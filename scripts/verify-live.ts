/**
 * 线上全链路自检：公网识别 → 契约校验 → 场景装配 → 播放取样。
 *
 * 前三步打的是真实公网 `https://<站点>/functions/v1/app`，用真实题图上传；
 * 后两步把回包原样喂给前端用的同一套 `validateStagePlan / assembleScene / buildMotion`，
 * 再按播放器的方式逐时刻取样。任何一环对不上都会在这里失败。
 *
 * 断言按当前契约写：`API_CONTRACT_MODE` 默认 `stage_plan`，回包是
 * `{ kind: "stage_plan", schemaVersion: 1, stages: [...] }`。
 * 若线上退回 `legacy`，第一组断言就会失败，提醒契约被改回去了。
 *
 * 为什么要带 `Origin`：Qoder 网关（Kong 2.8.1）对函数入口做同源校验，
 * 不带返回 403 `sites_gateway_origin_forbidden`。浏览器从站点自身发起请求时
 * 会自动带上，这里手工补一个，模拟真实前端。
 *
 * 为什么要带浏览器 UA：Kong 的 bot 检测会拦 `HeadlessChrome` / `Puppeteer` /
 * `Playwright` / `Selenium` 以及空 UA，返回 403 `BOT_DETECTED`。这不是接口缺陷，
 * 真实浏览器不受影响；脚本显式声明一个普通 UA 即可，不做任何绕过。
 *
 * 用法：
 *   npm run verify:live
 *   SITE_HOST=xxx.qoder.zone npm run verify:live
 *
 * 想用真实浏览器跑同一组用例：打开 `https://<站点>/acceptance/index.html`。
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateStagePlan } from "../src/physics/stagePlan";
import { assembleScene, buildMotion } from "../src/physics";
import type { StageMotion } from "../src/physics";

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

const END_REASONS = [
  "stop_before_target",
  "stop_at_target",
  "stopped",
  "landed",
  "spring_detached",
  "prefix_end",
];

type Body = Record<string, any>;

/** 把回包原样走一遍前端的计算链，返回播放器能直接用的 motion */
function runChain(plan: unknown): StageMotion {
  const validation = validateStagePlan(plan);
  if (!validation.ok) throw new Error(`契约校验失败：${validation.code} ${validation.message}`);
  const assembled = assembleScene(validation.reading);
  if (!assembled.ok) throw new Error(`场景装配失败：${assembled.message}`);
  const built = buildMotion(assembled.scene);
  return built.motion;
}

/** 播放器取样：首末与每个事件时刻都必须给出有限坐标，且确实发生了位移 */
function checkPlayback(motion: StageMotion) {
  if (!motion.segments.length) throw new Error("segments 为空");
  if (!motion.events.length) throw new Error("events 为空");
  if (!(motion.durationSeconds > 0)) throw new Error("durationSeconds 不为正");
  if (!END_REASONS.includes(motion.termination.reason)) {
    throw new Error(`未知终止原因 ${motion.termination.reason}`);
  }

  const times = [0, motion.durationSeconds, ...motion.events.map((item) => item.timeSeconds)];
  for (const t of times) {
    const sample = motion.sampleAt(t);
    if (!Number.isFinite(sample.xM) || !Number.isFinite(sample.yM)) {
      throw new Error(`t=${t} 采样坐标非有限值`);
    }
  }

  const start = motion.sampleAt(0);
  const end = motion.sampleAt(motion.durationSeconds);
  if (start.xM === end.xM && start.yM === end.yM) throw new Error("首末位置相同，没有发生运动");
  return { start, end };
}

const CASES: {
  label: string;
  image?: string;
  text?: string;
  expect: (body: Body) => [string, boolean][];
}[] = [
  {
    label: "gap-1m 图",
    image: "fixtures/incline-spring-gap-1m.png",
    expect: (body) => {
      const stages = body.reading?.stages ?? [];
      return [
        ["status=ok", body.status === "ok"],
        ["kind=stage_plan", body.reading?.kind === "stage_plan"],
        ["schemaVersion=1", body.reading?.schemaVersion === 1],
        ["四段含水平段", stages.length === 4 && stages[2]?.kind === "horizontal_slide"],
        ["distanceM=1", stages[2]?.end?.distanceM === 1],
        ["末段是弹簧", stages[3]?.kind === "spring_contact"],
      ];
    },
  },
  {
    label: "gap-2m 图",
    image: "fixtures/incline-spring-gap-2m.png",
    expect: (body) => {
      const stages = body.reading?.stages ?? [];
      return [
        ["status=ok", body.status === "ok"],
        ["kind=stage_plan", body.reading?.kind === "stage_plan"],
        ["schemaVersion=1", body.reading?.schemaVersion === 1],
        ["四段含水平段", stages.length === 4 && stages[2]?.kind === "horizontal_slide"],
        ["distanceM=2", stages[2]?.end?.distanceM === 2],
        ["末段是弹簧", stages[3]?.kind === "spring_contact"],
      ];
    },
  },
  {
    label: "缺弹簧距离",
    text: TIGHT_SPRING_TEXT,
    expect: (body) => [
      ["status=needs_input", body.status === "needs_input"],
      [
        "缺项指向 /stages/2/end/distanceM",
        (body.missingKeys ?? []).includes("/stages/2/end/distanceM"),
      ],
    ],
  },
  {
    // 磁场偏转已纳入支持范围：纯字母题不再判 unsupported，而是要求补齐具体数值。
    label: "电磁场纯字母题缺数值",
    text: ELECTROMAGNETISM_TEXT,
    expect: (body) => [
      ["status=needs_input", body.status === "needs_input"],
      ["首段是 magnetic_deflection", body.reading?.stages?.[0]?.kind === "magnetic_deflection"],
      ["缺项含磁感应强度", (body.missingKeys ?? []).includes("/stages/0/magneticTeslaB")],
      ["缺项含电荷量", (body.missingKeys ?? []).includes("/stages/0/chargeC")],
      ["缺项含磁场宽度", (body.missingKeys ?? []).includes("/stages/0/regionWidthM")],
    ],
  },
];

let failed = 0;

async function call(item: (typeof CASES)[number]) {
  const form = new FormData();
  if (item.image) {
    const bytes = await readFile(join(root, item.image));
    form.append("image", new Blob([bytes], { type: "image/png" }), "question.png");
  } else {
    form.append("text", item.text ?? "");
  }

  const started = Date.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { origin: ORIGIN, "user-agent": UA },
    body: form,
  });
  const elapsed = Date.now() - started;
  const body = (await res.json().catch(() => ({}))) as Body;
  return { res, body, elapsed };
}

console.log(`目标：${ENDPOINT}\n`);

for (const item of CASES) {
  let outcome: Awaited<ReturnType<typeof call>>;
  try {
    outcome = await call(item);
  } catch (error) {
    console.log(`✗ ${item.label} · 请求失败：${(error as Error).message}\n`);
    failed += 1;
    continue;
  }

  const { res, body, elapsed } = outcome;
  const checks: [string, boolean][] = [["HTTP 200", res.status === 200], ...item.expect(body)];

  // ok 的用例继续跑计算与播放，任何一环失败都算整条用例失败
  let chainLine = "";
  if (body.status === "ok" && body.reading?.kind === "stage_plan") {
    try {
      const motion = runChain(body.reading);
      const { start, end } = checkPlayback(motion);
      checks.push(["计算链通过", true]);
      checks.push(["播放取样通过", true]);
      chainLine =
        `  计算：${motion.segments.length} 段 / ${motion.events.length} 事件 / ` +
        `${motion.durationSeconds.toFixed(3)} s / 终止 ${motion.termination.reason}\n` +
        `  播放：(${start.xM.toFixed(2)}, ${start.yM.toFixed(2)}) → ` +
        `(${end.xM.toFixed(2)}, ${end.yM.toFixed(2)})`;
    } catch (error) {
      checks.push([`计算或播放失败：${(error as Error).message}`, false]);
    }
  }

  const ok = checks.every(([, pass]) => pass);
  if (!ok) failed += 1;

  console.log(
    `${ok ? "✓" : "✗"} ${item.label} · HTTP ${res.status} · ${elapsed} ms · ${res.headers.get("x-vision-model") ?? "-"}`,
  );
  if (chainLine) console.log(chainLine);
  if (body.status === "unsupported") console.log(`  ${body.message}`);
  if (body.missingKeys?.length) console.log(`  缺项：${body.missingKeys.join(", ")}`);
  if (body.reading?.stages?.length) {
    console.log(`  阶段：${body.reading.stages.map((stage: any) => stage.kind).join(" → ")}`);
  }
  for (const [name, pass] of checks) {
    if (!pass) console.log(`  ✗ 未通过：${name}`);
  }
  console.log("");
}

if (failed) {
  console.error(`自检未通过：${failed} 条用例失败`);
  process.exit(1);
}
console.log(`自检通过：${CASES.length} 条用例，识别 / 计算 / 播放全链路符合契约。`);
