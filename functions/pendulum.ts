// 由 scripts/sync-functions.mjs 从 src/physics/pendulum.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
import { integrate } from './quadrature.ts';
import { linearState } from './kinematics.ts';
import type { PendulumEnd, BodyState, PegConfig } from './multiBodyTypes.ts';

export type PendulumSample = {
  xM: number; yM: number; vxMps: number; vyMps: number; springCompressionM: number;
  stringState: 'taut' | 'slack'; tensionN: number; angleRad?: number; angularVelocityRadps?: number;
  status: BodyState['status'];
};
export type PendulumEvent = { time: number; kind: string; before: PendulumSample; after: PendulumSample };

// 为单调积分建立小表，取样时只反演一个格子；不按动画帧积分，不累积能量漂移。
function integralTable(f: (x: number) => number, end: number) {
  const n = 96, h = end / n, sums = [0];
  for (let i = 0; i < n; i++) sums.push(sums[i] + integrate(f, i * h, (i + 1) * h));
  const total = sums[n];
  if (!(total > 0) || !Number.isFinite(total)) throw new RangeError('摆动时间的数值量级无法表示。');
  return { total, inverse(value: number) {
    if (value <= 0) return 0;
    if (value >= total) return end;
    let a = 0, b = n;
    while (b - a > 1) { const m = (a + b) >>> 1; if (sums[m] <= value) a = m; else b = m; }
    const origin = a * h;
    let lo = origin, hi = (a + 1) * h;
    for (let j = 0; j < 42; j++) { const mid = (lo + hi) / 2; if (sums[a] + integrate(f, origin, mid) < value) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  } };
}
const near = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 16 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
const trig = (a: number) => {
  const quarter = Math.round(a / (Math.PI / 2));
  if (near(a, quarter * Math.PI / 2)) return { sin: [0, 1, 0, -1][((quarter % 4) + 4) % 4], cos: [1, 0, -1, 0][((quarter % 4) + 4) % 4] };
  return { sin: Math.sin(a), cos: Math.cos(a) };
};

export function createPendulum(lengthM: number, gravity: number, mass: number, initialAngleRad: number, initialQ: number, continueSlack: boolean) {
  const L = lengthM, g = gravity, scale = Math.sqrt(L / g), energySpeed = Math.sqrt(g * L);
  if (![L, g, mass, initialAngleRad, initialQ, scale, energySpeed].every(Number.isFinite) || Math.min(L, g, mass, scale, energySpeed) <= 0) throw new RangeError('摆长、质量或重力数值量级无法表示。');
  const constrained = (angle: number, q: number, turning = false): PendulumSample => {
    const { sin, cos } = trig(angle), force = mass * (q * q / L + g * cos);
    return { xM: L * sin, yM: L * (1 - cos), vxMps: q * cos || 0, vyMps: q * sin || 0, springCompressionM: 0,
      stringState: 'taut', tensionN: Math.max(0, force), angleRad: angle, angularVelocityRadps: q / L,
      status: turning ? 'turning' : q === 0 && angle === 0 ? 'resting' : 'moving' };
  };
  const initial = constrained(initialAngleRad, initialQ);
  const initiallySlack = initialQ * initialQ / L + g * trig(initialAngleRad).cos < 0;
  let ratio = (initialQ / energySpeed) ** 2;
  if (!Number.isFinite(ratio) || !Number.isFinite(initial.tensionN)) throw new RangeError('摆的能量比或张力量级无法表示。');
  for (const r of [2, 4, 5]) if (near(ratio, r)) ratio = r;
  const equilibrium = initialAngleRad === 0 && initialQ === 0;
  const loses = !initiallySlack && initialAngleRad === 0 && ratio > 2 && ratio < 5;
  const rotation = initialAngleRad === 0 && ratio >= 5;
  let quarterTime = Infinity, cycle = Infinity, phaseStart = 0, lossTime = Infinity;
  let atConstrained: (t: number) => PendulumSample = () => initial;
  let loss = { ...initial };
  const direction = Math.sign(initialQ) || 1;
  if (!initiallySlack && !equilibrium) {
    if (loses) {
      const phi = Math.acos((2 - ratio) / 3);
      // 接触丢失先于转折，积分上限有正速度，r=4也没有端点奇异性。
      const transformed = ratio < 4, k = Math.sqrt(ratio) / 2;
      const end = transformed ? Math.asin(Math.min(1, Math.sin(phi / 2) / k)) : phi;
      const table = integralTable(transformed ? p => 1 / Math.sqrt(1 - k * k * Math.sin(p) ** 2) : a => 1 / Math.sqrt(ratio - 4 * Math.sin(a / 2) ** 2), end);
      lossTime = scale * table.total;
      const q = direction * energySpeed * Math.sqrt(-Math.cos(phi));
      loss = { ...constrained(direction * phi, q), tensionN: 0 };
      atConstrained = t => {
        if (t >= lossTime || near(t, lossTime)) return { ...loss };
        const p = table.inverse(t / scale), a = transformed ? 2 * Math.asin(k * Math.sin(p)) : p;
        const qNow = direction * energySpeed * Math.sqrt(Math.max(0, ratio - 4 * Math.sin(a / 2) ** 2));
        return constrained(direction * a, qNow);
      };
    } else if (rotation) {
      const table = integralTable(a => 1 / Math.sqrt(ratio - 4 * Math.sin(a / 2) ** 2), 2 * Math.PI);
      cycle = scale * table.total;
      atConstrained = t => {
        let turns = Math.floor(t / cycle), remaining = t - turns * cycle;
        if (near(remaining, cycle)) { turns++; remaining = 0; }
        const a = table.inverse(remaining / scale) + turns * 2 * Math.PI;
        return constrained(direction * a, direction * energySpeed * Math.sqrt(Math.max(0, ratio - 4 * Math.sin(a / 2) ** 2)));
      };
    } else {
      const k = initialAngleRad === 0 ? Math.sqrt(ratio) / 2 : Math.sin(Math.abs(initialAngleRad) / 2);
      const table = integralTable(p => 1 / Math.sqrt(1 - k * k * Math.sin(p) ** 2), Math.PI / 2);
      quarterTime = scale * table.total; cycle = 4 * quarterTime;
      phaseStart = initialAngleRad < 0 ? 3 : initialAngleRad > 0 ? 1 : initialQ < 0 ? 2 : 0;
      atConstrained = t => {
        let phase = (phaseStart + t / quarterTime) % 4;
        const boundary = Math.round(phase);
        if (near(phase, boundary)) phase = boundary % 4;
        const cell = Math.floor(phase), local = phase - cell;
        const ascending = cell === 0 || cell === 2;
        const p = table.inverse((ascending ? local : 1 - local) * table.total);
        const signAngle = cell < 2 ? 1 : -1, signQ = cell === 0 || cell === 3 ? 1 : -1;
        const angle = signAngle * 2 * Math.asin(k * Math.sin(p));
        const isTurn = phase === 1 || phase === 3;
        const q = isTurn ? 0 : signQ * 2 * energySpeed * k * Math.cos(p);
        return constrained(angle, q, isTurn);
      };
    }
  }
  if (initiallySlack) { lossTime = 0; loss = { ...initial, stringState: 'slack', tensionN: 0, status: 'moving' }; delete loss.angleRad; delete loss.angularVelocityRadps; }
  const hasLoss = initiallySlack || loses;
  const flightTime = !hasLoss ? Infinity : initiallySlack ? 2 * Math.sqrt(-L * trig(initialAngleRad).cos / g) : 4 * loss.vyMps / g;
  const limit = hasLoss ? lossTime + (continueSlack ? flightTime : 0) : Infinity;
  const limitKind = continueSlack ? 'string_retaut_boundary' : 'string_slack';
  const at = (t: number): PendulumSample => {
    t = Math.max(0, Math.min(limit, t));
    if (t === 0 && !initiallySlack) return { ...initial };
    if (!hasLoss || t < lossTime) return atConstrained(t);
    const elapsed = t - lossTime;
    return { ...linearState(loss.xM, loss.yM, loss.vxMps, loss.vyMps, 0, -g, elapsed), stringState: 'slack', tensionN: 0,
      status: continueSlack && t === limit ? 'model_boundary' : 'moving' };
  };
  const firstTurn = equilibrium ? 0 : hasLoss || rotation ? Infinity : quarterTime * (initialAngleRad === 0 ? 1 : 2);
  const firstLowest = initialAngleRad === 0 ? 0 : initiallySlack ? Infinity : quarterTime;
  const firstReturn = rotation ? cycle : Number.isFinite(quarterTime) ? (initialAngleRad === 0 ? 2 : 3) * quarterTime : Infinity;
  function endTime(kind: PendulumEnd) {
    const requested = equilibrium ? 0 : kind === 'lowest_point' ? firstLowest : kind === 'first_turn' ? firstTurn : kind === 'first_return_lowest' ? firstReturn : Infinity;
    return Math.min(requested, limit);
  }
  function eventsUntil(duration: number): PendulumEvent[] {
    const events: PendulumEvent[] = [];
    const add = (time: number, kind: string, before = at(time), after = at(time)) => {
      if (time <= duration) events.push({ time, kind, before, after });
    };
    if (Number.isFinite(quarterTime)) {
      const count = Math.floor(phaseStart + duration / quarterTime + 32 * Number.EPSILON);
      if (count > 100000) throw new RangeError('给定范围包含过多摆动事件，请缩短播放范围。');
      for (let n = phaseStart + 1; n <= count; n++) {
        const t = (n - phaseStart) * quarterTime;
        add(t, n % 2 ? 'pendulum_turn' : 'pendulum_lowest');
      }
    } else if (rotation) {
      const count = Math.floor(duration / cycle + 32 * Number.EPSILON);
      if (count > 100000) throw new RangeError('给定范围包含过多绕行事件。');
      for (let n = 1; n <= count; n++) add(n * cycle, 'pendulum_lowest');
    }
    if (hasLoss) {
      add(lossTime, 'string_slack', loss, at(lossTime));
      if (continueSlack) {
        add(lossTime, 'projectile_launch');
        const apex = loss.vyMps / g;
        if (apex > 0 && apex < flightTime) add(lossTime + apex, 'apex');
        add(limit, 'string_retaut_boundary');
      }
    }
    return events.sort((a, b) => a.time - b.time);
  }
  return { initial: at(0), initiallySlack, equilibrium, limit, limitKind, lossTime, loss, firstTurn, firstLowest, endTime, at, eventsUntil };
}

export type PegPendulumResult = ReturnType<typeof createPendulum> & {
  pegHitTime: number;
  pegTopTime: number;
  pegOffsetXM: number;
  pegEffectiveLengthM: number;
  pegSideSign: 1 | -1;
  derivedPegOffsetXM?: number;
  pegSpeedMps?: number;
  pegTopSpeedMps?: number;
  pegTopTensionN?: number;
  pivotOffsetAt: (t: number) => number;
  activeLengthAt: (t: number) => number;
};

/**
 * 带单个同高水平侧向钉子的轻绳摆（从最低点 θ = 0 以带符号切向速度 initialQ 出发）：
 * - 摆至水平位置（θ = ±90°）时碰钉，位置与速度保持连续，支点切至钉子 P、半径缩为 r = L - OP；
 * - 若 peg.criticalTopNonSlack 为 true 且 offsetXM 为 null，反求恰好过钉子正上方最高点（T_top = 0）的最小 OP；
 * - 若 OP 小于临界值，绳在到达顶点前于 sin(u) = v_peg²/(3gr) 处如实松弛（string_slack），绝不画到顶点。
 */
export function createPegPendulum(
  lengthM: number,
  gravity: number,
  mass: number,
  initialQ: number,
  pegSpec: PegConfig,
  continueSlack: boolean,
): PegPendulumResult {
  const L = lengthM, g = gravity;
  const s: 1 | -1 = pegSpec.side === 'right' ? 1 : -1;
  const scale = Math.sqrt(L / g), energySpeed = Math.sqrt(g * L);
  if (![L, g, mass, initialQ, scale, energySpeed].every(Number.isFinite) || Math.min(L, g, mass, scale, energySpeed) <= 0) {
    throw new RangeError('摆长、质量或重力数值量级无法表示。');
  }
  const ratio = (initialQ / energySpeed) ** 2;
  const swingsTowardPeg = initialQ * s > 0;
  const reachesHorizontal = swingsTowardPeg && ratio > 2 + 16 * Number.EPSILON;

  // 若未朝向钉子或能量不足以到达水平位置（θ = ±90°），则不发生绕钉运动，退化为普通摆
  if (!reachesHorizontal) {
    if (pegSpec.criticalTopNonSlack && pegSpec.offsetXM == null) {
      throw new Error('PENDULUM_CANNOT_REACH_PEG');
    }
    const base = createPendulum(L, g, mass, 0, initialQ, continueSlack);
    const d = pegSpec.offsetXM ?? 0;
    return {
      ...base,
      pegHitTime: Infinity,
      pegTopTime: Infinity,
      pegOffsetXM: d,
      pegEffectiveLengthM: L - d,
      pegSideSign: s,
      pivotOffsetAt: () => 0,
      activeLengthAt: () => L,
    };
  }

  // 第一段：绕 O(0, L) 从 θ = 0 摆至 θ = s * π/2（绳水平）
  const vPegSq = initialQ * initialQ - 2 * g * L;
  const vPeg = Math.sqrt(vPegSq);
  const preTable = integralTable(a => 1 / Math.sqrt(ratio - 4 * Math.sin(a / 2) ** 2), Math.PI / 2);
  const pegHitTime = scale * preTable.total;

  // 确定钉距 d = OP 与碰钉后有效摆长 r = L - d
  let d: number;
  let derivedPegOffsetXM: number | undefined;
  if (pegSpec.offsetXM != null) {
    d = pegSpec.offsetXM;
    if (!(d > 0 && d < L)) throw new RangeError('钉距 OP 须满足 0 < OP < L。');
    if (pegSpec.criticalTopNonSlack) {
      const expected = L - vPegSq / (3 * g);
      if (Math.abs(d - expected) > 1e-6 * Math.max(1, L)) {
        throw new Error('PEG_OFFSET_CONFLICT');
      }
    }
  } else {
    const rMax = vPegSq / (3 * g);
    if (!(rMax > 0 && rMax < L)) {
      throw new Error(rMax >= L ? 'PEG_NOT_NEEDED' : 'PENDULUM_CANNOT_REACH_PEG');
    }
    d = L - rMax;
    derivedPegOffsetXM = d;
  }
  const r = L - d;
  const scaleR = Math.sqrt(r / g);
  let rho = vPegSq / (g * r);
  if (near(rho, 3)) rho = 3;

  const preConstrained = (angle: number, q: number): PendulumSample => {
    const { sin, cos } = trig(angle);
    const force = mass * (q * q / L + g * cos);
    return {
      xM: L * sin,
      yM: L * (1 - cos),
      vxMps: q * cos || 0,
      vyMps: q * sin || 0,
      springCompressionM: 0,
      stringState: 'taut',
      tensionN: Math.max(0, force),
      angleRad: angle,
      angularVelocityRadps: q / L,
      status: 'moving',
    };
  };

  const postConstrained = (u: number): PendulumSample => {
    const { sin: sinU, cos: cosU } = trig(u);
    const qSq = Math.max(0, vPegSq - 2 * g * r * sinU);
    const q = Math.sqrt(qSq);
    const force = mass * (qSq / r - g * sinU);
    return {
      xM: s * d + s * r * cosU,
      yM: L + r * sinU,
      vxMps: -s * q * sinU || 0,
      vyMps: q * cosU || 0,
      springCompressionM: 0,
      stringState: 'taut',
      tensionN: Math.max(0, force),
      angleRad: s * (Math.PI / 2 + u),
      angularVelocityRadps: s * q / r,
      status: 'moving',
    };
  };

  const initial = preConstrained(0, initialQ);
  const pegBefore = preConstrained(s * Math.PI / 2, s * vPeg);
  const pegAfter = postConstrained(0);

  let pegTopTime = Infinity;
  let pegTopSpeedMps: number | undefined;
  let pegTopTensionN: number | undefined;
  let lossTime = Infinity;
  let loss: PendulumSample = { ...pegAfter };
  let limit = Infinity;
  let limitKind: 'string_retaut_boundary' | 'string_slack' = continueSlack ? 'string_retaut_boundary' : 'string_slack';
  let flightTime = Infinity;
  let postAtConstrained: (tau: number) => PendulumSample;

  if (rho >= 3) {
    // 能量足够：无松弛通过钉子正上方最高点（u = π/2），之后可继续沿新半径 r 绕 P 旋转
    const topTable = integralTable(u => 1 / Math.sqrt(rho - 2 * Math.sin(u)), Math.PI / 2);
    const fullTable = integralTable(u => 1 / Math.sqrt(rho - 2 * Math.sin(u)), 2 * Math.PI);
    pegTopTime = pegHitTime + scaleR * topTable.total;
    const topSample = postConstrained(Math.PI / 2);
    pegTopSpeedMps = Math.hypot(topSample.vxMps, topSample.vyMps);
    pegTopTensionN = topSample.tensionN;
    const postCycle = scaleR * fullTable.total;
    postAtConstrained = (tau: number) => {
      if (tau <= 0) return { ...pegAfter };
      if (near(tau, pegTopTime - pegHitTime)) return postConstrained(Math.PI / 2);
      const rem = tau % postCycle;
      const u = fullTable.inverse(rem / scaleR);
      return postConstrained(u);
    };
  } else {
    // 能量不足（OP < OP_min）：在到达顶点前于 sin(uSlack) = rho/3 处张力归零并松弛
    const uSlack = Math.asin(Math.min(1, Math.max(0, rho / 3)));
    const slackTable = integralTable(u => 1 / Math.sqrt(rho - 2 * Math.sin(u)), uSlack);
    lossTime = pegHitTime + scaleR * slackTable.total;
    loss = { ...postConstrained(uSlack), tensionN: 0 };
    flightTime = 4 * loss.vyMps / g;
    limit = lossTime + (continueSlack ? flightTime : 0);
    postAtConstrained = (tau: number) => {
      if (tau <= 0) return { ...pegAfter };
      if (tau >= lossTime - pegHitTime || near(tau, lossTime - pegHitTime)) return { ...loss };
      const u = slackTable.inverse(tau / scaleR);
      return postConstrained(u);
    };
  }

  const at = (t: number): PendulumSample => {
    t = Math.max(0, Math.min(limit, t));
    if (t === 0) return { ...initial };
    if (t < pegHitTime && !near(t, pegHitTime)) {
      const a = preTable.inverse(t / scale);
      const qNow = s * energySpeed * Math.sqrt(Math.max(0, ratio - 4 * Math.sin(a / 2) ** 2));
      return preConstrained(s * a, qNow);
    }
    if (near(t, pegHitTime)) return { ...pegAfter };
    if (t < lossTime || !Number.isFinite(lossTime)) {
      return postAtConstrained(t - pegHitTime);
    }
    const elapsed = t - lossTime;
    return {
      ...linearState(loss.xM, loss.yM, loss.vxMps, loss.vyMps, 0, -g, elapsed),
      stringState: 'slack',
      tensionN: 0,
      status: continueSlack && near(t, limit) ? 'model_boundary' : 'moving',
    };
  };

  function eventsUntil(duration: number): PendulumEvent[] {
    const events: PendulumEvent[] = [];
    const add = (time: number, kind: string, before = at(time), after = at(time)) => {
      if (time <= duration || near(time, duration)) events.push({ time, kind, before, after });
    };
    add(pegHitTime, 'peg_contact', pegBefore, pegAfter);
    if (Number.isFinite(pegTopTime)) {
      add(pegTopTime, 'pendulum_top', postConstrained(Math.PI / 2), postConstrained(Math.PI / 2));
    }
    if (Number.isFinite(lossTime)) {
      const afterSlack: PendulumSample = { ...loss, stringState: 'slack', tensionN: 0, angleRad: undefined, angularVelocityRadps: undefined };
      add(lossTime, 'string_slack', loss, afterSlack);
      if (continueSlack) {
        add(lossTime, 'projectile_launch', afterSlack, afterSlack);
        const apex = loss.vyMps / g;
        if (apex > 0 && apex < flightTime) add(lossTime + apex, 'apex');
        add(limit, 'string_retaut_boundary');
      }
    }
    return events.sort((a, b) => a.time - b.time);
  }

  return {
    initial,
    initiallySlack: false,
    equilibrium: false,
    limit,
    limitKind,
    lossTime,
    loss,
    firstTurn: Infinity,
    firstLowest: 0,
    pegHitTime,
    pegTopTime,
    pegOffsetXM: d,
    pegEffectiveLengthM: r,
    pegSideSign: s,
    derivedPegOffsetXM,
    pegSpeedMps: vPeg,
    pegTopSpeedMps,
    pegTopTensionN,
    pivotOffsetAt: (t: number) => (t < pegHitTime && !near(t, pegHitTime) ? 0 : s * d),
    activeLengthAt: (t: number) => (t < pegHitTime && !near(t, pegHitTime) ? L : r),
    endTime: (kind: PendulumEnd) => Math.min(kind === 'lowest_point' ? 0 : Infinity, limit),
    at,
    eventsUntil,
  };
}
