// 由 scripts/sync-functions.mjs 从 src/physics/quadrature.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
// 八点Gauss-Legendre，供圆弧与非线性摆的专用光滑积分共用。
const nodes = [.1834346424956498, .525532409916329, .7966664774136267, .9602898564975363];
const weights = [.362683783378362, .3137066458778873, .2223810344533745, .1012285362903763];
export function integrate(f: (value: number) => number, a: number, b: number): number {
  const mid = (a + b) / 2, half = (b - a) / 2;
  let sum = 0;
  for (let i = 0; i < nodes.length; i++) sum += weights[i] * (f(mid - half * nodes[i]) + f(mid + half * nodes[i]));
  return half * sum;
}
