/**
 * 可动四分之一圆弧槽：槽静置光滑地面可自由滑动。
 * 1) 顶入模式（entryMode="top"，默认）：球自槽顶相对地面静止释放，水平动量守恒 + 机械能守恒；
 *    出口解析 v = √(2gRM/(M+m))，槽速反向 = m v / M。
 *    几何约定：圆心 C = entry + (exitDirection·R, 0)，球相对槽心 rel(θ) = (−s·R·cosθ, −R·sinθ)，
 *    θ∈[0, π/2]：θ=0 球在槽顶 entry，θ=π/2 球到槽底（下降 R），出口球速方向 = s。
 * 2) 底入模式（entryMode="bottom"）：球以水平初速 v0 从槽底切向进入初静止的槽，
 *    无量纲能量 e = (M/(m+M))·v0²/(gR)。e≤2 时在 φ_max=2·arcsin(√e/2)≤π/2 相对静止，
 *    随后对称下滑回槽底分离：v_ball = ((m−M)/(m+M))·v0，v_groove = (2m/(m+M))·v0，
 *    返回槽底瞬间支持力 N = mg + m·v0²/R。
 */

import { integrateAdaptive } from "./quadrature.ts";

export type MovableArcStage = {
  kind: "movable_arc";
  radiusM: number;
  grooveMassKg: number;
  /** "top"（默认）：从槽顶静止释放滑到底端离槽；"bottom"：从槽底切向进入、上升折返并返回槽底离槽。 */
  entryMode?: "top" | "bottom";
  /** 顶入模式：-1 球向左离槽、槽向右（默认）；1 反之。 */
  exitDirection?: -1 | 1;
  /** 底入模式：1 球向右入槽（默认），-1 向左入槽。 */
  entryDirection?: -1 | 1;
  /** 底入模式：true 表示题面给定「球恰好在槽顶相对静止」，可反求入槽速率 √(2(m+M)gR/M)。 */
  criticalTopRelativeRest?: true;
  /** 底入模式：槽底相对前段末位的水平间距（m，可选）。 */
  entryGapM?: number | null;
};

export interface MovableArcSample {
  xM: number;
  yM: number;
  vxMps: number;
  vyMps: number;
  grooveXM: number;
  grooveVX: number;
  normalForceN?: number;
  angleDeg?: number;
  relativeSpeedMps?: number;
}

export interface MovableArcSolution {
  durationSeconds: number;
  exit: MovableArcSample;
  maxSpeedMps: number;
  events: Array<{
    kind: "movable_arc_exit" | "movable_arc_top" | "movable_arc_return_exit" | "movable_arc_top_exit";
    timeSeconds: number;
    xM: number;
    yM: number;
    vxMps: number;
    vyMps: number;
    normalForceBeforeN?: number;
    normalForceAfterN?: number;
    label: string;
    explanation: string;
  }>;
  at(t: number): MovableArcSample;
  geometry: {
    radiusM: number;
    grooveMassKg: number;
    entryMode?: "top" | "bottom";
    exitDirection: -1 | 1;
    entryDirection?: -1 | 1;
    entryXM: number;
    entryYM: number;
    bottomReturnNormalForceN?: number | null;
  };
  outcome?: "top_release" | "critical_top_return" | "turn_return" | "top_exit";
  bottomReturnNormalForceN?: number | null;
}

/** 底入临界入槽速率：球恰好到达四分之一圆弧槽顶（φ=π/2）且与槽相对静止。 */
export function movableArcCriticalEntrySpeed(radiusM: number, ballMassKg: number, grooveMassKg: number, gravityMps2: number): number {
  return Math.sqrt((2 * (ballMassKg + grooveMassKg) * gravityMps2 * radiusM) / grooveMassKg);
}

const STEPS = 4000;

export function solveMovableArc(
  stage: MovableArcStage,
  entry: { xM: number; yM: number },
  ballMassKg: number,
  gravityMps2: number,
): MovableArcSolution {
  const R = stage.radiusM;
  const M = stage.grooveMassKg;
  const m = ballMassKg;
  const g = gravityMps2;
  const s: -1 | 1 = stage.exitDirection ?? -1;
  if (!Number.isFinite(R) || R <= 0) throw new RangeError("radiusM 须为正有限数。");
  if (!Number.isFinite(M) || M <= 0) throw new RangeError("grooveMassKg 须为正有限数。");
  if (!Number.isFinite(m) || m <= 0) throw new RangeError("ballMassKg 须为正有限数。");
  if (!Number.isFinite(g) || g <= 0) throw new RangeError("gravityMps2 须为正有限数。");
  if (!Number.isFinite(entry.xM) || !Number.isFinite(entry.yM)) throw new RangeError("entry 位置须为有限数。");
  if (s !== -1 && s !== 1) throw new RangeError("exitDirection 仅支持 -1 或 1。");

  const ratio = M / (m + M);
  const centerX = entry.xM + s * R;
  const centerY = entry.yM;
  const cmX = (m * entry.xM + M * centerX) / (m + M);

  /** θ̇(θ)：能量 m g R sinθ = ½ m R² θ̇² (cos²θ + ratio·sin²θ)。 */
  const thetaDot = (theta: number): number => {
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    if (sin <= 0) return 0;
    return Math.sqrt((2 * g * sin) / (R * (cos * cos + ratio * sin * sin)));
  };

  // 代换 θ = u² 消除 θ→0 处 dt/dθ ~ 1/√θ 的可积奇点，RK4 积 t(u)。
  const uMax = Math.sqrt(Math.PI / 2);
  const dtDu = (u: number): number => {
    if (u <= 1e-12) return Math.sqrt((2 * R) / g);
    return (2 * u) / thetaDot(u * u);
  };
  const thetas = new Float64Array(STEPS + 1);
  const times = new Float64Array(STEPS + 1);
  const h = uMax / STEPS;
  let u = 0;
  let t = 0;
  for (let i = 0; i < STEPS; i += 1) {
    const k1 = dtDu(u);
    const k2 = dtDu(u + h / 2);
    const k3 = dtDu(u + h / 2);
    const k4 = dtDu(u + h);
    t += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    u += h;
    thetas[i + 1] = u * u;
    times[i + 1] = t;
  }
  const duration = times[STEPS];

  const stateAt = (theta: number): MovableArcSample => {
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    const dot = thetaDot(theta);
    const relX = -s * R * cos;
    const relY = -R * sin;
    const grooveVX = -(m / (m + M)) * s * R * sin * dot;
    const grooveXM = cmX - (m / (m + M)) * relX;
    return {
      xM: grooveXM + relX,
      yM: centerY + relY,
      vxMps: s * R * sin * dot * ratio,
      vyMps: -R * cos * dot,
      grooveXM,
      grooveVX,
    };
  };

  const exitSpeed = Math.sqrt((2 * g * R * M) / (M + m));
  // 出口 θ=π/2：rel=(0,−R)，球与槽心横坐标都回到质心横坐标 cmX。
  const exit: MovableArcSample = {
    xM: cmX,
    yM: centerY - R,
    vxMps: s * exitSpeed,
    vyMps: 0,
    grooveXM: cmX,
    grooveVX: -s * (m / M) * exitSpeed,
  };

  const at = (time: number): MovableArcSample => {
    const q = Math.min(Math.max(time, 0), duration);
    let lo = 0;
    let hi = STEPS;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= q) lo = mid;
      else hi = mid;
    }
    const span = times[hi] - times[lo];
    const w = span > 0 ? (q - times[lo]) / span : 0;
    return stateAt(thetas[lo] + w * (thetas[hi] - thetas[lo]));
  };

  return {
    durationSeconds: duration,
    exit,
    maxSpeedMps: exitSpeed,
    events: [
      {
        kind: "movable_arc_exit",
        timeSeconds: duration,
        xM: exit.xM,
        yM: exit.yM,
        vxMps: exit.vxMps,
        vyMps: exit.vyMps,
        label: "球滑离槽底",
        explanation: `水平动量守恒与机械能守恒：球速 √(2gRM/(M+m)) = ${exitSpeed.toFixed(4)} m/s（${s === -1 ? "向左" : "向右"}），槽反向 ${((m / M) * exitSpeed).toFixed(4)} m/s。`,
      },
    ],
    at,
    geometry: { radiusM: R, grooveMassKg: M, entryMode: "top", exitDirection: s, entryXM: entry.xM, entryYM: entry.yM },
    outcome: "top_release",
    bottomReturnNormalForceN: null,
  };
}

/**
 * 底入可动四分之一圆弧槽：球以带符号水平速度 entryVxMps 从槽底切向进入初静止的槽。
 * e = (M/(m+M))·v0²/(gR)：
 * - e ≤ 2：上升至最高角 φ_max ≤ π/2 相对静止，随后对称下滑并返回槽底分离；
 * - e > 2：以正竖直分速从槽顶飞出。
 */
export function solveMovableArcBottom(
  stage: MovableArcStage,
  entry: { xM: number; yM: number },
  entryVxMps: number,
  ballMassKg: number,
  gravityMps2: number,
): MovableArcSolution {
  const R = stage.radiusM;
  const M = stage.grooveMassKg;
  const m = ballMassKg;
  const g = gravityMps2;
  if (!Number.isFinite(R) || R <= 0) throw new RangeError("radiusM 须为正有限数。");
  if (!Number.isFinite(M) || M <= 0) throw new RangeError("grooveMassKg 须为正有限数。");
  if (!Number.isFinite(m) || m <= 0) throw new RangeError("ballMassKg 须为正有限数。");
  if (!Number.isFinite(g) || g <= 0) throw new RangeError("gravityMps2 须为正有限数。");
  if (!Number.isFinite(entry.xM) || !Number.isFinite(entry.yM)) throw new RangeError("entry 位置须为有限数。");
  if (!Number.isFinite(entryVxMps) || entryVxMps === 0) throw new RangeError("底入可动圆弧槽需要非零水平入射速度。");

  const s: -1 | 1 = entryVxMps > 0 ? 1 : -1;
  const v0 = Math.abs(entryVxMps);
  const totalMass = m + M;
  const alpha = m / totalMass;
  const rho = M / totalMass;
  const speedUnit = Math.sqrt(g * R);
  const timeUnit = Math.sqrt(R / g);
  let energy = rho * (v0 / speedUnit) ** 2;
  if (Math.abs(energy - 2) <= 1e-10) energy = 2;

  const returnsToBottom = energy <= 2;
  const isCriticalTop = Math.abs(energy - 2) <= 1e-10;
  const k = Math.sqrt(Math.min(energy, 2)) / 2;
  const angleAtParam = (p: number) => returnsToBottom ? 2 * Math.asin(Math.min(1, k * Math.sin(p))) : p;
  const relSq = (phi: number) => {
    const sinHalf = Math.sin(phi / 2);
    return Math.max(0, energy - 4 * sinHalf * sinHalf) / (rho + alpha * Math.sin(phi) ** 2);
  };
  const dtDp = returnsToBottom
    ? (p: number) => {
      const phi = angleAtParam(p);
      return timeUnit * Math.sqrt((rho + alpha * Math.sin(phi) ** 2) / Math.max(1e-15, 1 - (k * Math.sin(p)) ** 2));
    }
    : (p: number) => timeUnit / Math.sqrt(Math.max(1e-15, relSq(p)));

  const cells = 64;
  const endParam = Math.PI / 2;
  const step = endParam / cells;
  const times = [0];
  for (let i = 0; i < cells; i += 1) {
    times.push(times[i] + integrateAdaptive(dtDp, i * step, (i + 1) * step));
  }
  const ascentDuration = times[cells];
  const duration = returnsToBottom ? 2 * ascentDuration : ascentDuration;
  if (!(duration > 0) || !Number.isFinite(duration)) throw new RangeError("底入可动圆弧槽时长无法表示。");

  const angleForAscentTime = (tau: number): number => {
    if (tau <= 0) return 0;
    if (tau >= ascentDuration) return angleAtParam(endParam);
    let left = 0;
    let right = cells;
    while (right - left > 1) {
      const mid = (left + right) >> 1;
      if (times[mid] <= tau) left = mid;
      else right = mid;
    }
    const base = left * step;
    let lo = base;
    let hi = right * step;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (times[left] + integrateAdaptive(dtDp, base, mid) < tau) lo = mid;
      else hi = mid;
    }
    return angleAtParam((lo + hi) / 2);
  };

  const buildSample = (t: number, phi: number, dir: 1 | -1, atPeak: boolean, atEndpoint: boolean): MovableArcSample => {
    const sin = Math.abs(phi - Math.PI / 2) <= 1e-12 ? 1 : Math.abs(phi) <= 1e-12 ? 0 : Math.sin(phi);
    const cos = Math.abs(phi - Math.PI / 2) <= 1e-12 ? 0 : Math.abs(phi) <= 1e-12 ? 1 : Math.cos(phi);
    const vRelMag = atPeak && returnsToBottom ? 0
      : atEndpoint && returnsToBottom ? v0
      : speedUnit * Math.sqrt(relSq(phi));
    const vRel = dir * vRelMag;
    const grooveXM = entry.xM + alpha * s * (v0 * t - R * sin);
    const grooveVX = alpha * s * (v0 - vRel * cos);
    const xM = grooveXM + s * R * sin;
    const yM = entry.yM + R * (1 - cos);
    const vxMps = grooveVX + s * vRel * cos;
    const vyMps = vRel * sin;
    const normalForceN = (m * (vRel * vRel / R + g * cos)) / (1 + (m / M) * sin * sin);
    return {
      xM,
      yM,
      vxMps: Math.abs(vxMps) < 1e-14 ? 0 : vxMps,
      vyMps: Math.abs(vyMps) < 1e-14 ? 0 : vyMps,
      grooveXM,
      grooveVX: Math.abs(grooveVX) < 1e-14 ? 0 : grooveVX,
      normalForceN,
      angleDeg: (phi * 180) / Math.PI,
      relativeSpeedMps: vRel,
    };
  };

  const at = (time: number): MovableArcSample => {
    const q = Math.min(Math.max(time, 0), duration);
    if (q === 0) return buildSample(0, 0, 1, false, true);
    if (returnsToBottom) {
      if (q === duration) return buildSample(duration, 0, -1, false, true);
      if (Math.abs(q - ascentDuration) <= 1e-13) return buildSample(ascentDuration, angleAtParam(endParam), 1, true, false);
      if (q < ascentDuration) return buildSample(q, angleForAscentTime(q), 1, false, false);
      return buildSample(q, angleForAscentTime(duration - q), -1, false, false);
    }
    if (q === duration) return buildSample(duration, Math.PI / 2, 1, false, true);
    return buildSample(q, angleForAscentTime(q), 1, false, false);
  };

  const peak = buildSample(ascentDuration, angleAtParam(endParam), 1, returnsToBottom, !returnsToBottom);
  const exit = at(duration);
  const bottomReturnNormalForceN = returnsToBottom ? m * (g + (v0 * v0) / R) : null;
  const events: MovableArcSolution["events"] = returnsToBottom
    ? [
      {
        kind: "movable_arc_top",
        timeSeconds: ascentDuration,
        xM: peak.xM,
        yM: peak.yM,
        vxMps: peak.vxMps,
        vyMps: peak.vyMps,
        normalForceBeforeN: peak.normalForceN,
        normalForceAfterN: peak.normalForceN,
        label: isCriticalTop ? "球到达槽顶相对静止" : "球在槽内到达最高点",
        explanation: isCriticalTop
          ? `水平动量守恒：球恰好升至四分之一圆弧槽顶（h = R = ${R} m）并与槽共速 v共 = ${peak.vxMps.toFixed(4)} m/s，随后沿槽对称滑回。`
          : `水平动量与机械能守恒：球在槽内升至最高点（φ = ${peak.angleDeg!.toFixed(2)}°）并与槽共速 v共 = ${peak.vxMps.toFixed(4)} m/s，随后滑回槽底。`,
      },
      {
        kind: "movable_arc_return_exit",
        timeSeconds: duration,
        xM: exit.xM,
        yM: exit.yM,
        vxMps: exit.vxMps,
        vyMps: exit.vyMps,
        normalForceBeforeN: bottomReturnNormalForceN!,
        normalForceAfterN: m * g,
        label: "球返回槽底分离",
        explanation: `球对称滑回槽底并首次分离：v球 = ${exit.vxMps.toFixed(4)} m/s，v槽 = ${exit.grooveVX.toFixed(4)} m/s；返回槽底瞬间对槽的压力 N = mg + m v₀²/R = ${bottomReturnNormalForceN!.toFixed(4)} N。`,
      },
    ]
    : [
      {
        kind: "movable_arc_top_exit",
        timeSeconds: duration,
        xM: exit.xM,
        yM: exit.yM,
        vxMps: exit.vxMps,
        vyMps: exit.vyMps,
        normalForceBeforeN: exit.normalForceN,
        normalForceAfterN: 0,
        label: "球从槽顶飞出",
        explanation: `入槽动能超过临界值，球到达槽顶（h = R = ${R} m）时仍有向上相对速度 vy = ${exit.vyMps.toFixed(4)} m/s，水平速度与槽相同 vx = ${exit.vxMps.toFixed(4)} m/s。`,
      },
    ];

  return {
    durationSeconds: duration,
    exit,
    maxSpeedMps: v0,
    events,
    at,
    geometry: {
      radiusM: R,
      grooveMassKg: M,
      entryMode: "bottom",
      exitDirection: (s === 1 ? -1 : 1) as -1 | 1,
      entryDirection: s,
      entryXM: entry.xM,
      entryYM: entry.yM,
      bottomReturnNormalForceN,
    },
    outcome: returnsToBottom ? (isCriticalTop ? "critical_top_return" : "turn_return") : "top_exit",
    bottomReturnNormalForceN,
  };
}
