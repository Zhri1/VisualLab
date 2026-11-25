// 由 scripts/sync-functions.mjs 从 src/physics/springPair.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
/**
 * 弹簧双球（自由弹簧，不锚墙）：m1 以 u 水平匀速走完 gap 后接触 m2 右侧的轻质自由弹簧，
 * 压缩 → 共速 → 恢复 → 分离；地面光滑、弹性无耗散。相对坐标为简谐：ω = √(k/μ)。
 * 接触段时长 = π/ω（半周期）；压缩量 x(τ) = (u/ω)·sin(ωτ)。
 * 若未给 m2 但给定分离速率 s（0<s<u，m1 反向弹回）：反求 m2 = m1(u+s)/(u−s)。
 *
 * 符号约定：与 entry.vxMps 同向为正；点质量 + 零自然长度弹簧模型，
 * compressionM 即两球间距的闭合量（x2−x1 沿运动方向的投影取反）。
 */

export type SpringPairStage = {
  kind: "spring_pair";
  targetMassKg?: number | null;
  springConstantNpm: number;
  gapM?: number | null;
  separationSpeedMps?: number | null;
};

export interface SpringPairSample {
  x1M: number;
  y1M: number;
  vx1Mps: number;
  x2M: number;
  vx2Mps: number;
  compressionM: number;
}

export interface SpringPairSolution {
  durationSeconds: number;
  mass2Kg: number;
  maxElasticJ: number;
  commonVelocityMps: number;
  separation: { vx1Mps: number; vx2Mps: number };
  events: Array<{
    kind: "spring_pair_contact" | "spring_pair_max_compression" | "spring_pair_separate";
    timeSeconds: number;
    xM: number;
    yM: number;
    vxMps: number;
    vyMps: number;
    label: string;
    explanation: string;
  }>;
  at(t: number): SpringPairSample;
  geometry: { gapM: number; springConstantNpm: number; mass2Kg: number; targetEntryXM: number };
}

export function solveSpringPair(
  stage: SpringPairStage,
  entry: { xM: number; yM: number; vxMps: number },
  ballMassKg: number,
): SpringPairSolution {
  const m1 = ballMassKg;
  const k = stage.springConstantNpm;
  const gap = stage.gapM ?? 0.5;
  const u = Math.abs(entry.vxMps);
  const d = entry.vxMps >= 0 ? 1 : -1;
  if (!Number.isFinite(m1) || m1 <= 0) throw new RangeError("ballMassKg 须为正有限数。");
  if (!Number.isFinite(k) || k <= 0) throw new RangeError("springConstantNpm 须为正有限数。");
  if (!Number.isFinite(gap) || gap < 0) throw new RangeError("gapM 须为非负有限数。");
  if (!Number.isFinite(u) || u <= 0) throw new RangeError("entry.vxMps 须非零。");
  if (!Number.isFinite(entry.xM) || !Number.isFinite(entry.yM)) throw new RangeError("entry 位置须为有限数。");

  let m2: number;
  const givenM2 = stage.targetMassKg;
  const s = stage.separationSpeedMps;
  if (givenM2 == null) {
    if (s == null) throw new RangeError("targetMassKg 与 separationSpeedMps 至少给定其一。");
    if (!Number.isFinite(s) || s <= 0 || s >= u) throw new RangeError("separationSpeedMps 须满足 0 < s < u。");
    m2 = (m1 * (u + s)) / (u - s);
  } else {
    if (!Number.isFinite(givenM2) || givenM2 <= 0) throw new RangeError("targetMassKg 须为正有限数。");
    m2 = givenM2;
  }

  const mu = (m1 * m2) / (m1 + m2);
  const omega = Math.sqrt(k / mu);
  const contactTime = gap / u;
  const halfPeriod = Math.PI / omega;
  const duration = contactTime + halfPeriod;
  const vc = (m1 * u) / (m1 + m2);
  const maxElastic = 0.5 * m1 * u * u - 0.5 * (m1 + m2) * vc * vc;
  const sep1 = ((m1 - m2) * u) / (m1 + m2);
  const sep2 = (2 * m1 * u) / (m1 + m2);
  const targetEntryXM = entry.xM + d * gap;
  const amp = u / omega;

  const at = (time: number): SpringPairSample => {
    const q = Math.min(Math.max(time, 0), duration);
    if (q <= contactTime) {
      return {
        x1M: entry.xM + d * u * q,
        y1M: entry.yM,
        vx1Mps: d * u,
        x2M: targetEntryXM,
        vx2Mps: 0,
        compressionM: 0,
      };
    }
    const tau = q - contactTime;
    if (tau >= halfPeriod) {
      const extra = tau - halfPeriod;
      // τ=π/ω 时 sin(ωτ)=0：分离点即共速漂移终点。
      const x1c = targetEntryXM + d * vc * halfPeriod;
      const x2c = targetEntryXM + d * vc * halfPeriod;
      return {
        x1M: x1c + d * sep1 * extra,
        y1M: entry.yM,
        vx1Mps: d * sep1,
        x2M: x2c + d * sep2 * extra,
        vx2Mps: d * sep2,
        compressionM: 0,
      };
    }
    const sn = Math.sin(omega * tau);
    const cs = Math.cos(omega * tau);
    const compression = amp * sn;
    return {
      x1M: targetEntryXM + d * (vc * tau + (m2 / (m1 + m2)) * amp * sn),
      y1M: entry.yM,
      vx1Mps: d * (vc + (m2 / (m1 + m2)) * u * cs),
      x2M: targetEntryXM + d * (vc * tau - (m1 / (m1 + m2)) * amp * sn),
      vx2Mps: d * (vc - (m1 / (m1 + m2)) * u * cs),
      compressionM: compression,
    };
  };

  const maxAt = at(contactTime + halfPeriod / 2);
  const sepAt = at(duration);
  return {
    durationSeconds: duration,
    mass2Kg: m2,
    maxElasticJ: maxElastic,
    commonVelocityMps: vc,
    separation: { vx1Mps: d * sep1, vx2Mps: d * sep2 },
    events: [
      {
        kind: "spring_pair_contact",
        timeSeconds: contactTime,
        xM: targetEntryXM,
        yM: entry.yM,
        vxMps: d * u,
        vyMps: 0,
        label: "接触弹簧",
        explanation: `m1 匀速走完 ${gap.toFixed(4)} m 后接触自由弹簧，开始压缩。`,
      },
      {
        kind: "spring_pair_max_compression",
        timeSeconds: contactTime + halfPeriod / 2,
        xM: maxAt.x1M,
        yM: entry.yM,
        vxMps: d * vc,
        vyMps: 0,
        label: "共速·压缩最大",
        explanation: `两球共速 ${vc.toFixed(4)} m/s，弹性势能最大 ${maxElastic.toFixed(4)} J。`,
      },
      {
        kind: "spring_pair_separate",
        timeSeconds: duration,
        xM: sepAt.x1M,
        yM: entry.yM,
        vxMps: d * sep1,
        vyMps: 0,
        label: "恢复原长·分离",
        explanation: `弹簧恢复原长后分离：v1 = ${ (d * sep1).toFixed(4)} m/s，v2 = ${(d * sep2).toFixed(4)} m/s。`,
      },
    ],
    at,
    geometry: { gapM: gap, springConstantNpm: k, mass2Kg: m2, targetEntryXM },
  };
}
