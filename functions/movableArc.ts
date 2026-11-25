// 由 scripts/sync-functions.mjs 从 src/physics/movableArc.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
/**
 * 可动四分之一圆弧槽：槽静置光滑地面可自由滑动，球自槽顶相对地面静止释放。
 * 水平动量守恒 + 机械能守恒；出口解析 v = √(2gRM/(M+m))，槽速反向 = m v / M。
 *
 * 几何约定（与题面自洽）：槽顶边缘切线竖直，球由此立即下滑（若按"球在圆最高点、
 * 切线水平"参数化，释放为不稳定平衡，t(θ) 在 θ→0 对数发散、时长无定义）。
 * 取圆心 C = entry + (exitDirection·R, 0)，球相对槽心 rel(θ) = (−s·R·cosθ, −R·sinθ)，
 * θ∈[0, π/2]：θ=0 球在槽顶 entry，θ=π/2 球到槽底（下降 R），出口球速方向 = s。
 */

export type MovableArcStage = {
  kind: "movable_arc";
  radiusM: number;
  grooveMassKg: number;
  /** -1：球向左离槽、槽向右（默认）；1 反之。 */
  exitDirection?: -1 | 1;
};

export interface MovableArcSample {
  xM: number;
  yM: number;
  vxMps: number;
  vyMps: number;
  grooveXM: number;
  grooveVX: number;
}

export interface MovableArcSolution {
  durationSeconds: number;
  exit: MovableArcSample;
  maxSpeedMps: number;
  events: Array<{
    kind: "movable_arc_exit";
    timeSeconds: number;
    xM: number;
    yM: number;
    vxMps: number;
    vyMps: number;
    label: string;
    explanation: string;
  }>;
  at(t: number): MovableArcSample;
  geometry: {
    radiusM: number;
    grooveMassKg: number;
    exitDirection: -1 | 1;
    entryXM: number;
    entryYM: number;
  };
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
    geometry: { radiusM: R, grooveMassKg: M, exitDirection: s, entryXM: entry.xM, entryYM: entry.yM },
  };
}
