// 由 scripts/sync-functions.mjs 从 src/physics/emfRail.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
/**
 * 电磁感应 · 导体棒在水平平行导轨上切割磁感线（单棒、匀强磁场垂直导轨平面）。
 *
 * 模型假设：
 * - 导轨水平且足够长，磁场 B 垂直导轨平面（向里或向外），棒始终垂直于导轨；
 * - 回路总电阻 R 恒定（含棒电阻与导轨电阻），忽略回路自感；
 * - 可含沿导轨方向的恒定外力 F 与导轨摩擦（动摩擦因数 μ）；
 * - 忽略棒的长度变化与端点效应。
 *
 * 动力学：m·dv/dt = F − μmg − B²L²v/R。
 * 记 k = B²L²/R、f = F − μmg、λ = k/m、v_t = f/k，则
 *   v(t) = v_t + (v₀ − v_t)·e^(−λt)
 *   x(t) = v_t·t + (v₀ − v_t)·(1 − e^(−λt))/λ
 * 通过回路的电荷量 q = BLx/R，焦耳热 Q = f·x − ΔEk = k∫v²dt。
 */

export type EmfRailEnd =
  | { kind: "time"; durationSeconds: number }
  | { kind: "distance"; distanceM: number }
  | { kind: "stop" }
  | { kind: "speed"; speedMps: number }
  /** 一直观察到速度达到收尾速度的 99%（恒力拉动的「足够长时间」场景）。 */
  | { kind: "terminal" };

export type EmfRailStage = {
  kind: "emf_rail";
  /** 磁感应强度 B（T，正有限数）。 */
  magneticTeslaB: number;
  /** 导轨间距 L（m，正有限数），也是棒在磁场中的有效长度。 */
  railSpacingM: number;
  /** 回路总电阻 R（Ω，正有限数）。 */
  totalResistanceOhm: number;
  /** 导体棒质量 m（kg，正有限数）。 */
  rodMassKg: number;
  /** 恒定外力 F（N，沿 +x 为正；阻力取负），默认 0。 */
  externalForceN?: number | null;
  /** 棒与导轨间动摩擦因数 μ，默认 0（光滑导轨）。 */
  kineticFrictionCoefficient?: number | null;
  /** 重力加速度（m/s²，正有限数），默认 10。 */
  gravityMps2?: number | null;
  /** 初速度 v₀（m/s，非负有限数），默认 0。 */
  initialSpeedMps?: number | null;
  /** 磁场方向，默认垂直纸面向里。 */
  fieldDirection?: "into_page" | "out_of_page";
  /** 观察终点。 */
  end: EmfRailEnd;
  startLabel?: string;
};

export interface EmfRailGeometry {
  stageIndex: number;
  magneticTeslaB: number;
  railSpacingM: number;
  totalResistanceOhm: number;
  rodMassKg: number;
  externalForceN: number;
  kineticFrictionCoefficient: number;
  gravityMps2: number;
  initialSpeedMps: number;
  terminalSpeedMps: number;
  dampingRatePerS: number;
  travelM: number;
  durationSeconds: number;
  fieldDirection: "into_page" | "out_of_page";
  startLabel?: string;
}

export type EmfRailSample = {
  xM: number;
  yM: number;
  vMps: number;
  emfV: number;
  currentA: number;
  ampereForceN: number;
};

export interface EmfRailSolution {
  durationSeconds: number;
  travelM: number;
  terminalSpeedMps: number;
  dampingRatePerS: number;
  chargeC: number;
  jouleHeatJ: number;
  stopTimeSeconds: number | null;
  geometry: EmfRailGeometry;
  at(timeSeconds: number): EmfRailSample;
  events: Array<{
    kind: "emf_start" | "emf_terminal" | "emf_force_balance" | "emf_stop" | "emf_end";
    timeSeconds: number;
    sample: EmfRailSample;
    label: string;
    explanation: string;
  }>;
}

const fmt = (n: number): string => {
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return n.toExponential(3);
  return Number(n.toFixed(4)).toString();
};

/** 动力学参数：k、f、λ、v_t。 */
export function emfRailParameters(stage: EmfRailStage) {
  const b = stage.magneticTeslaB;
  const l = stage.railSpacingM;
  const r = stage.totalResistanceOhm;
  const m = stage.rodMassKg;
  if (![b, l, r, m].every((v) => Number.isFinite(v) && v > 0)) {
    throw new RangeError("磁感应强度 B、导轨间距 L、总电阻 R 与棒质量 m 都必须是正有限数。");
  }
  const g = Number.isFinite(stage.gravityMps2 ?? NaN) ? Number(stage.gravityMps2) : 10;
  if (!(g > 0)) throw new RangeError("重力加速度 g 必须是正有限数。");
  const mu = Number.isFinite(stage.kineticFrictionCoefficient ?? NaN) ? Number(stage.kineticFrictionCoefficient) : 0;
  if (mu < 0) throw new RangeError("动摩擦因数 μ 不能为负。");
  const force = Number.isFinite(stage.externalForceN ?? NaN) ? Number(stage.externalForceN) : 0;
  const v0 = Number.isFinite(stage.initialSpeedMps ?? NaN) ? Number(stage.initialSpeedMps) : 0;
  if (v0 < 0) throw new RangeError("初速度 v₀ 不能为负（反向运动请用外力负值描述）。");
  const k = (b * b * l * l) / r;
  const f = force - mu * m * g;
  const lambda = k / m;
  const terminal = f / k;
  if (![k, f, lambda, terminal].every(Number.isFinite)) throw new RangeError("电磁感应参数超出有限数值范围。");
  if (!(lambda > 0)) throw new RangeError("阻尼系数 B²L²/(mR) 必须为正。");
  if (v0 === 0 && f <= 0) throw new RangeError("初速为零且合外力不大于零，导体棒不会运动。");
  return { b, l, r, m, g, mu, force, v0, k, f, lambda, terminal };
}

type Params = ReturnType<typeof emfRailParameters>;

const speedAt = (p: Params, t: number): number => p.terminal + (p.v0 - p.terminal) * Math.exp(-p.lambda * t);
const distanceAt = (p: Params, t: number): number =>
  p.terminal * t + ((p.v0 - p.terminal) * (1 - Math.exp(-p.lambda * t))) / p.lambda;

/** 速度降到零的时刻；仅在 v_t < 0 且 v₀ > 0 时存在。 */
function stopTime(p: Params): number | null {
  if (!(p.terminal < 0) || !(p.v0 > 0)) return null;
  const ratio = (p.v0 - p.terminal) / -p.terminal;
  if (!(ratio > 1)) return null;
  const t = Math.log(ratio) / p.lambda;
  return Number.isFinite(t) && t > 0 ? t : null;
}

/** 可达到的最大位移（速度不为负的前提下）。 */
function maxTravel(p: Params, tStop: number | null): number {
  if (p.terminal > 0) return Infinity;
  if (p.terminal === 0) return p.v0 / p.lambda;
  return tStop == null ? 0 : distanceAt(p, tStop);
}

function timeAtDistance(p: Params, target: number, tCap: number): number | null {
  if (!(target > 0)) return null;
  if (distanceAt(p, tCap) + 1e-9 < target) return null;
  let lo = 0;
  let hi = tCap;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (distanceAt(p, mid) < target) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12 * Math.max(1, hi)) break;
  }
  return (lo + hi) / 2;
}

function timeAtSpeed(p: Params, target: number): number | null {
  const num = p.v0 - p.terminal;
  const den = target - p.terminal;
  if (Math.abs(den) < 1e-12 * Math.max(1, Math.abs(p.terminal))) return null;
  const ratio = num / den;
  if (!(ratio > 0)) return null;
  const t = Math.log(ratio) / p.lambda;
  return Number.isFinite(t) && t >= 0 ? t : null;
}

export function solveEmfRail(stage: EmfRailStage, stageIndex = 0): EmfRailSolution {
  const p = emfRailParameters(stage);
  const tStop = stopTime(p);
  const travelLimit = maxTravel(p, tStop);
  const end = stage.end;
  let duration: number;
  let endLabel: string;
  switch (end.kind) {
    case "time": {
      if (!(Number.isFinite(end.durationSeconds) && end.durationSeconds > 0)) throw new RangeError("观察时长必须为正有限数。");
      duration = end.durationSeconds;
      endLabel = "到达观察时刻";
      break;
    }
    case "distance": {
      const cap = Number.isFinite(travelLimit) ? (tStop ?? 10 / p.lambda) : Math.max(10 / p.lambda, end.distanceM / Math.max(p.terminal, 1e-9) + 10 / p.lambda);
      const t = timeAtDistance(p, end.distanceM, cap);
      if (t == null) throw new RangeError("导体棒滑不到题给距离就会先停下来，请核对位移或摩擦条件。");
      duration = t;
      endLabel = "到达指定位移";
      break;
    }
    case "stop": {
      if (tStop == null) throw new RangeError("这组参数下速度只能渐近趋于零、不会在有限时间内停止；请改用 distance 或 time。");
      duration = tStop;
      endLabel = "速度减为零";
      break;
    }
    case "speed": {
      const t = timeAtSpeed(p, end.speedMps);
      if (t == null) throw new RangeError("这组参数下速度不会经过题给数值，请核对外力、摩擦与初速。");
      duration = t;
      endLabel = "速度达到指定值";
      break;
    }
    case "terminal": {
      if (!(p.terminal > 0)) throw new RangeError("这组参数下没有正的收尾速度；请改用 stop、time 或 distance。");
      if (Math.abs(p.v0 - p.terminal) <= 1e-9 * Math.max(1, p.terminal)) {
        throw new RangeError("初速已经等于收尾速度，导体棒一开始就匀速，请改用 time 或 distance 指定观察范围。");
      }
      const target = p.v0 < p.terminal ? p.terminal * 0.99 : p.terminal * 1.01;
      const t = timeAtSpeed(p, target);
      if (t == null) throw new RangeError("无法解出接近收尾速度的时刻，请核对外力与摩擦。");
      duration = t;
      endLabel = "稳定在收尾速度附近";
      break;
    }
    default:
      throw new RangeError("未登记的观察终点。");
  }
  if (!(Number.isFinite(duration) && duration > 0)) throw new RangeError("观察时长超出有限数值范围。");

  const travel = distanceAt(p, duration);
  const vEnd = speedAt(p, duration);
  if (![travel, vEnd].every(Number.isFinite)) throw new RangeError("电磁感应位移或末速超出有限数值范围。");

  const at = (timeSeconds: number): EmfRailSample => {
    const t = Math.min(Math.max(Number.isNaN(timeSeconds) ? 0 : timeSeconds, 0), duration);
    // 指数解在端点会留 1e-17 量级残差，统一在取用前抹平，避免读数出现 -0.0000。
    const raw = speedAt(p, t);
    const v = Math.abs(raw) < 1e-12 ? 0 : raw;
    const rawX = distanceAt(p, t);
    const x = Math.abs(rawX) < 1e-12 ? 0 : rawX;
    return {
      xM: x,
      yM: 0,
      vMps: v,
      emfV: p.b * p.l * v,
      currentA: (p.b * p.l * v) / p.r,
      ampereForceN: p.k * v,
    };
  };

  const charge = (p.b * p.l * travel) / p.r;
  const jouleHeat = p.f * travel - 0.5 * p.m * (vEnd * vEnd - p.v0 * p.v0);
  const startSample = at(0);
  // 讲解文字统一用清洗后的采样值，避免出现 -1.1e-16 这类指数残差。
  const endSample = at(duration);
  const vEndClean = endSample.vMps;
  const travelClean = endSample.xM;
  const events: EmfRailSolution["events"] = [
    {
      kind: "emf_start",
      timeSeconds: 0,
      sample: startSample,
      label: "进入磁场开始切割磁感线",
      explanation:
        `棒长 L = ${fmt(p.l)} m、磁感应强度 B = ${fmt(p.b)} T、回路电阻 R = ${fmt(p.r)} Ω，` +
        `阻尼系数 B²L²/R = ${fmt(p.k)} N·s/m，特征时间 mR/(B²L²) = ${fmt(1 / p.lambda)} s。` +
        `初始感应电动势 ε = BLv₀ = ${fmt(startSample.emfV)} V，安培力 ${fmt(startSample.ampereForceN)} N 阻碍相对运动。`,
    },
  ];
  if (p.terminal > 0) {
    const tReach = p.v0 < p.terminal ? timeAtSpeed(p, p.terminal * 0.95) : null;
    if (tReach != null && tReach > 0 && tReach < duration) {
      events.push({
        kind: "emf_terminal",
        timeSeconds: tReach,
        sample: at(tReach),
        label: "速度接近收尾速度",
        explanation: `安培力随速度增大，加速度逐渐减小；速度达到收尾速度 v_t = F·R/(B²L²) = ${fmt(p.terminal)} m/s 的 95%，此后近似匀速。`,
      });
    }
  }
  // 安培力衰减到与其他阻力（摩擦、反向外力）大小相等的时刻：此后减速几乎全靠摩擦。
  const balanceSpeed = Math.abs(p.terminal);
  if (balanceSpeed > 0 && balanceSpeed < p.v0) {
    const tBalance = timeAtSpeed(p, balanceSpeed);
    if (tBalance != null && tBalance > 0 && tBalance < duration) {
      events.push({
        kind: "emf_force_balance",
        timeSeconds: tBalance,
        sample: at(tBalance),
        label: "安培力衰减到与摩擦相等",
        explanation:
          `安培力 F安 = B²L²v/R 随速度减小而减弱，在 v = ${fmt(balanceSpeed)} m/s 时恰好等于摩擦阻力 ${fmt(Math.abs(p.f))} N；` +
          `此后安培力继续减小、摩擦保持不变，减速几乎全部由摩擦承担——这也是安培力单独作用无法让棒在有限时间内停下的原因。`,
      });
    }
  }
  const summary =
    `末速 v = ${fmt(vEndClean)} m/s，位移 x = ${fmt(travelClean)} m；` +
    `感应电动势 ε = BLv = ${fmt(p.b * p.l * vEndClean)} V，电流 I = ε/R = ${fmt((p.b * p.l * vEndClean) / p.r)} A。` +
    `累计电荷量 q = BLx/R = ${fmt(charge)} C，回路焦耳热 Q = ${fmt(jouleHeat)} J。`;
  if (end.kind === "stop" && tStop != null) {
    // 停止点本身就是观察终点，只推一条事件，避免同一时刻出现两条终点事件。
    events.push({
      kind: "emf_stop",
      timeSeconds: tStop,
      sample: at(tStop),
      label: "速度减为零",
      explanation:
        `安培力随速度减小而减弱，仅靠它只能让速度无限趋近于零；本题导轨粗糙，` +
        `安培力与摩擦共同消耗动能，棒在 x = ${fmt(travelClean)} m 处真正停下，历时 ${fmt(tStop)} s。` +
        summary,
    });
  } else {
    events.push({ kind: "emf_end", timeSeconds: duration, sample: at(duration), label: endLabel, explanation: summary });
  }

  const fieldDirection: "into_page" | "out_of_page" = stage.fieldDirection === "out_of_page" ? "out_of_page" : "into_page";
  return {
    durationSeconds: duration,
    travelM: travel,
    terminalSpeedMps: p.terminal,
    dampingRatePerS: p.lambda,
    chargeC: charge,
    jouleHeatJ: jouleHeat,
    stopTimeSeconds: tStop,
    geometry: {
      stageIndex,
      magneticTeslaB: p.b,
      railSpacingM: p.l,
      totalResistanceOhm: p.r,
      rodMassKg: p.m,
      externalForceN: p.force,
      kineticFrictionCoefficient: p.mu,
      gravityMps2: p.g,
      initialSpeedMps: p.v0,
      terminalSpeedMps: p.terminal,
      dampingRatePerS: p.lambda,
      travelM: travel,
      durationSeconds: duration,
      fieldDirection,
      ...(stage.startLabel ? { startLabel: stage.startLabel } : {}),
    },
    at,
    events,
  };
}

/* ------------------------------------------------------------------ *
 * 阶段计划校验：电磁感应作为独立单阶段模型，全部题设写在 emf_rail 内。
 * ------------------------------------------------------------------ */

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const EMF_PATH = "/stages/0";

export function validateEmfRailPlan(raw: Record<string, unknown>): import("./stagePlan.ts").StagePlanValidation {
  type StageFieldError = import("./stagePlan.ts").StageFieldError;
  type StagePlanDraft = import("./stagePlan.ts").StagePlanDraft;
  type ResolvedStagePlan = import("./stagePlan.ts").ResolvedStagePlan;

  const errors: StageFieldError[] = [];
  const missing: string[] = [];
  const issue = (at: string, code: StageFieldError["code"], message: string) => errors.push({ path: at, code, message });
  const stages = Array.isArray(raw.stages) ? raw.stages : [];
  const source = (stages.find((s) => isRecord(s) && s.kind === "emf_rail") ?? {}) as Record<string, unknown>;
  const stage: Record<string, unknown> = { ...source };

  if (raw.kind !== "stage_plan" || raw.schemaVersion !== 1) issue("/schemaVersion", "UNSUPPORTED", "需要阶段计划版本 1。");
  if (stages.length !== 1) issue("/stages", "UNSUPPORTED", "电磁感应导轨目前作为独立单阶段模型使用。");
  for (const key of ["bodies", "primaryBodyId", "massKg", "gravityMps2", "scaleMode", "energy", "constraints"]) {
    if (raw[key] != null) issue("/" + key, "PRECONDITION_CONFLICT", "电磁感应题设应写在 emf_rail 阶段内，不能混用其他模型入口。");
  }
  if (raw.initial != null && (!isRecord(raw.initial) || Object.keys(raw.initial).some((k) => k !== "speedMps"))) {
    issue("/initial", "PRECONDITION_CONFLICT", "电磁感应的初速写在 emf_rail.initialSpeedMps，initial 只能是 speedMps 占位。");
  }

  const required: Array<[string, (v: number) => boolean, string]> = [
    ["magneticTeslaB", (v) => v > 0, "磁感应强度 B 必须是正数。"],
    ["railSpacingM", (v) => v > 0, "导轨间距 L 必须是正数。"],
    ["totalResistanceOhm", (v) => v > 0, "回路总电阻 R 必须是正数。"],
    ["rodMassKg", (v) => v > 0, "导体棒质量 m 必须是正数。"],
  ];
  for (const [key, rule, message] of required) {
    const value = source[key];
    if (value == null) {
      missing.push(EMF_PATH + "/" + key);
      continue;
    }
    if (!isFiniteNumber(value)) {
      issue(EMF_PATH + "/" + key, "TYPE", "需要有限数值。");
      continue;
    }
    if (!rule(value)) issue(EMF_PATH + "/" + key, "RANGE", message);
    stage[key] = value;
  }

  for (const [key, fallback, rule, message] of [
    ["externalForceN", 0, () => true, ""],
    ["kineticFrictionCoefficient", 0, (v: number) => v >= 0, "动摩擦因数 μ 不能为负。"],
    ["gravityMps2", 10, (v: number) => v > 0, "重力加速度 g 必须是正数。"],
    ["initialSpeedMps", 0, (v: number) => v >= 0, "初速度 v₀ 不能为负。"],
  ] as Array<[string, number, (v: number) => boolean, string]>) {
    const value = source[key];
    if (value == null) {
      stage[key] = fallback;
      continue;
    }
    if (!isFiniteNumber(value)) {
      issue(EMF_PATH + "/" + key, "TYPE", "需要有限数值。");
      continue;
    }
    if (!rule(value)) issue(EMF_PATH + "/" + key, "RANGE", message);
    stage[key] = value;
  }

  if (source.fieldDirection == null) stage.fieldDirection = "into_page";
  else if (source.fieldDirection !== "into_page" && source.fieldDirection !== "out_of_page") {
    issue(EMF_PATH + "/fieldDirection", "UNSUPPORTED", "磁场方向仅支持 into_page（向里）或 out_of_page（向外）。");
  } else stage.fieldDirection = source.fieldDirection;

  const end = source.end;
  if (!isRecord(end)) {
    missing.push(EMF_PATH + "/end");
  } else {
    const kind = end.kind;
    if (kind === "time") {
      if (!isFiniteNumber(end.durationSeconds)) missing.push(EMF_PATH + "/end/durationSeconds");
      else if (!(end.durationSeconds > 0)) issue(EMF_PATH + "/end/durationSeconds", "RANGE", "观察时长必须为正数。");
      else stage.end = { kind: "time", durationSeconds: end.durationSeconds };
    } else if (kind === "distance") {
      if (!isFiniteNumber(end.distanceM)) missing.push(EMF_PATH + "/end/distanceM");
      else if (!(end.distanceM > 0)) issue(EMF_PATH + "/end/distanceM", "RANGE", "位移必须为正数。");
      else stage.end = { kind: "distance", distanceM: end.distanceM };
    } else if (kind === "speed") {
      if (!isFiniteNumber(end.speedMps)) missing.push(EMF_PATH + "/end/speedMps");
      else if (end.speedMps < 0) issue(EMF_PATH + "/end/speedMps", "RANGE", "目标速率不能为负。");
      else stage.end = { kind: "speed", speedMps: end.speedMps };
    } else if (kind === "stop") {
      stage.end = { kind: "stop" };
    } else if (kind === "terminal") {
      stage.end = { kind: "terminal" };
    } else {
      issue(EMF_PATH + "/end", "UNSUPPORTED", "观察终点仅支持 time / distance / speed / stop / terminal。");
    }
  }

  const v0 = isFiniteNumber(stage.initialSpeedMps) ? stage.initialSpeedMps : 0;
  const draft: StagePlanDraft = { kind: "stage_plan", schemaVersion: 1, initial: { speedMps: v0 }, stages: [stage] };

  if (!missing.length && !errors.length) {
    try {
      solveEmfRail(stage as unknown as EmfRailStage);
      return { ok: true, reading: draft as unknown as ResolvedStagePlan };
    } catch (error) {
      issue(EMF_PATH, "RANGE", (error as Error).message);
    }
  }

  return {
    ok: false,
    code: errors.some((e) => e.code === "TYPE") ? "INVALID_READING" : errors.some((e) => e.code === "UNSUPPORTED") ? "UNSUPPORTED" : errors.length ? "INCONSISTENT_CONDITIONS" : "NEEDS_INPUT",
    message: errors.length ? "请修正标记的电磁感应条件。" : "请补齐电磁感应导轨所需的磁感应强度、导轨间距、总电阻、棒质量与观察终点。",
    reading: draft,
    missingKeys: missing,
    fieldErrors: errors,
  };
}
