// 轻绳与理想定滑轮契约独立手算核对，不导入生产求解器。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (n) => JSON.parse(readFileSync(new URL("../fixtures/" + n, import.meta.url), "utf8"));
const acceptance = read("pulley-system.acceptance.json");
let checks = 0;
const near = (a, b) => {
  assert.ok(Number.isFinite(a) && Math.abs(a - b) <= acceptance.toleranceSI, `${a} != ${b}`);
  checks++;
};

function solveRef(plan) {
  const s = plan.stages[0], g = plan.gravityMps2;
  const m1 = plan.bodies.find((b) => b.bodyId === s.body1Id).massKg;
  const m2 = plan.bodies.find((b) => b.bodyId === s.body2Id).massKg;
  const surf = s.surface;
  let fg1 = 0, N1 = 0, muk = 0, mus = null;
  if (surf.kind === "hanging") { fg1 = -m1 * g; }
  else if (surf.kind === "horizontal") { N1 = m1 * g; muk = surf.kineticFrictionCoefficient; mus = surf.staticFrictionCoefficient ?? null; }
  else if (surf.kind === "incline") {
    const rad = surf.angleDeg * Math.PI / 180;
    fg1 = -m1 * g * Math.sin(rad); N1 = m1 * g * Math.cos(rad);
    muk = surf.kineticFrictionCoefficient; mus = surf.staticFrictionCoefficient ?? null;
  }
  const fDrive = m2 * g + fg1, fk = muk * N1;
  let holds = false;
  if (mus !== null) holds = Math.abs(fDrive) <= mus * N1 * (1 + 64 * Number.EPSILON);
  else if (surf.slidesAfterRelease === false) holds = true;
  if (holds) {
    return { a: 0, T: m2 * g, duration: 0, endReason: "stopped", v1: 0, v2: 0, disp: 0, slide1: 0, finalT: m2 * g };
  }
  const d = Math.sign(fDrive) || 1;
  const a = (fDrive - d * fk) / (m1 + m2);
  const T = m2 * (g - a);
  assert.ok(T >= 0); checks++;
  if (s.body2DropToGroundM) {
    const tHit = Math.sqrt(2 * s.body2DropToGroundM / a);
    const vHit = a * tHit;
    const decel = muk * g;
    const tCoast = vHit / decel;
    const slide1 = s.body2DropToGroundM + 0.5 * vHit * tCoast;
    return { a, T, groundHit: tHit, duration: tHit + tCoast, endReason: "stopped", v1: 0, v2: 0, disp: s.body2DropToGroundM, slide1, finalT: 0 };
  }
  const dur = s.durationSeconds;
  return { a, T, duration: dur, endReason: "prefix_end", v1: Math.abs(a * dur), v2: Math.abs(a * dur), disp: Math.abs(0.5 * a * dur * dur), slide1: Math.abs(0.5 * a * dur * dur), finalT: T };
}

for (const c of acceptance.cases) {
  const r = solveRef(read(c.readingFile));
  near(r.a, c.tautAccelMps2);
  near(r.T, c.tautTensionN);
  near(r.duration, c.durationSeconds);
  assert.equal(r.endReason, c.endReason); checks++;
  near(r.v1, c.finalBody1SpeedMps);
  near(r.v2, c.finalBody2SpeedMps);
  if (c.finalDisplacementM !== undefined) near(r.disp, c.finalDisplacementM);
  if (c.groundHitTimeSeconds !== undefined) near(r.groundHit, c.groundHitTimeSeconds);
  if (c.finalBody1TotalSlideM !== undefined) near(r.slide1, c.finalBody1TotalSlideM);
  if (c.finalTensionN !== undefined) near(r.finalT, c.finalTensionN);
}
console.log(`轻绳与理想定滑轮契约独立复算通过：${checks}项断言（未调用生产求解器）。`);
