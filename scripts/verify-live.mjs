/**
 * 线上接口自检：直接打公网 `/functions/v1/app`，覆盖契约第 2 节的三种状态。
 *
 * - `ok`：两张真实题图，断言旧 `Reading` 形状与水平段距离
 * - `needs_input`：弹簧题但题面没给水平距离，断言缺项指向 `springGapM`
 * - `unsupported`：电磁场题，断言整题超范围
 *
 * 断言按**线上实际契约**写：`API_CONTRACT_MODE` 默认 `legacy`，回包是旧的
 * `{ templateId, conditions, facts }`。切到 `stage_plan` 后本脚本会整体失败，
 * 提醒同步改断言 —— 这是有意的，避免契约换了还在跑旧检查。
 *
 * 为什么要带 `Origin`：Qoder 网关（Kong 2.8.1）对函数入口做同源校验，
 * 不带返回 403 `sites_gateway_origin_forbidden`。浏览器从站点自身发起请求时
 * 会自动带上，所以这里手工补一个，模拟真实前端。
 *
 * 为什么要带浏览器 UA：Kong 的 bot 检测会拦 `HeadlessChrome` / `Puppeteer` /
 * `Playwright` / `Selenium` 以及空 UA，返回 403 `BOT_DETECTED`。这不是接口缺陷，
 * 真实浏览器不受影响；脚本显式声明一个普通 UA 即可，不做任何绕过。
 *
 * 用法：
 *   node scripts/verify-live.mjs
 *   SITE_HOST=xxx.qoder.zone node scripts/verify-live.mjs
 *
 * 想用真实浏览器跑同一组用例：打开 `https://<站点>/acceptance/`。
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = process.env.SITE_HOST || "visuallab-physics-ecumfnqswpu.qoder.zone";
const ORIGIN = `https://${HOST}`;
const ENDPOINT = `${ORIGIN}/functions/v1/app`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

const TIGHT_SPRING_TEXT =
  "倾角37°的粗糙斜面长4m，动摩擦因数0.5，滑块由静止释放，经光滑圆弧进入光滑水平面，" +
  "压缩右端固定的弹簧后弹回，滑块与弹簧不连接，弹簧劲度系数400N/m，滑块质量1kg。" +
  "题面未给出弹簧与坡底的距离。取g=10";
const ELECTROMAGNETISM_TEXT =
  "如图，质量为m、电荷量为q的粒子以速度v垂直射入磁感应强度为B的匀强磁场，求粒子做圆周运动的半径。";

/** 每条用例：构造请求体 + 断言回包 */
const CASES = [
  {
    label: "gap-1m 图",
    image: "fixtures/incline-spring-gap-1m.png",
    expect: (body) => [
      ["status=ok", body.status === "ok"],
      ["templateId=incline_spring", body.reading?.templateId === "incline_spring"],
      ["springGapM=1", body.reading?.conditions?.springGapM === 1],
      ["不是 stage_plan 形状", body.reading?.kind === undefined],
    ],
  },
  {
    label: "gap-2m 图",
    image: "fixtures/incline-spring-gap-2m.png",
    expect: (body) => [
      ["status=ok", body.status === "ok"],
      ["templateId=incline_spring", body.reading?.templateId === "incline_spring"],
      ["springGapM=2", body.reading?.conditions?.springGapM === 2],
      ["不是 stage_plan 形状", body.reading?.kind === undefined],
    ],
  },
  {
    label: "缺弹簧距离",
    text: TIGHT_SPRING_TEXT,
    expect: (body) => [
      ["status=needs_input", body.status === "needs_input"],
      ["缺项指向 springGapM", (body.missingKeys ?? []).includes("springGapM")],
      ["缺项不混入 JSON Pointer", !(body.missingKeys ?? []).some((key) => key.startsWith("/"))],
    ],
  },
  {
    label: "电磁场超范围",
    text: ELECTROMAGNETISM_TEXT,
    expect: (body) => [
      ["status=unsupported", body.status === "unsupported"],
      ["message 非空", typeof body.message === "string" && body.message.trim().length > 0],
      ["不带 reading", body.reading === undefined || body.reading === null],
    ],
  },
];

let failed = 0;

async function call(item) {
  const form = new FormData();
  if (item.image) {
    const bytes = await readFile(join(root, item.image));
    form.append("image", new Blob([bytes], { type: "image/png" }), "question.png");
  } else {
    form.append("text", item.text);
  }

  const started = Date.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { origin: ORIGIN, "user-agent": UA },
    body: form,
  });
  const elapsed = Date.now() - started;
  const body = await res.json().catch(() => ({}));
  return { res, body, elapsed };
}

console.log(`目标：${ENDPOINT}\n`);

for (const item of CASES) {
  let outcome;
  try {
    outcome = await call(item);
  } catch (error) {
    console.log(`✗ ${item.label} · 请求失败：${error.message}\n`);
    failed += 1;
    continue;
  }

  const { res, body, elapsed } = outcome;
  const checks = [["HTTP 200", res.status === 200], ...item.expect(body)];
  const ok = checks.every(([, pass]) => pass);
  if (!ok) failed += 1;

  console.log(
    `${ok ? "✓" : "✗"} ${item.label} · HTTP ${res.status} · ${elapsed} ms · ${res.headers.get("x-vision-model") ?? "-"}`,
  );
  if (body.reading?.templateId) {
    const conditions = body.reading.conditions ?? {};
    console.log(`  ${body.reading.templateId} · springGapM=${conditions.springGapM ?? "null"}`);
  }
  if (body.status === "unsupported") console.log(`  ${body.message}`);
  if (body.missingKeys?.length) console.log(`  缺项：${body.missingKeys.join(", ")}`);
  for (const [name, pass] of checks) {
    if (!pass) console.log(`  ✗ 未通过：${name}`);
  }
  console.log("");
}

if (failed) {
  console.error(`自检未通过：${failed} 条用例失败`);
  process.exit(1);
}
console.log(`自检通过：${CASES.length} 条用例全部符合契约。`);
