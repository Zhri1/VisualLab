// 常力作用与分段匀变速契约的独立手算核对，不导入生产求解器。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (n) => JSON.parse(readFileSync(new URL("../fixtures/" + n, import.meta.url), "utf8"));
const acceptance = read("constant-force.acceptance.json");
let checks = 0;
const near = (a, b) => {
  assert.ok(Number.isFinite(a) && Math.abs(a - b) <= acceptance.toleranceSI, `${a} != ${b}`);
  checks++;
};

function simulate(plan) {
  const m = plan.massKg;
  const g = plan.gravityMps2 ?? 0;
  let t = 0, x = 0, y = 0, vx = plan.initial.speedMps, vy = 0;
  const history = [];
  for (const s of plan.stages) {
    if (s.kind === "constant_force_1d") {
      const a = s.netForceXN / m;
      const dt = s.end.kind === "duration" ? s.end.durationSeconds : -vx / a;
      assert.ok(dt >= 0);
      const t0 = t, x0 = x, y0 = y, vx0 = vx;
      history.push({ t0, t1: t0 + dt, at: (u) => ({ xM: x0 + vx0 * u + 0.5 * a * u * u, yM: y0, vxMps: vx0 + a * u, vyMps: 0 }) });
      x = x0 + vx0 * dt + 0.5 * a * dt * dt;
      vx = vx0 + a * dt;
      t += dt;
    } else if (s.kind === "projectile") {
      const dt = Math.sqrt(2 * s.dropHeightM / g);
      const t0 = t, x0 = x, y0 = y, vx0 = vx, vy0 = vy;
      history.push({ t0, t1: t0 + dt, at: (u) => ({ xM: x0 + vx0 * u, yM: y0 + vy0 * u - 0.5 * g * u * u, vxMps: vx0, vyMps: vy0 - g * u }) });
      x = x0 + vx0 * dt;
      y = y0 - s.dropHeightM;
      vy = vy0 - g * dt;
      t += dt;
    }
  }
  const sampleAt = (query) => {
    const seg = history.find((h) => query >= h.t0 - 1e-12 && query <= h.t1 + 1e-12) ?? history[history.length - 1];
    return seg.at(Math.max(0, Math.min(seg.t1 - seg.t0, query - seg.t0)));
  };
  return { durationSeconds: t, sampleAt };
}

for (const c of acceptance.cases) {
  const sim = simulate(read(c.readingFile));
  near(sim.durationSeconds, c.durationSeconds);
  for (const cp of c.checkpoints) {
    const s = sim.sampleAt(cp.timeSeconds);
    near(s.xM, cp.xM);
    near(s.yM, cp.yM);
    near(s.vxMps, cp.vxMps);
    near(s.vyMps, cp.vyMps);
  }
}
console.log(`常力分段匀变速契约独立复算通过：${checks}项断言（未调用生产求解器）。`);
