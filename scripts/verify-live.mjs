/**
 * 线上接口自检：直接打公网 `/functions/v1/app`，覆盖契约第 2 节的三种状态。
 *
 * - `ok`：两张真实题图，断言阶段序列与水平段距离
 * - `needs_input`：缺水平段距离的文字题，断言缺项路径
 * - `unsupported`：电磁场题，断言整题超范围
 *
 * 为什么要带 `Origin`：Qoder 网关（Kong 2.8.1）对函数入口做同源校验，
 * 不带返回 403 `sites_gateway_origin_forbidden`。浏览器从站点自身发起请求时
 * 会自动带上，所以这里手工补一个，模拟真实前端。
 *
 * 为什么要带浏览器 UA：Kong 的 bot 检测会拦 `HeadlessChrome` / `Puppeteer` /
 * `Playwright` / `Selenium` 以及空 UA，返回 403 `BOT_DETECTED`。这不是接口缺陷，
 * 真实浏览器不受影响；脚本显式声明一个普通 UA 即可。
 *
 * 用法：
 *   node scripts/verify-live.mjs
 *   SITE_HOST=xxx.qoder.zone node scripts/verify-live.mjs
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

const COMPLETE_ORDER = "incline_slide,lossless_turn,horizontal_slide,spring_contact";
const MISSING_DISTANCE_TEXT =
  "倾角30°的粗糙斜面长3.6m，动摩擦因数0，滑块由静止释放，经光滑圆弧进入水平面，" +
  "水平面动摩擦因数0.2，滑块从桌面边缘平抛，桌面高1.25m。求落地水平距离。（未给出水平段长度）取g=10";
const ELECTROMAGNETISM_TEXT =
  "如图，质量为m、电荷量为q的粒子以速度v垂直射入磁感应强度为B的匀强磁场，求粒子做圆周运动的半径。";

/** 每条用例：构造请求体 + 断言回包 */
const CASES = [
  {
    label: "gap-1m 图",
    image: "fixtures/incline-spring-gap-1m.png",
    expect: (body, stages) => [
      ["status=ok", body.status === "ok"],
      ["四段齐全", stages.join(",") === COMPLETE_ORDER],
      ["distanceM=1", stages.includes("horizontal_slide") && body.reading?.stages?.[2]?.end?.distanceM === 1],
    ],
  },
  {
    label: "gap-2m 图",
    image: "fixtures/incline-spring-gap-2m.png",
    expect: (body, stages) => [
      ["status=ok", body.status === "ok"],
      ["四段齐全", stages.join(",") === COMPLETE_ORDER],
      ["distanceM=2", body.reading?.stages?.[2]?.end?.distanceM === 2],
    ],
  },
  {
    label: "缺水平段距离",
    text: MISSING_DISTANCE_TEXT,
    expect: (body) => [
      ["status=needs_input", body.status === "needs_input"],
      ["缺项路径正确", (body.missingKeys ?? []).includes("/stages/2/end/distanceM")],
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
  const stages = Array.isArray(body.reading?.stages)
    ? body.reading.stages.map((stage) => stage.kind)
    : [];

  const checks = [["HTTP 200", res.status === 200], ...item.expect(body, stages)];
  const ok = checks.every(([, pass]) => pass);
  if (!ok) failed += 1;

  console.log(
    `${ok ? "✓" : "✗"} ${item.label} · HTTP ${res.status} · ${elapsed} ms · ${res.headers.get("x-vision-model") ?? "-"}`,
  );
  if (stages.length) console.log(`  ${stages.join(" → ")}`);
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
