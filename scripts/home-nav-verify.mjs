// 首页导航验收：logo 返回、返回首页文案、浏览器后退/前进。
// 用法：先 vite preview（默认 4173）或指定 BASE_URL，再 node scripts/home-nav-verify.mjs [cdpPort]
const base = process.env.BASE_URL ?? "http://127.0.0.1:4173/";
const port = process.argv[2] ?? "9232";
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = pages.find((p) => p.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0; const pending = new Map(); const errors = [];
ws.addEventListener("message", ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  const w = pending.get(m.id); if (!w) return; pending.delete(m.id);
  m.error ? w.reject(new Error(JSON.stringify(m.error))) : w.resolve(m.result);
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (name, ok) => { checks.push([name, !!ok]); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
const homeVisible = () => ev('!!document.querySelector(".sample-button")');
const workVisible = () => ev('!!document.querySelector(".player-title")');
const clickSample = async () => {
  await ev('document.querySelector(".sample-button").click()');
  await sleep(250);
  await ev('document.querySelector(".sample-option")?.click()');
};
const clickText = (t) => ev(`[...document.querySelectorAll("button")].find(b => b.textContent.includes(${JSON.stringify(t)}))?.click()`);

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: base });
await sleep(1200);
check("初始为主页", await homeVisible());

await clickSample(); await sleep(1200);
check("内置示例进入工作台", await workVisible());
check("进入工作台写入 #/work", (await ev("location.hash")) === "#/work");

await ev('document.querySelector(".brand-button").click()'); await sleep(700);
check("点击 logo 返回主页", await homeVisible());
check("logo 返回后 hash 清空", (await ev("location.hash")) === "");

await clickSample(); await sleep(1200);
await clickText("返回首页"); await sleep(700);
check("点击“返回首页”回到主页", await homeVisible());

await clickSample(); await sleep(1200);
await ev("history.back()"); await sleep(700);
check("浏览器后退回到主页（不离站）", (await homeVisible()) && (await ev("location.href")).startsWith(base));
await ev("history.forward()"); await sleep(700);
check("浏览器前进恢复工作台", await workVisible());

check("无应用级控制台错误", errors.length === 0);
if (errors.length) console.log("errors:", JSON.stringify(errors));
ws.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
