// 核对多物体画布标签不重叠、读数不裁切、布局与单物体版一致。
import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.BASE_URL ?? "http://127.0.0.1:4173/";
const port = process.argv[2] ?? "9233";
const out = "artifacts/overlap";
mkdirSync(out, { recursive: true });
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = pages.find((p) => p.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0; const pending = new Map();
ws.addEventListener("message", ({ data }) => { const m = JSON.parse(data); const w = pending.get(m.id); if (!w) return; pending.delete(m.id); m.error ? w.reject(new Error(JSON.stringify(m.error))) : w.resolve(m.result); });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (n) => writeFileSync(`${out}/${n}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
const checks = []; const check = (n, ok, d = "") => { checks.push([n, !!ok]); console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " - " + d : ""}`); };
const loadSample = async (i) => { await ev('document.querySelector(".sample-button").click()'); await sleep(200); await ev(`document.querySelectorAll(".sample-option")[${i}].click()`); await sleep(1000); };
const seekEvent = async (i) => { await ev(`document.querySelectorAll(".event-item")[${i}].click()`); await sleep(400); };

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: base }); await sleep(1500);
await ev("localStorage.clear()"); await send("Page.reload"); await sleep(1400);

// 单物体参照
await loadSample(0);
const singleH = await ev('document.querySelector(".canvas-frame").getBoundingClientRect().height');
await shot("single-desktop");
// 多物体：t=0（两标签水平接近）与摆起时刻
await ev('document.querySelector(".brand-button").click()'); await sleep(400);
await loadSample(3);
const multiH = await ev('document.querySelector(".canvas-frame").getBoundingClientRect().height');
check("多物体画布高度接近单物体", Math.abs(multiH - singleH) < 60, `single=${Math.round(singleH)} multi=${Math.round(multiH)}`);
check("读数不在画布卡片内", await ev('!document.querySelector(".canvas-frame .multi-body-readouts")'));
check("读数在折叠区", await ev('!!document.querySelector("#player-meta .multi-body-readouts")'));
await shot("multi-desktop-t0");
await seekEvent(3);
await shot("multi-desktop-swing");

// 手机
await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await sleep(300);
await ev('document.querySelector(".brand-button").click()'); await sleep(400);
await loadSample(3);
await seekEvent(3);
const mob = await ev(`(() => { const c = document.querySelector(".canvas-frame").getBoundingClientRect(); const r = document.querySelector(".multi-body-readouts"); const meta = document.querySelector("#player-meta"); return { canvasH: Math.round(c.height), metaCollapsed: meta.classList.contains("is-collapsed"), readoutsVisible: !!r && getComputedStyle(r).display !== "none" && r.getBoundingClientRect().height > 0, overflow: document.documentElement.scrollWidth - innerWidth }; })()`);
check("手机画布占主视觉", mob.canvasH > 240, `${mob.canvasH}px`);
check("手机默认折叠读数", mob.metaCollapsed && !mob.readoutsVisible);
check("手机无横向溢出", mob.overflow <= 0, `${mob.overflow}`);
await shot("multi-mobile-swing");
await ev('document.querySelector(".meta-toggle").click()'); await sleep(300);
const fit = await ev(`(() => { const r = document.querySelector(".multi-body-readouts"); return { sw: r.scrollWidth, cw: r.clientWidth, h: Math.round(r.getBoundingClientRect().height) }; })()`);
check("展开后读数不裁切", fit.sw <= fit.cw + 1, JSON.stringify(fit));
await shot("multi-mobile-meta");
writeFileSync(`${out}/report.json`, JSON.stringify({ singleH, multiH, mob, fit }, null, 2));
ws.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);