// 内置示例验收：每道题都能打开、画出非空画面、题面进入对话、时间轴可分阶段。
// 用法：vite preview（4173）后 node scripts/samples-verify.mjs [cdpPort]
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.BASE_URL ?? "http://127.0.0.1:4173/";
const port = process.argv[2] ?? "9233";
const out = "artifacts/samples";
mkdirSync(out, { recursive: true });

const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = pages.find((item) => item.type === "page");
if (!page) throw new Error("请先启动带远程调试端口的浏览器");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push([name, Boolean(ok)]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
const shot = async (name) => {
  const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(`${out}/${name}.png`, Buffer.from(result.data, "base64"));
};

// 画布上的非背景像素数量：用来判断“到底画没画”。
const inkPixels = () =>
  evaluate(`(() => {
    const c = document.querySelector(".canvas-frame canvas");
    if (!c) return -1;
    const ctx = c.getContext("2d");
    if (!ctx) return -2;
    const { width, height } = c;
    const data = ctx.getImageData(0, 0, width, height).data;
    const bg = [data[0], data[1], data[2], data[3]].join(",");
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ([data[i], data[i + 1], data[i + 2], data[i + 3]].join(",") !== bg) ink++;
    }
    return ink;
  })()`);

const openPicker = async () => {
  await evaluate('document.querySelector(".sample-button").click()');
  await sleep(220);
};
const home = async () => {
  await evaluate('document.querySelector(".brand-button").click()');
  await sleep(500);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: base });
await sleep(1600);
await evaluate("localStorage.clear()");
await send("Page.reload");
await sleep(1500);

await openPicker();
const options = await evaluate(
  '[...document.querySelectorAll(".sample-option")].map(o => ({ title: o.querySelector(".sample-option-title")?.textContent, level: o.querySelector(".sample-option-level")?.textContent, desc: o.querySelector(".sample-option-desc")?.textContent }))',
);
check("示例选择器至少 9 道题", options.length >= 9, String(options.length));
check("至少 3 道压轴", options.filter((o) => o.level === "压轴").length >= 3, JSON.stringify(options.map((o) => o.level)));
check("每道都有标题与描述", options.every((o) => o.title && o.desc));
await shot("picker-1280");

const results = [];
for (let i = 0; i < options.length; i += 1) {
  if (i > 0) await openPicker();
  await evaluate(`document.querySelectorAll(".sample-option")[${i}].click()`);
  await sleep(1100);
  const state = await evaluate(`(() => {
    const total = document.querySelector(".time-readout")?.textContent ?? "";
    const problem = document.querySelector(".chat-scroll")?.textContent ?? "";
    const events = document.querySelectorAll(".event-item").length;
    const title = document.querySelector(".player-title")?.textContent ?? "";
    const error = document.querySelector(".notice.error")?.textContent ?? "";
    return { total, events, title, hasProblem: problem.includes("【题目】"), error };
  })()`);
  const ink = await inkPixels();
  results.push({ ...options[i], ...state, ink });
  check(`${options[i].title} 画出画面`, ink > 200, `${ink} px`);
  check(`${options[i].title} 题面进入对话`, state.hasProblem);
  check(`${options[i].title} 有分阶段事件`, state.events >= 2, `${state.events}`);
  check(`${options[i].title} 无错误提示`, !state.error, state.error);
  if (i === 1) await shot("sample-critical");
  if (i === 3) await shot("sample-pendulum");
  await home();
}

// 临界对照：同一道题切换两组条件
await openPicker();
const compareIndex = await evaluate(
  '[...document.querySelectorAll(".sample-option")].findIndex(o => o.textContent.includes("对照"))',
);
await evaluate(`document.querySelectorAll(".sample-option")[${compareIndex}].click()`);
await sleep(1000);
const beforeToggle = await evaluate(`(() => {
  const b = document.querySelector(".compare-toggle");
  return { exists: !!b, pressed: b?.getAttribute("aria-pressed"), label: b?.textContent?.trim() ?? "" };
})()`);
check("对照题出现切换按钮", beforeToggle.exists, beforeToggle.label);
await evaluate('document.querySelector(".compare-toggle").click()');
await sleep(900);
const afterToggle = await evaluate(`(() => {
  const b = document.querySelector(".compare-toggle");
  return { pressed: b?.getAttribute("aria-pressed"), label: b?.textContent?.trim() ?? "", events: document.querySelectorAll(".event-item").length, error: document.querySelector(".notice.error")?.textContent ?? "" };
})()`);
check("切到差一点后按钮翻转", afterToggle.pressed === "true", afterToggle.label);
check("对照切换后仍有动画", (await inkPixels()) > 200);
check("对照切换无错误", !afterToggle.error, afterToggle.error);
await shot("compare-near-miss");
await evaluate('document.querySelector(".compare-toggle").click()');
await sleep(900);
const backToggle = await evaluate('document.querySelector(".compare-toggle")?.getAttribute("aria-pressed")');
check("能切回恰好过顶", backToggle === "false", String(backToggle));
await home();

// 题面抽屉
await openPicker();
await evaluate('document.querySelectorAll(".sample-option")[2].click()');
await sleep(900);
await evaluate('document.querySelector(\'button[aria-label="查看原题"]\').click()');
await sleep(300);
const drawerText = await evaluate('document.querySelector(".problem-text")?.textContent ?? ""');
check("原题抽屉显示完整题面", drawerText.length > 40, `${drawerText.length} 字`);
await shot("drawer-problem");
await evaluate('document.querySelector(\'button[aria-label="关闭"]\').click()');
await sleep(200);

// 手机：底部弹出、可选中压轴题、无溢出
await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await sleep(300);
await home();
await openPicker();
const sheet = await evaluate(`(() => {
  const el = document.querySelector(".sample-picker");
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), vh: innerHeight };
})()`);
check("手机选择器在视口内", !!sheet && sheet.top >= 0 && sheet.bottom <= sheet.vh + 1 && sheet.w <= 375, JSON.stringify(sheet));
const last = await evaluate('document.querySelectorAll(".sample-option").length');
await evaluate(`document.querySelectorAll(".sample-option")[${last - 1}].click()`);
await sleep(1100);
const mobileInk = await inkPixels();
check("手机端压轴示例能画出画面", mobileInk > 200, `${mobileInk} px`);
check("手机端无横向溢出", (await evaluate("document.documentElement.scrollWidth - innerWidth")) <= 0);
await shot("sample-375");

writeFileSync(`${out}/report.json`, JSON.stringify({ options, results }, null, 2));
ws.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);