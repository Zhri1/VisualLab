export type StageKind = "incline_slide" | "lossless_turn" | "horizontal_slide" | "spring_contact" | "projectile";
export type Stage =
  | { kind: "incline_slide"; lengthM: number; angleDeg: number; kineticFrictionCoefficient: number; slidesAfterRelease?: boolean | null }
  | { kind: "lossless_turn"; lossless: true }
  | { kind: "horizontal_slide"; kineticFrictionCoefficient: number; end: { kind: "distance"; distanceM: number } | { kind: "stop" } }
  | { kind: "spring_contact"; springConstantNpm: number; frictionless: true; unattached: true }
  | { kind: "projectile"; dropHeightM: number };

export type ResolvedStagePlan = {
  kind: "stage_plan";
  schemaVersion: 1;
  gravityMps2?: number;
  massKg?: number;
  initial: { speedMps: number } | { vxMps: number; vyMps: number };
  stages: Stage[];
};
export type StagePlanDraft = {
  kind: "stage_plan";
  schemaVersion: 1;
  gravityMps2?: number | null;
  massKg?: number | null;
  initial: { speedMps: number | null } | { vxMps: number | null; vyMps: number | null };
  stages: Array<Record<string, unknown>>;
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
export type StagePlanValidation = { ok: true; reading: ResolvedStagePlan } | StagePlanFailure;

const stageKinds: readonly string[] = ["incline_slide", "lossless_turn", "horizontal_slide", "spring_contact", "projectile"];
const positive = (value: number) => value > 0;
const nonnegative = (value: number) => value >= 0;
const finite = (_value: number) => true;
const numericRules: Record<StageKind, Record<string, (value: number) => boolean>> = {
  incline_slide: { lengthM: positive, angleDeg: (value) => value > 0 && value < 90, kineticFrictionCoefficient: nonnegative },
  lossless_turn: {},
  horizontal_slide: { kineticFrictionCoefficient: nonnegative },
  spring_contact: { springConstantNpm: positive },
  projectile: { dropHeightM: nonnegative },
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateStagePlan(input: unknown): StagePlanValidation {
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
  const stages = input.stages as Array<Record<string, unknown> & { kind?: StageKind | null }>;
  if (!stages.some((stage) => stage.kind != null)) return result();
  const firstKind = stages[0].kind;
  if (input.initial != null && !record(input.initial)) {
    issue("/initial", "TYPE", "初态应为对象。");
    return result();
  }
  const initial = input.initial ?? {};
  const hasSpeed = Object.prototype.hasOwnProperty.call(initial, "speedMps");
  const hasComponents = "vxMps" in initial || "vyMps" in initial;
  if ((hasSpeed && hasComponents) || (firstKind != null && (firstKind === "projectile" ? hasSpeed : hasComponents))) {
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
  const componentInitial = firstKind === "projectile" || (firstKind == null && hasComponents && !hasSpeed);
  const initialKeys = componentInitial ? ["vxMps", "vyMps"] : ["speedMps"];
  for (const key of initialKeys) numberField(initial, normalizedInitial, key, "/initial/" + key, key === "speedMps" ? nonnegative : finite);
  // 初态形状冲突时也保留另一种形状的已知值，便于用户选择正确形式。
  for (const key of ["speedMps", "vxMps", "vyMps"]) {
    if (!initialKeys.includes(key) && key in initial) numberField(initial, normalizedInitial, key, "/initial/" + key, key === "speedMps" ? nonnegative : finite, false);
  }
  const needsGravity = stages.some((stage) => stage.kind === "incline_slide" || stage.kind === "projectile"
    || (stage.kind === "horizontal_slide" && typeof stage.kineticFrictionCoefficient === "number" && stage.kineticFrictionCoefficient > 0));
  const needsMass = stages.some((stage) => stage.kind === "spring_contact");
  numberField(input, draft, "gravityMps2", "/gravityMps2", positive, needsGravity);
  numberField(input, draft, "massKg", "/massKg", positive, needsMass);
  for (const [i, source] of stages.entries()) {
    if (source.kind == null) continue;
    const stage = draft.stages[i];
    const path = "/stages/" + i;
    for (const [key, rule] of Object.entries(numericRules[source.kind])) numberField(source, stage, key, path + "/" + key, rule);
    if (source.kind === "incline_slide" && i === 0 && normalizedInitial.speedMps === 0) fact(stage, "slidesAfterRelease", path + "/slidesAfterRelease");
    else if (source.kind === "incline_slide" && source.slidesAfterRelease != null && typeof source.slidesAfterRelease !== "boolean") {
      issue(path + "/slidesAfterRelease", "TYPE", "前提事实须为布尔值或 null。");
    }
    if (source.kind === "lossless_turn") fact(stage, "lossless", path + "/lossless");
    if (source.kind === "spring_contact") {
      fact(stage, "frictionless", path + "/frictionless");
      fact(stage, "unattached", path + "/unattached");
      if (i === 0 && normalizedInitial.speedMps === 0) issue("/initial/speedMps", "PRECONDITION_CONFLICT", "弹簧接触需要水平正速入射。");
    }
    if (source.kind === "horizontal_slide") {
      if (source.end == null) { stage.end = null; missingKeys.push(path + "/end"); }
      else if (!record(source.end)) issue(path + "/end", "TYPE", "结束条件应为对象。");
      else if (source.end.kind == null) { stage.end = { ...source.end, kind: null }; missingKeys.push(path + "/end/kind"); }
      else if (typeof source.end.kind !== "string") issue(path + "/end/kind", "TYPE", "水平结束条件类型必须为字符串。");
      else if (source.end.kind === "distance") numberField(source.end, stage.end as Record<string, unknown>, "distanceM", path + "/end/distanceM", positive);
      else if (source.end.kind !== "stop") issue(path + "/end/kind", "UNSUPPORTED", "未登记的水平结束条件。");
      if (record(source.end) && source.end.kind === "stop" && source.kineticFrictionCoefficient === 0 && (i > 0 || (normalizedInitial.speedMps ?? 0) > 0)) {
        issue(path + "/end", "PRECONDITION_CONFLICT", "光滑面上的正速运动无法因摩擦停止。");
      }
    }
    const previous = stages[i - 1]?.kind;
    const permitted = i === 0 ? source.kind !== "lossless_turn"
      : previous == null ? true
      : previous === "incline_slide" ? source.kind === "lossless_turn"
      : previous === "lossless_turn" ? source.kind === "horizontal_slide" || source.kind === "spring_contact"
      : previous === "horizontal_slide" ? source.kind === "spring_contact" || source.kind === "projectile"
      : false;
    if (!permitted) issue(path + "/kind", "UNSUPPORTED", "当前版本不支持该阶段接续。");
    if (i > 0 && previous === "horizontal_slide") {
      const end = stages[i - 1].end;
      if (record(end) && end.kind === "stop") issue("/stages/" + (i - 1) + "/end", "PRECONDITION_CONFLICT", "接续弹簧或平抛需给出水平距离目标。");
    }
  }
  // 只判定已知的起动矛盾，停止与到达谁先发生留给运动计算。
  const first = stages[0];
  if (first.kind === "incline_slide" && normalizedInitial.speedMps === 0
    && typeof draft.gravityMps2 === "number" && draft.gravityMps2 > 0
    && typeof first.angleDeg === "number" && first.angleDeg > 0 && first.angleDeg < 90
    && typeof first.kineticFrictionCoefficient === "number" && first.kineticFrictionCoefficient >= 0) {
    const angle = first.angleDeg * Math.PI / 180;
    if (Math.sin(angle) - first.kineticFrictionCoefficient * Math.cos(angle) <= 0) {
      issue("/stages/0/kineticFrictionCoefficient", "PRECONDITION_CONFLICT", "当前倾角与摩擦无法支持从静止开始下滑。");
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
  return { ok: true, reading: resolved };
}
