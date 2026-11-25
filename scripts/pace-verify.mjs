// 自动慢放验收（对齐 #52 后的题库/选择器）：系数只放慢不加速、统一时间缩放、可开关。
// 用法: node scripts/pace-verify.mjs [cdp-port]   默认 9233，目标 http://127.0.0.1:4173/
import { writeFileSync, mkdirSync } from "node:fs";
const port = process.argv[2] ?? "9233";
const base = process.env.BASE_URL ?? "http://127.0.0.1:4173/";
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = pages.find((p) => p.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0; const pending = new Map();
ws.addEventListener("message", ({ data }) => { const m = JSON.parse(data); const w = pending.get(m.id); if (!w) return; pending.delete(m.id); m.error ? w.reject(new Error(JSON.stringify(m.error))) : w.resolve(m.result); });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " - " + extra : ""}`); };
const shot = async (name) => { mkdirSync("artifacts/pace", { recursive: true }); writeFileSync(`artifacts/pace/${name}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64")); };
const time = () => ev('parseFloat(document.querySelector(".time-readout b")?.textContent ?? "0")');
const mode = () => ev('document.querySelector(".playback-mode")?.textContent ?? ""');
const paceOf = async () => { const m = await mode(); const hit = /放慢至 ([\d.]+)×/.exec(m); return hit ? Number(hit[1]) : 1; };

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: base }); await sleep(1500);
await ev("localStorage.clear()"); await send("Page.reload"); await sleep(1400);
await ev('document.querySelector(".sample-button").click()'); await sleep(300);
const count = await ev('document.querySelectorAll(".sample-option").length');
check("选择器列出当前题库", count >= 4, String(count));

for (let i = 0; i < count; i++) {
  await send("Page.navigate", { url: base }); await sleep(1200);
  await ev('document.querySelector(".sample-button").click()'); await sleep(300);
  const title = await ev(`document.querySelectorAll(".sample-option-title")[${i}]?.textContent ?? "?"`);
  await ev(`document.querySelectorAll(".sample-option")[${i}].click()`); await sleep(900);
  check(`#${i} 默认开启自动慢放`, await ev('document.querySelector(".auto-slow-control input")?.checked === true'));
  const pace = await paceOf();
  const total = await ev('parseFloat((document.querySelector(".time-readout")?.textContent ?? "0").match(/\\/\\s*([\\d.]+)/)?.[1] ?? "99")');
  check(`#${i} 系数只放慢不加速 (0,1]`, pace > 0 && pace <= 1, `${title} pace=${pace}`);
  await ev('document.querySelector(\'button[aria-label="播放"]\').click()'); await sleep(1000);
  const adv = await time();
  check(`#${i} 1秒墙钟推进≈系数（统一缩放）`, Math.abs(adv - Math.min(pace, total)) < 0.2, `adv=${adv.toFixed(3)} pace=${pace} total=${total}`);
  if (pace < 1) check(`#${i} 快动画确实被放慢`, adv < 0.95, String(adv.toFixed(3)));
  await ev('document.querySelector(\'button[aria-label="暂停"]\')?.click()'); await sleep(120);
  await ev('document.querySelector(".auto-slow-control input").click()'); await sleep(120);
  check(`#${i} 关闭后回到原始流速`, (await mode()) === "全程播放");
  await ev('document.querySelector(\'button[aria-label="从头重播"]\').click()'); await sleep(1000);
  const raw = await time();
  check(`#${i} 关闭后1秒墙钟推进≈1`, Math.abs(raw - Math.min(1, total)) < 0.2, String(raw.toFixed(3)));
  await ev('document.querySelector(\'button[aria-label="暂停"]\')?.click()'); await sleep(120);
  await ev('document.querySelector(".auto-slow-control input").click()'); await sleep(120);
  if (i === 0) await shot("pace-desktop");
}

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(400);
check("手机可见自动慢放开关", await ev('!!document.querySelector(".auto-slow-control input")'));
const overflow = await ev("document.documentElement.scrollWidth - window.innerWidth");
check("手机无横向溢出", overflow <= 0, String(overflow));
await shot("pace-mobile");
console.log(`${pass}/${pass + fail} passed`);
ws.close();
process.exit(fail ? 1 : 0);