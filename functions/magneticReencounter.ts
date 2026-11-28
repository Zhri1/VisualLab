// 由 scripts/sync-functions.mjs 从 src/physics/magneticReencounter.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
import { collide1D } from './collision.ts';
import type { MagneticFieldDirection, MagneticState } from './magneticDeflection.ts';
import { createMagneticOrbit } from './magneticDeflection.ts';
import type { StagePlanValidation, StagePlanFailure, StagePlanDraft } from './stagePlan.ts';

export type Vec2Ratio = { x: number; y: number };
export type MagneticReencounterStage = {
  kind: 'magnetic_reencounter';
  scaleMode: 'normalized' | 'si';
  massScaleKg: number;
  chargeScaleC: number;
  magneticTeslaB: number;
  lengthScaleM: number;
  fieldDirection: MagneticFieldDirection;
  chargeSignA?: 1 | -1;
  targetChargeRatio?: number;
  entryOverLength: Vec2Ratio;
  entryDirection: Vec2Ratio;
  contactOverLength: Vec2Ratio;
  postFirstCollisionSpeedRatioA: number;
  periodRatioAOverB: number;
  observationTimeOverPiTau: number;
  gravityAndMutualForcesNegligible: true;
};

export type MagneticCollisionRecord = {
  index: number;
  timeSeconds: number;
  beforeA: MagneticState;
  beforeB: MagneticState;
  afterA: MagneticState;
  afterB: MagneticState;
  uA: number;
  uB: number;
  vA: number;
  vB: number;
  momentumBeforeKgMps: number;
  momentumAfterKgMps: number;
  energyBeforeJ: number;
  energyAfterJ: number;
};

export type MagneticOrbitInterval = {
  startSeconds: number;
  endSeconds: number;
  orbitA: ReturnType<typeof createMagneticOrbit>;
  orbitB: ReturnType<typeof createMagneticOrbit>;
  speedA: number;
  speedB: number;
  afterFirstCollision: boolean;
};

export type MagneticReencounterSolution = {
  tauSeconds: number;
  speedScaleMps: number;
  massA: number;
  massB: number;
  omegaA: number;
  omegaB: number;
  periodA: number;
  periodB: number;
  reencounterIntervalSeconds: number;
  firstCollisionSeconds: number;
  durationSeconds: number;
  contactPoint: { xM: number; yM: number };
  entryPointA: { xM: number; yM: number };
  entryPointB: { xM: number; yM: number };
  collisions: MagneticCollisionRecord[];
  intervals: MagneticOrbitInterval[];
  distanceBAfterFirstCollisionM: number;
  finalA: MagneticState;
  finalB: MagneticState;
  at(timeSeconds: number): { a: MagneticState; b: MagneticState };
};

const STAGE = '/stages/0/';
const TAU = 2 * Math.PI;
const MAX_RATIONAL_DENOM = 24;
const MAX_COLLISIONS = 200;
const scaleKeys = ['massScaleKg', 'chargeScaleC', 'magneticTeslaB', 'lengthScaleM'] as const;
const record = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input);

class ReencounterError extends Error {
  readonly key: string;
  readonly code: 'PRECONDITION_CONFLICT' | 'UNSUPPORTED' | 'RANGE';
  constructor(key: string, code: 'PRECONDITION_CONFLICT' | 'UNSUPPORTED' | 'RANGE', message: string) {
    super(message);
    this.key = key;
    this.code = code;
  }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a), y = Math.abs(b);
  while (y !== 0) { const t = x % y; x = y; y = t; }
  return x || 1;
}

/** 将正周期比近似为简单有理比 p/q（p, q <= MAX_RATIONAL_DENOM），无法证实则返回 null。 */
function toSimpleRational(ratio: number): { p: number; q: number } | null {
  for (let q = 1; q <= MAX_RATIONAL_DENOM; q++) {
    const p = Math.round(ratio * q);
    if (p >= 1 && p <= MAX_RATIONAL_DENOM && Math.abs(ratio - p / q) <= 1e-9 * Math.max(1, ratio)) {
      const g = gcd(p, q);
      return { p: p / g, q: q / g };
    }
  }
  return null;
}

function areExternallyTangent(
  a: ReturnType<typeof createMagneticOrbit>,
  b: ReturnType<typeof createMagneticOrbit>,
): boolean {
  const dist = Math.hypot(a.center.xM - b.center.xM, a.center.yM - b.center.yM);
  const sumR = a.radiusM + b.radiusM;
  return Math.abs(dist - sumR) <= 1e-6 * Math.max(1, sumR);
}

/** 检查两圆除接触点 O 外是否存在另一交点，并核实 [0, t1) 内是否在该交点同刻相撞。 */
function collidesBeforeFirstContact(
  orbitA: ReturnType<typeof createMagneticOrbit>,
  orbitB: ReturnType<typeof createMagneticOrbit>,
  t1: number,
  contact: { xM: number; yM: number },
): boolean {
  const dx = orbitB.center.xM - orbitA.center.xM;
  const dy = orbitB.center.yM - orbitA.center.yM;
  const d = Math.hypot(dx, dy);
  const tol = 1e-6 * Math.max(1, orbitA.radiusM, orbitB.radiusM);
  if (d <= tol) return false;
  if (d >= orbitA.radiusM + orbitB.radiusM - tol) return false; // 外切或相离：仅在 O 相交
  if (d <= Math.abs(orbitA.radiusM - orbitB.radiusM) + tol) return false; // 内切或内含
  // 两圆相交于两点：计算另一交点 Q
  const aLen = (orbitA.radiusM ** 2 - orbitB.radiusM ** 2 + d * d) / (2 * d);
  const hSq = Math.max(0, orbitA.radiusM ** 2 - aLen * aLen);
  const h = Math.sqrt(hSq);
  const mx = orbitA.center.xM + (aLen * dx) / d;
  const my = orbitA.center.yM + (aLen * dy) / d;
  const candidates = [
    { xM: mx + (h * dy) / d, yM: my - (h * dx) / d },
    { xM: mx - (h * dy) / d, yM: my + (h * dx) / d },
  ];
  for (const pt of candidates) {
    if (Math.hypot(pt.xM - contact.xM, pt.yM - contact.yM) <= tol) continue;
    const thetaA = Math.atan2(pt.yM - orbitA.center.yM, pt.xM - orbitA.center.xM);
    const sweepA = orbitA.sweepTo(thetaA);
    const tA = sweepA / orbitA.omega;
    if (tA > 1e-9 && tA < t1 - 1e-9) {
      const bPos = orbitB.at(tA);
      if (Math.hypot(bPos.xM - pt.xM, bPos.yM - pt.yM) <= tol) return true;
    }
  }
  return false;
}

export function solveMagneticReencounter(stage: MagneticReencounterStage): MagneticReencounterSolution {
  const mA = stage.massScaleKg;
  const qBase = stage.chargeScaleC;
  const B = stage.magneticTeslaB;
  const aScale = stage.lengthScaleM;
  const chargeSignA: 1 | -1 = stage.chargeSignA ?? 1;
  const targetChargeRatio = stage.targetChargeRatio ?? 1;
  if (!Number.isFinite(targetChargeRatio) || targetChargeRatio === 0) {
    throw new ReencounterError('targetChargeRatio', 'RANGE', '乙与甲的电荷比须为非零有限实数。');
  }

  const rational = toSimpleRational(stage.periodRatioAOverB);
  if (!rational) {
    throw new ReencounterError('periodRatioAOverB', 'UNSUPPORTED', '当前首版仅支持简单有理周期比（分子分母 ≤ 24）以证实周期同刻再相遇。');
  }

  const qA = chargeSignA * qBase;
  const qB = qA * targetChargeRatio;
  const mB = (mA * Math.abs(targetChargeRatio)) / stage.periodRatioAOverB;
  const tauSeconds = mA / (qBase * B);
  const speedScaleMps = (qBase * B * aScale) / mA;
  const omegaA = (Math.abs(qA) * B) / mA;
  const omegaB = (Math.abs(qB) * B) / mB;
  const periodA = TAU / omegaA;
  const periodB = TAU / omegaB;

  const fieldSign: 1 | -1 = stage.fieldDirection === 'into_page' ? 1 : -1;
  const spinA: 1 | -1 = ((qA > 0 ? 1 : -1) * fieldSign) as 1 | -1;
  const spinB: 1 | -1 = ((qB > 0 ? 1 : -1) * fieldSign) as 1 | -1;

  // 1. 由甲的入射点、方向和接触点 O 唯一确定首段磁圆
  const entryPointA = { xM: stage.entryOverLength.x * aScale, yM: stage.entryOverLength.y * aScale };
  const contactPoint = { xM: stage.contactOverLength.x * aScale, yM: stage.contactOverLength.y * aScale };
  const dirNorm = Math.hypot(stage.entryDirection.x, stage.entryDirection.y);
  if (!(dirNorm > 0) || !Number.isFinite(dirNorm)) {
    throw new ReencounterError('entryDirection', 'RANGE', '甲粒子入射方向向量须非零。');
  }
  const t0x = stage.entryDirection.x / dirNorm;
  const t0y = stage.entryDirection.y / dirNorm;
  // 圆心方向：spin * (-t0y, t0x)
  const n0x = -spinA * t0y;
  const n0y = spinA * t0x;
  const dx = contactPoint.xM - entryPointA.xM;
  const dy = contactPoint.yM - entryPointA.yM;
  const chordSq = dx * dx + dy * dy;
  if (!(chordSq > 0)) {
    throw new ReencounterError('contactOverLength', 'PRECONDITION_CONFLICT', '甲粒子入射点与首次正碰点不能重合。');
  }
  const proj = dx * n0x + dy * n0y;
  if (!(proj > 1e-12 * Math.sqrt(chordSq))) {
    throw new ReencounterError('contactOverLength', 'PRECONDITION_CONFLICT', '按洛伦兹力偏转方向，甲粒子无法从入射点到达该接触点。');
  }
  const radiusA0 = chordSq / (2 * proj);
  const speedA0 = omegaA * radiusA0;
  const orbitA0 = createMagneticOrbit(
    { xM: entryPointA.xM, yM: entryPointA.yM, vxMps: speedA0 * t0x, vyMps: speedA0 * t0y },
    omegaA,
    spinA,
  );
  const contactAngleA0 = Math.atan2(contactPoint.yM - orbitA0.center.yM, contactPoint.xM - orbitA0.center.xM);
  const sweep1 = orbitA0.sweepTo(contactAngleA0);
  const t1 = sweep1 / omegaA;
  if (!(t1 > 0) || !Number.isFinite(t1)) {
    throw new ReencounterError('contactOverLength', 'PRECONDITION_CONFLICT', '甲粒子到达首次接触点的时间无效。');
  }

  // 2. 首次正碰：沿甲入射切线方向反求乙碰前速度并调用 collide1D 核对守恒
  const beforeA1 = orbitA0.at(t1);
  const etx = beforeA1.vxMps / speedA0;
  const ety = beforeA1.vyMps / speedA0;
  const uA1 = speedA0;
  const targetVA1 = stage.postFirstCollisionSpeedRatioA * uA1;
  const uB1 = ((mA + mB) * targetVA1 - (mA - mB) * uA1) / (2 * mB);
  if (!Number.isFinite(uB1) || Math.abs(uB1) <= 1e-12 * Math.max(1, uA1)) {
    throw new ReencounterError('postFirstCollisionSpeedRatioA', 'UNSUPPORTED', '首次碰前乙粒子须在磁场中运动（非零速率）。');
  }
  if (Math.abs(uA1 - uB1) <= 1e-12 * Math.max(1, uA1, Math.abs(uB1))) {
    throw new ReencounterError('postFirstCollisionSpeedRatioA', 'PRECONDITION_CONFLICT', '首次碰前两粒子共速，不会发生有效碰撞。');
  }
  const firstCol = collide1D(mA, mB, uA1, uB1, 'elastic');
  const beforeB1: MagneticState = {
    xM: contactPoint.xM,
    yM: contactPoint.yM,
    vxMps: uB1 * etx,
    vyMps: uB1 * ety,
  };
  // 由首次接触状态逆推 -t1 得到乙在 t = 0 时刻的初态
  const orbitBAtContact = createMagneticOrbit(beforeB1, omegaB, spinB);
  const startB = orbitBAtContact.at(-t1);
  if (Math.hypot(startB.xM - entryPointA.xM, startB.yM - entryPointA.yM) <= 1e-6 * Math.max(1, aScale)) {
    throw new ReencounterError('entryOverLength', 'PRECONDITION_CONFLICT', '反推得到的乙初位与甲初位在 t=0 重合。');
  }
  const orbitB0 = createMagneticOrbit(startB, omegaB, spinB);
  if (collidesBeforeFirstContact(orbitA0, orbitB0, t1, contactPoint)) {
    throw new ReencounterError('contactOverLength', 'PRECONDITION_CONFLICT', '两粒子在到达指定接触点前已在另一轨迹交点同刻碰撞。');
  }

  // 3. 观察时长与逐次周期再相遇（保证外切几何，0 时刻不重复触发）
  const durationSeconds = stage.observationTimeOverPiTau * Math.PI * tauSeconds;
  if (!(durationSeconds > 0) || !Number.isFinite(durationSeconds)) {
    throw new ReencounterError('observationTimeOverPiTau', 'RANGE', '观察时刻系数须为有限正数。');
  }
  const reencounterIntervalSeconds = rational.q * periodA; // 精确等于 rational.p * periodB

  const intervals: MagneticOrbitInterval[] = [];
  const collisions: MagneticCollisionRecord[] = [];

  if (durationSeconds < t1 - 1e-12 * Math.max(1, t1)) {
    intervals.push({
      startSeconds: 0,
      endSeconds: durationSeconds,
      orbitA: orbitA0,
      orbitB: orbitB0,
      speedA: speedA0,
      speedB: Math.abs(uB1),
      afterFirstCollision: false,
    });
  } else {
    intervals.push({
      startSeconds: 0,
      endSeconds: t1,
      orbitA: orbitA0,
      orbitB: orbitB0,
      speedA: speedA0,
      speedB: Math.abs(uB1),
      afterFirstCollision: false,
    });

    let currentTime = t1;
    let curUA = uA1;
    let curUB = uB1;
    let curBeforeA = beforeA1;
    let curBeforeB = beforeB1;
    let collisionCount = 0;

    while (currentTime <= durationSeconds + 1e-12 * Math.max(1, durationSeconds)) {
      collisionCount += 1;
      if (collisionCount > MAX_COLLISIONS) {
        throw new ReencounterError('observationTimeOverPiTau', 'RANGE', `观察范围内碰撞次数超过上限 ${MAX_COLLISIONS}，请缩短观察时刻。`);
      }
      const col = collisionCount === 1 ? firstCol : collide1D(mA, mB, curUA, curUB, 'elastic');
      const vA = col.v1;
      const vB = col.v2;
      if (Math.abs(vA) <= 1e-12 * Math.max(1, speedScaleMps) || Math.abs(vB) <= 1e-12 * Math.max(1, speedScaleMps)) {
        throw new ReencounterError('postFirstCollisionSpeedRatioA', 'UNSUPPORTED', '碰后某粒子静止在接触点，超出两运动圆外切再相遇的首版范围。');
      }
      const afterA: MagneticState = { xM: contactPoint.xM, yM: contactPoint.yM, vxMps: vA * etx, vyMps: vA * ety };
      const afterB: MagneticState = { xM: contactPoint.xM, yM: contactPoint.yM, vxMps: vB * etx, vyMps: vB * ety };
      const nextOrbitA = createMagneticOrbit(afterA, omegaA, spinA);
      const nextOrbitB = createMagneticOrbit(afterB, omegaB, spinB);

      // 验证两轨道在接触点 O 严格外切：排除无法证实的其他几何（内切/重合/异点相交）
      if (!areExternallyTangent(nextOrbitA, nextOrbitB)) {
        throw new ReencounterError('postFirstCollisionSpeedRatioA', 'UNSUPPORTED', '碰后两回旋圆在接触点并非外切几何，当前首版仅支持外切同刻再相遇。');
      }

      collisions.push({
        index: collisionCount,
        timeSeconds: currentTime,
        beforeA: curBeforeA,
        beforeB: curBeforeB,
        afterA,
        afterB,
        uA: curUA,
        uB: curUB,
        vA,
        vB,
        momentumBeforeKgMps: mA * curUA + mB * curUB,
        momentumAfterKgMps: mA * vA + mB * vB,
        energyBeforeJ: col.energyBeforeJ,
        energyAfterJ: col.energyAfterJ,
      });

      const nextTime = currentTime + reencounterIntervalSeconds;
      const segEnd = Math.min(nextTime, durationSeconds);
      if (segEnd > currentTime + 1e-12 * Math.max(1, durationSeconds)) {
        intervals.push({
          startSeconds: currentTime,
          endSeconds: segEnd,
          orbitA: nextOrbitA,
          orbitB: nextOrbitB,
          speedA: Math.abs(vA),
          speedB: Math.abs(vB),
          afterFirstCollision: true,
        });
      }
      if (nextTime > durationSeconds + 1e-12 * Math.max(1, durationSeconds)) break;

      // 下一同刻再相遇时，两粒子精确回到接触点 O，切向速度与离开时完全相同
      currentTime = nextTime;
      curUA = vA;
      curUB = vB;
      curBeforeA = afterA;
      curBeforeB = afterB;
    }
  }

  // 逐段累加首次碰后乙粒子路程（不写死公式）
  const distanceBAfterFirstCollisionM = intervals
    .filter(seg => seg.afterFirstCollision)
    .reduce((sum, seg) => sum + seg.speedB * (seg.endSeconds - seg.startSeconds), 0);

  const at = (timeSeconds: number): { a: MagneticState; b: MagneticState } => {
    const t = Number.isNaN(timeSeconds) ? 0 : Math.max(0, Math.min(timeSeconds, durationSeconds));
    // 精确碰撞时刻按“同刻取最后事件之后”返回碰后瞬时状态
    for (let i = collisions.length - 1; i >= 0; i--) {
      const c = collisions[i];
      if (Math.abs(t - c.timeSeconds) <= 32 * Number.EPSILON * Math.max(1, c.timeSeconds)) {
        return { a: { ...c.afterA }, b: { ...c.afterB } };
      }
    }
    const seg = intervals.find(s => t >= s.startSeconds && t < s.endSeconds) ?? intervals[intervals.length - 1];
    const dt = Math.max(0, t - seg.startSeconds);
    return { a: seg.orbitA.at(dt), b: seg.orbitB.at(dt) };
  };

  const finalState = at(durationSeconds);
  return {
    tauSeconds,
    speedScaleMps,
    massA: mA,
    massB: mB,
    omegaA,
    omegaB,
    periodA,
    periodB,
    reencounterIntervalSeconds,
    firstCollisionSeconds: t1,
    durationSeconds,
    contactPoint,
    entryPointA,
    entryPointB: { xM: startB.xM, yM: startB.yM },
    collisions,
    intervals,
    distanceBAfterFirstCollisionM,
    finalA: finalState.a,
    finalB: finalState.b,
    at,
  };
}

export function validateMagneticReencounterPlan(input: Record<string, unknown>): StagePlanValidation {
  const stages = input.stages as unknown[];
  const missingKeys: string[] = [];
  const fieldErrors: StagePlanFailure['fieldErrors'] = [];
  let draft: StagePlanDraft | null = null;
  const issue = (path: string, code: string, message: string) => fieldErrors.push({ path, code, message });
  const result = (): StagePlanFailure => {
    const code = fieldErrors.some(e => e.code === 'TYPE') ? 'INVALID_READING'
      : fieldErrors.some(e => e.code === 'UNSUPPORTED') ? 'UNSUPPORTED'
      : fieldErrors.length ? 'INCONSISTENT_CONDITIONS' : 'NEEDS_INPUT';
    return {
      ok: false,
      code,
      reading: code === 'INVALID_READING' ? null : draft,
      missingKeys,
      fieldErrors,
      message: fieldErrors[0]?.message ?? '请补齐双粒子磁场再相遇的题设条件。',
    };
  };

  if (input.kind !== 'stage_plan' || input.schemaVersion !== 1) {
    issue('/schemaVersion', 'UNSUPPORTED', '双粒子磁场再相遇需要版本 1 的阶段计划。');
  }
  if (stages.length !== 1 || !record(stages[0]) || stages[0].kind !== 'magnetic_reencounter') {
    issue('/stages', 'UNSUPPORTED', '双粒子磁场再相遇使用一个独立的复合阶段。');
    return result();
  }

  const source = stages[0];
  const stage: Record<string, unknown> = { ...source };
  draft = { kind: 'stage_plan', schemaVersion: 1, initial: { speedMps: null }, stages: [stage] };

  const fact = (key: string, allowed: unknown[]) => {
    const value = source[key];
    if (value == null) missingKeys.push(STAGE + key);
    else if (!allowed.includes(value)) issue(STAGE + key, 'UNSUPPORTED', '题设条件超出纯匀强磁场双粒子再相遇的支持范围。');
  };
  fact('scaleMode', ['normalized', 'si']);
  fact('fieldDirection', ['into_page', 'out_of_page']);
  fact('gravityAndMutualForcesNegligible', [true]);

  for (const key of scaleKeys) {
    const value = source[key];
    if (value == null) {
      if (source.scaleMode === 'normalized') stage[key] = 1;
      else missingKeys.push(STAGE + key);
    } else if (typeof value !== 'number') {
      issue(STAGE + key, 'TYPE', '标度须为数值。');
    } else if (!Number.isFinite(value) || value <= 0) {
      issue(STAGE + key, 'RANGE', '标度须为有限正数。');
    }
  }

  if (source.chargeSignA != null) {
    if (source.chargeSignA !== 1 && source.chargeSignA !== -1) issue(STAGE + 'chargeSignA', 'RANGE', '甲粒子电荷符号须为 1 或 -1。');
  } else {
    stage.chargeSignA = 1;
  }

  if (source.targetChargeRatio != null) {
    if (typeof source.targetChargeRatio !== 'number') issue(STAGE + 'targetChargeRatio', 'TYPE', '电荷比须为数值。');
    else if (!Number.isFinite(source.targetChargeRatio) || source.targetChargeRatio === 0) issue(STAGE + 'targetChargeRatio', 'RANGE', '电荷比须为非零有限实数。');
  } else {
    stage.targetChargeRatio = 1;
  }

  const vec2 = (key: 'entryOverLength' | 'entryDirection' | 'contactOverLength') => {
    const v = source[key];
    if (v == null) { missingKeys.push(STAGE + key); return; }
    if (!record(v)) { issue(STAGE + key, 'TYPE', '二维坐标或方向须为 { x, y } 对象。'); return; }
    for (const axis of ['x', 'y'] as const) {
      const n = v[axis];
      if (n == null) missingKeys.push(`${STAGE}${key}/${axis}`);
      else if (typeof n !== 'number') issue(`${STAGE}${key}/${axis}`, 'TYPE', '分量须为数值。');
      else if (!Number.isFinite(n)) issue(`${STAGE}${key}/${axis}`, 'RANGE', '分量须为有限实数。');
    }
  };
  vec2('entryOverLength');
  vec2('entryDirection');
  vec2('contactOverLength');

  const reqNum = (key: 'postFirstCollisionSpeedRatioA' | 'periodRatioAOverB' | 'observationTimeOverPiTau', positive: boolean) => {
    const v = source[key];
    if (v == null) { missingKeys.push(STAGE + key); return; }
    if (typeof v !== 'number') { issue(STAGE + key, 'TYPE', '参数须为数值。'); return; }
    if (!Number.isFinite(v) || (positive ? v <= 0 : v === 0)) {
      issue(STAGE + key, 'RANGE', positive ? '参数须为有限正数。' : '碰后速率倍率须为非零有限实数。');
    }
  };
  reqNum('postFirstCollisionSpeedRatioA', false);
  reqNum('periodRatioAOverB', true);
  reqNum('observationTimeOverPiTau', true);

  if (fieldErrors.length || missingKeys.length) return result();

  const resolvedStage = stage as unknown as MagneticReencounterStage;
  let solved: MagneticReencounterSolution;
  try {
    solved = solveMagneticReencounter(resolvedStage);
  } catch (error) {
    if (error instanceof ReencounterError) {
      issue(STAGE + error.key, error.code, error.message);
      return result();
    }
    if (error instanceof RangeError) {
      issue(STAGE + 'lengthScaleM', 'RANGE', error.message);
      return result();
    }
    throw error;
  }

  return {
    ok: true,
    reading: {
      kind: 'stage_plan',
      schemaVersion: 1,
      initial: { speedMps: solved.speedScaleMps },
      stages: [resolvedStage],
    },
  };
}
