import type { StageSample } from "./arcTypes.ts";
import { integrateAdaptive } from "./quadrature.ts";
import type { Point } from "./geometryTypes.ts";

export type MovableSemicircleStage = {
  kind: "movable_semicircle";
  radiusM: number;
  grooveMassKg: number;
  direction: "right" | "left";
  frictionless: true;
  groundFrictionless: true;
  startLabel?: string;
  endLabel?: string;
};

export type MovableSemicircleReading = {
  grooveXM: number;
  grooveVX: number;
  relativeSpeedMps: number;
  angleDeg: number;
};

export function solveMovableSemicircle(
  stage: MovableSemicircleStage, entry: Point, entrySpeed: number,
  mass: number, gravity: number, stageIndex: number,
) {
  const radius = stage.radiusM;
  const totalMass = mass + stage.grooveMassKg;
  const alpha = mass / totalMass;
  const reducedRatio = stage.grooveMassKg / totalMass;
  const direction = stage.direction === "right" ? 1 : -1;
  const speedUnit = Math.sqrt(gravity) * Math.sqrt(radius);
  const timeUnit = Math.sqrt(radius) / Math.sqrt(gravity);
  const speedRatio = (entrySpeed / speedUnit) ** 2;
  let energy = reducedRatio * speedRatio;
  if (!(energy > 0 && timeUnit > 0) || ![energy, speedUnit, timeUnit, mass * gravity].every(Number.isFinite)) {
    throw new RangeError("半圆轨道的速度、力或时间量级无法表示。");
  }

  for (const threshold of [2, 4 + reducedRatio]) {
    if (Math.abs(energy - threshold) <= 16 * Number.EPSILON * threshold) energy = threshold;
  }
  let outcome: "top" | "contact_lost" | "turn" = "top";
  let endAngle = Math.PI;
  if (energy <= 2) {
    outcome = "turn";
    endAngle = 2 * Math.asin(Math.sqrt(energy) / 2);
  } else if (energy < 4 + reducedRatio) {
    // 将 N=0 化成关于 cosφ 的单调三次式，根必在 (-1, 0)。
    outcome = "contact_lost";
    let lo = -1;
    let hi = 0;
    for (let i = 0; i < 56; i += 1) {
      const cos = (lo + hi) / 2;
      if (energy - 2 + cos * (3 - alpha * cos ** 2) < 0) lo = cos;
      else hi = cos;
    }
    endAngle = Math.acos((lo + hi) / 2);
  }

  // 机械能扣除不变的质心水平动能。转折分支用 sin(φ/2)=k sinψ 消去积分奇点。
  const relativeSquared = (angle: number) => {
    const sinHalf = Math.sin(angle / 2);
    return Math.max(0, energy - 4 * sinHalf ** 2) / (reducedRatio + alpha * Math.sin(angle) ** 2);
  };
  const k = Math.sqrt(energy) / 2;
  const turn = outcome === "turn";
  const angleAt = (p: number) => turn ? 2 * Math.asin(k * Math.sin(p)) : p;
  const dtDp = turn
    ? (p: number) => timeUnit * Math.sqrt((reducedRatio + alpha * Math.sin(angleAt(p)) ** 2) / (1 - (k * Math.sin(p)) ** 2))
    : (p: number) => timeUnit / Math.sqrt(relativeSquared(p));
  const cells = 64;
  const endParam = turn ? Math.PI / 2 : endAngle;
  const step = endParam / cells;
  const times = [0];
  for (let i = 0; i < cells; i += 1) {
    times.push(times[i] + integrateAdaptive(dtDp, i * step, (i + 1) * step));
  }
  const duration = times[cells];
  if (!(duration > 0) || !Number.isFinite(duration)) throw new RangeError("半圆轨道时长无法表示。");

  function stateAt(angle: number, time: number) {
    const sin = angle === Math.PI ? 0 : Math.sin(angle);
    const cos = angle === Math.PI / 2 ? 0 : Math.cos(angle);
    const relativeSpeedMps = time === 0 ? entrySpeed
      : turn && time === duration ? 0 : speedUnit * Math.sqrt(relativeSquared(angle));
    const grooveXM = entry.xM + alpha * direction * (entrySpeed * time - radius * sin);
    const grooveVX = alpha * direction * (entrySpeed - relativeSpeedMps * cos);
    const normalForceN = outcome === "contact_lost" && time === duration ? 0
      : Math.max(0, mass * (relativeSpeedMps ** 2 / radius + gravity * cos) / (1 + (mass / stage.grooveMassKg) * sin ** 2));
    const angleDeg = angle * (180 / Math.PI);
    const sample: StageSample = {
      xM: grooveXM + direction * radius * sin,
      yM: entry.yM + 2 * radius * Math.sin(angle / 2) ** 2,
      vxMps: grooveVX + direction * relativeSpeedMps * cos,
      vyMps: relativeSpeedMps * sin,
      springCompressionM: 0,
      constraint: {
        kind: "vertical_arc", stageIndex, angleDeg, normalForceN,
        angularVelocityRadps: relativeSpeedMps / radius,
        normalDirection: { x: -direction * sin, y: cos },
        forceRole: normalForceN > 0 ? "support" : "none",
      },
    };
    const groove: MovableSemicircleReading = { grooveXM, grooveVX, relativeSpeedMps, angleDeg };
    return { sample, groove };
  }

  const start = stateAt(0, 0);
  const end = stateAt(endAngle, duration);
  return {
    duration, start, end, outcome,
    at(time: number) {
      if (time <= 0) return start;
      if (time >= duration) return end;
      let left = 0;
      let right = cells;
      while (right - left > 1) {
        const mid = (left + right) >> 1;
        if (times[mid] <= time) left = mid;
        else right = mid;
      }
      const base = left * step;
      let lo = base;
      let hi = right * step;
      for (let i = 0; i < 24; i += 1) {
        const mid = (lo + hi) / 2;
        if (times[left] + integrateAdaptive(dtDp, base, mid) < time) lo = mid;
        else hi = mid;
      }
      return stateAt(angleAt((lo + hi) / 2), time);
    },
  };
}
