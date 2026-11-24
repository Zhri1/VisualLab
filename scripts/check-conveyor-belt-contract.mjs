// 传送带与滑块契约独立手算核对，不导入生产求解器。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (n) => JSON.parse(readFileSync(new URL("../fixtures/" + n, import.meta.url), "utf8"));
const acceptance = read("conveyor-belt.acceptance.json");
let checks = 0;
const near = (a, b) => {
  assert.ok(Number.isFinite(a) && Math.abs(a - b) <= acceptance.toleranceSI, `${a} != ${b}`);
  checks++;
};

function simulate(plan) {
  const s = plan.stages[0], g = plan.gravityMps2;
  const ak = s.kineticFrictionCoefficient * g;
  const asMax = (s.staticFrictionCoefficient ?? 0) * g;
  let t = 0, x = 0, v = plan.initial.vxMps, xb = 0, vb = s.initialBeltSpeedMps;
  const pieces = [];
  let commonTime = null, reslideTime = null, turnTime = null;

  for (const seg of s.segments) {
    let rem = seg.durationSeconds;
    const ab = seg.accelerationMps2;
    while (rem > 1e-12) {
      const vRel = v - vb;
      let a;
      let dt = rem;
      if (Math.abs(vRel) <= 1e-12) {
        if (Math.abs(ab) <= asMax + 64 * Number.EPSILON * Math.max(1, asMax)) {
          a = ab;
        } else {
          reslideTime ??= t;
          a = Math.sign(ab) * ak;
        }
      } else {
        a = -Math.sign(vRel) * ak;
        const aRel = a - ab;
        if (vRel * aRel < 0) {
          const tc = -vRel / aRel;
          if (tc > 1e-12 && tc <= rem + 1e-12) {
            dt = Math.min(rem, tc);
            commonTime ??= t + dt;
          }
        }
      }
      if (a !== 0 && v !== 0 && v * (v + a * dt) < 0) {
        turnTime ??= t - v / a;
      }
      const t0 = t, x0 = x, v0 = v, xb0 = xb, vb0 = vb;
      pieces.push({
        t0, t1: t0 + dt,
        at: (u) => {
          const xn = x0 + v0 * u + 0.5 * a * u * u;
          const vn = v0 + a * u;
          const xbn = xb0 + vb0 * u + 0.5 * ab * u * u;
          const vbn = vb0 + ab * u;
          return { xM: xn, vxMps: vn, beltSpeedMps: vbn, relativeDisplacementM: xn - xbn };
        },
      });
      x = x0 + v0 * dt + 0.5 * a * dt * dt;
      v = v0 + a * dt;
      xb = xb0 + vb0 * dt + 0.5 * ab * dt * dt;
      vb = vb0 + ab * dt;
      if (Math.abs(v - vb) <= 1e-12) v = vb;
      t += dt;
      rem -= dt;
    }
  }
  const at = (query) => {
    const p = pieces.find((item) => query >= item.t0 - 1e-12 && query <= item.t1 + 1e-12) ?? pieces[pieces.length - 1];
    return p.at(Math.max(0, Math.min(p.t1 - p.t0, query - p.t0)));
  };
  return { durationSeconds: t, at, commonTime, reslideTime, turnTime };
}

for (const c of acceptance.cases) {
  const sim = simulate(read(c.readingFile));
  near(sim.durationSeconds, c.durationSeconds);
  if (c.commonVelocityTimeSeconds !== undefined) near(sim.commonTime, c.commonVelocityTimeSeconds);
  if (c.reslideTimeSeconds !== undefined) near(sim.reslideTime, c.reslideTimeSeconds);
  if (c.turnAroundTimeSeconds !== undefined) near(sim.turnTime, c.turnAroundTimeSeconds);
  for (const cp of c.checkpoints) {
    const s = sim.at(cp.timeSeconds);
    near(s.xM, cp.xM);
    near(s.vxMps, cp.vxMps);
    near(s.beltSpeedMps, cp.beltSpeedMps);
    near(s.relativeDisplacementM, cp.relativeDisplacementM);
  }
}
console.log(`传送带与滑块契约独立复算通过：${checks}项断言（未调用生产求解器）。`);
