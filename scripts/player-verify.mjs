// 使用独立 Edge/Chromium CDP 会话验证真实播放器，沿用仓库浏览器测试的运行方式。
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.UI_URL ?? "http://127.0.0.1:4174/";
const endpoint = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const out = process.argv[2] ?? "artifacts/player";
mkdirSync(out, { recursive: true });
const pages = await (await fetch(endpoint + "/json/list")).json();
const page = pages.find((item) => item.type === "page");
if (!page) throw new Error("请先启动带远程调试端口的独立浏览器。");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
let seq = 0;
const pending = new Map();
const errors = [];
let blockedApiRequests = 0;
ws.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Fetch.requestPaused") {
    blockedApiRequests++;
    void send("Fetch.fulfillRequest", {
      requestId: message.params.requestId, responseCode: 409,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify({ message: "测试：识别接口未启用" })).toString("base64"),
    });
  }
  if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
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
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 旧时间轴的 ARIA 数值保留两位显示精度；用原有进度填充比例核对精确物理时间。
const time = () => evaluate('parseFloat(document.querySelector(".track-fill").style.width) / 100 * 2.393162693419792');
const click = async (selector) => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(100); };
const eventClick = async (index) => { await evaluate(`document.querySelectorAll(".event-item")[${index}].click()`); await sleep(100); };
const report = [];
function check(name, condition, detail = "") {
  report.push({ name, passed: Boolean(condition), detail });
  if (!condition) process.exitCode = 1;
}
async function screenshot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out + "/" + name + ".png", Buffer.from(data, "base64"));
}
async function key(key, code = key) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
  await sleep(100);
}
await send("Page.enable");
await send("Runtime.enable");
// 模拟生产识别接口返回409，内置示例须完全绕过该接口。
await send("Fetch.enable", { patterns: [{ urlPattern: "*functions/v1/app*" }, { urlPattern: "*api/animation/plan*" }] });
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: base });
await sleep(1500);
await click(".sample-button");
await sleep(300);
await click(".sample-option");
await sleep(1500);
check("默认1倍速、关键点暂停关闭", await evaluate('document.querySelector(".rate-control select").value === "1" && !document.querySelector(".auto-pause-control input").checked'));
check("释放静止速度为0", (await evaluate('document.querySelector("#player-speed").textContent')).includes("大小 0 米每秒"));
check("图例来自已应用条件", (await evaluate('document.querySelector(".scene-legend").textContent')).includes("0.50"));
check("生产接口设为409时内置示例仍打开，且未请求接口", blockedApiRequests === 0 && await evaluate('!!document.querySelector("canvas")'));
check("旧播放行、滑轨、事件列表之后才出现辅助选项", await evaluate('document.querySelector(".timeline").nextElementSibling?.classList.contains("playback-auxiliary") && document.querySelector(".transport-row").nextElementSibling?.classList.contains("timeline")'));
await eventClick(1);
check("转向时读数4.02，速度取自物理样本", (await evaluate('document.querySelector("#player-speed").textContent')).includes("4.02"));
await eventClick(3);
check("最大压缩读数为0", (await evaluate('document.querySelector("#player-speed").textContent')).includes("大小 0 米每秒"));
await screenshot("standard-max-1440");
const beforeSelect = await time();
await evaluate('document.querySelector(".rate-control select").focus()');
await key("Home");
check("原生倍率控件支持键盘且不移动时间轴", await evaluate('document.querySelector(".rate-control select").value === "0.25"') && await time() === beforeSelect);
await evaluate('document.querySelector(".track").focus()');
await key("ArrowLeft");
check("时间轴保留原有左键定位行为", Math.abs(await time() - (beforeSelect - 0.05)) < 0.000005);
await eventClick(2);
await click(".segment-control");
check("本段从弹簧起点慢放，倍率0.25", await evaluate('document.querySelector(".playback-mode").textContent.includes("压缩与反弹") && document.querySelector(".rate-control select").value === "0.25"'));
await sleep(1000);
const end = await time();
check("本段精确停在段末", Math.abs(end - 2.393162693419792) < 1e-12 && await evaluate('!!document.querySelector("button[aria-label=播放]")'), String(end));
await click(".segment-control");
check("退出本段回到全程及1倍速", await evaluate('document.querySelector(".playback-mode").textContent === "全程播放" && document.querySelector(".rate-control select").value === "1"'));
await eventClick(0);
await click(".auto-pause-control input");
await click('button[aria-label="播放"]');
await sleep(2300);
const firstPause = await time();
check("首次实际经过坡底事件时暂停", Math.abs(firstPause - 1.987629387324713) < 0.000005, String(firstPause));
await click('button[aria-label="播放"]');
await sleep(500);
const secondPause = await time();
check("继续播放可到下一事件，不滞留原事件", Math.abs(secondPause - 2.2360830607403024) < 0.000005, String(secondPause));
await click(".auto-pause-control input");
await click(".segment-control");
await eventClick(0);
check("跳到本段范围外退出本段模式", await evaluate('document.querySelector(".playback-mode").textContent === "全程播放"'));
await eventClick(2);
await click(".segment-control");
const track = await evaluate('(() => { const r = document.querySelector(".track").getBoundingClientRect(); return {x:r.left + r.width * 0.1, y:r.top + r.height / 2}; })()');
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: track.x, y: track.y, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: track.x + 5, y: track.y, button: "left", buttons: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: track.x + 5, y: track.y, button: "left", clickCount: 1 });
await sleep(100);
check("实际拖动时间轴到范围外结束本段并暂停", await evaluate('document.querySelector(".playback-mode").textContent === "全程播放" && !!document.querySelector("button[aria-label=播放]")'));

// 修改题设后，图例与场景一起更新，本段模式失效。
await eventClick(2);
await click(".segment-control");
await click(".player-head .ghost-button");
await evaluate(`(() => {
  const row = [...document.querySelectorAll(".cond-table tr")].find((row) => row.textContent.includes("动摩擦因数"));
  const input = row.querySelector("input");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "0.4");
  input.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await evaluate('[...document.querySelectorAll(".drawer button")].find((button) => button.textContent.includes("应用条件")).click()');
await sleep(200);
check("应用新题设结束本段并更新AB摩擦图例", await evaluate('document.querySelector(".playback-mode").textContent === "全程播放" && document.querySelector(".scene-legend").textContent.includes("0.40")'));

for (const width of [375, 750, 1440]) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(250);
  const layouts = [];
  for (const index of [0, 1, 2, 3, 4]) {
    await eventClick(index);
    layouts.push(await evaluate(`(() => {
      const canvas = document.querySelector("canvas").getBoundingClientRect();
      const controls = document.querySelector(".transport").getBoundingClientRect();
      const slot = document.querySelector(".explanation-slot").getBoundingClientRect();
      return { canvasTop: canvas.top, canvasHeight: canvas.height, controlsTop: controls.top, explanationHeight: slot.height };
    })()`));
  }
  check(width + "px 阶段切换布局稳定", layouts.every((value) => Object.keys(value).every((key) => Math.abs(value[key] - layouts[0][key]) < 0.5)), JSON.stringify(layouts));
  check(width + "px 无横向溢出", await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  check(width + "px 图例位于画布外", await evaluate('document.querySelector(".scene-legend").getBoundingClientRect().bottom <= document.querySelector("canvas").getBoundingClientRect().top'));
  await eventClick(3);
  await screenshot("max-" + width);
  await eventClick(0);
  await screenshot("release-" + width);
}
// 放大文字和减少动态效果下，控件仍可显示并使用。
await send("Emulation.setDeviceMetricsOverride", { width: 750, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await evaluate('document.documentElement.style.zoom = "2"');
await sleep(300);
check("200%缩放与减少动态效果下控件仍可见", await evaluate('document.querySelector(".rate-control select").getBoundingClientRect().width > 0 && document.documentElement.scrollWidth <= innerWidth'));
await screenshot("zoom-200");
check("无运行时或控制台错误", errors.length === 0, errors.join("\n"));
writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
for (const item of report) console.log((item.passed ? "✓ " : "✗ ") + item.name + (item.passed ? "" : " " + item.detail));
ws.close();
