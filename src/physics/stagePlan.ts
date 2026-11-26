import type {HorizontalInitial} from './horizontalTypes.ts';
import { resolveSpringEnergy } from "./springEnergy.ts";
import { resolveGaokaoImplicitParams, type DerivedCalculation } from "./gaokaoConstraints.ts";
import { solveRoughSpring } from "./roughSpring.ts";
import { circularEntry, circularGeometry, type ExplicitArcPath } from './circularArc.ts';
import { validateMultiBodyPlan } from './multiBodyPlan.ts';
import type { BodyDefinition, BodyStage } from './multiBodyTypes.ts';
export type Energy = { stageIndex: number; elasticEnergyJ: number; origin: "given" | "user" | "spring_parameters" | "critical_arc_top"; basis?: Record<string, number> };
export type PlaybackScope = { mode: "full" | "suffix" | "state_only"; startStageIndex: number; unresolvedKeys: string[]; reason: string; xM?: number; vxMps?: number; stopReason?: "stop_at_target" | "stop_before_target" | "prefix_end" };
export type SingleStageKind = "incline_slide" | "lossless_turn" | "horizontal_slide" | "spring_contact" | "projectile" | "vertical_arc" | "spring_release" | "constant_force_1d" | "conveyor_belt" | "magnetic_deflection" | "movable_arc" | "spring_pair";
export type StageKind = SingleStageKind | BodyStage['kind'];
export type SingleStage =
  | { kind: "incline_slide"; direction?: "down" | "up"; lengthM?: number | null; angleDeg: number; kineticFrictionCoefficient: number; staticFrictionCoefficient?: number | null; slidesAfterRelease?: boolean | null }
  | { kind: "lossless_turn"; lossless: true }
  | { kind: "horizontal_slide"; kineticFrictionCoefficient: number; end: { kind: "distance"; distanceM: number } | { kind: "stop" } | { kind: "distance_from_stage_start"; stageIndex: number; distanceM: number } }
  | { kind: "constant_force_1d"; netForceXN: number; end: { kind: "duration"; durationSeconds: number } | { kind: "stop" } }
  | import("./conveyorBelt.ts").ConveyorBeltStage
  | import("./magneticDeflection.ts").MagneticDeflectionStage
  | import("./movableArc.ts").MovableArcStage
  | import("./springPair.ts").SpringPairStage
  | { kind: "spring_release"; springConstantNpm: number | null; initialCompressionM: number | null; kineticFrictionCoefficient: number; unattached: true; slidesAfterRelease: boolean; releaseCompleteByM?: number | null }
  | { kind: "spring_contact"; springConstantNpm: number; frictionless: true; unattached: true; kineticFrictionCoefficient?: never; staticFrictionCoefficient?: never; reboundAtMaxCompression?: never }
  | { kind: "spring_contact"; springConstantNpm: number; kineticFrictionCoefficient: number; staticFrictionCoefficient?: number | null; reboundAtMaxCompression?: boolean | null; unattached: true; frictionless?: never }
  | { kind: "vertical_arc"; radiusM: number; verticalDropM?: number; endAngleDeg?: number; path?: ExplicitArcPath; side: "inside" | "rod"; frictionless: true; startLabel?: string; endLabel?: string }
  | ({ kind: "projectile"; startLabel?: string; endLabel?: string } & ({ dropHeightM: number; landingPlaneYM?: never; end?: never } | { landingPlaneYM: number; dropHeightM?: never; end?: never } | { end: { kind: "tangent_to_next_arc" }; dropHeightM?: number; landingPlaneYM?: never }));
export type Stage = SingleStage | BodyStage;

export type ResolvedStagePlan = {
  kind: "stage_plan";
  schemaVersion: 1;
  gravityMps2?: number;
  massKg?: number;
  initial: { speedMps: number } | { vxMps: number; vyMps: number } | { vxMps: number } | { tangentialSpeedMps: number } | HorizontalInitial;
  bodies?: BodyDefinition[];
  primaryBodyId?: string;
  stages: Stage[];
  energy?: Energy;
  derivedCalculations?: DerivedCalculation[];
};
export type StagePlanDraft = {
  kind: "stage_plan";
  schemaVersion: 1;
  gravityMps2?: number | null;
  massKg?: number | null;
  initial: { speedMps: number | null } | { vxMps: number | null; vyMps: number | null } | { vxMps: number | null } | { tangentialSpeedMps: number | null } | { bodies: Array<Record<string, unknown>> };
  bodies?: Array<{ bodyId: string | null; massKg: number | null }>;
  primaryBodyId?: string | null;
  stages: Array<Record<string, unknown>>;
  energy?: Energy;
  constraints?: unknown;
};
export type StageFieldError = { path: string; code: string; message: string };
export type StagePlanFailure = {
  ok: false;
  code: "NEEDS_INPUT" | "INVALID_READING" | "INCONSISTENT_CONDITIONS" | "UNSUPPORTED";
  message: string;
  reading: StagePlanDraft | null;
  missingKeys: string[];
  fieldErrors: StageFieldError[];
};
export type StagePlanValidation = { ok: true; reading: ResolvedStagePlan; playback?: PlaybackScope } | StagePlanFailure;

const stageKinds: readonly string[] = ["incline_slide", "lossless_turn", "horizontal_slide", "spring_contact", "projectile", "vertical_arc", "spring_release", "constant_force_1d", "conveyor_belt", "magnetic_deflection", "movable_arc", "spring_pair"];
const positive = (value: number) => value > 0;
const nonnegative = (value: number) => value >= 0;
const finite = (_value: number) => true;
const numericRules: Record<StageKind, Record<string, (value: number) => boolean>> = {
  horizontal_approach: {}, pendulum_swing: {}, collision_1d: {}, parallel_motion: {}, block_plank: {}, pulley_system: {},
  incline_slide: { lengthM: positive, angleDeg: (value) => value > 0 && value < 90, kineticFrictionCoefficient: nonnegative },
  lossless_turn: {},
  horizontal_slide: { kineticFrictionCoefficient: nonnegative },
  constant_force_1d: { netForceXN: finite },
  conveyor_belt: { initialBeltSpeedMps: finite, kineticFrictionCoefficient: nonnegative },
  magnetic_deflection: { magneticTeslaB: positive, chargeC: (value) => value !== 0, regionWidthM: positive },
  movable_arc: { radiusM: positive, grooveMassKg: positive },
  spring_pair: {},
  spring_contact: { springConstantNpm: positive },
  spring_release: { kineticFrictionCoefficient: nonnegative },
  projectile: {},
  vertical_arc: { radiusM: positive, endAngleDeg: (value) => value > 0 && value <= 180 },
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateStagePlan(input: unknown): StagePlanValidation {
  if (record(input) && ('bodies' in input || (Array.isArray(input.stages) && input.stages.some(s => record(s) && ['pendulum_swing','collision_1d','parallel_motion','horizontal_approach','block_plank','pulley_system'].includes(String(s.kind)))))) return validateMultiBodyPlan(input, validateStagePlan);
  const missingKeys: string[] = [];
  const fieldErrors: StageFieldError[] = [];
  let damaged = false;
  let unsupported = false;
  let draft: StagePlanDraft | null = null;
  const issue = (path: string, code: string, message: string) => {
    fieldErrors.push({ path, code, message });
    if (code === "TYPE") damaged = true;
    if (code === "UNSUPPORTED") unsupported = true;
  };
  const result = (): StagePlanFailure => ({
    ok: false,
    code: damaged ? "INVALID_READING" : unsupported ? "UNSUPPORTED" : fieldErrors.length ? "INCONSISTENT_CONDITIONS" : "NEEDS_INPUT",
    message: damaged ? "阶段计划结构或字段类型损坏，请重新识别。" : unsupported ? "当前版本不支持标记的模块或接续方式。" : fieldErrors.length ? "请修正标记的条件。" : "请补齐或确认标记的条件。",
    reading: damaged ? null : draft,
    missingKeys: [...new Set(missingKeys)],
    fieldErrors,
  });
  if (!record(input)) {
    issue("", "TYPE", "计划应为对象。");
    return result();
  }
  if (input.kind == null) missingKeys.push("/kind");
  else if (input.kind !== "stage_plan") issue("/kind", "UNSUPPORTED", "需要已登记的阶段计划。");
  if (input.schemaVersion == null) missingKeys.push("/schemaVersion");
  else if (input.schemaVersion !== 1) issue("/schemaVersion", "UNSUPPORTED", "仅支持阶段计划版本 1。");
  if (!Array.isArray(input.stages)) {
    if (input.stages == null) missingKeys.push("/stages");
    else issue("/stages", "TYPE", "阶段列表应为数组。");
    return result();
  }
  if (input.stages.length === 0) {
    missingKeys.push("/stages");
    return result();
  }
  for (const [i, stage] of input.stages.entries()) {
    if (!record(stage)) issue("/stages/" + i, "TYPE", "阶段应为对象。");
    else if (stage.kind == null) missingKeys.push("/stages/" + i + "/kind");
    else if (typeof stage.kind !== "string") issue("/stages/" + i + "/kind", "TYPE", "阶段种类应为字符串。");
    else if (!stageKinds.includes(stage.kind)) issue("/stages/" + i + "/kind", "UNSUPPORTED", "未登记的阶段模块。");
  }
  // 仅整体结构未知时提前返回；局部kind缺失不吞掉其他已知阶段的问题。
  if (damaged || unsupported || missingKeys.some((path) => !/^\/stages\/\d+\/kind$/.test(path))) return result();
  const stages = input.stages as Array<Record<string, unknown> & { kind?: StageKind | null }>;
  if (!stages.some((stage) => stage.kind != null)) return result();
  const firstKind = stages[0].kind;
  if (input.initial != null && !record(input.initial)) {
    issue("/initial", "TYPE", "初态应为对象。");
    return result();
  }
  const initial = input.initial ?? {};
  const hasSpeed = Object.prototype.hasOwnProperty.call(initial, "speedMps");
  const hasVx = "vxMps" in initial;
  const hasVy = "vyMps" in initial;
  const hasComponents = hasVx || hasVy;
  const conveyorInitial = firstKind === "conveyor_belt";
  // 磁场偏转首段沿用首阶段规则：允许 speedMps 或 vxMps/vyMps 两种形式，二者互斥。
  const magneticInitial = firstKind === "magnetic_deflection";
  if ((hasSpeed && hasComponents)
    || (conveyorInitial && (hasSpeed || hasVy))
    || (!conveyorInitial && !magneticInitial && firstKind != null && (firstKind === "projectile" ? hasSpeed : hasComponents))) {
    issue("/initial", "PRECONDITION_CONFLICT", "初态标量与分量互斥，请按第一段选择速度形式。");
  }
  const normalizedInitial: Record<string, number | null> = {};
  draft = {
    kind: "stage_plan", schemaVersion: 1,
    initial: normalizedInitial as StagePlanDraft["initial"],
    stages: stages.map((stage) => ({ ...stage, kind: stage.kind ?? null, ...(record(stage.end) ? { end: { ...stage.end } } : {}) })),
  };
  function numberField(source: Record<string, unknown>, target: Record<string, unknown>, key: string, path: string, rule: (value: number) => boolean, required = true) {
    const value = source[key];
    if (value == null) {
      if (required) { target[key] = null; missingKeys.push(path); }
      else if (value === null) target[key] = null;
    } else if (typeof value !== "number") {
      target[key] = null;
      issue(path, "TYPE", "需要数值，单位应先由识别层归一化。");
    } else if (!Number.isFinite(value)) {
      target[key] = null;
      issue(path, "NOT_FINITE", "数值须为有限数。");
    } else {
      target[key] = value;
      if (!rule(value)) issue(path, "RANGE", "数值超出该字段的适用范围。");
    }
  }
  function fact(stage: Record<string, unknown>, key: string, path: string) {
    if (stage[key] == null) { stage[key] = null; missingKeys.push(path); }
    else if (stage[key] === false) issue(path, "UNSUPPORTED", "题面明确不满足该阶段的适用前提。");
    else if (stage[key] !== true) issue(path, "TYPE", "前提事实须为布尔值或 null。");
  }
  const componentInitial = firstKind === "projectile" || (magneticInitial && hasComponents) || (firstKind == null && hasComponents && !hasSpeed);
  const initialKeys = conveyorInitial ? ["vxMps"] : componentInitial ? ["vxMps", "vyMps"] : ["speedMps"];
  for (const key of initialKeys) numberField(initial, normalizedInitial, key, "/initial/" + key, key === "speedMps" ? nonnegative : finite);
  // 初态形状冲突时也保留另一种形状的已知值，便于用户选择正确形式。
  for (const key of ["speedMps", "vxMps", "vyMps"]) {
    if (!initialKeys.includes(key) && key in initial) numberField(initial, normalizedInitial, key, "/initial/" + key, key === "speedMps" ? nonnegative : finite, false);
  }
  const needsGravity = stages.some((stage) => stage.kind === "incline_slide" || stage.kind === "projectile" || stage.kind === "vertical_arc" || stage.kind === "conveyor_belt" || stage.kind === "movable_arc" || (stage.kind === "spring_contact" && Object.prototype.hasOwnProperty.call(stage, "kineticFrictionCoefficient"))
    || ((stage.kind === "horizontal_slide" || stage.kind === "spring_release") && typeof stage.kineticFrictionCoefficient === "number" && stage.kineticFrictionCoefficient > 0));
  const needsMass = stages.some((stage) => stage.kind === "spring_contact" || stage.kind === "vertical_arc" || stage.kind === "spring_release" || stage.kind === "constant_force_1d" || stage.kind === "magnetic_deflection" || stage.kind === "movable_arc" || stage.kind === "spring_pair");
  numberField(input, draft, "gravityMps2", "/gravityMps2", positive, needsGravity);
  numberField(input, draft, "massKg", "/massKg", positive, needsMass);
  const nonSpringConstraints = stages[0]?.kind !== "spring_release" && input.constraints != null;
  const criticalTopIndices = new Set<number>();
  if (nonSpringConstraints && Array.isArray(input.constraints)) {
    for (const c of input.constraints) {
      if (record(c) && c.kind === "critical_arc_top" && typeof c.stageIndex === "number" && Number.isInteger(c.stageIndex)) {
        criticalTopIndices.add(c.stageIndex);
      }
    }
  }
  const hasGaokaoImplicit = nonSpringConstraints
    || stages.some((s) => (s.kind === "projectile" && Object.prototype.hasOwnProperty.call(s, "end"))
      || (s.kind === "vertical_arc" && Object.prototype.hasOwnProperty.call(s, "verticalDropM")));
  if (nonSpringConstraints) draft.constraints = input.constraints;
  for (const [i, source] of stages.entries()) {
    if (source.kind == null) continue;
    const stage = draft.stages[i];
    const path = "/stages/" + i;
    for (const [key, rule] of Object.entries(numericRules[source.kind])) {
      if (source.kind === 'vertical_arc' && key === 'endAngleDeg' && Object.prototype.hasOwnProperty.call(source, 'path')) continue;
      if (source.kind === 'vertical_arc' && key === 'radiusM' && source.radiusM == null
        && ((Object.prototype.hasOwnProperty.call(source, 'verticalDropM') && source.verticalDropM != null) || criticalTopIndices.has(i))) {
        stage.radiusM = null;
        continue;
      }
      if (source.kind === "incline_slide" && key === "lengthM" && source.direction === "up") {
        // 冲上斜面允许 lengthM 为空或 null，表示斜面足够长。
        numberField(source, stage, key, path + "/" + key, rule, false);
        continue;
      }
      numberField(source, stage, key, path + "/" + key, rule);
    }
    if (source.kind === "incline_slide") {
      if (source.direction != null) {
        if (typeof source.direction !== "string") issue(path + "/direction", "TYPE", "斜面方向须为字符串。");
        else if (source.direction !== "down" && source.direction !== "up") issue(path + "/direction", "UNSUPPORTED", "斜面方向仅支持 down（下滑）或 up（上滑）。");
        else stage.direction = source.direction;
      }
      numberField(source, stage, "staticFrictionCoefficient", path + "/staticFrictionCoefficient", nonnegative, false);
      if (typeof stage.staticFrictionCoefficient === "number" && typeof stage.kineticFrictionCoefficient === "number" && stage.staticFrictionCoefficient < stage.kineticFrictionCoefficient) {
        issue(path + "/staticFrictionCoefficient", "RANGE", "静摩擦因数不应小于动摩擦因数。");
      }
      if (source.direction === "up") {
        if (i === 0 && normalizedInitial.speedMps === 0) {
          issue("/initial/speedMps", "PRECONDITION_CONFLICT", "冲上斜面需要正的初速度。");
        }
      } else if (i === 0 && normalizedInitial.speedMps === 0) {
        fact(stage, "slidesAfterRelease", path + "/slidesAfterRelease");
      } else if (source.slidesAfterRelease != null && typeof source.slidesAfterRelease !== "boolean") {
        issue(path + "/slidesAfterRelease", "TYPE", "前提事实须为布尔值或 null。");
      }
    }
    if (source.kind === "lossless_turn") fact(stage, "lossless", path + "/lossless");
    if (source.kind === "spring_release") {
      fact(stage, "unattached", path + "/unattached");
      if (source.slidesAfterRelease == null) { stage.slidesAfterRelease = null; missingKeys.push(path + "/slidesAfterRelease"); }
      else if (typeof source.slidesAfterRelease !== "boolean") issue(path + "/slidesAfterRelease", "TYPE", "起动前提须为布尔值。");
      for (const key of ["springConstantNpm", "initialCompressionM", "releaseCompleteByM"]) numberField(source, stage, key, path + "/" + key, positive, false);
      if (i !== 0 || normalizedInitial.speedMps !== 0) issue(path, "PRECONDITION_CONFLICT", "预压释放须为从静止开始的首段。");
    }
    if (source.kind === "vertical_arc") {
      if (Object.prototype.hasOwnProperty.call(source, 'path')) {
        if (Object.prototype.hasOwnProperty.call(source, 'endAngleDeg')) issue(path, 'PRECONDITION_CONFLICT', '显式圆轨path与旧endAngleDeg互斥。');
        const readObject = (value: unknown, at: string): Record<string, unknown> | null => {
          if (value == null) { missingKeys.push(at); return null; }
          if (!record(value)) { issue(at, 'TYPE', '需要对象。'); return null; }
          return value;
        };
        const choice = (target: Record<string, unknown>, key: string, choices: string[], at: string) => {
          if (target[key] == null) { target[key] = null; missingKeys.push(at); }
          else if (typeof target[key] !== 'string') issue(at, 'TYPE', '判别字段须为字符串。');
          else if (!choices.includes(target[key] as string)) issue(at, 'UNSUPPORTED', '未登记的圆轨选项。');
        };
        const raw = readObject(source.path, path + '/path');
        if (raw) {
          const p = { ...raw }; stage.path = p;
          numberField(raw, p, 'startAngleDeg', path + '/path/startAngleDeg', v => v >= -180 && v <= 180);
          choice(p, 'direction', ['positive','negative'], path + '/path/direction');
          if (raw.center !== undefined && raw.center !== null) {
            if (!record(raw.center)) { issue(path + '/path/center', 'TYPE', '需要对象。'); p.center = null; }
            else { p.center = { ...raw.center }; for (const key of ['xM','yM']) numberField(raw.center, p.center as Record<string, unknown>, key, path + '/path/center/' + key, finite); }
          } else {
            delete p.center;
          }
          const end = readObject(raw.end, path + '/path/end');
          if (end) {
            p.end = { ...end }; choice(p.end as Record<string, unknown>, 'kind', ['physical_endpoint','observation'], path + '/path/end/kind');
            numberField(end, p.end as Record<string, unknown>, 'sweepAngleDeg', path + '/path/end/sweepAngleDeg', v => v > 0 && (end.kind === 'physical_endpoint' ? v < 360 : v <= 360));
          } else p.end = null;
        } else stage.path = null;
      }
      fact(stage, "frictionless", path + "/frictionless");
      if (source.side == null) { stage.side = null; missingKeys.push(path + "/side"); }
      else if (typeof source.side !== "string") issue(path + "/side", "TYPE", "轨道内外侧须为字符串。");
      else if (source.side !== "inside" && source.side !== "rod") issue(path + "/side", "UNSUPPORTED", "当前只支持竖直圆弧内侧（inside）或轻杆/双轨（rod）。");
    }
    if (source.kind === "projectile") {
      const hasDrop = Object.prototype.hasOwnProperty.call(source, "dropHeightM") && source.dropHeightM !== undefined;
      const hasPlane = Object.prototype.hasOwnProperty.call(source, "landingPlaneYM") && source.landingPlaneYM !== undefined;
      const hasEnd = Object.prototype.hasOwnProperty.call(source, "end") && source.end !== undefined;
      const fromArc = stages[i - 1]?.kind === "vertical_arc";
      if (hasEnd) {
        if (hasDrop || hasPlane) {
          // 互斥错误交由 gaokaoConstraints 统一给出精确路径提示
        }
      } else {
        if (hasDrop && hasPlane) issue(path, "PRECONDITION_CONFLICT", "相对落差与固定落地平面互斥，请保留一种。");
        else if (fromArc && hasDrop) issue(path, "PRECONDITION_CONFLICT", "圆弧后抛体需固定 landingPlaneYM，不能使用相对落差。");
        if (hasDrop || (!hasPlane && !fromArc)) numberField(source, stage, "dropHeightM", path + "/dropHeightM", nonnegative);
        if (hasPlane || (fromArc && !hasDrop)) numberField(source, stage, "landingPlaneYM", path + "/landingPlaneYM", finite);
      }
    }
    if (source.kind === "spring_contact") {
      const rough = Object.prototype.hasOwnProperty.call(source, "kineticFrictionCoefficient");
      if (rough) {
        if (Object.prototype.hasOwnProperty.call(source, "frictionless")) issue(path, "PRECONDITION_CONFLICT", "粗糙接触（动摩擦因数）与 frictionless 互斥，请保留一种。");
        numberField(source, stage, "kineticFrictionCoefficient", path + "/kineticFrictionCoefficient", nonnegative);
        numberField(source, stage, "staticFrictionCoefficient", path + "/staticFrictionCoefficient", nonnegative, false);
        const rebound = source.reboundAtMaxCompression;
        if (rebound != null && typeof rebound !== "boolean") issue(path + "/reboundAtMaxCompression", "TYPE", "回弹事实须为布尔值或 null。");
        else if (rebound === undefined || rebound === null) stage.reboundAtMaxCompression = null;
        if (source.staticFrictionCoefficient == null && rebound == null) missingKeys.push(path + "/staticFrictionCoefficient");
        const mus = stage.staticFrictionCoefficient, muk = stage.kineticFrictionCoefficient;
        if (typeof mus === "number" && typeof muk === "number" && mus < muk) issue(path + "/staticFrictionCoefficient", "RANGE", "静摩擦因数不应小于动摩擦因数。");
      } else {
        fact(stage, "frictionless", path + "/frictionless");
        if (Object.prototype.hasOwnProperty.call(source, "staticFrictionCoefficient") || Object.prototype.hasOwnProperty.call(source, "reboundAtMaxCompression")) {
          issue(path, "PRECONDITION_CONFLICT", "光滑弹簧接触不能同时携带静摩擦因数或回弹事实，请改用粗糙接触。");
        }
      }
      fact(stage, "unattached", path + "/unattached");
      if (i === 0 && normalizedInitial.speedMps === 0) issue("/initial/speedMps", "PRECONDITION_CONFLICT", "弹簧接触需要水平正速入射。");
    }
    if (source.kind === "horizontal_slide") {
      if (source.end == null) { stage.end = null; missingKeys.push(path + "/end"); }
      else if (!record(source.end)) issue(path + "/end", "TYPE", "结束条件应为对象。");
      else if (source.end.kind == null) { stage.end = { ...source.end, kind: null }; missingKeys.push(path + "/end/kind"); }
      else if (source.end.kind === "distance" || source.end.kind === "distance_from_stage_start") {
        numberField(source.end, stage.end as Record<string, unknown>, "distanceM", path + "/end/distanceM", positive);
        if (source.end.kind === "distance_from_stage_start") {
          numberField(source.end, stage.end as Record<string, unknown>, "stageIndex", path + "/end/stageIndex", v => Number.isInteger(v) && v >= 0 && v < i);
          if (typeof source.end.stageIndex === "number" && (source.end.stageIndex !== i - 1 || stages[i - 1]?.kind !== "spring_release")) issue(path + "/end/stageIndex", "PRECONDITION_CONFLICT", "距离引用须指向紧邻的预压释放阶段。");
        }
      }
      else if (source.end.kind !== "stop") issue(path + "/end/kind", "UNSUPPORTED", "未登记的水平结束条件。");
      if (record(source.end) && source.end.kind === "stop" && source.kineticFrictionCoefficient === 0 && (i > 0 || (normalizedInitial.speedMps ?? 0) > 0)) {
        issue(path + "/end", "PRECONDITION_CONFLICT", "光滑面上的正速运动无法因摩擦停止。");
      }
    }
    if (source.kind === "conveyor_belt") {
      numberField(source, stage, "staticFrictionCoefficient", path + "/staticFrictionCoefficient", nonnegative, false);
      numberField(source, stage, "beltLengthM", path + "/beltLengthM", positive, source.entryEdge != null || source.continuationExitEdge != null);
      for (const key of ["entryEdge", "continuationExitEdge"] as const) {
        const value = source[key];
        if (value == null) continue;
        if (typeof value !== "string") issue(path + "/" + key, "TYPE", "传送带端点须为字符串。");
        else if (value !== "start" && value !== "end") issue(path + "/" + key, "UNSUPPORTED", "仅支持 start（沿带起端）或 end（沿带末端）。");
      }
      numberField(source, stage, "angleDeg", path + "/angleDeg", (v) => v >= 0 && v < 90, false);
      if (source.inclineDirection != null) {
        if (typeof source.inclineDirection !== "string") issue(path + "/inclineDirection", "TYPE", "倾斜方向须为字符串。");
        else if (source.inclineDirection !== "up" && source.inclineDirection !== "down") issue(path + "/inclineDirection", "UNSUPPORTED", "倾斜方向仅支持 up（向上）或 down（向下）。");
        else stage.inclineDirection = source.inclineDirection;
      }
      if (typeof stage.staticFrictionCoefficient === "number" && typeof stage.kineticFrictionCoefficient === "number" && stage.staticFrictionCoefficient < stage.kineticFrictionCoefficient) {
        issue(path + "/staticFrictionCoefficient", "RANGE", "静摩擦因数不应小于动摩擦因数。");
      }
      const hasBeltLength = typeof stage.beltLengthM === "number" && stage.beltLengthM > 0;
      let hasAccel = false;
      if (source.segments == null || (Array.isArray(source.segments) && source.segments.length === 0)) {
        if (hasBeltLength) {
          // 定长匀速且未给时长，按实际离带或停下结束。
          stage.segments = [{ accelerationMps2: 0, durationSeconds: null }];
        } else {
          stage.segments = null;
          missingKeys.push(path + "/segments");
        }
      } else if (!Array.isArray(source.segments)) issue(path + "/segments", "TYPE", "传送带速度分段须为数组。");
      else {
        const rawSegs = source.segments;
        const segs: Record<string, unknown>[] = [];
        rawSegs.forEach((rawSeg, j) => {
          const sp = `${path}/segments/${j}`;
          if (!record(rawSeg)) { issue(sp, "TYPE", "传送带分段须为对象。"); return; }
          const copy: Record<string, unknown> = { ...rawSeg };
          numberField(rawSeg, copy, "accelerationMps2", sp + "/accelerationMps2", finite);
          if (hasBeltLength && rawSegs.length === 1 && copy.accelerationMps2 === 0 && rawSeg.durationSeconds == null) {
            copy.durationSeconds = null;
          } else {
            numberField(rawSeg, copy, "durationSeconds", sp + "/durationSeconds", positive);
          }
          if (typeof copy.accelerationMps2 === "number" && copy.accelerationMps2 !== 0) hasAccel = true;
          segs.push(copy);
        });
        stage.segments = segs;
      }
      if (hasAccel && source.staticFrictionCoefficient == null) {
        missingKeys.push(path + "/staticFrictionCoefficient");
      }
    }
    if (source.kind === "magnetic_deflection") {
      if (source.fieldDirection == null) stage.fieldDirection = "into_page";
      else if (source.fieldDirection !== "into_page" && source.fieldDirection !== "out_of_page") issue(path + "/fieldDirection", "UNSUPPORTED", "磁场方向仅支持垂直纸面向里或向外。");
      else stage.fieldDirection = source.fieldDirection;
      if (source.exitKind == null) stage.exitKind = "region_edge";
      else if (source.exitKind !== "region_edge" && source.exitKind !== "half_circle") issue(path + "/exitKind", "UNSUPPORTED", "未登记的磁场出射方式。");
      else stage.exitKind = source.exitKind;
    }
    if (source.kind === "movable_arc") {
      if (source.exitDirection == null) stage.exitDirection = -1;
      else if (source.exitDirection !== -1 && source.exitDirection !== 1) issue(path + "/exitDirection", "UNSUPPORTED", "离槽方向仅支持 -1（向左）或 1（向右）。");
      else stage.exitDirection = source.exitDirection;
    }
    if (source.kind === "spring_pair") {
      if (source.springConstantNpm == null) stage.springConstantNpm = 100;
      else numberField(source, stage, "springConstantNpm", path + "/springConstantNpm", positive);
      if (source.targetMassKg == null) stage.targetMassKg = null;
      else numberField(source, stage, "targetMassKg", path + "/targetMassKg", positive);
      if (source.separationSpeedMps == null) stage.separationSpeedMps = null;
      else numberField(source, stage, "separationSpeedMps", path + "/separationSpeedMps", positive);
      if (source.gapM == null) stage.gapM = 0.5;
      else numberField(source, stage, "gapM", path + "/gapM", nonnegative);
      if (source.matchGrooveSpeed != null) {
        if (typeof source.matchGrooveSpeed !== "boolean") issue(path + "/matchGrooveSpeed", "TYPE", "matchGrooveSpeed 须为布尔值。");
        else if (source.matchGrooveSpeed && stages[i - 1]?.kind !== "movable_arc") issue(path + "/matchGrooveSpeed", "PRECONDITION_CONFLICT", "matchGrooveSpeed 仅在紧接 movable_arc 后使用。");
        else stage.matchGrooveSpeed = source.matchGrooveSpeed;
      }
      if (stage.targetMassKg == null && stage.separationSpeedMps == null && stage.matchGrooveSpeed !== true) missingKeys.push(path + "/targetMassKg");
    }
    if (source.kind === "constant_force_1d") {
      if (source.end == null) { stage.end = null; missingKeys.push(path + "/end"); }
      else if (!record(source.end)) issue(path + "/end", "TYPE", "结束条件应为对象。");
      else if (source.end.kind == null) { stage.end = { ...source.end, kind: null }; missingKeys.push(path + "/end/kind"); }
      else if (typeof source.end.kind !== "string") issue(path + "/end/kind", "TYPE", "结束条件种类须为字符串。");
      else if (source.end.kind === "duration") {
        numberField(source.end, stage.end as Record<string, unknown>, "durationSeconds", path + "/end/durationSeconds", positive);
      } else if (source.end.kind !== "stop") {
        issue(path + "/end/kind", "UNSUPPORTED", "未登记的常力段结束条件。");
      }
    }
    const previous = stages[i - 1]?.kind;
    const permitted = i === 0 ? source.kind !== "lossless_turn"
      : previous == null ? true
      : previous === "incline_slide" ? source.kind === "lossless_turn" || source.kind === "projectile" || source.kind === "conveyor_belt" || (source.kind === "vertical_arc" && Object.prototype.hasOwnProperty.call(source, "path"))
      : previous === "lossless_turn" ? ["horizontal_slide", "spring_contact", "vertical_arc", "constant_force_1d", "conveyor_belt", "spring_pair", "incline_slide"].includes(source.kind)
      : previous === "horizontal_slide" ? ["spring_contact", "projectile", "vertical_arc", "constant_force_1d", "magnetic_deflection", "conveyor_belt", "spring_pair", "lossless_turn", "incline_slide"].includes(source.kind)
      : previous === "constant_force_1d" ? ["constant_force_1d", "horizontal_slide", "spring_contact", "projectile", "vertical_arc", "conveyor_belt", "spring_pair", "lossless_turn"].includes(source.kind)
      : previous === "vertical_arc" ? ["projectile", "horizontal_slide", "incline_slide", "spring_contact", "constant_force_1d", "vertical_arc", "conveyor_belt", "spring_pair", "lossless_turn"].includes(source.kind)
      : previous === "projectile" ? source.kind === "vertical_arc" || source.kind === "incline_slide"
      : previous === "spring_release" ? ["horizontal_slide", "spring_contact", "vertical_arc", "projectile", "constant_force_1d", "conveyor_belt", "spring_pair", "lossless_turn", "incline_slide"].includes(source.kind)
      : previous === "spring_contact" ? ["horizontal_slide", "lossless_turn", "incline_slide", "vertical_arc", "conveyor_belt", "projectile"].includes(source.kind)
      : previous === "conveyor_belt" ? ["projectile", "horizontal_slide", "spring_contact", "vertical_arc", "constant_force_1d", "incline_slide", "spring_pair", "lossless_turn"].includes(source.kind)
      : previous === "magnetic_deflection" ? ["projectile", "horizontal_slide", "constant_force_1d", "conveyor_belt"].includes(source.kind)
      : previous === "movable_arc" ? ["spring_pair", "horizontal_slide", "spring_contact", "vertical_arc", "projectile", "conveyor_belt"].includes(source.kind)
      : previous === "spring_pair" ? ["horizontal_slide", "projectile", "vertical_arc"].includes(source.kind)
      : false;
    if (!permitted) issue(path + "/kind", "UNSUPPORTED", "当前版本不支持该阶段接续。");
    if (i > 0 && previous === "horizontal_slide") {
      const end = stages[i - 1].end;
      if (record(end) && end.kind === "stop") issue("/stages/" + (i - 1) + "/end", "PRECONDITION_CONFLICT", "接续后段需给出水平距离目标。");
    }
    if (i > 0 && previous === "constant_force_1d" && source.kind !== "constant_force_1d") {
      const end = stages[i - 1].end;
      if (record(end) && end.kind === "stop") issue("/stages/" + (i - 1) + "/end", "PRECONDITION_CONFLICT", "减速至静止后不能直接接续该阶段，请改用定时结束或接续下一常力段。");
    }
  }
  // 只判定已知的起动矛盾，停止与到达谁先发生留给运动计算。
  const first = stages[0];
  if (first.kind === "incline_slide" && first.direction !== "up" && normalizedInitial.speedMps === 0
    && typeof draft.gravityMps2 === "number" && draft.gravityMps2 > 0
    && typeof first.angleDeg === "number" && first.angleDeg > 0 && first.angleDeg < 90
    && typeof first.kineticFrictionCoefficient === "number" && first.kineticFrictionCoefficient >= 0) {
    const angle = first.angleDeg * Math.PI / 180;
    if (Math.sin(angle) - first.kineticFrictionCoefficient * Math.cos(angle) <= 0) {
      issue("/stages/0/kineticFrictionCoefficient", "PRECONDITION_CONFLICT", "当前倾角与摩擦无法支持从静止开始下滑。");
    }
  }
  let derivedCalculations: DerivedCalculation[] = [];
  if (hasGaokaoImplicit) {
    const solved = resolveGaokaoImplicitParams({
      gravityMps2: draft.gravityMps2,
      massKg: draft.massKg,
      initial: normalizedInitial,
      stages: draft.stages,
      ...(nonSpringConstraints ? { constraints: input.constraints } : {}),
    });
    if (solved.ok) {
      draft.stages = solved.stages;
      derivedCalculations = solved.calculations;
    } else {
      for (const mk of solved.missingKeys) missingKeys.push(mk);
      for (const fe of solved.fieldErrors) issue(fe.path, fe.code, fe.message);
    }
  }
  if(!missingKeys.length&&!fieldErrors.length)for(const [i,s]of draft.stages.entries())if(s.kind==='vertical_arc'&&s.path){
    try{circularGeometry(s as unknown as Extract<Stage,{kind:'vertical_arc'}>&{path:ExplicitArcPath},i);}
    catch(e){issue('/stages/'+i+((e as {field?:string}).field??'/path'),'RANGE',(e as Error).message);}
  }
  const playback = resolveSpringEnergy(input, draft, missingKeys, issue, numberField);
  if (!missingKeys.length && !fieldErrors.length && draft.stages[0].kind === 'vertical_arc' && draft.stages[0].path) {
    try { circularEntry(draft.stages[0] as unknown as Extract<Stage,{kind:'vertical_arc'}> & {path:ExplicitArcPath}, normalizedInitial.speedMps!, draft.gravityMps2!, draft.massKg!, 0); }
    catch (e) { issue('/stages/0' + ((e as {field?:string}).field??('/path' + (e instanceof Error && e.message.includes('方向') ? '/direction' : ''))), e instanceof RangeError ? 'RANGE' : 'PRECONDITION_CONFLICT', (e as Error).message); }
  }
  if (!missingKeys.length && !fieldErrors.length && draft.stages[0].kind === 'spring_contact' && Object.prototype.hasOwnProperty.call(draft.stages[0], 'kineticFrictionCoefficient')) {
    const s = draft.stages[0];
    const checked = solveRoughSpring({
      speedMps: normalizedInitial.speedMps!,
      massKg: draft.massKg!,
      gravityMps2: draft.gravityMps2!,
      springConstantNpm: s.springConstantNpm as number,
      kineticFrictionCoefficient: s.kineticFrictionCoefficient as number,
      staticFrictionCoefficient: s.staticFrictionCoefficient as number | null | undefined,
      reboundAtMaxCompression: s.reboundAtMaxCompression as boolean | null | undefined,
    });
    if ('conflict' in checked) issue('/stages/0' + checked.path, 'PRECONDITION_CONFLICT', checked.conflict);
  }
  if (!missingKeys.length && !fieldErrors.length && draft.stages[0].kind === 'constant_force_1d') {
    let vx = normalizedInitial.speedMps!;
    const m = draft.massKg!;
    for (let i = 0; i < draft.stages.length; i++) {
      const s = draft.stages[i];
      if (s.kind !== 'constant_force_1d') break;
      const force = s.netForceXN as number;
      const end = s.end as { kind: string; durationSeconds?: number };
      const a = force / m;
      if (end.kind === 'stop') {
        if (vx === 0 && force !== 0) { issue(`/stages/${i}/end`, 'PRECONDITION_CONFLICT', '初速度为零且合力非零，物体将加速离开静止而非停止。'); break; }
        if (vx !== 0 && (force === 0 || Math.sign(force) === Math.sign(vx))) { issue(`/stages/${i}/end`, 'PRECONDITION_CONFLICT', '合力方向与当前速度相同或为零，无法减速至零。'); break; }
        vx = 0;
      } else {
        vx = vx + a * end.durationSeconds!;
      }
    }
  }
  if (missingKeys.length || fieldErrors.length) return result();
  const resolved: ResolvedStagePlan = {
    kind: "stage_plan", schemaVersion: 1,
    initial: normalizedInitial as ResolvedStagePlan["initial"],
    stages: draft.stages as Stage[],
  };
  if (typeof draft.gravityMps2 === "number") resolved.gravityMps2 = draft.gravityMps2;
  if (typeof draft.massKg === "number") resolved.massKg = draft.massKg;
  if (draft.energy) resolved.energy = draft.energy;
  if (derivedCalculations.length) resolved.derivedCalculations = derivedCalculations;
  else if (Array.isArray(input.derivedCalculations) && input.derivedCalculations.length) resolved.derivedCalculations = input.derivedCalculations as DerivedCalculation[];
  return { ok: true, reading: resolved, ...(playback ? { playback } : {}) };
}

