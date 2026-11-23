// 粗糙弹簧接触契约的独立手算：只用闭式解与RK4，不导入生产求解器。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = n => JSON.parse(readFileSync(new URL("../fixtures/" + n, import.meta.url), "utf8"));
let checks = 0;
const near = (a, b, tol = 1e-9) => { assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`); checks++; };
const m = 1, k = 10, g = 10, mk = 0.2, ms = 0.25, f = mk * m * g, xe = f / k, w = Math.sqrt(k / m);
function reference(v0) {
  const a = v0 / w, B = Math.hypot(a, xe), xmax = B - xe, t1 = Math.atan2(a, xe) / w;
  const holds = k * xmax <= ms * m * g * (1 + 1e-12);
  const out = { xmax, t1, holds, heat1: f * xmax };
  if (holds) return { ...out, end: "hold_max", duration: t1, residual: xmax, heat: f * xmax };
  const D = xmax - xe, x2 = 2 * xe - xmax;
  if (Math.abs(x2) <= 1e-12) return { ...out, end: "stop_natural", duration: t1 + Math.PI / w, residual: 0, heat: f * 2 * xmax };
  if (x2 > 0) return { ...out, end: "stop_residual", duration: t1 + Math.PI / w, residual: x2, heat: f * (xmax + xmax - x2) };
  const tau = Math.acos(-xe / D) / w;
  return { ...out, end: "detach", duration: t1 + tau, residual: 0, speed: D * w * Math.sin(w * tau), heat: f * 2 * xmax };
}
// 独立RK4：位置、速度、路程；用方向符号摩擦，不使用上面的相位解。
function rk4(v0) {
  let x = 0, v = v0, t = 0, path = 0, turned = false; const dt = 1e-5; let tTurn = 0, xmaxN = 0;
  const acc = (x, v) => -k * x / m - Math.sign(v) * mk * g;
  while (t < 5) {
    if (!turned && v <= 0) { turned = true; tTurn = t; xmaxN = x; if (k * x <= ms * m * g) return { t, x, v: 0, path, tTurn, xmaxN, end: "hold" }; v = -1e-12; }
    if (turned && x <= 0) return { t, x, v, path, tTurn, xmaxN, end: "detach" };
    if (turned && t > tTurn + 1e-3 && v >= -3e-5) return { t, x, v: 0, path, tTurn, xmaxN, end: "stop" };
    const k1x = v, k1v = acc(x, v), k2x = v + dt / 2 * k1v, k2v = acc(x + dt / 2 * k1x, k2x), k3x = v + dt / 2 * k2v, k3v = acc(x + dt / 2 * k2x, k3x), k4x = v + dt * k3v, k4v = acc(x + dt * k3x, k4x);
    const nx = x + dt / 6 * (k1x + 2 * k2x + 2 * k3x + k4x); path += Math.abs(nx - x); x = nx; v += dt / 6 * (k1v + 2 * k2v + 2 * k3v + k4v); t += dt;
  }
}
const a = read("rough-spring.acceptance.json");
for (const c of a.cases) {
  const r = reference(c.speedMps), n = rk4(c.speedMps);
  near(r.xmax, c.maxCompressionM, 1e-9); near(r.xmax, n.xmaxN, 2e-5); near(r.t1, n.tTurn, 2e-4);
  assert.equal(r.end, c.outcome); checks++;
  near(r.duration, c.durationSeconds, 1e-9); near(r.residual, c.finalCompressionM, 1e-9); near(r.heat, c.frictionHeatJ, 1e-9);
  if (c.detachVxMps !== undefined) { near(-r.speed, c.detachVxMps, 1e-9); near(n.v, c.detachVxMps, 2e-4); near(n.path, r.heat / f, 2e-4); }
  // 能量守恒：动能+弹性势能+摩擦耗能=入射动能
  const e0 = 0.5 * m * c.speedMps ** 2, ek = 0.5 * m * (c.detachVxMps ?? 0) ** 2, ep = 0.5 * k * c.finalCompressionM ** 2;
  near(ek + ep + r.heat, e0, 1e-9);
}
console.log(`粗糙弹簧接触契约独立复算通过：${checks}项断言（未调用生产求解器）。`);

