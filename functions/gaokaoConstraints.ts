// 由 scripts/sync-functions.mjs 从 src/physics/gaokaoConstraints.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
import { arcTrig } from "./circularArc.ts";

export type ArcDirection = "positive" | "negative";

export type DerivedCalculation = {
  stageIndex: number;
  targetPath: string;
  quantity: "projectile_drop_height" | "arc_radius" | "critical_arc_top_radius";
  value: number;
  unit: "m";
  source: "derived";
  rule: "tangent_to_next_arc" | "arc_radius_from_drop" | "critical_arc_top";
  inputPaths: string[];
};

export type GaokaoConstraintError = {
  ok: false;
  path: string;
  code: "RANGE" | "NOT_FINITE" | "PRECONDITION_CONFLICT" | "UNSUPPORTED" | "TYPE";
  message: string;
};

export type GaokaoFieldError = {
  path: string;
  code: string;
  message: string;
};

export type ProjectileTangentDropParams = {
  vxMps: number;
  vyMps: number;
  gravityMps2: number;
  nextArcStartAngleDeg: number;
  nextArcDirection: ArcDirection;
  stageIndex?: number;
  nextArcStageIndex?: number;
  inputPaths?: string[];
};

export type ProjectileTangentDropResult =
  | {
      ok: true;
      dropHeightM: number;
      flightSeconds: number;
      entrySpeedMps: number;
      entryVyMps: number;
      calculation: DerivedCalculation;
    }
  | GaokaoConstraintError;

export type ArcRadiusFromDropParams = {
  verticalDropM: number;
  startAngleDeg: number;
  sweepAngleDeg: number;
  direction: ArcDirection;
  stageIndex?: number;
  inputPaths?: string[];
};

export type ArcRadiusFromDropResult =
  | {
      ok: true;
      radiusM: number;
      endAngleDeg: number;
      deltaCos: number;
      calculation: DerivedCalculation;
    }
  | GaokaoConstraintError;

export type CriticalArcTopRadiusParams = {
  entrySpeedMps: number;
  gravityMps2: number;
  startAngleDeg?: number;
  stageIndex?: number;
  constraintIndex?: number;
  inputPaths?: string[];
};

export type CriticalArcTopRadiusResult =
  | {
      ok: true;
      radiusM: number;
      topSpeedMps: number;
      calculation: DerivedCalculation;
    }
  | GaokaoConstraintError;

export type GaokaoPlanDraftInput = {
  gravityMps2?: number | null;
  massKg?: number | null;
  initial?: Record<string, unknown> | null;
  stages: Array<Record<string, unknown>>;
  constraints?: unknown;
};

export type ResolveGaokaoImplicitResult =
  | {
      ok: true;
      stages: Array<Record<string, unknown>>;
      calculations: DerivedCalculation[];
      consumedConstraintIndices: number[];
    }
  | {
      ok: false;
      stages: Array<Record<string, unknown>>;
      calculations: DerivedCalculation[];
      missingKeys: string[];
      fieldErrors: GaokaoFieldError[];
    };

type Obj = Record<string, unknown>;
type VelocityState = { vx: number; vy: number; speed: number };

const ZERO_TOL = 1e-12;
const DELTA_COS_TOL = 1e-9;

function isRecord(value: unknown): value is Obj {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(obj: Obj, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function fail(
  path: string,
  code: GaokaoConstraintError["code"],
  message: string,
): GaokaoConstraintError {
  return { ok: false, path, code, message };
}

function cloneStage(stage: Obj): Obj {
  const copy: Obj = { ...stage };
  if (isRecord(stage.end)) copy.end = { ...stage.end };
  if (isRecord(stage.path)) {
    const pathCopy: Obj = { ...stage.path };
    if (isRecord(stage.path.center)) pathCopy.center = { ...stage.path.center };
    if (isRecord(stage.path.end)) pathCopy.end = { ...stage.path.end };
    copy.path = pathCopy;
  }
  return copy;
}

/**
 * 由抛体初速度与紧邻圆弧入口切向条件反求竖直落差 dropHeightM。
 * 入口角 phi0 处沿 direction 的单位切向量为 (d * cos(phi0), d * sin(phi0))，
 * 要求 vx 与 d * cos(phi0) 同号且 cos(phi0) !== 0，并满足 vyEntry < vyMps 且落差非负。
 */
export function deriveProjectileTangentDrop(
  params: ProjectileTangentDropParams,
): ProjectileTangentDropResult {
  const stageIndex = params.stageIndex ?? 0;
  const nextIdx = params.nextArcStageIndex ?? stageIndex + 1;
  const stageEndPath = `/stages/${stageIndex}/end`;
  const startAnglePath = `/stages/${nextIdx}/path/startAngleDeg`;
  const directionPath = `/stages/${nextIdx}/path/direction`;

  if (!Number.isFinite(params.vxMps)) {
    return fail("/initial/vxMps", "NOT_FINITE", "抛体水平初速度须为有限数。");
  }
  if (!Number.isFinite(params.vyMps)) {
    return fail("/initial/vyMps", "NOT_FINITE", "抛体竖直初速度须为有限数。");
  }
  if (!Number.isFinite(params.gravityMps2)) {
    return fail("/gravityMps2", "NOT_FINITE", "重力加速度须为有限数。");
  }
  if (params.gravityMps2 <= 0) {
    return fail("/gravityMps2", "RANGE", "重力加速度须大于零。");
  }
  if (!Number.isFinite(params.nextArcStartAngleDeg)) {
    return fail(startAnglePath, "NOT_FINITE", "圆弧入口角须为有限数。");
  }
  if (params.nextArcStartAngleDeg < -180 || params.nextArcStartAngleDeg > 180) {
    return fail(startAnglePath, "RANGE", "圆弧入口角须在 [-180, 180] 度范围内。");
  }
  if (params.nextArcDirection !== "positive" && params.nextArcDirection !== "negative") {
    return fail(directionPath, "UNSUPPORTED", "圆弧方向须为 positive 或 negative。");
  }

  const d = params.nextArcDirection === "positive" ? 1 : -1;
  const phi0 = (params.nextArcStartAngleDeg * Math.PI) / 180;
  const { sin, cos } = arcTrig(phi0);

  if (Math.abs(cos) <= ZERO_TOL) {
    return fail(
      startAnglePath,
      "PRECONDITION_CONFLICT",
      "圆弧入口切线为竖直方向（cos(phi0) = 0），无法由抛体水平速度反求切向落差。",
    );
  }

  const tx = d * cos;
  if (params.vxMps === 0 || params.vxMps * tx <= 0) {
    return fail(
      stageEndPath,
      "PRECONDITION_CONFLICT",
      "抛体水平速度方向与圆弧入口切线水平分量相反或为零，无法切向入弧。",
    );
  }

  const entryVyMps = params.vxMps * (sin / cos);
  if (entryVyMps >= params.vyMps - ZERO_TOL) {
    return fail(
      stageEndPath,
      "PRECONDITION_CONFLICT",
      "抛体初竖直速度不高于切向入弧所需竖直速度，无法在正时间内切向入弧。",
    );
  }

  const flightSeconds = (params.vyMps - entryVyMps) / params.gravityMps2;
  if (!Number.isFinite(flightSeconds) || flightSeconds <= ZERO_TOL) {
    return fail(
      stageEndPath,
      "PRECONDITION_CONFLICT",
      "切向入弧所需飞行时间非正，无法满足抛体运动方向。",
    );
  }

  const rawDrop =
    (entryVyMps * entryVyMps - params.vyMps * params.vyMps) / (2 * params.gravityMps2);
  if (!Number.isFinite(rawDrop)) {
    return fail(stageEndPath, "NOT_FINITE", "反求得到的抛体落差超出可表示范围。");
  }
  if (rawDrop < -ZERO_TOL) {
    return fail(
      stageEndPath,
      "PRECONDITION_CONFLICT",
      "切向入弧点高于抛出点，无法由非负落差 dropHeightM 表示。",
    );
  }

  const dropHeightM = rawDrop < 0 ? 0 : rawDrop;
  const entrySpeedMps = Math.hypot(params.vxMps, entryVyMps);
  if (!Number.isFinite(entrySpeedMps)) {
    return fail(stageEndPath, "NOT_FINITE", "反求得到的入弧速率超出可表示范围。");
  }

  const calculation: DerivedCalculation = {
    stageIndex,
    targetPath: `/stages/${stageIndex}/dropHeightM`,
    quantity: "projectile_drop_height",
    value: dropHeightM,
    unit: "m",
    source: "derived",
    rule: "tangent_to_next_arc",
    inputPaths: params.inputPaths ?? [
      "/gravityMps2",
      stageEndPath,
      startAnglePath,
      directionPath,
    ],
  };

  return {
    ok: true,
    dropHeightM,
    flightSeconds,
    entrySpeedMps,
    entryVyMps,
    calculation,
  };
}

/**
 * 由圆弧入口角、圆心角与竖直落差 verticalDropM 反求半径 radiusM。
 * 竖直向下落差满足 verticalDropM = R * (cos(endAngle) - cos(startAngle))，要求 deltaCos > 1e-9。
 */
export function deriveArcRadiusFromDrop(
  params: ArcRadiusFromDropParams,
): ArcRadiusFromDropResult {
  const stageIndex = params.stageIndex ?? 0;
  const dropPath = `/stages/${stageIndex}/verticalDropM`;
  const startAnglePath = `/stages/${stageIndex}/path/startAngleDeg`;
  const directionPath = `/stages/${stageIndex}/path/direction`;
  const sweepPath = `/stages/${stageIndex}/path/end/sweepAngleDeg`;

  if (!Number.isFinite(params.verticalDropM)) {
    return fail(dropPath, "NOT_FINITE", "圆弧竖直落差须为有限数。");
  }
  if (params.verticalDropM <= 0) {
    return fail(dropPath, "RANGE", "圆弧竖直落差须大于零。");
  }
  if (!Number.isFinite(params.startAngleDeg)) {
    return fail(startAnglePath, "NOT_FINITE", "圆弧入口角须为有限数。");
  }
  if (params.startAngleDeg < -180 || params.startAngleDeg > 180) {
    return fail(startAnglePath, "RANGE", "圆弧入口角须在 [-180, 180] 度范围内。");
  }
  if (!Number.isFinite(params.sweepAngleDeg)) {
    return fail(sweepPath, "NOT_FINITE", "圆弧圆心角须为有限数。");
  }
  if (params.sweepAngleDeg <= 0 || params.sweepAngleDeg > 360) {
    return fail(sweepPath, "RANGE", "圆弧圆心角须在 (0, 360] 度范围内。");
  }
  if (params.direction !== "positive" && params.direction !== "negative") {
    return fail(directionPath, "UNSUPPORTED", "圆弧方向须为 positive 或 negative。");
  }

  const d = params.direction === "positive" ? 1 : -1;
  const endAngleDeg = params.startAngleDeg + d * params.sweepAngleDeg;
  const startCos = arcTrig((params.startAngleDeg * Math.PI) / 180).cos;
  const endCos = arcTrig((endAngleDeg * Math.PI) / 180).cos;
  const deltaCos = endCos - startCos;

  if (!Number.isFinite(deltaCos) || deltaCos <= DELTA_COS_TOL) {
    return fail(
      dropPath,
      "PRECONDITION_CONFLICT",
      "圆弧端点未低于入口（cos(endAngle) - cos(startAngle) <= 0），无法由竖直落差反求半径。",
    );
  }

  const radiusM = params.verticalDropM / deltaCos;
  if (!Number.isFinite(radiusM) || radiusM <= 0) {
    return fail(dropPath, "NOT_FINITE", "反求得到的圆弧半径超出可表示范围。");
  }

  const calculation: DerivedCalculation = {
    stageIndex,
    targetPath: `/stages/${stageIndex}/radiusM`,
    quantity: "arc_radius",
    value: radiusM,
    unit: "m",
    source: "derived",
    rule: "arc_radius_from_drop",
    inputPaths: params.inputPaths ?? [dropPath, startAnglePath, directionPath, sweepPath],
  };

  return {
    ok: true,
    radiusM,
    endAngleDeg,
    deltaCos,
    calculation,
  };
}

/**
 * 由进入圆轨的速率 u 与临界过顶条件（最高点 N = 0，v_top^2 = gR）反求圆轨半径 R。
 * 能量守恒给出 u^2 = g * R * (3 + 2 * cos(phi0))，在最低点 phi0 = 0 时退化为 R = u^2 / (5g)。
 */
export function deriveCriticalArcTopRadius(
  params: CriticalArcTopRadiusParams,
): CriticalArcTopRadiusResult {
  const stageIndex = params.stageIndex ?? 0;
  const constraintIndex = params.constraintIndex ?? 0;
  const startAngleDeg = params.startAngleDeg ?? 0;
  const constraintPath = `/constraints/${constraintIndex}`;
  const startAnglePath = `/stages/${stageIndex}/path/startAngleDeg`;

  if (!Number.isFinite(params.entrySpeedMps)) {
    return fail(constraintPath, "NOT_FINITE", "进入圆轨的速率须为有限数。");
  }
  if (!Number.isFinite(params.gravityMps2)) {
    return fail("/gravityMps2", "NOT_FINITE", "重力加速度须为有限数。");
  }
  if (params.gravityMps2 <= 0) {
    return fail("/gravityMps2", "RANGE", "重力加速度须大于零。");
  }
  if (!Number.isFinite(startAngleDeg)) {
    return fail(startAnglePath, "NOT_FINITE", "圆轨入口角须为有限数。");
  }
  if (startAngleDeg < -180 || startAngleDeg > 180) {
    return fail(startAnglePath, "RANGE", "圆轨入口角须在 [-180, 180] 度范围内。");
  }
  if (params.entrySpeedMps <= 0) {
    return fail(
      constraintPath,
      "PRECONDITION_CONFLICT",
      "进入圆轨的速率须大于零，零速无法满足临界过顶条件。",
    );
  }

  const cosPhi0 = arcTrig((startAngleDeg * Math.PI) / 180).cos;
  const denomFactor = 3 + 2 * cosPhi0;
  if (!Number.isFinite(denomFactor) || denomFactor <= DELTA_COS_TOL) {
    return fail(
      startAnglePath,
      "PRECONDITION_CONFLICT",
      "入口角对应的能量系数 3 + 2*cos(phi0) 非正，无法反求临界半径。",
    );
  }

  const radiusM = (params.entrySpeedMps * params.entrySpeedMps) / (params.gravityMps2 * denomFactor);
  const topSpeedMps = Math.sqrt(params.gravityMps2 * radiusM);
  if (!Number.isFinite(radiusM) || radiusM <= 0 || !Number.isFinite(topSpeedMps)) {
    return fail(constraintPath, "NOT_FINITE", "反求得到的临界圆轨半径超出可表示范围。");
  }

  const calculation: DerivedCalculation = {
    stageIndex,
    targetPath: `/stages/${stageIndex}/radiusM`,
    quantity: "critical_arc_top_radius",
    value: radiusM,
    unit: "m",
    source: "derived",
    rule: "critical_arc_top",
    inputPaths: params.inputPaths ?? ["/gravityMps2", constraintPath, startAnglePath],
  };

  return {
    ok: true,
    radiusM,
    topSpeedMps,
    calculation,
  };
}

function hasGaokaoImplicitDeclarations(planDraft: GaokaoPlanDraftInput): boolean {
  const isSpringReleaseHead = planDraft.stages[0]?.kind === "spring_release";
  if (!isSpringReleaseHead && planDraft.constraints != null) return true;
  for (const stage of planDraft.stages) {
    if (!isRecord(stage)) continue;
    if (stage.kind === "projectile" && hasOwn(stage, "end") && stage.end !== undefined) return true;
    if (
      stage.kind === "vertical_arc" &&
      hasOwn(stage, "verticalDropM") &&
      stage.verticalDropM !== undefined
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 组合静态解析器：按阶段顺序检验并推导高考多过程声明式隐含几何与临界半径。
 * 仅在前置段速度可唯一确定时推导目标量；条件缺失或矛盾时返回精确 JSON Pointer，绝不臆造未知值。
 * 不拦截首段为 spring_release 的既有预压弹簧能量反求约束。
 */
export function resolveGaokaoImplicitParams(
  planDraft: GaokaoPlanDraftInput,
): ResolveGaokaoImplicitResult {
  const stages = planDraft.stages.map((stage) => (isRecord(stage) ? cloneStage(stage) : {}));
  const calculations: DerivedCalculation[] = [];
  const consumedConstraintIndices: number[] = [];

  if (!hasGaokaoImplicitDeclarations(planDraft)) {
    return { ok: true, stages, calculations, consumedConstraintIndices };
  }

  const missingKeys: string[] = [];
  const fieldErrors: GaokaoFieldError[] = [];
  const addError = (path: string, code: string, message: string) => {
    fieldErrors.push({ path, code, message });
  };
  const addMissing = (path: string) => {
    if (!missingKeys.includes(path)) missingKeys.push(path);
  };

  // 解析顶层重力加速度
  let g: number | null = null;
  if (planDraft.gravityMps2 == null) {
    g = null;
  } else if (typeof planDraft.gravityMps2 !== "number") {
    addError("/gravityMps2", "TYPE", "重力加速度须为数值。");
  } else if (!Number.isFinite(planDraft.gravityMps2)) {
    addError("/gravityMps2", "NOT_FINITE", "重力加速度须为有限数。");
  } else if (planDraft.gravityMps2 <= 0) {
    addError("/gravityMps2", "RANGE", "重力加速度须大于零。");
  } else {
    g = planDraft.gravityMps2;
  }

  // 解析顶层 critical_arc_top 约束（仅当首段非 spring_release，避免与预压弹簧能量反求冲突）
  const criticalByStage = new Map<number, { constraintIndex: number }>();
  const isSpringReleaseHead = stages[0]?.kind === "spring_release";
  if (!isSpringReleaseHead && planDraft.constraints != null) {
    if (!Array.isArray(planDraft.constraints)) {
      addError("/constraints", "TYPE", "constraints 须为数组。");
    } else {
      for (let cIdx = 0; cIdx < planDraft.constraints.length; cIdx++) {
        const raw = planDraft.constraints[cIdx];
        const cPath = `/constraints/${cIdx}`;
        if (!isRecord(raw)) {
          addError(cPath, "TYPE", "约束项须为对象。");
          continue;
        }
        if (raw.kind == null) {
          addMissing(`${cPath}/kind`);
          continue;
        }
        if (typeof raw.kind !== "string") {
          addError(`${cPath}/kind`, "TYPE", "约束类型须为字符串。");
          continue;
        }
        if (raw.kind !== "critical_arc_top") {
          addError(`${cPath}/kind`, "UNSUPPORTED", "未登记的顶层约束类型。");
          continue;
        }
        if (raw.stageIndex == null) {
          addMissing(`${cPath}/stageIndex`);
          continue;
        }
        if (typeof raw.stageIndex !== "number") {
          addError(`${cPath}/stageIndex`, "TYPE", "约束 stageIndex 须为整数。");
          continue;
        }
        if (
          !Number.isInteger(raw.stageIndex) ||
          raw.stageIndex < 0 ||
          raw.stageIndex >= stages.length
        ) {
          addError(`${cPath}/stageIndex`, "RANGE", "约束 stageIndex 超出阶段数组范围。");
          continue;
        }
        const targetStage = stages[raw.stageIndex];
        if (targetStage?.kind !== "vertical_arc") {
          addError(
            `${cPath}/stageIndex`,
            "PRECONDITION_CONFLICT",
            "critical_arc_top 约束必须指向 vertical_arc 阶段。",
          );
          continue;
        }
        if (criticalByStage.has(raw.stageIndex)) {
          addError(cPath, "PRECONDITION_CONFLICT", "同一圆弧阶段不能重复声明 critical_arc_top 约束。");
          continue;
        }
        if (typeof targetStage.radiusM === "number") {
          addError(
            cPath,
            "PRECONDITION_CONFLICT",
            "圆弧已显式给出 radiusM，与 critical_arc_top 反求半径互斥。",
          );
          continue;
        }
        criticalByStage.set(raw.stageIndex, { constraintIndex: cIdx });
      }
    }
  }

  // 解析初态速度（不臆造缺失值）
  let state: VelocityState | null = null;
  const firstKind = stages[0]?.kind;
  const initial = isRecord(planDraft.initial) ? planDraft.initial : null;
  if (initial) {
    if (firstKind === "projectile") {
      const vx = initial.vxMps;
      const vy = initial.vyMps;
      if (typeof vx === "number" && Number.isFinite(vx) && typeof vy === "number" && Number.isFinite(vy)) {
        state = { vx, vy, speed: Math.hypot(vx, vy) };
      }
    } else if (typeof initial.speedMps === "number" && Number.isFinite(initial.speedMps) && initial.speedMps >= 0) {
      state = { vx: initial.speedMps, vy: 0, speed: initial.speedMps };
    } else if (typeof initial.vxMps === "number" && Number.isFinite(initial.vxMps)) {
      state = { vx: initial.vxMps, vy: 0, speed: Math.abs(initial.vxMps) };
    }
  }

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const stagePath = `/stages/${i}`;
    const kind = stage.kind;

    if (kind === "projectile") {
      const hasEnd = hasOwn(stage, "end") && stage.end !== undefined;
      const hasDrop = hasOwn(stage, "dropHeightM") && stage.dropHeightM !== undefined && stage.dropHeightM !== null;
      const hasPlane =
        hasOwn(stage, "landingPlaneYM") && stage.landingPlaneYM !== undefined && stage.landingPlaneYM !== null;

      if (hasEnd) {
        if (stage.end === null) {
          addMissing(`${stagePath}/end`);
          state = null;
          continue;
        }
        if (!isRecord(stage.end)) {
          addError(`${stagePath}/end`, "TYPE", "抛体结束条件须为对象。");
          state = null;
          continue;
        }
        if (stage.end.kind == null) {
          addMissing(`${stagePath}/end/kind`);
          state = null;
          continue;
        }
        if (typeof stage.end.kind !== "string") {
          addError(`${stagePath}/end/kind`, "TYPE", "抛体结束条件类型须为字符串。");
          state = null;
          continue;
        }
        if (stage.end.kind !== "tangent_to_next_arc") {
          addError(`${stagePath}/end/kind`, "UNSUPPORTED", "未登记的抛体结束条件类型。");
          state = null;
          continue;
        }
        if (hasDrop || hasPlane) {
          addError(
            stagePath,
            "PRECONDITION_CONFLICT",
            "tangent_to_next_arc 与显式 dropHeightM、landingPlaneYM 互斥，请只保留一种。",
          );
          state = null;
          continue;
        }

        const nextStage = stages[i + 1];
        if (!nextStage || nextStage.kind !== "vertical_arc" || !isRecord(nextStage.path)) {
          addError(
            `${stagePath}/end`,
            "PRECONDITION_CONFLICT",
            "tangent_to_next_arc 要求紧邻后继段为带显式 path 的 vertical_arc。",
          );
          state = null;
          continue;
        }

        const nextPath = nextStage.path;
        let ready = true;
        if (g == null) {
          addMissing("/gravityMps2");
          ready = false;
        }
        if (state == null) {
          if (i === 0) {
            if (!initial || initial.vxMps == null) addMissing("/initial/vxMps");
            if (!initial || initial.vyMps == null) addMissing("/initial/vyMps");
          } else {
            addError(
              `${stagePath}/end`,
              "PRECONDITION_CONFLICT",
              "无法由前置阶段唯一确定抛体初速度，不能反求切向入弧落差。",
            );
          }
          ready = false;
        }
        if (nextPath.startAngleDeg == null) {
          addMissing(`/stages/${i + 1}/path/startAngleDeg`);
          ready = false;
        } else if (typeof nextPath.startAngleDeg !== "number") {
          addError(`/stages/${i + 1}/path/startAngleDeg`, "TYPE", "圆弧入口角须为数值。");
          ready = false;
        }
        if (nextPath.direction == null) {
          addMissing(`/stages/${i + 1}/path/direction`);
          ready = false;
        } else if (typeof nextPath.direction !== "string") {
          addError(`/stages/${i + 1}/path/direction`, "TYPE", "圆弧方向须为字符串。");
          ready = false;
        }

        if (!ready) {
          state = null;
          continue;
        }

        const derived = deriveProjectileTangentDrop({
          vxMps: state!.vx,
          vyMps: state!.vy,
          gravityMps2: g!,
          nextArcStartAngleDeg: nextPath.startAngleDeg as number,
          nextArcDirection: nextPath.direction as ArcDirection,
          stageIndex: i,
          nextArcStageIndex: i + 1,
          inputPaths: [
            ...(i === 0 ? ["/initial/vxMps", "/initial/vyMps"] : [`/stages/${i - 1}`]),
            "/gravityMps2",
            `${stagePath}/end`,
            `/stages/${i + 1}/path/startAngleDeg`,
            `/stages/${i + 1}/path/direction`,
          ],
        });

        if (!derived.ok) {
          addError(derived.path, derived.code, derived.message);
          state = null;
          continue;
        }

        stage.dropHeightM = derived.dropHeightM;
        delete stage.end;
        calculations.push(derived.calculation);
        state = {
          vx: state!.vx,
          vy: derived.entryVyMps,
          speed: derived.entrySpeedMps,
        };
      } else if (
        state != null &&
        g != null &&
        typeof stage.dropHeightM === "number" &&
        Number.isFinite(stage.dropHeightM) &&
        stage.dropHeightM >= 0
      ) {
        const vyExit = -Math.sqrt(state.vy * state.vy + 2 * g * stage.dropHeightM);
        state = {
          vx: state.vx,
          vy: vyExit,
          speed: Math.hypot(state.vx, vyExit),
        };
      } else {
        state = null;
      }
      continue;
    }

    if (kind === "vertical_arc") {
      const hasVerticalDrop = hasOwn(stage, "verticalDropM") && stage.verticalDropM !== undefined;
      const hasExplicitRadius = typeof stage.radiusM === "number";
      const crit = criticalByStage.get(i);

      if (hasVerticalDrop && hasExplicitRadius) {
        addError(
          stagePath,
          "PRECONDITION_CONFLICT",
          "verticalDropM 与显式 radiusM 互斥，请只保留一种。",
        );
      }
      if (hasVerticalDrop && crit) {
        addError(
          stagePath,
          "PRECONDITION_CONFLICT",
          "verticalDropM 与 critical_arc_top 约束互斥，不能同时反求同一圆弧半径。",
        );
      }

      if (hasVerticalDrop && !hasExplicitRadius && !crit) {
        let ready = true;
        if (stage.verticalDropM == null) {
          addMissing(`${stagePath}/verticalDropM`);
          ready = false;
        } else if (typeof stage.verticalDropM !== "number") {
          addError(`${stagePath}/verticalDropM`, "TYPE", "圆弧竖直落差须为数值。");
          ready = false;
        }

        let startAngleDeg: number | null = null;
        let sweepAngleDeg: number | null = null;
        let direction: ArcDirection | null = null;
        const inputPaths: string[] = [`${stagePath}/verticalDropM`];

        if (isRecord(stage.path)) {
          const p = stage.path;
          if (p.startAngleDeg == null) {
            addMissing(`${stagePath}/path/startAngleDeg`);
            ready = false;
          } else if (typeof p.startAngleDeg !== "number") {
            addError(`${stagePath}/path/startAngleDeg`, "TYPE", "圆弧入口角须为数值。");
            ready = false;
          } else {
            startAngleDeg = p.startAngleDeg;
            inputPaths.push(`${stagePath}/path/startAngleDeg`);
          }

          if (p.direction == null) {
            addMissing(`${stagePath}/path/direction`);
            ready = false;
          } else if (typeof p.direction !== "string") {
            addError(`${stagePath}/path/direction`, "TYPE", "圆弧方向须为字符串。");
            ready = false;
          } else {
            direction = p.direction as ArcDirection;
            inputPaths.push(`${stagePath}/path/direction`);
          }

          if (!isRecord(p.end)) {
            addMissing(`${stagePath}/path/end`);
            ready = false;
          } else if (p.end.sweepAngleDeg == null) {
            addMissing(`${stagePath}/path/end/sweepAngleDeg`);
            ready = false;
          } else if (typeof p.end.sweepAngleDeg !== "number") {
            addError(`${stagePath}/path/end/sweepAngleDeg`, "TYPE", "圆弧圆心角须为数值。");
            ready = false;
          } else {
            sweepAngleDeg = p.end.sweepAngleDeg;
            inputPaths.push(`${stagePath}/path/end/sweepAngleDeg`);
          }
        } else {
          addError(
            `${stagePath}/verticalDropM`,
            "PRECONDITION_CONFLICT",
            "使用 verticalDropM 反求半径需要显式 path（含 startAngleDeg、direction 与 sweepAngleDeg）。",
          );
          ready = false;
        }

        if (ready) {
          const derived = deriveArcRadiusFromDrop({
            verticalDropM: stage.verticalDropM as number,
            startAngleDeg: startAngleDeg!,
            sweepAngleDeg: sweepAngleDeg!,
            direction: direction!,
            stageIndex: i,
            inputPaths,
          });
          if (!derived.ok) {
            addError(derived.path, derived.code, derived.message);
          } else {
            stage.radiusM = derived.radiusM;
            delete stage.verticalDropM;
            calculations.push(derived.calculation);
          }
        }
      } else if (crit && !hasVerticalDrop && !hasExplicitRadius) {
        let ready = true;
        if (g == null) {
          addMissing("/gravityMps2");
          ready = false;
        }
        let startAngleDeg = 0;
        const inputPaths: string[] = ["/gravityMps2", `/constraints/${crit.constraintIndex}`];
        if (isRecord(stage.path)) {
          if (stage.path.startAngleDeg == null) {
            addMissing(`${stagePath}/path/startAngleDeg`);
            ready = false;
          } else if (typeof stage.path.startAngleDeg !== "number") {
            addError(`${stagePath}/path/startAngleDeg`, "TYPE", "圆轨入口角须为数值。");
            ready = false;
          } else {
            startAngleDeg = stage.path.startAngleDeg;
            inputPaths.push(`${stagePath}/path/startAngleDeg`);
          }
        }
        if (state == null) {
          if (i === 0 && (!initial || initial.speedMps == null)) {
            addMissing("/initial/speedMps");
          } else if (missingKeys.length === 0 && fieldErrors.length === 0) {
            addError(
              `/constraints/${crit.constraintIndex}`,
              "PRECONDITION_CONFLICT",
              "无法由前置阶段唯一确定进入圆轨的速率，不能反求临界过顶半径。",
            );
          }
          ready = false;
        } else if (i === 0) {
          inputPaths.push("/initial/speedMps");
        } else {
          inputPaths.push(`/stages/${i - 1}`);
        }

        if (ready) {
          const derived = deriveCriticalArcTopRadius({
            entrySpeedMps: state!.speed,
            gravityMps2: g!,
            startAngleDeg,
            stageIndex: i,
            constraintIndex: crit.constraintIndex,
            inputPaths,
          });
          if (!derived.ok) {
            addError(derived.path, derived.code, derived.message);
          } else {
            stage.radiusM = derived.radiusM;
            calculations.push(derived.calculation);
            consumedConstraintIndices.push(crit.constraintIndex);
          }
        }
      }

      // 沿光滑圆弧递推末速度，供后续阶段使用
      if (
        state != null &&
        g != null &&
        stage.frictionless === true &&
        typeof stage.radiusM === "number" &&
        Number.isFinite(stage.radiusM) &&
        stage.radiusM > 0
      ) {
        let startAngleDeg: number | null = null;
        let endAngleDeg: number | null = null;
        let d = 1;
        if (isRecord(stage.path) && isRecord(stage.path.end)) {
          const sa = stage.path.startAngleDeg;
          const sw = stage.path.end.sweepAngleDeg;
          const dir = stage.path.direction;
          if (
            typeof sa === "number" &&
            Number.isFinite(sa) &&
            typeof sw === "number" &&
            Number.isFinite(sw) &&
            (dir === "positive" || dir === "negative")
          ) {
            d = dir === "positive" ? 1 : -1;
            startAngleDeg = sa;
            endAngleDeg = sa + d * sw;
          }
        } else if (typeof stage.endAngleDeg === "number" && Number.isFinite(stage.endAngleDeg)) {
          startAngleDeg = 0;
          endAngleDeg = stage.endAngleDeg;
          d = 1;
        }

        if (startAngleDeg != null && endAngleDeg != null) {
          const startCos = arcTrig((startAngleDeg * Math.PI) / 180).cos;
          const endTrig = arcTrig((endAngleDeg * Math.PI) / 180);
          const vExitSq = state.speed * state.speed + 2 * g * stage.radiusM * (endTrig.cos - startCos);
          if (vExitSq < -ZERO_TOL) {
            state = null;
          } else {
            const vExit = Math.sqrt(Math.max(0, vExitSq));
            state = {
              vx: d * vExit * endTrig.cos,
              vy: d * vExit * endTrig.sin,
              speed: vExit,
            };
          }
        } else {
          state = null;
        }
      } else {
        state = null;
      }
      continue;
    }

    if (kind === "horizontal_slide") {
      if (
        state != null &&
        typeof stage.kineticFrictionCoefficient === "number" &&
        Number.isFinite(stage.kineticFrictionCoefficient) &&
        stage.kineticFrictionCoefficient >= 0 &&
        isRecord(stage.end) &&
        stage.end.kind === "distance" &&
        typeof stage.end.distanceM === "number" &&
        Number.isFinite(stage.end.distanceM) &&
        stage.end.distanceM > 0
      ) {
        const mu = stage.kineticFrictionCoefficient;
        if (mu > 0 && g == null) {
          state = null;
        } else {
          const vSq = state.speed * state.speed - 2 * mu * (g ?? 0) * stage.end.distanceM;
          if (vSq <= ZERO_TOL) {
            state = { vx: 0, vy: 0, speed: 0 };
          } else {
            const v = Math.sqrt(vSq);
            state = { vx: v, vy: 0, speed: v };
          }
        }
      } else {
        state = null;
      }
      continue;
    }

    if (kind === "incline_slide") {
      if (
        state != null &&
        g != null &&
        typeof stage.lengthM === "number" &&
        Number.isFinite(stage.lengthM) &&
        stage.lengthM > 0 &&
        typeof stage.angleDeg === "number" &&
        Number.isFinite(stage.angleDeg) &&
        stage.angleDeg > 0 &&
        stage.angleDeg < 90 &&
        typeof stage.kineticFrictionCoefficient === "number" &&
        Number.isFinite(stage.kineticFrictionCoefficient) &&
        stage.kineticFrictionCoefficient >= 0
      ) {
        const rad = (stage.angleDeg * Math.PI) / 180;
        const a = g * (Math.sin(rad) - stage.kineticFrictionCoefficient * Math.cos(rad));
        const vSq = state.speed * state.speed + 2 * a * stage.lengthM;
        if (vSq <= ZERO_TOL) {
          state = { vx: 0, vy: 0, speed: 0 };
        } else {
          const v = Math.sqrt(vSq);
          state = { vx: v * Math.cos(rad), vy: -v * Math.sin(rad), speed: v };
        }
      } else {
        state = null;
      }
      continue;
    }

    if (kind === "lossless_turn") {
      if (state != null && stage.lossless === true) {
        state = { vx: state.speed, vy: 0, speed: state.speed };
      } else {
        state = null;
      }
      continue;
    }

    // 其他阶段（如弹簧、传送带等）不在本纯模块中静态估算末速，避免臆造。
    state = null;
  }

  if (missingKeys.length > 0 || fieldErrors.length > 0) {
    return { ok: false, stages, calculations, missingKeys, fieldErrors };
  }

  return { ok: true, stages, calculations, consumedConstraintIndices };
}
