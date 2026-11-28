import { collide1D } from './collision.ts';
import type { MagneticFieldDirection, MagneticState } from './magneticDeflection.ts';
import { createMagneticOrbit } from './magneticDeflection.ts';
import type { StagePlanValidation, StagePlanFailure, StagePlanDraft } from './stagePlan.ts';

export type Ratio = number | { coefficient: number; radicand: number };
type ScaleMode = 'normalized' | 'si';
export type SwitchableEMStage = {
  kind: 'switchable_em_collision';
  scaleMode: ScaleMode;
  massScaleKg: number;
  chargeScaleC: number;
  lengthScaleM: number;
  speedScaleMps: number;
  targetMassRatio: Ratio;
  targetChargeRatio: Ratio;
  entryXOverLength: Ratio;
  collisionXOverLength: Ratio;
  collisionYOverLength: Ratio;
  switchOffXOverLength: Ratio;
  fieldDirection: MagneticFieldDirection;
  gravityAndMutualForcesNegligible: true;
};

const STAGE = '/stages/0/';
const TAU = 2 * Math.PI;
const EPS = 64 * Number.EPSILON;
const scaleKeys = ['massScaleKg', 'chargeScaleC', 'lengthScaleM', 'speedScaleMps'] as const;
const ratioKeys = ['targetMassRatio', 'targetChargeRatio', 'entryXOverLength', 'collisionXOverLength', 'collisionYOverLength', 'switchOffXOverLength'] as const;
const record = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input);

export function ratioValue(ratio: Ratio): number {
  return typeof ratio === 'number' ? ratio : ratio.coefficient * Math.sqrt(ratio.radicand);
}

class FieldConflict extends Error {
  readonly key: keyof SwitchableEMStage;
  constructor(key: keyof SwitchableEMStage, message: string) {
    super(message);
    this.key = key;
  }
}

export function validateSwitchableEMPlan(input: Record<string, unknown>): StagePlanValidation {
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
      ok: false, code, reading: code === 'INVALID_READING' ? null : draft, missingKeys, fieldErrors,
      message: fieldErrors[0]?.message ?? '请补齐电磁场切换的题设条件。',
    };
  };
  if (input.kind !== 'stage_plan' || input.schemaVersion !== 1) issue('/schemaVersion', 'UNSUPPORTED', '分区电磁场需要版本 1 的阶段计划。');
  if (stages.length !== 1 || !record(stages[0]) || stages[0].kind !== 'switchable_em_collision') {
    issue('/stages', 'UNSUPPORTED', '分区电磁场与正碰使用一个独立的复合阶段。');
    return result();
  }
  const source = stages[0], stage = { ...source };
  draft = { kind: 'stage_plan', schemaVersion: 1, initial: { speedMps: null }, stages: [stage] };
  const fact = (key: string, allowed: unknown[]) => {
    const value = source[key];
    if (value == null) missingKeys.push(STAGE + key);
    else if (!allowed.includes(value)) issue(STAGE + key, 'UNSUPPORTED', '题设条件超出分区电磁场与弹性正碰的支持范围。');
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
  for (const key of ratioKeys) {
    const value = source[key];
    if (value == null) {
      missingKeys.push(STAGE + key);
      continue;
    }
    const isRadical = record(value) && typeof value.coefficient === 'number' && typeof value.radicand === 'number';
    if (typeof value !== 'number' && !isRadical) {
      issue(STAGE + key, 'TYPE', '比例须为数值或由系数和根号内数值构成。');
      continue;
    }
    const ratio = ratioValue(value as Ratio);
    const signValid = key === 'collisionYOverLength' ? ratio < 0
      : key === 'switchOffXOverLength' || key === 'collisionXOverLength' || ratio > 0;
    if (!Number.isFinite(ratio) || !signValid) issue(STAGE + key, 'RANGE', '比例须有限并与粒子所在场区相符。');
  }
  if (fieldErrors.length || missingKeys.length) return result();
  const resolvedStage = stage as SwitchableEMStage;
  try {
    solveSwitchableEM(resolvedStage);
  } catch (error) {
    if (!(error instanceof FieldConflict) && !(error instanceof RangeError)) throw error;
    issue(STAGE + (error instanceof FieldConflict ? error.key : 'speedScaleMps'), 'PRECONDITION_CONFLICT', error.message);
    return result();
  }
  return { ok: true, reading: { kind: 'stage_plan', schemaVersion: 1, initial: { speedMps: resolvedStage.speedScaleMps }, stages: [resolvedStage] } };
}

function pointState(xM: number, yM: number, vxMps = 0, vyMps = 0): MagneticState {
  return { xM, yM, vxMps, vyMps };
}

function drift(state: MagneticState, t: number): MagneticState {
  return { ...state, xM: state.xM + state.vxMps * t, yM: state.yM + state.vyMps * t };
}

type Orbit = ReturnType<typeof createMagneticOrbit>;

// 解圆与直线的两个交点，再按当前转向排序；相切不算穿过。
function firstAxisCrossing(orbit: Orbit, axis: 'x' | 'y', coordinate: number, toward?: 1 | -1) {
  const ratio = (coordinate - (axis === 'x' ? orbit.center.xM : orbit.center.yM)) / orbit.radiusM;
  if (Math.abs(ratio) >= 1 - EPS) return Infinity;
  const angle = Math.acos(ratio);
  const angles = axis === 'x' ? [angle, -angle] : [Math.PI / 2 - angle, Math.PI / 2 + angle];
  let first = Infinity;
  for (const theta of angles) {
    const speedSign = orbit.spin * (axis === 'x' ? -Math.sin(theta) : Math.cos(theta));
    if (toward && toward * speedSign <= 0) continue;
    const sweep = orbit.sweepTo(theta);
    first = Math.min(first, (sweep <= EPS || TAU - sweep <= EPS ? TAU : sweep) / orbit.omega);
  }
  return first;
}

// 尺度按两圆半径归一，未知时间按相对漂移到单位长度所用时长归一。
function exteriorTangencyTimes(a: Orbit, b: Orbit, first: MagneticState, second: MagneticState) {
  const radiusSum = a.radiusM + b.radiusM;
  const dx = (a.center.xM - b.center.xM) / radiusSum;
  const dy = (a.center.yM - b.center.yM) / radiusSum;
  const vx = first.vxMps - second.vxMps, vy = first.vyMps - second.vyMps;
  const speed = Math.hypot(vx, vy);
  if (!(speed > 0)) return [];
  const ux = vx / speed, uy = vy / speed;
  const projection = dx * ux + dy * uy;
  const offset = dx * uy - dy * ux;
  if (Math.abs(offset) > 1 + EPS) return [];
  const span = Math.sqrt(Math.max(0, 1 - offset ** 2));
  return [-projection - span, -projection + span]
    .filter(root => root > EPS)
    .map(root => root * radiusSum / speed)
    .filter(Number.isFinite);
}

export function solveSwitchableEM(stage: SwitchableEMStage) {
  const { lengthScaleM: L, speedScaleMps: v0, chargeScaleC: q, massScaleKg: m, fieldDirection } = stage;
  const entryX = L * ratioValue(stage.entryXOverLength);
  const contact = pointState(L * ratioValue(stage.collisionXOverLength), L * ratioValue(stage.collisionYOverLength));
  const switchOffX = L * ratioValue(stage.switchOffXOverLength);
  const targetMass = m * ratioValue(stage.targetMassRatio);
  const targetCharge = q * ratioValue(stage.targetChargeRatio);
  const electricTime = entryX / v0;
  const acceleration = (2 * L / electricTime) / electricTime;
  const electricNPerC = acceleration * (m / q);
  const start = pointState(0, L, v0);
  const entry = pointState(entryX, 0, v0, -acceleration * electricTime);
  const dx = contact.xM - entry.xM, dy = contact.yM - entry.yM;
  const chord = Math.hypot(dx, dy);
  const signedOmega = 2 * ((dy / chord) * entry.vxMps - (dx / chord) * entry.vyMps) / chord;
  const spin = fieldDirection === 'into_page' ? 1 : -1;
  if (!(signedOmega * spin > 0)) throw new FieldConflict('fieldDirection', '按题给磁场方向无法从入磁点转到碰撞点。');
  const omega = Math.abs(signedOmega);
  const magneticTesla = omega * (m / q);
  if (![targetMass, targetCharge, electricNPerC, magneticTesla, electricTime].every(value => Number.isFinite(value) && value > 0)) {
    throw new FieldConflict('speedScaleMps', '题设标度组合超出可计算范围。');
  }

  const incidentOrbit = createMagneticOrbit(entry, omega, spin);
  const collisionAngle = Math.atan2(contact.yM - incidentOrbit.center.yM, contact.xM - incidentOrbit.center.xM);
  const approachTime = incidentOrbit.sweepTo(collisionAngle) / omega;
  if (!(approachTime > 0 && approachTime < firstAxisCrossing(incidentOrbit, 'y', 0, 1))) {
    throw new FieldConflict('collisionYOverLength', '甲在到达碰撞点前会离开磁场。');
  }
  const incoming = { ...incidentOrbit.at(approachTime), xM: contact.xM, yM: contact.yM };
  const speed = Math.hypot(incoming.vxMps, incoming.vyMps);
  const collision = collide1D(m, targetMass, speed, 0, 'elastic');
  const aCollision = { ...incoming, vxMps: incoming.vxMps * (collision.v1 / speed), vyMps: incoming.vyMps * (collision.v1 / speed) };
  const bCollision = { ...contact, vxMps: incoming.vxMps * (collision.v2 / speed), vyMps: incoming.vyMps * (collision.v2 / speed) };
  if (collision.v1 === 0) throw new FieldConflict('targetMassRatio', '甲碰后静止，恢复磁场时无法形成两个回旋圆。');
  const aOrbit = createMagneticOrbit(aCollision, omega, spin);
  const bOrbit = createMagneticOrbit(bCollision, omega * (targetCharge / q) / (targetMass / m), spin);
  const magneticTime = firstAxisCrossing(bOrbit, 'x', switchOffX);
  const firstExit = Math.min(firstAxisCrossing(aOrbit, 'y', 0, 1), firstAxisCrossing(bOrbit, 'y', 0, 1));
  if (!(Number.isFinite(magneticTime) && magneticTime < firstExit)) {
    throw new FieldConflict('switchOffXOverLength', '乙无法在任一粒子离开磁区之前穿过撤场竖线。');
  }
  const aOff = aOrbit.at(magneticTime), bOff = bOrbit.at(magneticTime);
  // 恢复时的回旋圆与关场时的圆只差匀速平移。整圆留在磁区也保证漂移终点在磁区。
  const restoreTimes = exteriorTangencyTimes(aOrbit, bOrbit, aOff, bOff);
  let restored: { time: number; a: Orbit; b: Orbit; aState: MagneticState; bState: MagneticState } | undefined;
  for (const time of restoreTimes) {
    const aState = drift(aOff, time), bState = drift(bOff, time);
    const a = createMagneticOrbit(aState, aOrbit.omega, spin);
    const b = createMagneticOrbit(bState, bOrbit.omega, spin);
    const scale = Math.max(L, a.radiusM, b.radiusM);
    if (a.center.yM + a.radiusM <= EPS * scale && b.center.yM + b.radiusM <= EPS * scale) {
      restored = { time, a, b, aState, bState };
      break;
    }
  }
  if (!restored) throw new FieldConflict('switchOffXOverLength', '撤场后没有使两条完整磁场轨迹外切的有效正等待时间。');
  const observationTime = TAU / Math.min(aOrbit.omega, bOrbit.omega);
  const distanceM = Math.hypot(aOff.vxMps, aOff.vyMps) * restored.time;
  if (![distanceM, observationTime, electricNPerC / magneticTesla].every(Number.isFinite)) {
    throw new FieldConflict('speedScaleMps', '计算结果超出可表示的数值范围。');
  }
  return {
    start, entry, contact, incoming, aCollision, bCollision, aOff, bOff, incidentOrbit, aOrbit, bOrbit,
    acceleration, electricNPerC, magneticTesla, electricTime, approachTime, magneticTime, restored, observationTime, distanceM,
    switchOffX, targetMass, collision,
    electricAt(t: number) {
      return pointState(v0 * t, L - (acceleration * t / 2) * t, v0, -acceleration * t);
    },
    driftAt(t: number) { return [drift(aOff, t), drift(bOff, t)] as const; },
  };
}
