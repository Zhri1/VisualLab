// 由 scripts/sync-functions.mjs 从 src/physics/roughSpring.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
// 粗糙水平面上的弹簧接触：压缩段、回弹段的闭式解。公式见 ROUGH_SPRING_CONTACT.md 第 2 节。
export type RoughSpringInput = {
  speedMps: number; massKg: number; gravityMps2: number; springConstantNpm: number;
  kineticFrictionCoefficient: number;
  staticFrictionCoefficient?: number | null;
  reboundAtMaxCompression?: boolean | null;
};
export type RoughSpringOutcome = "hold_max" | "stop_natural" | "stop_residual" | "detach";
export type RoughSpring = {
  outcome: RoughSpringOutcome;
  omega: number; equilibriumM: number; maxCompressionM: number;
  compressSeconds: number; reboundSeconds: number; durationSeconds: number;
  finalCompressionM: number; detachSpeedMps: number;
  frictionForceN: number; holdBasis: "static_coefficient" | "given_fact";
  /** 时间 t（0 起）的压缩量、向右速度（压缩方向为正）。 */
  stateAt(t: number): { compressionM: number; vxMps: number };
  /** 到时间 t 为止的路程。 */
  pathAt(t: number): number;
};
export type RoughSpringConflict = { conflict: string; path: string };

export function solveRoughSpring(input: RoughSpringInput): RoughSpring | RoughSpringConflict {
  const { speedMps: v0, massKg: m, gravityMps2: g, springConstantNpm: k, kineticFrictionCoefficient: muK } = input;
  const omega = Math.sqrt(k / m), force = muK * m * g, xe = force / k;
  const a = v0 / omega;
  const xmax = Math.hypot(a, xe) - xe;
  const compressSeconds = Math.atan2(a, xe) / omega;
  const springForce = k * xmax, slack = 1 + 64 * Number.EPSILON;
  const mus = input.staticFrictionCoefficient;
  let holds: boolean, basis: RoughSpring["holdBasis"];
  if (typeof mus === "number") {
    basis = "static_coefficient";
    holds = springForce <= mus * m * g * slack;
    if (typeof input.reboundAtMaxCompression === "boolean" && input.reboundAtMaxCompression === holds) {
      return { conflict: "题给回弹事实与静摩擦上限的判断相反。", path: "/reboundAtMaxCompression" };
    }
  } else {
    basis = "given_fact";
    holds = input.reboundAtMaxCompression === false;
    if (!holds && springForce <= force * slack) return { conflict: "此时合力仍指向压缩方向，不可能从最大压缩回弹。", path: "/reboundAtMaxCompression" };
  }
  const base = { omega, equilibriumM: xe, maxCompressionM: xmax, compressSeconds, frictionForceN: force, holdBasis: basis };
  const compress = (t: number) => {
    const phase = omega * t;
    return { compressionM: -xe + xe * Math.cos(phase) + a * Math.sin(phase), vxMps: -xe * omega * Math.sin(phase) + v0 * Math.cos(phase) };
  };
  if (holds) {
    return { ...base, outcome: "hold_max", reboundSeconds: 0, durationSeconds: compressSeconds, finalCompressionM: xmax, detachSpeedMps: 0,
      stateAt: (t) => t <= 0 ? { compressionM: 0, vxMps: v0 } : t >= compressSeconds ? { compressionM: xmax, vxMps: 0 } : compress(t),
      pathAt: (t) => t <= 0 ? 0 : t >= compressSeconds ? xmax : compress(t).compressionM };
  }
  const D = xmax - xe, x2 = 2 * xe - xmax;
  const tolerance = 64 * Number.EPSILON * Math.max(xmax, xe);
  const rebound = (tau: number) => ({ compressionM: xe + D * Math.cos(omega * tau), vxMps: -D * omega * Math.sin(omega * tau) });
  let outcome: RoughSpringOutcome, reboundSeconds: number, finalCompressionM: number, detachSpeedMps = 0;
  if (x2 < -tolerance) {
    outcome = "detach"; reboundSeconds = Math.acos(-xe / D) / omega; finalCompressionM = 0;
    detachSpeedMps = -D * omega * Math.sin(omega * reboundSeconds);
  } else if (x2 <= tolerance) {
    outcome = "stop_natural"; reboundSeconds = Math.PI / omega; finalCompressionM = 0;
  } else {
    outcome = "stop_residual"; reboundSeconds = Math.PI / omega; finalCompressionM = x2;
  }
  const endState = { compressionM: finalCompressionM, vxMps: detachSpeedMps };
  return { ...base, outcome, reboundSeconds, durationSeconds: compressSeconds + reboundSeconds, finalCompressionM, detachSpeedMps,
    stateAt(t) {
      if (t <= 0) return { compressionM: 0, vxMps: v0 };
      if (t <= compressSeconds) return compress(t);
      if (t >= compressSeconds + reboundSeconds) return { ...endState };
      return rebound(t - compressSeconds);
    },
    pathAt(t) {
      if (t <= 0) return 0;
      if (t <= compressSeconds) return compress(t).compressionM;
      const x = t >= compressSeconds + reboundSeconds ? finalCompressionM : rebound(t - compressSeconds).compressionM;
      return 2 * xmax - x;
    } };
}
