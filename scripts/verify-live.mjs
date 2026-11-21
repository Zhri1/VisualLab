/**
 * 线上接口自检：直接打公网 `/functions/v1/app`，用两张真实题图验证。
 *
 * 为什么要带 `Origin`：Qoder Sites 的网关对函数入口做同源校验，不带会返回
 * 403 `sites_gateway_origin_forbidden`。浏览器从站点自身发起请求时会自动带上，
 * 所以这里手工补一个，模拟真实前端。
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

const CASES = [
  { label: "gap-1m", file: "fixtures/incline-spring-gap-1m.png", expectDistanceM: 1 },
  { label: "gap-2m", file: "fixtures/incline-spring-gap-2m.png", expectDistanceM: 2 },
];

let failed = 0;

async function call(filePath) {
  const bytes = await readFile(join(root, filePath));
  const form = new FormData();
  form.append("image", new Blob([bytes], { type: "image/png" }), "question.png");

  const started = Date.now();
  const res = await fetch(ENDPOINT, { method: "POST", headers: { origin: ORIGIN }, body: form });
  const elapsed = Date.now() - started;
  const body = await res.json().catch(() => ({}));
  return { res, body, elapsed };
}

console.log(`目标：${ENDPOINT}\n`);

for (const item of CASES) {
  let outcome;
  try {
    outcome = await call(item.file);
  } catch (error) {
    console.log(`✗ ${item.label} 请求失败：${error.message}`);
    failed += 1;
    continue;
  }

  const { res, body, elapsed } = outcome;
  const reading = body.reading ?? {};
  const stages = Array.isArray(reading.stages) ? reading.stages : [];
  const horizontal = stages.find((stage) => stage.kind === "horizontal_slide");
  const distanceM = horizontal?.end?.distanceM;

  const checks = [
    ["HTTP 200", res.status === 200],
    ["status=ok", body.status === "ok"],
    ["kind=stage_plan", reading.kind === "stage_plan"],
    ["四段齐全", stages.map((s) => s.kind).join(",") === "incline_slide,lossless_turn,horizontal_slide,spring_contact"],
    [`distanceM=${item.expectDistanceM}`, distanceM === item.expectDistanceM],
  ];

  const ok = checks.every(([, pass]) => pass);
  if (!ok) failed += 1;

  console.log(`${ok ? "✓" : "✗"} ${item.label} · HTTP ${res.status} · ${elapsed} ms · 模型 ${res.headers.get("x-vision-model") ?? "-"}`);
  console.log(`  阶段：${stages.map((s) => s.kind).join(" → ") || "(无)"}`);
  console.log(`  水平段结束条件：${JSON.stringify(horizontal?.end ?? null)}`);
  for (const [name, pass] of checks) {
    if (!pass) console.log(`  ✗ 未通过：${name}`);
  }
  console.log("");
}

if (failed) {
  console.error(`自检未通过：${failed} 项失败`);
  process.exit(1);
}
console.log("自检通过：两张题图都返回了正确的阶段计划。");
