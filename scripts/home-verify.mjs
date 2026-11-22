// 首页验收：保持极简，同时确认粘贴/拖拽/校验/压缩/草稿等不可见能力可用。
// 用法：先 vite preview（默认 4173），再 node scripts/home-verify.mjs [cdpPort]
import { writeFileSync, mkdirSync } from "node:fs";

const base = process.env.BASE_URL ?? "http://127.0.0.1:4173/";
const port = process.argv[2] ?? "9233";
const tmp = "C:/Temp/home-verify";
mkdirSync(tmp, { recursive: true });
const fixture = new URL("../fixtures/incline-spring-gap-2m.png", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const badFile = `${tmp}/bad.txt`;
const bigFile = `${tmp}/big.png`;
writeFileSync(badFile, "not an image");
writeFileSync(bigFile, Buffer.alloc(9 * 1024 * 1024));

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
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const text = (selector) =>
  evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText?.trim() ?? ""`);

const upload = async (filePath) => {
  const { root } = await send("DOM.getDocument");
  const { nodeId } = await send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: 'input[type="file"]',
  });
  await send("DOM.setFileInputFiles", { nodeId, files: [filePath] });
};

await send("Page.enable");
await send("Runtime.enable");
await send("DOM.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: base });
await sleep(1200);
await evaluate("localStorage.clear()");
await send("Page.reload");
await sleep(1500);

check("示例仍是文字按钮", (await text(".sample-button")).includes("内置示例"));
check(
  "没有引导/样例/最近等附加块",
  await evaluate(
    '!document.querySelector(".sample-card, .home-steps, .text-samples, .home-capabilities, .home-recents")',
  ),
);
check("保留一行能力说明", /单题/.test(await text(".home-note")));

await evaluate(`(() => {
  const ta = document.querySelector(".composer-text");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, "草稿恢复测试题干");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await sleep(500);
await send("Page.reload");
await sleep(1500);
check("刷新后恢复草稿", (await evaluate('document.querySelector(".composer-text").value')).includes("草稿恢复测试"));

await upload(badFile);
await sleep(400);
check("非图片被拦截", /JPG \/ PNG/.test(await text(".composer-error")), await text(".composer-error"));
await upload(bigFile);
await sleep(400);
check("超 8MB 被拦截", /8MB/.test(await text(".composer-error")), await text(".composer-error"));

await upload(fixture);
await sleep(1200);
check("有效题图出现预览", await evaluate('!!document.querySelector(".composer-preview img")'));

await evaluate('document.querySelector(\'button[aria-label="开始识别"]\').click()');
await sleep(1800);
check("识别失败有提示", (await text(".notice")).length > 0);

ws.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);