// 手机端验收：演示优先布局（单列 + 播放/对话标签 + 画布吃满 + 触控尺寸）
// 用法：先 vite preview（默认 4173），再 node scripts/mobile-verify.mjs [cdpPort]
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.BASE_URL ?? "http://127.0.0.1:4173/";
const port = process.argv[2] ?? "9233";
const out = "artifacts/mobile";
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
const box = (selector) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; })()`);
const visible = (selector) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden"; })()`);
const overflow = () => evaluate("document.documentElement.scrollWidth - window.innerWidth");
const fontSize = (selector) => evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).fontSize`);

const setViewport = async (width, height, mobile = true) => {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await sleep(350);
};
const shot = async (name) => {
  const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(`${out}/${name}.png`, Buffer.from(result.data, "base64"));
};

await send("Page.enable");
await send("Runtime.enable");
await setViewport(375, 812);
await send("Page.navigate", { url: base });
await sleep(1600);
await evaluate("localStorage.clear()");
await send("Page.reload");
await sleep(1500);

// 首页
check("首页无横向溢出", (await overflow()) <= 0, String(await overflow()));
check("首页输入框 16px（防 iOS 缩放）", (await fontSize(".composer-text")) === "16px");
const attach = await box(".attach-button");
const sendBtn = await box(".send-button");
check("首页触控目标 ≥44", attach.w >= 44 && attach.h >= 44 && sendBtn.w >= 44 && sendBtn.h >= 44);
await shot("375-home");

// 进入示例
await evaluate('document.querySelector(".sample-button").click()');
await sleep(250);
check("示例选择器在手机上为底部弹出", (await box(".sample-picker")).top > 300);
await evaluate('document.querySelector(".sample-option").click()');
await sleep(1800);

// 工作台单列
check("出现播放/对话标签", await visible(".mobile-tabs"));
const tabsBox = await box(".mobile-tab");
check("标签高度 44", tabsBox.h >= 44, `${tabsBox.h}px`);
const columns = await evaluate('getComputedStyle(document.querySelector(".workspace")).gridTemplateColumns');
check("工作台为单列", columns.trim().split(/\s+/).length === 1, columns);
const player = await box(".player-panel");
check("播放器宽度占满", player.w >= 330, `${player.w}px`);
check("对话面板默认隐藏", !(await visible(".chat-panel")));
const canvas = await box(".canvas-frame");
check("画布高度 ≥200", canvas.h >= 200, `${canvas.h}px`);
const tbtn = await box(".tbtn");
const primary = await box(".tbtn.primary");
check("播放按钮 ≥44", tbtn.w >= 44 && tbtn.h >= 44 && primary.w >= 48);
check("路段/计时默认折叠", !(await visible(".player-meta")));
check("原理默认折叠", !(await visible("#explain-slot")));
const topbar = await box(".topbar");
check("顶栏高度 ≤56", topbar.h <= 56, `${topbar.h}px`);
const clip = await evaluate(
  '(() => { const p = document.querySelector(".player-panel"); return p.scrollHeight - p.clientHeight; })()',
);
check("播放页无内容被裁切", clip <= 1, `${clip}px`);

// 播放
await evaluate('document.querySelector(\'button[aria-label="播放"]\').click()');
await sleep(700);
const timeText = await evaluate('document.querySelector(".time-readout b")?.textContent ?? ""');
check("点播放后时间前进", Number(timeText) > 0, timeText);
await evaluate('document.querySelector(\'button[aria-label="暂停"]\')?.click()');
await shot("375-player");

// 折叠区展开
await evaluate('document.querySelector(".explain-toggle").click()');
await sleep(200);
check("原理可展开", await visible("#explain-slot"));
await evaluate('document.querySelector(".explain-toggle").click()');
await evaluate('document.querySelector(".meta-toggle").click()');
await sleep(200);
check("路段与计时可展开", await visible(".player-meta") && await visible(".scene-legend"));
await evaluate('document.querySelector(".meta-toggle").click()');
await sleep(200);

// 对话标签
await evaluate('document.querySelector("#work-tab-chat").click()');
await sleep(250);
check("切到对话后隐藏播放器", !(await visible(".player-panel")));
check("对话面板占满", await visible(".chat-panel"));
check("对话输入框 16px", (await fontSize(".chat-input")) === "16px");
const composerBottom = await evaluate(
  '(() => { const el = document.querySelector(".chat-input-wrap"); return Math.round(el.getBoundingClientRect().bottom); })()',
);
check("对话输入框在视口内", composerBottom <= 812, String(composerBottom));
const chatClip = await evaluate(
  '(() => { const p = document.querySelector(".chat-panel"); return p.scrollHeight - p.clientHeight; })()',
);
check("对话页无内容被裁切", chatClip <= 1, `${chatClip}px`);
await shot("375-chat");
await evaluate('document.querySelector("#work-tab-player").click()');
await sleep(250);
check("切回播放保留播放器", await visible(".player-panel"));

// 其它宽度
for (const [w, h] of [[360, 800], [390, 844], [375, 667]]) {
  await setViewport(w, h);
  await sleep(300);
  const of = await overflow();
  const c = await box(".canvas-frame");
  check(`${w}px 无横向溢出`, of <= 0, String(of));
  check(`${w}px 画布 ≥200`, c.h >= 200, `${c.h}px`);
}
await setViewport(375, 812);

// 横屏
await setViewport(812, 375);
await sleep(300);
check("横屏无横向溢出", (await overflow()) <= 0);
const landCanvas = await box(".canvas-frame");
check("横屏画布 ≥150", landCanvas.h >= 150, `${landCanvas.h}px`);
await shot("812-landscape");

ws.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);