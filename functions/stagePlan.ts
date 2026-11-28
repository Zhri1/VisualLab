// 由 scripts/sync-functions.mjs 从 src/physics/stagePlan.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
import {validateBinaryCircularOrbitPlan} from "./binaryCircularOrbit.ts";
import {validateEmfRailPlan} from "./emfRail.ts";
import { resolveUniformConstraints, inclineTrig } from "./uniformConstraints.ts";
import type {HorizontalInitial} from './horizontalTypes.ts';
import { resolveSpringEnergy } from "./springEnergy.ts";
import { resolveGaokaoImplicitParams, type DerivedCalculation } from "./gaokaoConstraints.ts";
import { solveRoughSpring } from "./roughSpring.ts";
import { circularEntry, circularGeometry, type ExplicitArcPath } from './circularArc.ts';
import { validateMultiBodyPlan } from './multiBodyPlan.ts';
import { validateSwitchableEMPlan, type SwitchableEMStage } from './switchableEMCollision.ts';
import { validateMagneticReencounterPlan, type MagneticReencounterStage } from './magneticReencounter.ts';
import type { BodyDefinition, BodyStage } from './multiBodyTypes.ts';
export type Energy = { stageIndex: number; elasticEnergyJ: number; origin: "given" | "user" | "spring_parameters" | "critical_arc_top" | "tangent_to_next_arc"; basis?: Record<string, number> };
export type PlaybackScope = { mode: "full" | "suffix" | "state_only"; startStageIndex: number; unresolvedKeys: string[]; reason: string; xM?: number; vxMps?: number; stopReason?: "stop_at_target" | "stop_before_target" | "prefix_end" };
export type SingleStageKind = "incline_slide" | "lossless_turn" | "horizontal_slide" | "spring_contact" | "projectile" | "vertical_arc" | "spring_release" | "constant_force_1d" | "conveyor_belt" | "magnetic_deflection" | "movable_arc" | "movable_semicircle" | "spring_pair" | "circular_orbit" | "binary_circular_orbit" | "emf_rail";
export type StageKind = SingleStageKind | BodyStage['kind'] | SwitchableEMStage['kind'] | MagneticReencounterStage['kind'];
export type ProjectileBounce = {
  normalRestitution: number;
  stopAt: "first_apex";
  apexHeightM?: number | null;
};
export type SingleStage =
  | { kind: "incline_slide"; direction?: "down" | "up"; lengthM?: number | null; angleDeg: number; kineticFrictionCoefficient: number; resistanceN?: number; trig?: { sin?: number; cos?: number }; returnsToEntry?: true; staticFrictionCoefficient?: number | null; slidesAfterRelease?: boolean | null }
  | { kind: "lossless_turn"; lossless: true }
  | { kind: "horizontal_slide"; kineticFrictionCoefficient: number; end: { kind: "distance"; distanceM: number } | { kind: "stop" } | { kind: "speed"; speedMps: number } | { kind: "distance_from_stage_start"; stageIndex: number; distanceM: number } }
  | { kind: "constant_force_1d"; netForceXN: number; end: { kind: "duration"; durationSeconds: number } | { kind: "distance"; distanceM: number } | { kind: "stop" }; startLabel?: string; endLabel?: string }
  | import("./conveyorBelt.ts").ConveyorBeltStage
  | import("./magneticDeflection.ts").MagneticDeflectionStage
  | import("./movableArc.ts").MovableArcStage
  | import("./binaryCircularOrbit.ts").BinaryCircularOrbitStage
  | import("./emfRail.ts").EmfRailStage
  | import("./circularOrbit.ts").CircularOrbitStage
  | import("./movableSemicircle.ts").MovableSemicircleStage
  | import("./springPair.ts").SpringPairStage
  | { kind: "spring_release"; springConstantNpm: number | null; initialCompressionM: number | null; kineticFrictionCoefficient: number; unattached: true; slidesAfterRelease: boolean; releaseCompleteByM?: number | null }
  | { kind: "spring_contact"; springConstantNpm: number; frictionless: true; unattached: true; kineticFrictionCoefficient?: never; staticFrictionCoefficient?: never; reboundAtMaxCompression?: never }
  | { kind: "spring_contact"; springConstantNpm: number; kineticFrictionCoefficient: number; staticFrictionCoefficient?: number | null; reboundAtMaxCompression?: boolean | null; unattached: true; frictionless?: never }
  | { kind: "vertical_arc"; entryOnly?: false; radiusM: number; verticalDropM?: number; endAngleDeg?: number; path?: ExplicitArcPath; side: "inside" | "rod"; frictionless: true; dragLaw?: never; knownExit?: never; startLabel?: string; endLabel?: string }
  | { kind: "vertical_arc"; entryOnly?: false; radiusM: number; endAngleDeg: number; path?: undefined; side: "inside" | "rod"; frictionless: false; dragLaw: "unknown"; knownExit: { kind: "critical_top" } | { kind: "speed"; speedMps: number }; startLabel?: string; endLabel?: string }
  | { kind:"vertical_arc"; entryOnly:true; radiusM:number; endAngleDeg?:number; side:"inside"|"rod"; frictionless?:boolean|null; path?:never; dragLaw?:never; knownExit?:never; startLabel?:string; endLabel?:string }
  | ({ kind: "projectile"; startLabel?: string; endLabel?: string; bounce?: ProjectileBounce; reversal?: {kind:"equal_speed_opposite";stopAt:"after_impulse"|"first_apex"} } & ({ dropHeightM: number; landingPlaneYM?: never; end?: never } | { landingPlaneYM: number; dropHeightM?: never; end?: never } | { end: { kind: "tangent_to_next_arc" }; dropHeightM?: number; landingPlaneYM?: never }));
export type Stage = SingleStage | BodyStage | SwitchableEMStage | MagneticReencounterStage;

export type ResolvedStagePlan = {
  kind: "stage_plan";
  schemaVersion: 1;
  scaleMode?: "normalized" | "si";
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
  scaleMode?: "normalized" | "si";
  gravityMps2?: number | null;
  massKg?: number | null;
  initial: { speedMps: number | null } | { vxMps: number | null; vyMps: number | null } | { vxMps: number | null } | { tangentialSpeedMps: number | null } | { bodies: Array<Record<string, unknown>> };
  bodies?: Array<{ bodyId: string | null; massKg: number | null }>;
  primaryBodyId?: string | null;
  stages: Array<Record<string, unknown>>;
  energy?: Energy;
  constraints?: unknown;
  derivedCalculations?: DerivedCalculation[];
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

const stageKinds: readonly string[] = ["incline_slide", "lossless_turn", "horizontal_slide", "spring_contact", "projectile", "vertical_arc", "spring_release", "constant_force_1d", "conveyor_belt", "magnetic_deflection", "movable_arc", "movable_semicircle", "spring_pair", "circular_orbit", "binary_circular_orbit", "emf_rail"];
const positive = (value: number) => value > 0;
const nonnegative = (value: number) => value >= 0;
const finite = (_value: number) => true;
const numericRules: Record<StageKind, Record<string, (value: number) => boolean>> = {
  switchable_em_collision: {}, magnetic_reencounter: {}, horizontal_approach: {}, pendulum_swing: {}, collision_1d: {}, parallel_motion: {}, block_plank: {}, pulley_system: {}, emf_rail: {},
  incline_slide: { lengthM: positive, angleDeg: (value) => value > 0 && value < 90, kineticFrictionCoefficient: nonnegative },
  lossless_turn: {},
  horizontal_slide: { kineticFrictionCoefficient: nonnegative },
  constant_force_1d: { netForceXN: finite },
  conveyor_belt: { initialBeltSpeedMps: finite, kineticFrictionCoefficient: nonnegative },
  magnetic_deflection: { magneticTeslaB: positive, chargeC: (value) => value !== 0, regionWidthM: positive },
  movable_arc: { radiusM: positive, grooveMassKg: positive },
  binary_circular_orbit: {},
  circular_orbit: { gravitationalParameterM3s2: positive },
  movable_semicircle: { radiusM: positive, grooveMassKg: positive },
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
  if (record(input) && Array.isArray(input.stages) && input.stages.some(s=>record(s)&&s.kind==="emf_rail")) return validateEmfRailPlan(input);
  if (record(input) && Array.isArray(input.stages) && input.stages.some(s=>record(s)&&s.kind==="binary_circular_orbit")) return validateBinaryCircularOrbitPlan(input);
  if (record(input) && Array.isArray(input.stages) && input.stages.some(stage => record(stage) && stage.kind === 'switchable_em_collision')) {
    return validateSwitchableEMPlan(input);
  }
  if (record(input) && Array.isArray(input.stages) && input.stages.some(stage => record(stage) && stage.kind === 'magnetic_reencounter')) {
    return validateMagneticReencounterPlan(input);
  }
  if (record(input) && ('bodies' in input || (Array.isArray(input.stages) && input.stages.some(s => record(s) && ['pendulum_swing','collision_1d','parallel_motion','horizontal_approach','block_plank','pulley_system'].includes(String(s.kind)))))) return validateMultiBodyPlan(input, (track) => validateSingleBodyPlan(track, true));
  return validateSingleBodyPlan(input);
}

function validateSingleBodyPlan(input: unknown, bodyTrack = false): StagePlanValidation {
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
  else if (typeof input.schemaVersion !== "number") issue("/schemaVersion", "TYPE", "阶段计划版本必须为数字。");
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
  const uniform = resolveUniformConstraints(input);
  input = uniform.input;
  if (!record(input)) return result();
  for (const e of uniform.errors) issue(e.path, e.code, e.message);
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
  let scaleMode: "normalized" | "si" | undefined;
  if (input.scaleMode != null) {
    if (typeof input.scaleMode !== "string") issue("/scaleMode", "TYPE", "标度模式须为字符串。");
    else if (input.scaleMode !== "normalized" && input.scaleMode !== "si") issue("/scaleMode", "UNSUPPORTED", "标度模式仅支持 normalized 或 si。");
    else scaleMode = input.scaleMode;
  }
  draft = {
    kind: "stage_plan", schemaVersion: 1,
    ...(scaleMode ? { scaleMode } : {}),
    initial: normalizedInitial as StagePlanDraft["initial"],
    stages: stages.map((stage) => ({ ...stage, kind: stage.kind ?? null, ...(record(stage.end) ? { end: { ...stage.end } } : {}) })),
  };
  const bounceDerived: DerivedCalculation[] = [];
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
  // 若首段抛体或「圆弧 → 抛体」满足「已知落差/落面 + 切向入后段圆弧」反求条件，允许初速暂为 null 交由 gaokaoConstraints 反求。
  const hasTangentLaunchDerivation =
    (firstKind === "projectile" &&
      record(stages[0]?.end) &&
      stages[0].end.kind === "tangent_to_next_arc" &&
      stages[0].dropHeightM != null &&
      stages[0].landingPlaneYM == null) ||
    (firstKind === "vertical_arc" &&
      stages[1]?.kind === "projectile" &&
      record(stages[1]?.end) &&
      stages[1].end.kind === "tangent_to_next_arc" &&
      stages[1].landingPlaneYM != null &&
      stages[1].dropHeightM == null);
  for (const key of initialKeys) {
    const optionalInitial =
      firstKind === "circular_orbit" ||
      (hasTangentLaunchDerivation &&
        ((firstKind === "projectile" && key === "vxMps") || (firstKind === "vertical_arc" && key === "speedMps")));
    numberField(initial, normalizedInitial, key, "/initial/" + key, key === "speedMps" ? nonnegative : finite, !optionalInitial);
  }
  if (firstKind === "circular_orbit" && normalizedInitial.speedMps == null) {
    normalizedInitial.speedMps = 0;
  }
  // 初态形状冲突时也保留另一种形状的已知值，便于用户选择正确形式。
  for (const key of ["speedMps", "vxMps", "vyMps"]) {
    if (!initialKeys.includes(key) && key in initial) numberField(initial, normalizedInitial, key, "/initial/" + key, key === "speedMps" ? nonnegative : finite, false);
  }
  const needsGravity = stages.some((stage) => stage.kind === "incline_slide" || stage.kind === "projectile" || stage.kind === "vertical_arc" || stage.kind === "conveyor_belt" || stage.kind === "movable_arc" || stage.kind === "movable_semicircle" || (stage.kind === "spring_contact" && Object.prototype.hasOwnProperty.call(stage, "kineticFrictionCoefficient"))
    || ((stage.kind === "horizontal_slide" || stage.kind === "spring_release") && typeof stage.kineticFrictionCoefficient === "number" && stage.kineticFrictionCoefficient > 0));
  const needsMass = stages.some((stage) => stage.kind === "spring_contact" || stage.kind === "vertical_arc" || stage.kind === "spring_release" || stage.kind === "constant_force_1d" || (stage.kind === "incline_slide" && "resistanceN" in stage) || (stage.kind === "projectile" && stage.reversal != null) || stage.kind === "magnetic_deflection" || stage.kind === "movable_arc" || stage.kind === "movable_semicircle" || stage.kind === "spring_pair");
  if (scaleMode === "normalized" && needsGravity && input.gravityMps2 == null) draft.gravityMps2 = 1;
  else numberField(input, draft, "gravityMps2", "/gravityMps2", positive, needsGravity);
  if (scaleMode === "normalized" && needsMass && input.massKg == null) draft.massKg = 1;
  else numberField(input, draft, "massKg", "/massKg", positive, needsMass);
  const nonSpringConstraints = stages[0]?.kind !== "spring_release" && input.constraints != null;
  const criticalTopIndices = new Set<number>();
  if (nonSpringConstraints && Array.isArray(input.constraints)) {
    for (const c of input.constraints) {
      if (record(c) && c.kind === "critical_arc_top" && typeof c.stageIndex === "number" && Number.isInteger(c.stageIndex)) {
        criticalTopIndices.add(c.stageIndex);
      }
    }
  }
  const hasPriorInverseTangent =
    (Array.isArray(input.derivedCalculations) &&
      (input.derivedCalculations as unknown[]).some(
        (c) =>
          record(c) &&
          (c.rule === "tangent_to_next_arc_launch_vx" || c.rule === "tangent_to_next_arc") &&
          c.quantity === "projectile_launch_vx",
      )) ||
    (record(input.energy) && input.energy.origin === "tangent_to_next_arc");
  const hasGaokaoImplicit = nonSpringConstraints
    || hasPriorInverseTangent
    || stages.some((s) => (s.kind === "projectile" && Object.prototype.hasOwnProperty.call(s, "end"))
      || (s.kind === "vertical_arc" && Object.prototype.hasOwnProperty.call(s, "verticalDropM")));
  if (nonSpringConstraints) draft.constraints = input.constraints;
  for (const [i, source] of stages.entries()) {
    if (source.kind == null) continue;
    const stage = draft.stages[i];
    const path = "/stages/" + i;
    for (const [key, rule] of Object.entries(numericRules[source.kind])) {
      if (source.kind === 'vertical_arc' && key === 'endAngleDeg' && (Object.prototype.hasOwnProperty.call(source, 'path') || source.entryOnly === true && source.endAngleDeg == null)) continue;
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
      if (source.kind === "incline_slide" && key === "kineticFrictionCoefficient" && "resistanceN" in source) continue;
      numberField(source, stage, key, path + "/" + key, rule);
    }
    if (source.kind === "incline_slide") {
      if ("resistanceN" in source) numberField(source, stage, "resistanceN", path + "/resistanceN", nonnegative);
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
      if (source.entryOnly != null && typeof source.entryOnly !== "boolean") issue(path+"/entryOnly","TYPE","入口观察标记须为布尔值。");
      if (source.entryOnly === true) {
        if (i !== stages.length-1 || source.path != null || source.dragLaw != null || source.knownExit != null) issue(path+"/entryOnly","PRECONDITION_CONFLICT","入口瞬时观察仅支持最低点入射的终段，不能混写路径、出口或后缀。");
        if (source.frictionless != null && typeof source.frictionless !== "boolean") issue(path+"/frictionless","TYPE","光滑事实须为布尔值或null。");
      } else if (source.frictionless === false && (source.dragLaw != null || source.knownExit != null)) {
        stage.frictionless = false;
        if (source.dragLaw == null) { stage.dragLaw = null; missingKeys.push(path + "/dragLaw"); }
        else if (source.dragLaw !== "unknown") issue(path + "/dragLaw", "UNSUPPORTED", "非光滑圆弧目前仅支持声明 dragLaw=\"unknown\"（阻力规律未知，按动能定理与播放缺口处理）。");
        else stage.dragLaw = "unknown";
        if (source.knownExit == null) { stage.knownExit = null; missingKeys.push(path + "/knownExit"); }
        else if (!record(source.knownExit)) issue(path + "/knownExit", "TYPE", "knownExit 须为对象。");
        else if (source.knownExit.kind == null) { stage.knownExit = { ...source.knownExit, kind: null }; missingKeys.push(path + "/knownExit/kind"); }
        else if (source.knownExit.kind === "critical_top") {
          stage.knownExit = { kind: "critical_top" };
          if (source.endAngleDeg !== 180) issue(path + "/endAngleDeg", "PRECONDITION_CONFLICT", "最高点临界条件要求半圆轨道 endAngleDeg = 180。");
          if (source.side != null && source.side !== "inside") issue(path + "/side", "PRECONDITION_CONFLICT", "最高点临界条件（v = √(gR)）仅适用于内侧轨道（inside）。");
        } else if (source.knownExit.kind === "speed") {
          const ke: Record<string, unknown> = { kind: "speed" };
          numberField(source.knownExit, ke, "speedMps", path + "/knownExit/speedMps", positive);
          stage.knownExit = ke;
        } else {
          issue(path + "/knownExit/kind", "UNSUPPORTED", "knownExit.kind 仅支持 critical_top 或 speed。");
        }
      } else {
        fact(stage, "frictionless", path + "/frictionless");
      }
      if (source.side == null && source.entryOnly === true) stage.side="inside";
      else if (source.side == null) { stage.side = null; missingKeys.push(path + "/side"); }
      else if (typeof source.side !== "string") issue(path + "/side", "TYPE", "轨道内外侧须为字符串。");
      else if (source.side !== "inside" && source.side !== "rod") issue(path + "/side", "UNSUPPORTED", "当前只支持竖直圆弧内侧（inside）或轻杆/双轨（rod）。");
    }
    if (source.kind === "projectile") {
      const hasDrop = Object.prototype.hasOwnProperty.call(source, "dropHeightM") && source.dropHeightM !== undefined;
      const hasPlane = Object.prototype.hasOwnProperty.call(source, "landingPlaneYM") && source.landingPlaneYM !== undefined;
      const hasEnd = Object.prototype.hasOwnProperty.call(source, "end") && source.end !== undefined;
      const fromArc = stages[i - 1]?.kind === "vertical_arc";
      const hasDropValue = hasDrop && source.dropHeightM !== null;
      const hasPlaneValue = hasPlane && source.landingPlaneYM !== null;
      const priorDerivedDrop = Array.isArray(input.derivedCalculations)
        ? (input.derivedCalculations as Array<Record<string, unknown>>).find(
            (c) =>
              record(c) &&
              c.rule === "bounce_apex_height" &&
              c.stageIndex === i &&
              c.targetPath === path + "/dropHeightM" &&
              typeof c.value === "number",
          )
        : undefined;
      const isUneditedDerivedDrop =
        hasDropValue &&
        typeof source.dropHeightM === "number" &&
        typeof priorDerivedDrop?.value === "number" &&
        Math.abs(source.dropHeightM - priorDerivedDrop.value) <= 1e-9 * Math.max(1, Math.abs(priorDerivedDrop.value));
      const hasManualDropValue = hasDropValue && !isUneditedDerivedDrop;
      if (source.reversal != null) {
        if (!record(source.reversal)) issue(path+"/reversal", "TYPE", "速度反向条件须为对象。");
        else {
          stage.reversal={...source.reversal};
          if (source.reversal.kind == null) missingKeys.push(path+"/reversal/kind");
          else if (source.reversal.kind !== "equal_speed_opposite") issue(path+"/reversal/kind", "UNSUPPORTED", "仅支持题面明确总速度等速反向。");
          if (source.reversal.stopAt == null) missingKeys.push(path+"/reversal/stopAt");
          else if (!["after_impulse","first_apex"].includes(String(source.reversal.stopAt))) issue(path+"/reversal/stopAt", "UNSUPPORTED", "反向后只支持碰后瞬间或首个最高点。");
          if (source.bounce != null || hasEnd || i !== stages.length-1) issue(path+"/reversal", "PRECONDITION_CONFLICT", "瞬时反向仅用于终段，与水平面反弹和切向入弧互斥。");
        }
      }
      let bounce: Record<string, unknown> | undefined;
      if (source.bounce != null) {
        if (!record(source.bounce)) {
          issue(path + "/bounce", "TYPE", "反弹配置须为对象。");
        } else {
          bounce = { ...source.bounce };
          stage.bounce = bounce;
          if (i < stages.length - 1 || hasEnd) {
            issue(path + "/bounce", "PRECONDITION_CONFLICT", "首次落地反弹仅用于终段抛体，不能与后续阶段或切向入弧同时使用。");
          }
          numberField(source.bounce, bounce, "normalRestitution", path + "/bounce/normalRestitution", (v) => v >= 0 && v <= 1);
          if (source.bounce.stopAt == null) bounce.stopAt = "first_apex";
          else if (typeof source.bounce.stopAt !== "string") issue(path + "/bounce/stopAt", "TYPE", "反弹终止模式须为字符串。");
          else if (source.bounce.stopAt !== "first_apex") issue(path + "/bounce/stopAt", "UNSUPPORTED", "当前仅支持追踪首次反弹至最高点（first_apex）。");
          if (source.bounce.apexHeightM !== undefined && source.bounce.apexHeightM !== null) {
            numberField(source.bounce, bounce, "apexHeightM", path + "/bounce/apexHeightM", positive);
          } else if (scaleMode === "normalized" && !hasDropValue && !hasPlaneValue && !fromArc && !hasEnd) {
            bounce.apexHeightM = 1;
          }
        }
      }
      // 仅在入射竖直速度 vy0 与发射原点 y0 可由静态结构确定时执行反求与预检，不把未知前段默认为 vy0=0。
      const knownHorizontalLaunch =
        i > 0 &&
        stages.slice(0, i).every(
          (st) =>
            st.kind === "spring_release" ||
            st.kind === "horizontal_slide" ||
            st.kind === "lossless_turn" ||
            st.kind === "constant_force_1d" ||
            (st.kind === "conveyor_belt" && !(typeof st.angleDeg === "number" && st.angleDeg > 0)),
        );
      const knownVy0 =
        i === 0 && typeof normalizedInitial.vyMps === "number" && Number.isFinite(normalizedInitial.vyMps)
          ? normalizedInitial.vyMps
          : knownHorizontalLaunch
            ? 0
            : null;
      const knownY0 = i === 0 || knownHorizontalLaunch ? 0 : null;
      const gVal = typeof draft.gravityMps2 === "number" && draft.gravityMps2 > 0 ? draft.gravityMps2 : null;
      if (hasEnd) {
        if (hasDrop || hasPlane) {
          // 互斥错误交由 gaokaoConstraints 统一给出精确路径提示
        }
      } else {
        if (hasDrop && hasPlane) issue(path, "PRECONDITION_CONFLICT", "相对落差与固定落地平面互斥，请保留一种。");
        else if (fromArc && hasDrop) issue(path, "PRECONDITION_CONFLICT", "圆弧后抛体需固定 landingPlaneYM，不能使用相对落差。");
        const apexH = typeof bounce?.apexHeightM === "number" && Number.isFinite(bounce.apexHeightM) && bounce.apexHeightM > 0 ? bounce.apexHeightM : null;
        const eVal = typeof bounce?.normalRestitution === "number" && Number.isFinite(bounce.normalRestitution) ? bounce.normalRestitution : null;
        if (apexH !== null && eVal === 0) {
          issue(path + "/bounce/apexHeightM", "PRECONDITION_CONFLICT", "恢复系数为 0 时竖直方向不反弹，无法反推或达到非零反弹高度。");
        }
        const canInvertH =
          !hasManualDropValue &&
          !hasPlaneValue &&
          !fromArc &&
          apexH !== null &&
          eVal !== null &&
          eVal > 0 &&
          knownVy0 !== null &&
          gVal !== null &&
          !(hasDrop && hasPlane);
        if (canInvertH) {
          const derivedH = apexH / (eVal * eVal) - (knownVy0 * knownVy0) / (2 * gVal);
          if (derivedH < -1e-9) {
            issue(path + "/bounce/apexHeightM", "PRECONDITION_CONFLICT", "给定竖直初速下反弹高度过小，无法反求非负桌面落差 H。");
          } else {
            const clampedH = Math.max(0, derivedH);
            stage.dropHeightM = clampedH;
            delete stage.landingPlaneYM;
            bounceDerived.push({
              stageIndex: i,
              targetPath: path + "/dropHeightM",
              quantity: "projectile_drop_height",
              value: clampedH,
              unit: "m",
              source: "derived",
              rule: "bounce_apex_height",
              inputPaths: [path + "/bounce/apexHeightM", path + "/bounce/normalRestitution"],
            });
          }
        } else if (!hasDropValue && !hasPlaneValue && !fromArc && scaleMode === "normalized" && !bounce && !(hasDrop && hasPlane)) {
          stage.dropHeightM = 1;
          delete stage.landingPlaneYM;
        } else {
          if (hasDrop || (!hasPlane && !fromArc)) numberField(source, stage, "dropHeightM", path + "/dropHeightM", nonnegative);
          if (hasPlane || (fromArc && !hasDrop)) numberField(source, stage, "landingPlaneYM", path + "/landingPlaneYM", finite);
          if (apexH !== null && eVal !== null && eVal > 0 && knownVy0 !== null && gVal !== null) {
            const actualH =
              hasDropValue && typeof stage.dropHeightM === "number"
                ? stage.dropHeightM
                : hasPlaneValue && typeof stage.landingPlaneYM === "number" && knownY0 !== null
                  ? knownY0 - stage.landingPlaneYM
                  : null;
            if (actualH !== null) {
              if (actualH < -1e-9) {
                issue(path + "/landingPlaneYM", "PRECONDITION_CONFLICT", "落地平面高于发射点，无法由此产生指定反弹高度。");
              } else {
                const expectedApexH = eVal * eVal * (Math.max(0, actualH) + (knownVy0 * knownVy0) / (2 * gVal));
                if (Math.abs(expectedApexH - apexH) > 1e-6 * Math.max(1, apexH)) {
                  issue(path + "/bounce/apexHeightM", "PRECONDITION_CONFLICT", "反弹最大高度与入射初速、落差和恢复系数不自洽（应满足 h = e²(H + vᵧ₀²/(2g))）。");
                }
              }
            }
          }
        }
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
      else if (typeof source.end.kind !== "string") issue(path + "/end/kind", "TYPE", "水平结束条件类型必须为字符串。");
      else if (source.end.kind === "distance" || source.end.kind === "distance_from_stage_start") {
        numberField(source.end, stage.end as Record<string, unknown>, "distanceM", path + "/end/distanceM", positive);
        if (source.end.kind === "distance_from_stage_start") {
          numberField(source.end, stage.end as Record<string, unknown>, "stageIndex", path + "/end/stageIndex", v => Number.isInteger(v) && v >= 0 && v < i);
          if (typeof source.end.stageIndex === "number" && (source.end.stageIndex !== i - 1 || stages[i - 1]?.kind !== "spring_release")) issue(path + "/end/stageIndex", "PRECONDITION_CONFLICT", "距离引用须指向紧邻的预压释放阶段。");
        }
      }
      else if (source.end.kind === "speed") {
        numberField(source.end, stage.end as Record<string, unknown>, "speedMps", path + "/end/speedMps", nonnegative);
      }
      else if (source.end.kind === "scene_end" && bodyTrack) {
        if (i !== stages.length - 1) issue(path + "/end/kind", "PRECONDITION_CONFLICT", "跟随共同终点的水平段必须是轨道末段。");
        if (typeof source.kineticFrictionCoefficient === "number" && source.kineticFrictionCoefficient > 0) {
          issue(path + "/kineticFrictionCoefficient", "PRECONDITION_CONFLICT", "跟随共同终点的水平段必须光滑。");
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
      const sufficientLength = source.lengthSufficientForCommonSpeed === true;
      if (source.lengthSufficientForCommonSpeed != null && typeof source.lengthSufficientForCommonSpeed !== "boolean") {
        issue(path + "/lengthSufficientForCommonSpeed", "TYPE", "带长是否足以共速应为布尔值。");
      }
      if (sufficientLength) {
        if (hasBeltLength || source.entryEdge != null || source.continuationExitEdge != null) {
          issue(path + "/lengthSufficientForCommonSpeed", "PRECONDITION_CONFLICT", "足够长模式仅在实际带长与两端字段均未给出时使用。");
        }
        if (typeof stage.angleDeg === "number" && stage.angleDeg > 0) issue(path + "/angleDeg", "PRECONDITION_CONFLICT", "足够长模式需要水平带。");
        if (typeof source.initialBeltSpeedMps === "number" && source.initialBeltSpeedMps <= 0) issue(path + "/initialBeltSpeedMps", "RANGE", "足够长模式需要向右运动的带面。");
        const next = stages[i + 1];
        if (next?.kind != null && next.kind !== "movable_semicircle") issue(path + "/lengthSufficientForCommonSpeed", "UNSUPPORTED", "共速后省略匀速带段仅支持接可平动半圆轨道。");
      }
      if (stages[i + 1]?.kind === "movable_semicircle") {
        if (!hasBeltLength && source.beltLengthM == null && !sufficientLength) {
          stage.beltLengthM = null;
          missingKeys.push(path + "/beltLengthM");
        }
        if (typeof stage.angleDeg === "number" && stage.angleDeg > 0) issue(path + "/angleDeg", "PRECONDITION_CONFLICT", "接可平动半圆轨需要水平带。");
      }
      let hasAccel = false;
      if (source.segments == null || (Array.isArray(source.segments) && source.segments.length === 0)) {
        if (hasBeltLength || sufficientLength || stages[i + 1]?.kind === "movable_semicircle") {
          // 匀速带的结束由实际离带或明确的共速前缀决定。
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
          if ((hasBeltLength || sufficientLength || stages[i + 1]?.kind === "movable_semicircle") && rawSegs.length === 1 && copy.accelerationMps2 === 0 && rawSeg.durationSeconds == null) {
            copy.durationSeconds = null;
          } else {
            numberField(rawSeg, copy, "durationSeconds", sp + "/durationSeconds", positive);
          }
          if (typeof copy.accelerationMps2 === "number" && copy.accelerationMps2 !== 0) hasAccel = true;
          segs.push(copy);
        });
        stage.segments = segs;
        if (sufficientLength && (rawSegs.length !== 1 || (segs[0]?.durationSeconds != null))) {
          issue(path + "/segments", "PRECONDITION_CONFLICT", "足够长模式只接受单段匀速且时长未知的传送带。");
        }
      }
      if (hasAccel && (sufficientLength || stages[i + 1]?.kind === "movable_semicircle")) {
        issue(path + "/segments", "PRECONDITION_CONFLICT", "足够长模式及可平动半圆轨入口都要求匀速带。");
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
    if (source.kind === "circular_orbit") {
      if (i > 0 || stages.length > 1) issue(path + "/kind", "UNSUPPORTED", "圆周轨道运动目前作为独立单段模型使用。");
      const hasR = source.orbitalRadiusM != null;
      const hasAlt = source.altitudeM != null;
      const hasBodyR = source.centralBodyRadiusM != null;
      if (hasR) numberField(source, stage, "orbitalRadiusM", path + "/orbitalRadiusM", positive);
      if (hasAlt) numberField(source, stage, "altitudeM", path + "/altitudeM", nonnegative);
      if (hasBodyR) numberField(source, stage, "centralBodyRadiusM", path + "/centralBodyRadiusM", positive);
      if (!hasR && !hasAlt) {
        stage.orbitalRadiusM = null;
        missingKeys.push(path + "/orbitalRadiusM");
      } else if (!hasR && hasAlt && !hasBodyR) {
        stage.centralBodyRadiusM = null;
        missingKeys.push(path + "/centralBodyRadiusM");
      }
      if (typeof stage.orbitalRadiusM === "number" && typeof stage.centralBodyRadiusM === "number" && stage.orbitalRadiusM < stage.centralBodyRadiusM) {
        issue(path + "/orbitalRadiusM", "RANGE", "轨道半径 r 不能小于中心天体半径 R。");
      }
      if (typeof stage.orbitalRadiusM === "number" && typeof stage.centralBodyRadiusM === "number" && typeof stage.altitudeM === "number") {
        const expectedR = stage.centralBodyRadiusM + stage.altitudeM;
        if (Math.abs(stage.orbitalRadiusM - expectedR) > 1e-6 * Math.max(1, expectedR)) {
          issue(path + "/orbitalRadiusM", "PRECONDITION_CONFLICT", "同时给出 r、R、h 时须满足 r = R + h。");
        }
      }
      if (source.direction == null) stage.direction = "ccw";
      else if (source.direction !== "ccw" && source.direction !== "cw") issue(path + "/direction", "UNSUPPORTED", "绕行方向仅支持 ccw（逆时针）或 cw（顺时针）。");
      else stage.direction = source.direction;
      if (source.initialAngleDeg != null) numberField(source, stage, "initialAngleDeg", path + "/initialAngleDeg", finite);
      else stage.initialAngleDeg = 0;
      if (source.orbits != null) numberField(source, stage, "orbits", path + "/orbits", positive);
      else stage.orbits = 1;
      if (typeof stage.gravitationalParameterM3s2 === "number" && stage.gravitationalParameterM3s2 > 0) {
        const resolvedR = typeof stage.orbitalRadiusM === "number"
          ? stage.orbitalRadiusM
          : typeof stage.centralBodyRadiusM === "number" && typeof stage.altitudeM === "number"
            ? stage.centralBodyRadiusM + stage.altitudeM
            : null;
        if (resolvedR !== null && resolvedR > 0) {
          normalizedInitial.speedMps = Math.sqrt(stage.gravitationalParameterM3s2 / resolvedR);
        }
      }
    }
    if (source.kind === "movable_arc") {
      const entryMode = source.entryMode ?? "top";
      if (entryMode !== "top" && entryMode !== "bottom") {
        issue(path + "/entryMode", "UNSUPPORTED", "movable_arc 入槽方式仅支持 top（槽顶静止释放）或 bottom（槽底切向进入）。");
      } else {
        if (source.entryMode != null) stage.entryMode = entryMode;
      }
      if (entryMode === "bottom") {
        if (source.entryDirection == null) stage.entryDirection = 1;
        else if (source.entryDirection !== -1 && source.entryDirection !== 1) issue(path + "/entryDirection", "UNSUPPORTED", "底入方向仅支持 1（向右）或 -1（向左）。");
        else stage.entryDirection = source.entryDirection;
        if (source.criticalTopRelativeRest != null) {
          if (source.criticalTopRelativeRest !== true) issue(path + "/criticalTopRelativeRest", "UNSUPPORTED", "criticalTopRelativeRest 仅支持 true。");
          else stage.criticalTopRelativeRest = true;
        }
        if (source.entryGapM != null) numberField(source, stage, "entryGapM", path + "/entryGapM", nonnegative);
        if (i === 0) {
          if (source.criticalTopRelativeRest === true && normalizedInitial.speedMps == null
            && typeof draft.massKg === "number" && draft.massKg > 0
            && typeof draft.gravityMps2 === "number" && draft.gravityMps2 > 0
            && typeof stage.radiusM === "number" && stage.radiusM > 0
            && typeof stage.grooveMassKg === "number" && stage.grooveMassKg > 0) {
            const critSpeed = Math.sqrt((2 * (draft.massKg + stage.grooveMassKg) * draft.gravityMps2 * stage.radiusM) / stage.grooveMassKg);
            normalizedInitial.speedMps = critSpeed;
            const idx = missingKeys.indexOf("/initial/speedMps");
            if (idx >= 0) missingKeys.splice(idx, 1);
          } else if (typeof normalizedInitial.speedMps === "number" && normalizedInitial.speedMps <= 0) {
            issue("/initial/speedMps", "RANGE", "从槽底切向进入可移动圆弧槽时，入射速率须大于 0。");
          }
        }
      } else {
        if (source.exitDirection == null) stage.exitDirection = -1;
        else if (source.exitDirection !== -1 && source.exitDirection !== 1) issue(path + "/exitDirection", "UNSUPPORTED", "离槽方向仅支持 -1（向左）或 1（向右）。");
        else stage.exitDirection = source.exitDirection;
        if (i === 0 && typeof normalizedInitial.speedMps === "number" && normalizedInitial.speedMps !== 0) {
          issue("/initial/speedMps", "PRECONDITION_CONFLICT", "可移动圆弧槽从槽顶静止释放时，初速度须为 0。");
        }
      }
    }
    if (source.kind === "movable_semicircle") {
      fact(stage, "frictionless", path + "/frictionless");
      fact(stage, "groundFrictionless", path + "/groundFrictionless");
      if (source.direction == null) {
        stage.direction = null;
        missingKeys.push(path + "/direction");
      } else if (source.direction !== "right" && source.direction !== "left") {
        issue(path + "/direction", "RANGE", "轨道朝向须为向右或向左。");
      }
      const before = stages[i - 1];
      if (before?.kind === "conveyor_belt") {
        if (before.lengthSufficientForCommonSpeed === true && source.direction === "left") {
          issue(path + "/direction", "PRECONDITION_CONFLICT", "向右运行的足够长传送带需要连接右向半圆轨道。");
        }
        const edge = source.direction === "left" ? "start" : "end";
        if ((source.direction === "left" || source.direction === "right") && before.continuationExitEdge != null && before.continuationExitEdge !== edge) {
          issue("/stages/" + (i - 1) + "/continuationExitEdge", "PRECONDITION_CONFLICT", "传送带连接端与半圆底部切向不一致。");
        }
      }
      if (i === 0 && normalizedInitial.speedMps === 0) issue("/initial/speedMps", "RANGE", "进入半圆轨道的切向速率须大于零。");
      if (bodyTrack) issue(path + "/kind", "UNSUPPORTED", "可平动半圆轨道作为独立阶段计划使用。");
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
      } else if (source.end.kind === "distance") {
        numberField(source.end, stage.end as Record<string, unknown>, "distanceM", path + "/end/distanceM", positive);
      } else if (source.end.kind !== "stop") {
        issue(path + "/end/kind", "UNSUPPORTED", "未登记的常力段结束条件。");
      }
    }
    const previous = stages[i - 1]?.kind;
    const permitted = i === 0 ? source.kind !== "lossless_turn"
      : previous == null ? true
      : previous === "incline_slide" ? source.kind === "lossless_turn" || source.kind === "projectile" || source.kind === "conveyor_belt" || (source.kind === "vertical_arc" && Object.prototype.hasOwnProperty.call(source, "path"))
      : previous === "lossless_turn" ? ["horizontal_slide", "spring_contact", "vertical_arc", "constant_force_1d", "conveyor_belt", "spring_pair", "incline_slide"].includes(source.kind) || (source.kind === "movable_arc" && source.entryMode === "bottom")
      : previous === "horizontal_slide" ? ["spring_contact", "projectile", "vertical_arc", "constant_force_1d", "magnetic_deflection", "conveyor_belt", "spring_pair", "lossless_turn", "incline_slide"].includes(source.kind) || (source.kind === "movable_arc" && source.entryMode === "bottom")
      : previous === "constant_force_1d" ? ["constant_force_1d", "horizontal_slide", "spring_contact", "projectile", "vertical_arc", "conveyor_belt", "spring_pair", "lossless_turn"].includes(source.kind)
      : previous === "vertical_arc" ? ["projectile", "horizontal_slide", "incline_slide", "spring_contact", "constant_force_1d", "vertical_arc", "conveyor_belt", "spring_pair", "lossless_turn"].includes(source.kind)
      : previous === "projectile" ? source.kind === "vertical_arc" || source.kind === "incline_slide"
      : previous === "spring_release" ? ["horizontal_slide", "spring_contact", "vertical_arc", "projectile", "constant_force_1d", "conveyor_belt", "spring_pair", "lossless_turn", "incline_slide"].includes(source.kind) || (source.kind === "movable_arc" && source.entryMode === "bottom")
      : previous === "spring_contact" ? ["horizontal_slide", "lossless_turn", "incline_slide", "vertical_arc", "conveyor_belt", "projectile"].includes(source.kind)
      : previous === "conveyor_belt" ? ["projectile", "horizontal_slide", "spring_contact", "vertical_arc", "constant_force_1d", "incline_slide", "spring_pair", "lossless_turn", "movable_semicircle"].includes(source.kind) || (source.kind === "movable_arc" && source.entryMode === "bottom")
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
    if (inclineTrig(first as {angleDeg:number}).sin - first.kineticFrictionCoefficient * inclineTrig(first as {angleDeg:number}).cos <= 0) {
      issue("/stages/0/kineticFrictionCoefficient", "PRECONDITION_CONFLICT", "当前倾角与摩擦无法支持从静止开始下滑。");
    }
  }
  let derivedCalculations: DerivedCalculation[] = [...bounceDerived, ...uniform.calculations];
  if (hasGaokaoImplicit) {
    const solved = resolveGaokaoImplicitParams({
      gravityMps2: draft.gravityMps2,
      massKg: draft.massKg,
      initial: normalizedInitial,
      stages: draft.stages,
      ...(input.energy != null ? { energy: input.energy } : {}),
      ...(Array.isArray(input.derivedCalculations) ? { derivedCalculations: input.derivedCalculations } : {}),
      ...(nonSpringConstraints ? { constraints: input.constraints } : {}),
    });
    if (solved.ok) {
      draft.stages = solved.stages;
      if (solved.initial) {
        Object.assign(normalizedInitial, solved.initial);
      }
      if (solved.energy) {
        draft.energy = solved.energy;
      }
      derivedCalculations = [...bounceDerived, ...uniform.calculations, ...solved.calculations];
    } else {
      for (const mk of solved.missingKeys) missingKeys.push(mk);
      for (const fe of solved.fieldErrors) issue(fe.path, fe.code, fe.message);
    }
  }
  if(!missingKeys.length&&!fieldErrors.length)for(const [i,s]of draft.stages.entries())if(s.kind==='vertical_arc'&&s.path){
    try{circularGeometry(s as unknown as Extract<Stage,{kind:'vertical_arc'}>&{path:ExplicitArcPath},i);}
    catch(e){issue('/stages/'+i+((e as {field?:string}).field??'/path'),'RANGE',(e as Error).message);}
    // 仅在首段下滑斜面可达且出口方向唯一确定（向右下方）时做结构切线预检；
    // 其余前驱（反向斜面、保留左右方向的转向、依赖能量可达性的圆弧）交由实际末帧校验。
    if(i===1){
      const prev=draft.stages[0],p=s.path as ExplicitArcPath;
      if(prev.kind==='incline_slide'&&prev.direction!=='up'&&typeof prev.angleDeg==='number'&&typeof prev.lengthM==='number'&&typeof prev.kineticFrictionCoefficient==='number'&&typeof draft.gravityMps2==='number'){
        const rad=prev.angleDeg*Math.PI/180,a=draft.gravityMps2*(Math.sin(rad)-prev.kineticFrictionCoefficient*Math.cos(rad));
        const v0=normalizedInitial.speedMps??0;
        const reachesBottom=a>0||(v0>0&&v0*v0+2*a*prev.lengthM>0);
        if(reachesBottom){
          const phi0=p.startAngleDeg*Math.PI/180,d=p.direction==='positive'?1:-1;
          const diff=Math.acos(Math.max(-1,Math.min(1,Math.cos(rad)*d*Math.cos(phi0)-Math.sin(rad)*d*Math.sin(phi0))));
          if(diff>0.03)issue('/stages/'+i+'/path','PRECONDITION_CONFLICT','圆轨入口位置或速度不符合声明的切线与方向。');
        }
      }
    }
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
      } else if (end.kind === 'duration') {
        vx = vx + a * end.durationSeconds!;
      } else {
        const direction = Math.sign(vx || a), distance = (s.end as {distanceM:number}).distanceM;
        const square = vx*vx+2*direction*a*distance;
        vx = direction*Math.sqrt(Math.max(0,square));
      }
    }
  }
  if (derivedCalculations.length) draft.derivedCalculations = derivedCalculations;
  if (missingKeys.length || fieldErrors.length) return result();
  const resolved: ResolvedStagePlan = {
    kind: "stage_plan", schemaVersion: 1,
    initial: normalizedInitial as ResolvedStagePlan["initial"],
    stages: draft.stages as Stage[],
  };
  if (draft.scaleMode) resolved.scaleMode = draft.scaleMode;
  if (typeof draft.gravityMps2 === "number") resolved.gravityMps2 = draft.gravityMps2;
  if (typeof draft.massKg === "number") resolved.massKg = draft.massKg;
  if (draft.energy) resolved.energy = draft.energy;
  if (derivedCalculations.length) resolved.derivedCalculations = derivedCalculations;
  else if (Array.isArray(input.derivedCalculations) && input.derivedCalculations.length) resolved.derivedCalculations = input.derivedCalculations as DerivedCalculation[];
  return { ok: true, reading: resolved, ...(playback ? { playback } : {}) };
}

