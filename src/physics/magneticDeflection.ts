// 匀强磁场偏转：洛伦兹力提供向心力，带电粒子做匀速圆周运动（高考模型）。
// 题目约定：磁场阶段忽略重力。坐标约定 x 向右、y 向上；
// into_page 为 B 沿 −z，out_of_page 沿 +z，F = qv×B。
// q>0 且向里时力指向速度左侧（逆时针）；q 变号或磁场反向都会翻转旋转方向。

export type MagneticFieldDirection = "into_page" | "out_of_page";
export type MagneticExitKind = "region_edge" | "half_circle";

export type MagneticDeflectionStage = {
  kind: "magnetic_deflection";
  /** 磁感应强度 B（T），> 0。 */
  magneticTeslaB: number;
  /** 电荷量 q（C），≠ 0，可负。质量用计划根 massKg。 */
  chargeC: number;
  /** 磁场区域宽度（m）：入口边界 x = entryX 到远边界 x = entryX + regionWidthM 的竖直条形区域，> 0。 */
  regionWidthM: number;
  /** 磁场方向，默认 into_page（垂直纸面向里）。 */
  fieldDirection?: MagneticFieldDirection;
  /** 出射方式，默认 region_edge：穿出远边界；半径太小穿不出时转过半圆从入口侧离开。half_circle：强制转过 180° 从入口侧离开。 */
  exitKind?: MagneticExitKind;
};

export type MagneticPoint = { xM: number; yM: number };
export type MagneticEntry = MagneticPoint & { vxMps: number; vyMps: number };
export type MagneticState = MagneticEntry;

export type MagneticGeometry = {
  center: MagneticPoint;
  radiusM: number;
  entry: MagneticPoint;
  exit: MagneticPoint;
  /** 入口相对圆心的极角（rad）。 */
  entryAngleRad: number;
  /** 出射点相对圆心的极角（rad），沿旋转方向展开：exitAngleRad − entryAngleRad = ±偏转角。 */
  exitAngleRad: number;
  direction: "cw" | "ccw";
  regionWidthM: number;
  fieldDirection: MagneticFieldDirection;
};

export type MagneticEvent = {
  kind: "magnetic_enter" | "magnetic_exit";
  timeSeconds: number;
  xM: number;
  yM: number;
  vxMps: number;
  vyMps: number;
  label: string;
  explanation: string;
};

export type MagneticDeflectionSolution = {
  durationSeconds: number;
  geometry: MagneticGeometry;
  /** 阶段内 t 时刻的位置与速度，t 截断到 [0, durationSeconds]。 */
  at(t: number): MagneticState;
  events: MagneticEvent[];
  /** 是否从远边界 x = entryX + regionWidthM 穿出；半圆返回入口侧为 false。 */
  exited: boolean;
  exitSide: "region_edge" | "entry_side";
  /** 偏转角（扫过圆心角的绝对值，rad）。 */
  deflectionAngleRad: number;
  exitVelocity: { vxMps: number; vyMps: number };
  /** 角速度 ω = |q|B/m（rad/s）。 */
  angularVelocityRadps: number;
};

const TAU = Math.PI * 2;

// 基数角取精确值，避免水平/竖直出射残留 1e-16 量级的三角误差。
function trig(phi: number) {
  const mod = ((phi % TAU) + TAU) % TAU;
  if (mod === 0) return { sin: 0, cos: 1 };
  if (mod === Math.PI) return { sin: 0, cos: -1 };
  if (mod === Math.PI / 2) return { sin: 1, cos: 0 };
  if (mod === Math.PI + Math.PI / 2) return { sin: -1, cos: 0 };
  return { sin: Math.sin(phi), cos: Math.cos(phi) };
}

/**
 * 求解匀强磁场中的匀速圆周偏转。重力按题目约定忽略（不参与计算）。
 * 半径 R = m·v/(|q|·B)，角速度 ω = |q|·B/m；旋转方向由 q 符号与 fieldDirection 按 F = qv×B 决定。
 * 数值非法或入口速率为零时抛 RangeError（附 field 相对路径）。
 */
export function solveMagneticDeflection(stage: MagneticDeflectionStage, entry: MagneticEntry, massKg: number): MagneticDeflectionSolution {
  const B = stage.magneticTeslaB, q = stage.chargeC, W = stage.regionWidthM;
  const fieldDirection = stage.fieldDirection ?? "into_page";
  const exitKind = stage.exitKind ?? "region_edge";
  const fail = (message: string, field: string) => Object.assign(new RangeError(message), { field });
  if (!(Number.isFinite(B) && B > 0)) throw fail("磁感应强度须为正有限数。", "/magneticTeslaB");
  if (!(Number.isFinite(q) && q !== 0)) throw fail("电荷量须为非零有限数。", "/chargeC");
  if (!(Number.isFinite(W) && W > 0)) throw fail("磁场区域宽度须为正有限数。", "/regionWidthM");
  if (!(Number.isFinite(massKg) && massKg > 0)) throw fail("磁场偏转需要正质量（计划根 massKg）。", "/massKg");
  const speed = Math.hypot(entry.vxMps, entry.vyMps);
  if (!(Number.isFinite(speed) && speed > 0)) throw fail("磁场偏转需要非零入口速度。", "");
  const radius = massKg * speed / (Math.abs(q) * B);
  const omega = Math.abs(q) * B / massKg;
  if (!(Number.isFinite(radius) && radius > 0 && Number.isFinite(omega) && omega > 0)) throw fail("磁场数值量级无法表示。", "");

  // spin = +1 → 逆时针（圆心在速度左侧）；−1 → 顺时针（右侧）。
  const spin = (q > 0 ? 1 : -1) * (fieldDirection === "into_page" ? 1 : -1);
  const direction: "cw" | "ccw" = spin > 0 ? "ccw" : "cw";
  const center: MagneticPoint = {
    xM: entry.xM + spin * radius * (-entry.vyMps / speed),
    yM: entry.yM + spin * radius * (entry.vxMps / speed),
  };
  const entryAngle = Math.atan2(entry.yM - center.yM, entry.xM - center.xM);

  // 求首次以指定方向穿越竖直边界 x = targetX 的时刻；outwardSign = +1 向右穿出，−1 向左穿出。
  const crossingTime = (targetX: number, outwardSign: 1 | -1): number => {
    let ratio = (targetX - center.xM) / radius;
    const tolerance = 32 * Number.EPSILON * Math.max(1, Math.abs(ratio));
    if (ratio > 1 + tolerance || ratio < -1 - tolerance) return Infinity;
    ratio = Math.min(1, Math.max(-1, ratio));
    const alpha = Math.acos(ratio);
    // vx = spin·v·(−sinθ)，穿出要求 sign(vx) = outwardSign，即 sign(sinθ) = −spin·outwardSign。
    const base = -spin * outwardSign > 0 ? alpha : -alpha;
    let sweep = spin * (base - entryAngle);
    sweep = ((sweep % TAU) + TAU) % TAU;
    if (sweep <= 1e-14) {
      // 入口恰在左边界上：入口即向外穿越时立即离开；否则该解族是入口自身，取下一圈。
      if (outwardSign === -1 && Math.abs(entry.xM - targetX) <= 32 * Number.EPSILON * Math.max(1, Math.abs(entry.xM), Math.abs(targetX))) return 0;
      sweep += TAU;
    }
    return sweep / omega;
  };

  let sweep: number;
  let exitSide: "region_edge" | "entry_side";
  if (exitKind === "half_circle") {
    sweep = Math.PI;
    exitSide = "entry_side";
  } else {
    // 远边界可达时先穿出远边界；否则（半径太小）半圆返回入口边界。
    // 斜入射时取两侧边界中更早的真实穿出时刻，水平入射退化为题设两种情形。
    const rightTime = crossingTime(entry.xM + W, 1);
    const leftTime = crossingTime(entry.xM, -1);
    const exitTime = Math.min(rightTime, leftTime);
    if (!Number.isFinite(exitTime)) { sweep = Math.PI; exitSide = "entry_side"; }
    else if (rightTime <= leftTime) { sweep = omega * rightTime; exitSide = "region_edge"; }
    else { sweep = omega * leftTime; exitSide = "entry_side"; }
  }

  const duration = sweep / omega;
  const exitAngle = entryAngle + spin * sweep;
  const exitTrig = trig(exitAngle);
  const exitState: MagneticState = {
    xM: center.xM + radius * exitTrig.cos,
    yM: center.yM + radius * exitTrig.sin,
    vxMps: spin * speed * -exitTrig.sin,
    vyMps: spin * speed * exitTrig.cos,
  };
  const at = (t: number): MagneticState => {
    const clamped = Math.min(duration, Math.max(0, Number.isNaN(t) ? 0 : t));
    if (clamped <= 0) return { xM: entry.xM, yM: entry.yM, vxMps: entry.vxMps, vyMps: entry.vyMps };
    if (clamped >= duration) return { ...exitState };
    const angle = entryAngle + spin * omega * clamped;
    const { sin, cos } = trig(angle);
    return {
      xM: center.xM + radius * cos,
      yM: center.yM + radius * sin,
      vxMps: spin * speed * -sin,
      vyMps: spin * speed * cos,
    };
  };

  const geometry: MagneticGeometry = {
    center, radiusM: radius,
    entry: { xM: entry.xM, yM: entry.yM },
    exit: { xM: exitState.xM, yM: exitState.yM },
    entryAngleRad: entryAngle, exitAngleRad: exitAngle,
    direction, regionWidthM: W, fieldDirection,
  };
  const deflectionDeg = sweep * 180 / Math.PI;
  const events: MagneticEvent[] = [
    {
      kind: "magnetic_enter", timeSeconds: 0,
      xM: entry.xM, yM: entry.yM, vxMps: entry.vxMps, vyMps: entry.vyMps,
      label: "进入磁场",
      explanation: `以速率 ${speed.toFixed(4)} m/s 进入匀强磁场（B = ${B} T，${fieldDirection === "into_page" ? "垂直纸面向里" : "垂直纸面向外"}），洛伦兹力提供向心力，R = mv/(|q|B) ≈ ${radius.toFixed(4)} m；题目约定忽略重力。`,
    },
    {
      kind: "magnetic_exit", timeSeconds: duration,
      xM: exitState.xM, yM: exitState.yM, vxMps: exitState.vxMps, vyMps: exitState.vyMps,
      label: exitSide === "region_edge" ? "穿出磁场边界" : "从入口侧离开磁场",
      explanation: `${exitSide === "region_edge" ? `穿出 x = ${(entry.xM + W).toFixed(4)} m 处的磁场边界` : `转过 ${deflectionDeg.toFixed(2)}° 后从入口侧离开`}，偏转角约 ${deflectionDeg.toFixed(2)}°，出射速度 (${exitState.vxMps.toFixed(4)}, ${exitState.vyMps.toFixed(4)}) m/s，速率保持 ${speed.toFixed(4)} m/s。`,
    },
  ];
  return {
    durationSeconds: duration,
    geometry,
    at,
    events,
    exited: exitSide === "region_edge",
    exitSide,
    deflectionAngleRad: sweep,
    exitVelocity: { vxMps: exitState.vxMps, vyMps: exitState.vyMps },
    angularVelocityRadps: omega,
  };
}
