// 水平正碰只接收质量和带符号速度，不依赖摆长、角度或整题路径。
export function collide1D(m1: number, m2: number, u1: number, u2: number, mode: 'elastic' | 'perfectly_inelastic') {
  if (![m1, m2, u1, u2].every(Number.isFinite) || m1 <= 0 || m2 <= 0) throw new RangeError('碰撞质量和速度须在有效数值范围。');
  const total = m1 + m2, a = m1 / total, b = m2 / total;
  const v = a * u1 + b * u2;
  const v1 = mode === 'elastic' ? (a - b) * u1 + 2 * b * u2 : v;
  const v2 = mode === 'elastic' ? 2 * a * u1 + (b - a) * u2 : v;
  const energyBeforeJ = .5 * m1 * u1 ** 2 + .5 * m2 * u2 ** 2;
  const energyAfterJ = .5 * m1 * v1 ** 2 + .5 * m2 * v2 ** 2;
  if (![total, v1, v2, energyBeforeJ, energyAfterJ].every(Number.isFinite)) throw new RangeError('碰撞数值量级超出可计算范围。');
  return { v1, v2, energyBeforeJ, energyAfterJ, energyLostJ: mode === 'elastic' ? 0 : .5 * m1 * b * (u1 - u2) ** 2 };
}

/**
 * 已知其中一物体碰后速度的一维正碰：由水平动量守恒反求另一物体速度，并核对动能损失与不互穿条件。
 */
export function collide1DSpecifiedPostVelocity(
  m1: number,
  m2: number,
  u1: number,
  u2: number,
  normalXM: 1 | -1,
  knownIndex: 0 | 1,
  knownPostVx: number,
) {
  if (![m1, m2, u1, u2, knownPostVx].every(Number.isFinite) || m1 <= 0 || m2 <= 0) {
    throw new RangeError('碰撞质量和速度须在有效数值范围。');
  }
  const p = m1 * u1 + m2 * u2;
  const v1 = knownIndex === 0 ? knownPostVx : (p - m2 * knownPostVx) / m1;
  const v2 = knownIndex === 1 ? knownPostVx : (p - m1 * knownPostVx) / m2;
  const energyBeforeJ = 0.5 * m1 * u1 ** 2 + 0.5 * m2 * u2 ** 2;
  const energyAfterJ = 0.5 * m1 * v1 ** 2 + 0.5 * m2 * v2 ** 2;
  if (![p, v1, v2, energyBeforeJ, energyAfterJ].every(Number.isFinite)) {
    throw new RangeError('碰撞数值量级超出可计算范围。');
  }
  const rawLoss = energyBeforeJ - energyAfterJ;
  const tolE = 64 * Number.EPSILON * Math.max(1, energyBeforeJ, energyAfterJ);
  const tolV = 64 * Number.EPSILON * Math.max(1, Math.abs(v1), Math.abs(v2));
  return {
    v1,
    v2,
    energyBeforeJ,
    energyAfterJ,
    energyLostJ: Math.abs(rawLoss) <= tolE ? 0 : rawLoss,
    superElastic: rawLoss < -tolE,
    interpenetrating: (v1 - v2) * normalXM > tolV,
  };
}
