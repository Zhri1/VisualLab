/**
 * 占位动画库。成员 B 的 src/physics 就绪后整文件删除即可。
 *
 * 该实现严格按 PROJECT_PLAN_FINAL.md 第 3 节的解析式求解，
 * 因此可以直接当作 B 的数值验收对照：
 *   a₁    = 2.0250 m/s²
 *   t₁    = 1.9876 s，v₁ = 4.0249 m/s
 *   t₂    = 2.2361 s（springGapM = 1）
 *   t₃    = 2.3146 s，x_max = 0.2012 m，F = 80.50 N
 *   t₄    = 2.3932 s，v = −4.0249 m/s
 * springGapM 改为 2 时 t₂ 应为 2.4845 s。
 *
 * 这里只依赖契约字段，不引入任何 UI 逻辑。
 */
import type {
  FieldError,
  Motion,
  MotionEvent,
  MotionSample,
  MotionSegment,
  Reading,
  ResolvedConditions,
  Scene,
  Vec2,
} from "../types";
import type { AssembleResult, BuildMotionResult, MotionLibrary } from "./contract";

const DEG = Math.PI / 180;
/** 滑块边长（m），仅用于绘图，不参与运动计算 */
const BLOCK_SIZE_M = 0.3;

const TEMPLATE = "incline_spring";

const NUMBER_FIELDS: { key: keyof ResolvedConditions; label: string }[] = [
  { key: "gravityMps2", label: "重力加速度 g" },
  { key: "inclineAngleDeg", label: "斜面倾角 θ" },
  { key: "inclineLengthM", label: "斜面长度 L" },
  { key: "kineticFrictionCoefficient", label: "动摩擦因数 μ" },
  { key: "initialSpeedMps", label: "初速度 v₀" },
  { key: "blockMassKg", label: "滑块质量 m" },
  { key: "springGapM", label: "坡底到弹簧距离" },
  { key: "springConstantNpm", label: "弹簧劲度系数 k" },
];

/**
 * 校验并装配场景。
 * 失败时返回逐字段错误，页面据此高亮输入框。
 */
export function assembleScene(reading: Reading): AssembleResult {
  const errors: FieldError[] = [];

  if (reading?.templateId !== TEMPLATE) {
    return {
      ok: false,
      errors: [
        {
          code: "UNSUPPORTED_TEMPLATE",
          message: "当前版本支持斜面接光滑水平面与弹簧的运动",
        },
      ],
    };
  }

  const c = reading.conditions;

  for (const { key, label } of NUMBER_FIELDS) {
    const v = c[key];
    if (v === null || v === undefined) {
      errors.push({ code: "MISSING", field: key, message: `${label}缺失，请补齐` });
    } else if (!Number.isFinite(v)) {
      errors.push({ code: "NOT_FINITE", field: key, message: `${label}不是有效数字` });
    }
  }

  if (errors.length) return { ok: false, errors };

  const p = c as ResolvedConditions;

  // 范围检查（契约 1 节）
  const range = (key: keyof ResolvedConditions, ok: boolean, msg: string) => {
    if (!ok) errors.push({ code: "RANGE", field: key, message: msg });
  };
  range("gravityMps2", p.gravityMps2 > 0, "重力加速度必须为正数");
  range("inclineAngleDeg", p.inclineAngleDeg > 0 && p.inclineAngleDeg < 90, "倾角需在 0° 与 90° 之间");
  range("inclineLengthM", p.inclineLengthM > 0, "斜面长度必须为正数");
  range("kineticFrictionCoefficient", p.kineticFrictionCoefficient >= 0, "动摩擦因数不能为负");
  range("initialSpeedMps", p.initialSpeedMps >= 0, "初速度不能为负");
  range("blockMassKg", p.blockMassKg > 0, "滑块质量必须为正数");
  range("springGapM", p.springGapM > 0, "坡底到弹簧的距离必须为正数");
  range("springConstantNpm", p.springConstantNpm > 0, "劲度系数必须为正数");
  range("initialSpeedMps", p.initialSpeedMps === 0, "首版仅支持由静止释放");

  // 模板前提（contract: 必要事实应当明确为真）
  const f = reading.facts;
  const needTrue: [keyof typeof f, string][] = [
    ["slidesAfterRelease", "释放后下滑"],
    ["losslessTurn", "转向无损"],
    ["horizontalIsFrictionless", "水平面光滑"],
    ["springIsUnattached", "滑块与弹簧不连接"],
  ];
  for (const [key, label] of needTrue) {
    if (f?.[key] === null || f?.[key] === undefined) {
      errors.push({ code: "MISSING", field: key, message: `无法确认「${label}」，请核对题面` });
    } else if (f[key] === false) {
      errors.push({
        code: "PRECONDITION_CONFLICT",
        field: key,
        message: `题面不满足「${label}」，超出当前题型范围`,
      });
    }
  }

  if (errors.length) return { ok: false, errors };

  // 静止释放时下坡加速度必须为正
  const th = p.inclineAngleDeg * DEG;
  const a1 = p.gravityMps2 * (Math.sin(th) - p.kineticFrictionCoefficient * Math.cos(th));
  if (a1 <= 0) {
    errors.push({
      code: "PRECONDITION_CONFLICT",
      field: "kineticFrictionCoefficient",
      message: "μ ≥ tanθ，滑块不会自行下滑，与题设矛盾",
    });
    return { ok: false, errors };
  }

  const top: Vec2 = {
    x: -p.inclineLengthM * Math.cos(th),
    y: p.inclineLengthM * Math.sin(th),
  };

  return {
    ok: true,
    scene: {
      params: p,
      geometry: {
        inclineTop: top,
        inclineBottom: { x: 0, y: 0 },
        horizontalEnd: { x: p.springGapM, y: 0 },
        springContactX: p.springGapM,
        // 题面未给弹簧原长，按示意取 0.9 m，仅影响绘制
        springAnchorX: p.springGapM + 0.9,
        blockSizeM: BLOCK_SIZE_M,
      },
    },
  };
}

/**
 * 由场景求运动。三段解析解：
 *   斜面滑动  s = ½a₁t²
 *   水平匀速  x = v₁t
 *   弹簧接触  x = (v₁/ω)sin(ωt)，ω = √(k/m)
 * 均为理想化模型，不含二次项摩擦，与方案第 3 节口径一致。
 */
export function buildMotion(scene: Scene): BuildMotionResult {
  const p = scene.params;
  const th = p.inclineAngleDeg * DEG;

  const a1 = p.gravityMps2 * (Math.sin(th) - p.kineticFrictionCoefficient * Math.cos(th));
  if (!(a1 > 0)) {
    return { ok: false, code: "NO_SLIDE", message: "下坡加速度不为正，滑块不会下滑" };
  }

  const L = p.inclineLengthM;
  const v0 = p.initialSpeedMps;

  // 由静止释放
  const t1 = Math.sqrt((2 * L) / a1);
  const v1 = a1 * t1;

  const t2 = t1 + p.springGapM / v1;

  const omega = Math.sqrt(p.springConstantNpm / p.blockMassKg);
  const quarter = Math.PI / (2 * omega);
  const t3 = t2 + quarter;
  const t4 = t2 + Math.PI / omega;

  const xMax = v1 / omega;
  const fMax = p.springConstantNpm * xMax;

  const segments: MotionSegment[] = [
    {
      kind: "incline",
      startSeconds: 0,
      endSeconds: t1,
      name: "斜面滑动",
      summary: "滑块沿斜面加速下滑，受重力沿坡分力与滑动摩擦力共同作用。",
      formula: "a = g(sinθ − μcosθ)",
    },
    {
      kind: "horizontal",
      startSeconds: t1,
      endSeconds: t2,
      name: "水平匀速",
      summary: "转向后水平面光滑，滑块保持速率匀速前进，直到接触弹簧。",
      formula: "v = 常数 = √(2aL)",
    },
    {
      kind: "spring",
      startSeconds: t2,
      endSeconds: t4,
      name: "压缩与反弹",
      summary: "弹簧弹力随压缩量线性增大，四分之一周期达到最大压缩，随后反弹脱离。",
      formula: "x = (v/ω)·sin(ωt)，ω = √(k/m)",
    },
  ];

  const events: MotionEvent[] = [
    {
      id: "release",
      timeSeconds: 0,
      label: "滑块释放",
      caption: "t = 0 由静止释放，沿坡加速度 a = g(sinθ − μcosθ)。",
      segment: "incline",
      detail: `a = ${a1.toFixed(4)} m/s²`,
    },
    {
      id: "reach_bottom",
      timeSeconds: t1,
      label: "到达坡底",
      caption: "到达坡底，速率 v = √(2aL)。经光滑圆弧后方向转为水平，速率不变。",
      segment: "incline",
      velocityBefore: { x: v1 * Math.cos(th), y: -v1 * Math.sin(th) },
      velocityAfter: { x: v1, y: 0 },
      detail: `v = ${v1.toFixed(4)} m/s`,
    },
    {
      id: "contact_spring",
      timeSeconds: t2,
      label: "接触弹簧",
      caption: "接触弹簧瞬间压缩量为零，弹力为零，速率仍是进入水平面时的数值。",
      segment: "horizontal",
      detail: `已前进 ${p.springGapM.toFixed(2)} m`,
    },
    {
      id: "max_compression",
      timeSeconds: t3,
      label: "最大压缩",
      caption: "压缩量最大时速度为零，动能全部转为弹性势能，弹力达到最大值。",
      segment: "spring",
      detail: `x = ${xMax.toFixed(4)} m，F = ${fMax.toFixed(2)} N`,
    },
    {
      id: "detach_spring",
      timeSeconds: t4,
      label: "弹簧脱离",
      caption: "半个周期后弹簧恢复原长，滑块以原速率反向离开，开始向左匀速。",
      segment: "spring",
      velocityBefore: { x: v1, y: 0 },
      velocityAfter: { x: -v1, y: 0 },
      detail: `v = ${(-v1).toFixed(4)} m/s`,
    },
  ];

  const sampleAt = (tRaw: number): MotionSample => {
    const t = Math.min(Math.max(tRaw, 0), t4);
    const top = scene.geometry.inclineTop;

    if (t < t1) {
      const s = 0.5 * a1 * t * t + v0 * t;
      const v = a1 * t + v0;
      return {
        position: {
          x: top.x + s * Math.cos(th),
          y: top.y - s * Math.sin(th),
        },
        velocity: { x: v * Math.cos(th), y: -v * Math.sin(th) },
        springCompressionM: 0,
      };
    }

    if (t < t2) {
      return {
        position: { x: v1 * (t - t1), y: 0 },
        velocity: { x: v1, y: 0 },
        springCompressionM: 0,
      };
    }

    if (t < t3) {
      const tau = t - t2;
      const comp = (v1 / omega) * Math.sin(omega * tau);
      const v = v1 * Math.cos(omega * tau);
      return {
        position: { x: p.springGapM + comp, y: 0 },
        velocity: { x: v, y: 0 },
        springCompressionM: comp,
      };
    }

    const tau = t - t2;
    const comp = (v1 / omega) * Math.sin(omega * tau);
    const v = v1 * Math.cos(omega * tau);
    return {
      position: { x: p.springGapM + Math.max(0, comp), y: 0 },
      velocity: { x: v, y: 0 },
      springCompressionM: Math.max(0, comp),
    };
  };

  return {
    ok: true,
    motion: {
      geometry: scene.geometry,
      durationSeconds: t4,
      segments,
      events,
      sampleAt,
    },
  };
}

/** 供 mock 适配层整体替换 */
export const mockMotionLibrary: MotionLibrary = { assembleScene, buildMotion };
