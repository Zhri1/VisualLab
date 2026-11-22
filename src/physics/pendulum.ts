import { integrate } from './quadrature.ts';
import { linearState } from './kinematics.ts';
import type { PendulumEnd, BodyState } from './multiBodyTypes.ts';

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
