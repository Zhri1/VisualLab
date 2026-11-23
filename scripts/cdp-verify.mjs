// 通过 Edge/Chromium 的 DevTools 协议做一次真机走查：
// 首页 → 内置示例 → 工作台 → 播放 → 窄屏 → 文字缺项路径，并收集控制台错误与布局溢出。
//
// 用法：node scripts/cdp-verify.mjs [截图目录] [页面 URL]
//   截图目录  第一个 CLI 参数，默认 artifacts/ui
//   页面 URL  第二个 CLI 参数，其次取 UI_URL，默认 http://127.0.0.1:4173/
//   CDP 地址  取 CDP_URL，默认 http://127.0.0.1:9222
//
// 前置条件（本步骤不是 CI 步骤）：
//   1. 先 `npm run build && npm run preview` 起 4173 预览服务；
//   2. 再以 --remote-debugging-port=9222 启动 Edge/Chromium 并留一个标签页。
// 只使用 Node 内置 API（fetch / WebSocket / fs），不引入任何依赖。
import { mkdirSync, writeFileSync } from 'node:fs';

// 三个地址都做成可配置项，默认值对应本地最常用的端口。
const out = process.argv[2] ?? 'artifacts/ui';
const url = process.argv[3] ?? process.env.UI_URL ?? 'http://127.0.0.1:4173/';
const cdpUrl = (process.env.CDP_URL ?? 'http://127.0.0.1:9222').replace(/\/+$/, '');
mkdirSync(out, { recursive: true });

// 连不上 CDP 时给出可读提示，而不是抛原始的 fetch 错误。
const res = await fetch(`${cdpUrl}/json/list`).catch(() => null);
const list = res ? await res.json().catch(() => null) : null;
if (!Array.isArray(list)) {
  console.error(`✗ 连不上 ${cdpUrl}/json/list，请先用 --remote-debugging-port=9222 启动 Edge/Chromium。`);
  process.exit(1);
}
const page = list.find((t) => t.type === 'page');
if (!page?.webSocketDebuggerUrl) {
  console.error(`✗ 在 ${cdpUrl}/json/list 里没找到可用的页面目标，请确认浏览器已用远程调试端口启动。`);
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

let seq = 0;
const pending = new Map();
const consoleErrors = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('exception: ' + (msg.params.exceptionDetails.text ?? ''));
  }
  if (!msg.id || !pending.has(msg.id)) return;
  const { resolve, reject } = pending.get(msg.id);
  pending.delete(msg.id);
  msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
};
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}/${name}.png`, Buffer.from(data, 'base64'));
};
const text = async () => (await evaluate('document.body.innerText')).replace(/\s+/g, ' ');

// 22 条断言全部走这里，失败只置退出码，不中断后续走查（便于一次收集全部问题）。
const report = [];
const check = (name, ok, detail = '') => {
  report.push(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(2500);

// 1. 首页
const homeText = await text();
check('首页渲染出产品名', homeText.includes('VisualLab'), homeText.slice(0, 40));
check('首页有「内置示例」入口', await evaluate('!!document.querySelector(".sample-button")'));
const homeOverflow = await evaluate('document.documentElement.scrollWidth - window.innerWidth');
check('1440 宽无横向溢出', homeOverflow <= 0, `scrollWidth-innerWidth=${homeOverflow}`);
await shot('01-home-1440');

// 2. 内置示例 → 工作台
await evaluate('document.querySelector(".sample-button").click()');
await sleep(250);
check('内置示例先弹出选择', await evaluate('!!document.querySelector(".sample-picker")'));
await evaluate('document.querySelector(".sample-option").click()');
await sleep(4000);
check('进入工作台并画出画布', await evaluate('!!document.querySelector("canvas")'));
const canvasBox = await evaluate(`(() => {
  const c = document.querySelector("canvas");
  const r = c.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), pixels: c.width * c.height };
})()`);
check('画布有实际尺寸', canvasBox.w > 300 && canvasBox.h > 150, JSON.stringify(canvasBox));
const wsText = await text();
// 正文只报条数，假设条目收进胶囊（P2 · S1），所以这里不再断言正文出现 g=10
check('正文含 按以下 3 条假设计算', wsText.includes('按以下 3 条假设计算'), wsText.slice(-140));
check('正文不重复假设条目', !wsText.includes('已按 g=10'), '');
check('时间轴有关键事件', wsText.includes('接触弹簧') && wsText.includes('恢复原长'));
await shot('02-workspace-1440');

// 2b. 假设胶囊：出现 → 标题带条数 → 点击展开后条目齐全、首条是 g=10
check('工作台出现 .assumption 胶囊', await evaluate('!!document.querySelector(".assumption")'));
const chipSummary = await evaluate(
  'document.querySelector(".assumption > summary")?.textContent?.trim() ?? ""',
);
check('胶囊 summary 文本含「3 条」', chipSummary.includes('3 条'), chipSummary);
const clicked = await evaluate(`(() => {
  const s = document.querySelector(".assumption > summary");
  if (!s) return false;
  s.click();
  return true;
})()`);
check('胶囊 summary 可点击', clicked);
await sleep(400);
const chipState = await evaluate(`(() => {
  const d = document.querySelector(".assumption");
  if (!d) return null;
  const items = [...d.querySelectorAll(".assumption-list li")].map((li) => (li.textContent ?? "").trim());
  return { open: d.open === true, count: items.length, first: items[0] ?? "" };
})()`);
check('点击后 details[open] 为真', chipState?.open === true, JSON.stringify(chipState));
check('展开后假设条目 ≥ 3 条', (chipState?.count ?? 0) >= 3, `li=${chipState?.count ?? 0}`);
check('首条假设含 g=10', (chipState?.first ?? "").includes('g=10'), chipState?.first ?? '');
await shot('02b-assumptions-open');

// 3. 播放 1.2 s
const before = await evaluate(`document.body.innerText.match(/(\\d+\\.\\d\\d) s \\//)?.[1] ?? null`);
await evaluate(`(() => {
  const b = document.querySelector("button.tbtn.primary") ?? [...document.querySelectorAll("button")].find((x) => /播放|暂停/.test(x.getAttribute("aria-label") ?? x.textContent));
  if (b) b.click();
  return !!b;
})()`);
await sleep(1400);
const after = await evaluate(`document.body.innerText.match(/(\\d+\\.\\d\\d) s \\//)?.[1] ?? null`);
check('播放推进了时间轴', before !== after, `${before} → ${after}`);
await shot('03-workspace-playing');

// 4. 窄屏
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
await sleep(1200);
const mobileOverflow = await evaluate('document.documentElement.scrollWidth - window.innerWidth');
check('430 宽无横向溢出', mobileOverflow <= 0, `scrollWidth-innerWidth=${mobileOverflow}`);
const mobileCanvas = await evaluate(`(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return Math.round(r.width); })()`);
check('窄屏画布收缩到容器内', mobileCanvas <= 430, `canvas 宽 ${mobileCanvas}`);
await shot('04-workspace-430');

// 5. 回到首页再走一次文字发送（缺项路径）
await send('Emulation.clearDeviceMetricsOverride');
await send('Page.navigate', { url });
await sleep(2000);
await evaluate(`(() => {
  const ta = document.querySelector("textarea");
  if (!ta) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, "滑块从斜面上由静止释放");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`);
await sleep(300);
const sent = await evaluate(`(() => {
  const b = document.querySelector(".send-button");
  if (!b || b.disabled) return false;
  b.click();
  return true;
})()`);
check('文字可以提交', sent);
await sleep(3000);
const needsText = await text();
check('文字模式走缺项提示', /请确认|需要确认|补齐|核对/.test(needsText), needsText.slice(-160));
await shot('05-needs-input');

// 5b. 缺项工作台复用同一颗假设胶囊：needs_input 回包也带 assumptions（P3）
const missingChipSummary = await evaluate(
  'document.querySelector(".assumption > summary")?.textContent?.trim() ?? ""',
);
check(
  '缺项工作台出现 .assumption 且 summary 含「3 条」',
  missingChipSummary.includes('3 条'),
  missingChipSummary || '(没找到胶囊)',
);
const missingClicked = await evaluate(`(() => {
  const s = document.querySelector(".assumption > summary");
  if (!s) return false;
  s.click();
  return true;
})()`);
await sleep(400);
const missingChipState = missingClicked
  ? await evaluate(`(() => {
  const d = document.querySelector(".assumption");
  if (!d) return null;
  const items = [...d.querySelectorAll(".assumption-list li")].map((li) => (li.textContent ?? "").trim());
  return { open: d.open === true, count: items.length, first: items[0] ?? "" };
})()`)
  : null;
check(
  '缺项胶囊展开后 details[open]、至少 3 条 li、首条含 g=10',
  missingChipState?.open === true &&
    (missingChipState?.count ?? 0) >= 3 &&
    (missingChipState?.first ?? '').includes('g=10'),
  JSON.stringify(missingChipState),
);
await shot('06-needs-input-assumptions');

check('控制台无错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' / '));

console.log(report.join('\n'));
writeFileSync(`${out}/report.txt`, report.join('\n') + '\n', 'utf8');
ws.close();