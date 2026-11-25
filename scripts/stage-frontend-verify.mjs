// 本地契约服务 + 独立 Edge CDP：验证 stage_plan 的完整前端消费链路。
// 先启动 VITE_USE_MOCK_API=false 的 Vite 与 CDP 浏览器，再运行：
// UI_URL=http://127.0.0.1:5179/ CDP_URL=http://127.0.0.1:9230 node scripts/stage-frontend-verify.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.env.UI_URL ?? "http://127.0.0.1:5179/";
const endpoint = process.env.CDP_URL ?? "http://127.0.0.1:9230";
const fixture = process.env.STAGE_IMAGE ?? fileURLToPath(new URL("../fixtures/incline-spring-gap-2m.png", import.meta.url));
const out = process.argv[2] ?? "artifacts/stage-frontend";
mkdirSync(out, { recursive: true });
const plan = JSON.parse(readFileSync(new URL("../fixtures/stage-composition.reading.json", import.meta.url), "utf8"));
const missingPlan = JSON.parse(readFileSync(new URL("../fixtures/stage-missing-distance.reading.json", import.meta.url), "utf8"));

const pages = await (await fetch(endpoint + "/json/list")).json();
const page = pages.find((item) => item.type === "page");
if (!page) throw new Error("请先启动带远程调试端口的独立浏览器。");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
let seq = 0;
const pending = new Map();
const errors = [];
const apiRequests = [];
let scenario = "full";
let commandBodies = 0;

function distancePlan(distance) {
  return { ...plan, stages: plan.stages.map((stage, index) => index === 2 ? { ...stage, end: { kind: "distance", distanceM: distance } } : stage) };
}
function fulfill(requestId, body, status = 200) {
  void send("Fetch.fulfillRequest", {
    requestId, responseCode: status,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Cache-Control", value: "no-store" }],
    body: Buffer.from(JSON.stringify(body)).toString("base64"),
  });
}

ws.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Fetch.requestPaused") {
    const request = message.params.request;
    apiRequests.push({ url: request.url, method: request.method, scenario });
    const postData = request.postData ?? "";
    if (postData.includes('name="command"')) {
      commandBodies++;
      if (!postData.includes('name="currentPlan"') || !postData.includes("projectile")) {
        fulfill(message.params.requestId, { message: "currentPlan 不完整" }, 400);
      } else {
        fulfill(message.params.requestId, { status: "ok", intent: { type: "truncate_stages", throughStageIndex: 0 } });
      }
      return;
    }
    if (scenario === "error") fulfill(message.params.requestId, { message: "测试接口不可用" }, 502);
    else if (scenario === "missing") fulfill(message.params.requestId, {
      status: "needs_input", reading: missingPlan, missingKeys: ["/stages/2/end/distanceM"], fieldErrors: [], message: "请补齐水平距离",
    });
    else if (scenario === "before") fulfill(message.params.requestId, { status: "ok", reading: distancePlan(10), assumptions: [] });
    else if (scenario === "edge") fulfill(message.params.requestId, { status: "ok", reading: distancePlan(9), assumptions: [] });
    else fulfill(message.params.requestId, { status: "ok", reading: distancePlan(5), assumptions: [] });
  }
  if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
  else waiter.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(100);
  }
  throw new Error("等待超时：" + expression);
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  await sleep(120);
}
async function screenshot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out + "/" + name + ".png", Buffer.from(data, "base64"));
}
const report = [];
function check(name, condition, detail = "") {
  report.push({ name, passed: Boolean(condition), detail });
  console.log((condition ? "✓ " : "✗ ") + name + (condition ? "" : " " + detail));
  if (!condition) process.exitCode = 1;
}
async function reload() {
  await send("Page.navigate", { url: base + "?test=" + Date.now() });
  await waitFor('document.readyState === "complete" && !!document.querySelector(".sample-button")');
  await sleep(150);
}
async function upload(nextScenario) {
  scenario = nextScenario;
  const root = await send("DOM.getDocument", { depth: 1 });
  const input = await send("DOM.querySelector", { nodeId: root.root.nodeId, selector: 'input[type="file"]' });
  await send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [fixture] });
  await waitFor('!document.querySelector(".send-button")?.disabled');
  await click(".send-button");
  await waitFor('!!document.querySelector(".workspace")');
}
const eventText = () => evaluate('document.querySelector(".event-index")?.textContent ?? ""');
const speedCaption = () => evaluate('document.querySelector("#player-speed")?.textContent ?? ""');
const clickLastEvent = async () => {
  await evaluate('document.querySelectorAll(".event-item")[document.querySelectorAll(".event-item").length - 1]?.click()');
  await sleep(150);
};
const canvasNonBlank = () => evaluate(`(() => {
  const canvas = document.querySelector("canvas");
  if (!canvas) return false;
  const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let marks = 0;
  for (let i = 0; i < data.length; i += 388) if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) marks++;
  return marks > 20;
})()`);

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*api/animation/plan*" }, { urlPattern: "*functions/v1/app*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  // 1. 完整组合
  await reload();
  await upload("full");
  await waitFor('document.querySelector(".player-title")?.textContent.includes("抛体")');
  check("完整 stage_plan 进入有序阶段工作台", await evaluate('document.querySelector(".player-title").textContent.includes("斜面") && document.querySelector(".player-title").textContent.includes("抛体")'));
  check("阶段画布非空", await canvasNonBlank());
  check("完整时间轴含离桌与落地", (await eventText()).includes("离开桌沿") && (await eventText()).includes("落地"));
  await click('button[aria-label="查看原题"]');
  await waitFor('!!document.querySelector("[data-testid=stage-plan-editor]")');
  check("动态条件表含4个有序阶段", await evaluate('document.querySelectorAll(".stage-editor-card").length === 4'));
  check("嵌套距离路径绑定到5m输入", await evaluate('document.querySelector("input[data-field-path=\\"/stages/2/end/distanceM\\"]")?.value === "5"'));
  await screenshot("full-conditions-1440");
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await sleep(200);
  check("375px 阶段条件抽屉无横向溢出", await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  await screenshot("full-conditions-375");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await click('.drawer .icon-button[aria-label="关闭"]');
  await click('button[aria-label="播放"]');
  await sleep(450);
  check("播放推进共享物理时间", await evaluate('Number(document.querySelector(".track").getAttribute("aria-valuenow")) > 0'));
  await click('button[aria-label="暂停"]');
  await clickLastEvent();
  check("落地末帧保留入射速度与 landed", (await speedCaption()).includes("6.40") && (await speedCaption()).includes("landed"));
  await screenshot("full-landed-1440");
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await sleep(200);
  check("375px 阶段工作台无横向溢出", await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  check("375px 阶段画布收缩到容器内", await evaluate('document.querySelector("canvas").getBoundingClientRect().width <= innerWidth'));
  await screenshot("full-landed-375");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  // 2. 提前停止
  await reload();
  await upload("before");
  await clickLastEvent();
  check("提前停止无离桌/最高点/落地事件", !/离开桌沿|最高点|落地/.test(await eventText()));
  check("提前停止末帧静止且 stop_before_target", (await speedCaption()).includes("大小 0 米每秒") && (await speedCaption()).includes("stop_before_target"));
  check("停止字幕不进入飞行", !/平抛|飞行|落地/.test(await evaluate('document.querySelector(".explain")?.textContent ?? ""')));
  check("提前停止画布仍非空（含 plannedEnd）", await canvasNonBlank());
  await screenshot("stop-before-target-1440");

  // 3. 恰停桌沿
  await reload();
  await upload("edge");
  await clickLastEvent();
  check("恰停桌沿无离桌事件", !(await eventText()).includes("离开桌沿"));
  check("恰停末帧 stop_at_target 且静止", (await speedCaption()).includes("stop_at_target") && (await speedCaption()).includes("大小 0 米每秒"));
  await screenshot("stop-at-target-1440");

  // 4. 对话截断
  await reload();
  await upload("full");
  await evaluate(`(() => {
    const input = document.querySelector(".chat-input");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, "只看斜面");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await click(".chat-input-row .send-button");
  await waitFor('document.querySelector(".chat-scroll")?.textContent.includes("已保留前 1 个阶段")');
  check("truncate_stages 提交完整 currentPlan", commandBodies === 1, String(commandBodies));
  check("前缀标题与时间轴只保留斜面", await evaluate('document.querySelector(".player-title").textContent.trim() === "斜面" && document.querySelector(".track").getAttribute("aria-valuemax") === "1.2"'));
  check("前缀无转向/水平/飞行事件", !/无损转向|到达目标|离开桌沿|落地/.test(await eventText()));
  await clickLastEvent();
  check("prefix_end 末帧保持斜向6m/s", (await speedCaption()).includes("prefix_end") && (await speedCaption()).includes("大小 6.00 米每秒"));
  await screenshot("prefix-incline-1440");

  // 5. 缺距离 → 定位输入 → 补值后本地重算
  await reload();
  await upload("missing");
  await waitFor('!!document.querySelector(".notice.info")');
  await evaluate('[...document.querySelectorAll(".notice button")].find((button) => button.textContent.includes("去补齐"))?.click()');
  await waitFor('!!document.querySelector("input[data-field-path=\\"/stages/2/end/distanceM\\"]")');
  check("缺失距离定位到可编辑嵌套输入", await evaluate('document.querySelector("input[data-field-path=\\"/stages/2/end/distanceM\\"]")?.getAttribute("aria-invalid") === "true"'));
  await evaluate(`(() => {
    const input = document.querySelector('input[data-field-path="/stages/2/end/distanceM"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "10");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await evaluate('[...document.querySelectorAll(".drawer button")].find((button) => button.textContent.includes("应用条件"))?.click()');
  await waitFor('!!document.querySelector("figure[data-renderer=stage]")');
  await clickLastEvent();
  check("补值后重算为提前停止结局", (await speedCaption()).includes("stop_before_target") && !/离开桌沿|落地/.test(await eventText()));
  await screenshot("missing-filled-recomputed");

  // 6. 内置示例不依赖识别接口
  scenario = "error";
  const beforeSampleRequests = apiRequests.length;
  await reload();
  await click(".sample-button");
  await sleep(300);
  await click(".sample-option");
  await waitFor('!!document.querySelector("figure[data-renderer=stage]")');
  await sleep(500);
  let painted = await canvasNonBlank();
  for (let i = 0; i < 4 && !painted; i++) { await sleep(400); painted = await canvasNonBlank(); }
  check("接口失败时内置示例仍本地打开", painted);
  check("内置示例零识别请求", apiRequests.length === beforeSampleRequests, String(apiRequests.length - beforeSampleRequests));

  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await sleep(250);
  check("375px 工作台无横向溢出", await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  await screenshot("legacy-sample-375");
  check("控制台与运行时零错误", errors.length === 0, errors.join("\n"));
} finally {
  writeFileSync(out + "/report.json", JSON.stringify({ report, errors, apiRequests, commandBodies }, null, 2));
  ws.close();
}
