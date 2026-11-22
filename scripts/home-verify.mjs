// 首页增强验收：引导/示例卡片/文字样例/草稿/校验/旋转裁剪/最近记录。
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
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: base });
await sleep(1200);
await evaluate("localStorage.clear()");
await send("Page.reload");
await sleep(1500);

check("首页有示例卡片", await evaluate('!!document.querySelector(".sample-card")'));
check("三步引导为 3 条", (await evaluate('document.querySelectorAll(".home-steps li").length')) === 3);
check("能力与隐私说明存在", (await evaluate('!!document.querySelector(".home-capabilities")')));
check("多阶段说明已出现", /多阶段/.test(await text(".home-note")));
check("文字样例有 2 个", (await evaluate('document.querySelectorAll(".text-chip").length')) === 2);

await evaluate('document.querySelector(".text-chip").click()');
await sleep(300);
const chipValue = await evaluate('document.querySelector(".composer-text").value');
check("点样例回填题干", typeof chipValue === "string" && chipValue.length > 20);

// 草稿：输入 → 刷新 → 自动恢复
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

// 校验：类型与体积
await upload(badFile);
await sleep(400);
check("非图片被拦截", /JPG \/ PNG/.test(await text(".composer-error")), await text(".composer-error"));
await upload(bigFile);
await sleep(400);
check("超 8MB 被拦截", /8MB/.test(await text(".composer-error")), await text(".composer-error"));

// 有效图片：预览 → 旋转 → 裁剪
await upload(fixture);
await sleep(1200);
check("有效题图出现预览", await evaluate('!!document.querySelector(".composer-preview img")'));
check("有旋转与裁剪入口", await evaluate('!!document.querySelector(\'button[aria-label="向右旋转"]\') && !!document.querySelector(\'button[aria-label="裁剪图片"]\')'));
await evaluate('document.querySelector(\'button[aria-label="向右旋转"]\').click()');
await sleep(900);
check("旋转后仍保留预览", await evaluate('!!document.querySelector(".composer-preview img")'));
await evaluate('document.querySelector(\'button[aria-label="裁剪图片"]\').click()');
await sleep(400);
check("裁剪弹层打开", await evaluate('!!document.querySelector(".crop-dialog")'));
await evaluate(`[...document.querySelectorAll(".crop-dialog button")].find((b) => b.textContent.includes("应用裁剪")).click()`);
await sleep(1200);
check("裁剪后弹层关闭且预览保留", (await evaluate('!document.querySelector(".crop-dialog")')) && (await evaluate('!!document.querySelector(".composer-preview img")')));

// 提交后写入最近记录（预览无后端，落到错误卡片也应有最近）
await evaluate('document.querySelector(\'button[aria-label="开始识别"]\').click()');
await sleep(1800);
check("提交失败有结构化错误卡", await evaluate('!!document.querySelector(".notice-card")'));
check("最近记录已生成", await evaluate('!!document.querySelector(".recent-chip")'));
await send("Page.reload");
await sleep(1500);
check("刷新后最近记录仍在", await evaluate('!!document.querySelector(".recent-chip")'));

ws.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);