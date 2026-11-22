// 由 scripts/sync-functions.mjs 从 src/physics/collision.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
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
