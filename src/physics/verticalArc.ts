import type { MotionSample } from "./motion.ts";
import type { Point } from "./scene.ts";
import type { Stage } from "./stagePlan.ts";
import { integrate } from './quadrature.ts';

import type {StageSample,VerticalArcGeometry} from './arcTypes.ts';
export type {StageSample,ArcConstraint,VerticalArcGeometry} from './arcTypes.ts';

function trig(phi: number) {
  if (phi === 0) return { sin: 0, cos: 1 };
  if (phi === Math.PI) return { sin: 0, cos: -1 };
  if (phi === Math.PI / 2) return { sin: 1, cos: 0 };
  return { sin: Math.sin(phi), cos: Math.cos(phi) };
}

export function solveVerticalArc(stage: Extract<Stage, { kind: "vertical_arc" }>, start: MotionSample, gravity: number, mass: number, stageIndex: number) {
  const radius = stage.radiusM, speed = start.vxMps;
  const isRod = stage.side === "rod";
  const scale = Math.sqrt(radius) / Math.sqrt(gravity);
  let ratio = (speed / Math.sqrt(gravity) / Math.sqrt(radius)) ** 2;
  if (![ratio, scale, mass * gravity, speed / radius].every(Number.isFinite) || scale <= 0) throw new RangeError("圆弧数值量级无法表示。");
  // 仅吸收无量纲能量比的舍入误差，保留临界值两侧的真实分支。
  for (const boundary of isRod ? [2, 4] : [2, 5]) if (Math.abs(ratio - boundary) <= 16 * Number.EPSILON * Math.max(ratio, boundary)) ratio = boundary;
  const plannedPhi = stage.endAngleDeg! * Math.PI / 180;
  const turnPhi = isRod
    ? (ratio < 4 ? 2 * Math.asin(Math.sqrt(ratio) / 2) : Infinity)
    : (ratio <= 2 ? 2 * Math.asin(Math.sqrt(ratio) / 2) : Infinity);
  const lossPhi = isRod ? Infinity : (ratio > 2 && ratio < 5 ? Math.acos((2 - ratio) / 3) : Infinity);
  const angleTolerance = 16 * Number.EPSILON * Math.PI;
  const returns = turnPhi <= plannedPhi + angleTolerance && speed > 0;
  const loses = !returns && lossPhi < plannedPhi - angleTolerance;
  const phiEnd = returns ? turnPhi : loses ? lossPhi : plannedPhi;
  const rodCriticalTop = isRod && ratio === 4 && plannedPhi >= Math.PI - angleTolerance;
  const at = (phi: number, signedSpeed: number, constrained: boolean): StageSample => {
    const { sin, cos } = trig(phi);
    const rawN = mass * gravity * ((signedSpeed / Math.sqrt(gravity) / Math.sqrt(radius)) ** 2 + cos);
    const tolN = 1e-12 * mass * gravity;
    const rodN = Math.abs(rawN) <= tolN ? 0 : rawN;
    return {
      xM: start.xM + radius * sin, yM: start.yM + radius * (1 - cos),
      vxMps: signedSpeed * cos || 0, vyMps: signedSpeed * sin || 0, springCompressionM: 0,
      ...(constrained ? { constraint: {
        kind: "vertical_arc" as const, stageIndex, angleDeg: phi * 180 / Math.PI,
        angularVelocityRadps: signedSpeed / radius,
        normalForceN: isRod ? rodN : Math.max(0, rawN),
        ...(isRod ? {
          forceRole: (rodN > 0 ? "pull" : rodN < 0 ? "support" : "none") as "pull" | "support" | "none",
          normalDirection: rodN < 0 ? { x: sin || 0, y: -cos || 0 } : { x: -sin || 0, y: cos || 0 },
        } : {}),
      } } : {}),
    };
  };
  const entry = at(0, speed, true);
  const exitReason = speed === 0 ? "stationary" : returns ? "returned_to_entry" : loses ? "contact_lost" : "endpoint";
  const geometry: VerticalArcGeometry = {
    stageIndex, entry: { xM: start.xM, yM: start.yM },
    center: { xM: start.xM, yM: start.yM + radius }, radiusM: radius,
    startAngleDeg: 0, endAngleDeg: stage.endAngleDeg!,
    side: stage.side,
    plannedEnd: { xM: start.xM + radius * trig(plannedPhi).sin, yM: start.yM + radius * (1 - trig(plannedPhi).cos) },
    actualExit: { position: { xM: start.xM, yM: start.yM }, angleDeg: 0, reason: exitReason },
  };
  if (speed === 0) return { geometry, entry, boundary: entry, end: entry, duration: 0, ascentSeconds: 0, returns: false, sampleAt: () => ({ ...entry }) };

  // ratio < 4 时令 φ = 2asin(k sinψ)，转折点的 1/v 奇异性被消去。
  // 轻杆恰达最高点（ratio = 4, v_top = 0）时对数发散，用微扰 4+1e-6 正则化时间积分，边界仍保留精确 v=0、N=-mg。
  const effRatio = rodCriticalTop ? 4 + 1e-6 : ratio;
  const transformed = effRatio < 4, k = Math.sqrt(effRatio) / 2;
  const parameterEnd = transformed ? returns ? Math.PI / 2 : Math.asin(Math.min(1, Math.sin(phiEnd / 2) / k)) : phiEnd;
  const integrand = transformed
    ? (p: number) => 1 / Math.sqrt(1 - k * k * Math.sin(p) ** 2)
    : (p: number) => 1 / Math.sqrt(effRatio - 4 * Math.sin(p / 2) ** 2);
  const cells = 64, step = parameterEnd / cells;
  const cumulative = [0];
  for (let i = 0; i < cells; i++) cumulative.push(cumulative[i] + integrate(integrand, i * step, (i + 1) * step));
  const ascentSeconds = scale * cumulative[cells];
  const duration = ascentSeconds * (returns ? 2 : 1);
  if (!(ascentSeconds > 0) || !Number.isFinite(duration)) throw new RangeError("圆弧时长无法表示。");
  const boundarySpeed = returns || rodCriticalTop ? 0 : loses ? Math.sqrt(gravity) * Math.sqrt(radius) * Math.sqrt(Math.max(0, -trig(phiEnd).cos))
    : Math.sqrt(gravity) * Math.sqrt(radius) * Math.sqrt(Math.max(0, ratio - 4 * Math.sin(phiEnd / 2) ** 2));
  const boundary = at(phiEnd, boundarySpeed, true);
  if (!isRod && (loses || (ratio === 5 && phiEnd === Math.PI))) boundary.constraint!.normalForceN = 0;
  const end = returns ? at(0, -speed, false) : { ...boundary };
  delete end.constraint;
  geometry.actualExit = { position: { xM: end.xM, yM: end.yM }, angleDeg: returns ? 0 : phiEnd * 180 / Math.PI, reason: exitReason };
  return {
    geometry, entry, boundary, end, duration, ascentSeconds, returns,
    sampleAt(time: number): StageSample {
      if (time <= 0) return { ...entry };
      if (time >= duration) return { ...end };
      if (returns && time === ascentSeconds) return { ...boundary };
      const backwards = returns && time > ascentSeconds;
      const target = (backwards ? duration - time : time) / scale;
      let lo = 0, hi = cells;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cumulative[mid] <= target) lo = mid; else hi = mid; }
      const base = lo * step;
      let a = base, b = hi * step;
      for (let iteration = 0; iteration < 40; iteration++) {
        const p = (a + b) / 2;
        if (cumulative[lo] + integrate(integrand, base, p) < target) a = p; else b = p;
      }
      const p = (a + b) / 2;
      const phi = transformed ? 2 * Math.asin(Math.min(1, k * Math.sin(p))) : p;
      const magnitude = transformed ? speed * Math.cos(p) : Math.sqrt(gravity) * Math.sqrt(radius) * Math.sqrt(Math.max(0, effRatio - 4 * Math.sin(phi / 2) ** 2));
      return at(phi, backwards ? -magnitude : magnitude, true);
    },
  };
}
