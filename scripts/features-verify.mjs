// 功能路线图验收：临界扫描/双画布/受力/能量条/逐问/练习/标注/收藏/分享/导出。
// 用法: node scripts/features-verify.mjs [cdp-port]   默认 9233，目标 http://127.0.0.1:4173/
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
const port = process.argv[2] ?? "9233";
const base = process.env.BASE_URL ?? "http://127.0.0.1:4173/";
const dl = "F:\\Temp\\features-verify";
mkdirSync(dl, { recursive: true });
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = pages.find((p) => p.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0; const pending = new Map();
let lastPrompt = null;
ws.addEventListener("message", ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === "Page.javascriptDialogOpening") { lastPrompt = m.params.defaultValue ?? null; void send("Page.handleJavaScriptDialog", { accept: true }); return; }
  const w = pending.get(m.id); if (!w) return; pending.delete(m.id); m.error ? w.reject(new Error(JSON.stringify(m.error))) : w.resolve(m.result);
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " - " + extra : ""}`); };
const shot = async (name) => { mkdirSync("artifacts/features", { recursive: true }); writeFileSync(`artifacts/features/${name}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64")); };
const loadSample = async (i) => {
  await send("Page.navigate", { url: base }); await sleep(1200);
  await ev('document.querySelector(".sample-button").click()'); await sleep(300);
  await ev(`document.querySelectorAll(".sample-option")[${i}].click()`); await sleep(900);
};
const canvasUrl = () => ev('document.querySelector(".canvas-frame canvas")?.toDataURL().length ?? 0');

await send("Page.enable"); await send("Runtime.enable");
await send("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"], origin: base.replace(/\/$/, "") }).catch(() => {});
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl, eventsEnabled: true }).catch(() => {});
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: base }); await sleep(1400);
await ev("localStorage.clear()"); await send("Page.reload"); await sleep(1300);

check("首页有错题本入口", await ev('!!document.querySelector(".favorites-button")'));
await ev('document.querySelector(".favorites-button").click()'); await sleep(250);
check("空错题本提示", await ev('!!document.querySelector(".favorites-empty")'));
await ev('document.querySelector(".favorites-drawer .ghost-button").click()'); await sleep(200);

await loadSample(0);
check("视图工具条齐全", await ev('document.querySelectorAll(".view-tools .tool-toggle").length') >= 6);
check("临界面板与滑杆", await ev('!!document.querySelector(".critical-slider")'));
check("临界结局标记非空", ((await ev('document.querySelector(".critical-outcome")?.textContent ?? ""')) || "").length > 0);
const critCount = await ev('document.querySelectorAll(".critical-point").length');
check("扫出临界值按钮", critCount >= 1, String(critCount));
await ev('document.querySelector(".critical-point")?.click()'); await sleep(200);
await ev('[...document.querySelectorAll(".critical-actions button")].find(b=>b.textContent.includes("并排对照"))?.click()'); await sleep(500);
check("双画布同步对照", await ev('document.querySelectorAll(".canvas-stack.is-dual canvas").length') === 2);
check("对照标签", await ev('!!document.querySelector(".dual-label")'));
await shot("features-dual");
await ev('[...document.querySelectorAll(".critical-actions button")].find(b=>b.textContent.includes("退出对照"))?.click()'); await sleep(300);
check("退出对照回单画布", await ev('document.querySelectorAll(".canvas-stack canvas").length') === 1);

const before = await canvasUrl();
await ev('[...document.querySelectorAll(".view-tools .tool-toggle")].find(b=>b.textContent==="受力")?.click()'); await sleep(300);
check("受力开关 pressed", await ev('[...document.querySelectorAll(".view-tools .tool-toggle")].find(b=>b.textContent==="受力")?.getAttribute("aria-pressed")') === "true");
check("受力图层改变画布", (await canvasUrl()) !== before);
await ev('[...document.querySelectorAll(".view-tools .tool-toggle")].find(b=>b.textContent==="分解")?.click()'); await sleep(300);
check("分解开关 pressed", await ev('[...document.querySelectorAll(".view-tools .tool-toggle")].find(b=>b.textContent==="分解")?.getAttribute("aria-pressed")') === "true");
await shot("features-forces");

check("能量条分段", await ev('document.querySelectorAll(".energy-bar .energy-seg").length') >= 1);
check("能量图例数值", await ev('!!document.querySelector(".energy-bar-legend b")'));

const tabs = await ev('document.querySelectorAll(".question-tab").length');
check("逐问标签存在", tabs >= 2, String(tabs));
await ev('document.querySelectorAll(".question-tab")[1]?.click()'); await sleep(250);
check("逐问公式展示", ((await ev('document.querySelector(".question-formula")?.textContent ?? ""')) || "").length > 0);
await ev('[...document.querySelectorAll(".question-body button")].find(b=>b.textContent.includes("跳到"))?.click()'); await sleep(250);
check("跳到该问时刻改变时间", (await ev('parseFloat(document.querySelector(".time-readout b")?.textContent ?? "0")')) > 0);

await ev('[...document.querySelectorAll(".view-tools .tool-toggle")].find(b=>b.textContent==="练习")?.click()'); await sleep(300);
check("练习遮罩出现", await ev('!!document.querySelector(".practice-mask")'));
check("画布被遮罩模糊", await ev('document.querySelector(".canvas-stack")?.classList.contains("is-blinded")') === true);
await shot("features-practice");
await ev('document.querySelectorAll(".practice-option")[0]?.click()'); await sleep(150);
await ev('[...document.querySelectorAll(".practice-actions button")].find(b=>b.textContent.includes("提交预测"))?.click()'); await sleep(200);
check("提交后给出判定", await ev('!!document.querySelector(".practice-verdict")'));
await ev('[...document.querySelectorAll(".practice-actions button")].find(b=>b.textContent.includes("播放验证"))?.click()'); await sleep(400);
check("揭示后遮罩消失", await ev('!document.querySelector(".practice-mask")'));
await ev('button[aria-label="暂停"]?.click()'); await sleep(150);

await ev('[...document.querySelectorAll(".view-tools .tool-toggle")].find(b=>b.textContent==="标注")?.click()'); await sleep(250);
const box = await ev('(()=>{const r=document.querySelector(".canvas-frame").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()');
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x + box.w * 0.3, y: box.y + box.h * 0.4, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + box.w * 0.5, y: box.y + box.h * 0.5, button: "left", buttons: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + box.w * 0.5, y: box.y + box.h * 0.5, button: "left", clickCount: 1 });
await sleep(250);
check("标注笔画后可清空", await ev('!!document.querySelector(".annotation-clear")'));
await ev('document.querySelector(".annotation-clear")?.click()'); await sleep(150);
await ev('[...document.querySelectorAll(".view-tools .tool-toggle")].find(b=>b.textContent==="标注")?.click()'); await sleep(150);

await ev('[...document.querySelectorAll(".player-head button")].find(b=>b.textContent.includes("收藏"))?.click()'); await sleep(250);
check("收藏反馈", await ev('!!document.querySelector(".save-note")'));
await ev('[...document.querySelectorAll(".player-head button")].find(b=>b.textContent.includes("分享"))?.click()'); await sleep(400);
const clip = await ev("navigator.clipboard.readText().catch(() => null)");
const shareUrl = typeof clip === "string" && clip.includes("#s=") ? clip : lastPrompt;
check("分享链接含 #s=", typeof shareUrl === "string" && shareUrl.includes("#s="), String(shareUrl).slice(0, 60));
const savedTime = await ev('parseFloat(document.querySelector(".time-readout b")?.textContent ?? "0")');
await send("Page.navigate", { url: shareUrl });
for (let i = 0; i < 20 && !(await ev('!!document.querySelector(".canvas-frame canvas")')); i += 1) await sleep(200);
// 分享还原是异步装配：轮询时刻读数直到收敛，避免固定 sleep 造成的偶发误报。
let restored = false;
for (let i = 0; i < 40; i += 1) {
  restored = Math.abs((await ev('parseFloat(document.querySelector(".time-readout b")?.textContent ?? "0")')) - savedTime) < 0.35;
  if (restored) break;
  await sleep(200);
}
check("分享链接复现题目", await ev('!!document.querySelector(".canvas-frame canvas")'));
check("分享链接复现时刻", restored, `saved=${savedTime} got=${await ev('parseFloat(document.querySelector(".time-readout b")?.textContent ?? "-1")')}`);

const t0 = Date.now();
await ev('[...document.querySelectorAll(".export-menu button")].find(b=>b.textContent==="存图")?.click()'); await sleep(900);
const fresh = (ext) => readdirSync(dl).some((f) => f.endsWith(ext) && statSync(`${dl}/${f}`).mtimeMs >= t0 - 500);
check("导出 PNG 落盘", fresh(".png"), "err=" + (await ev('document.querySelector(".export-error")?.textContent ?? ""')));
await ev('[...document.querySelectorAll(".export-menu button")].find(b=>b.textContent==="GIF")?.click()');
for (let i = 0; i < 40 && !fresh(".gif"); i++) await sleep(300);
check("导出 GIF 落盘", fresh(".gif"));
check("打印讲义组件挂载", await ev('!!document.querySelector(".print-sheet")'));

await send("Page.navigate", { url: base }); await sleep(1200);
await ev('document.querySelector(".favorites-button").click()'); await sleep(300);
check("错题本列出收藏", await ev('document.querySelectorAll(".favorites-item").length') >= 1);
await shot("features-favorites");
await ev('[...document.querySelectorAll(".favorites-item button")].find(b=>b.textContent==="加载")?.click()'); await sleep(900);
check("收藏加载回工作台", await ev('!!document.querySelector(".canvas-frame canvas")'));

await loadSample(4);
check("传送带 HUD 相对带面读数", ((await ev('document.querySelector(".canvas-frame canvas")?.getAttribute("aria-label") ?? ""')) || "").length > 0);
check("传送带示例进入工作台", await ev('!!document.querySelector(".critical-panel")'));
await shot("features-conveyor");
await loadSample(5);
check("磁场示例可播放", await ev('!!document.querySelector(".canvas-frame canvas")'));
await ev('[...document.querySelectorAll(".view-tools .tool-toggle")].find(b=>b.textContent==="受力")?.click()'); await sleep(300);
await shot("features-magnetic");
check("磁场题逐问标签", await ev('document.querySelectorAll(".question-tab").length') >= 2);

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(500);
check("手机无横向溢出", (await ev("document.documentElement.scrollWidth - window.innerWidth")) <= 0);
check("手机工具条可见", await ev('!!document.querySelector(".view-tools")'));
await shot("features-mobile");
console.log(`${pass}/${pass + fail} passed`);
ws.close();
process.exit(fail ? 1 : 0);
