// 滑块与可移动木板契约独立手算核对，不导入生产求解器。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (n) => JSON.parse(readFileSync(new URL("../fixtures/" + n, import.meta.url), "utf8"));
const acceptance = read("block-plank.acceptance.json");
let checks = 0;
const near = (a, b) => {
  assert.ok(Number.isFinite(a) && Math.abs(a - b) <= acceptance.toleranceSI, `${a} != ${b}`);
  checks++;
};

function solveEdgeTime(s0, vRel0, aRel, targetS) {
  // 0.5*aRel*t^2 + vRel0*t + (s0 - targetS) = 0
  const c = s0 - targetS;
  if (Math.abs(aRel) < 1e-15) {
    if (Math.abs(vRel0) < 1e-15) return Infinity;
    const t = -c / vRel0;
    return t > 0 ? t : Infinity;
  }
  const disc = vRel0 * vRel0 - 2 * aRel * c;
  if (disc < 0) return Infinity;
  const r = Math.sqrt(disc);
  const roots = [(-vRel0 - r) / aRel, (-vRel0 + r) / aRel].filter((t) => t > 1e-12);
  return roots.length ? Math.min(...roots) : Infinity;
}

function refSolve(plan) {
  const s = plan.stages[0];
  const m = plan.bodies.find((b) => b.bodyId === s.blockBodyId).massKg;
  const M = plan.bodies.find((b) => b.bodyId === s.plankBodyId).massKg;
  const g = plan.gravityMps2;
  const ib = plan.initial.bodies.find((b) => b.bodyId === s.blockBodyId);
  const ip = plan.initial.bodies.find((b) => b.bodyId === s.plankBodyId);
  let xb = ib.xM, vb = ib.vxMps, xp = ip.xM, vp = ip.vxMps, t = 0;
  const L = s.plankLengthM, fk = s.kineticFrictionCoefficient * m * g;
  const vRel0 = vb - vp;
  let commonTime = null;
  if (Math.abs(vRel0) > 1e-12) {
    const d = Math.sign(vRel0);
    const ab = -d * fk / m, ap = d * fk / M, aRel = ab - ap;
    const tc = fk > 0 ? -vRel0 / aRel : Infinity;
    const s0 = xb - xp;
    const tEdge = d > 0 ? solveEdgeTime(s0, vRel0, aRel, L) : solveEdgeTime(s0, vRel0, aRel, 0);
    if (tEdge < tc - 1e-12) {
      xb += vb * tEdge + 0.5 * ab * tEdge * tEdge;
      vb += ab * tEdge;
      xp += vp * tEdge + 0.5 * ap * tEdge * tEdge;
      vp += ap * tEdge;
      t += tEdge;
      return { t, endReason: "plank_edge_leave", xb, vb, xp, vp, relDisp: (xb - xp) - s0, commonTime };
    }
    xb += vb * tc + 0.5 * ab * tc * tc;
    vb += ab * tc;
    xp += vp * tc + 0.5 * ap * tc * tc;
    vp += ap * tc;
    t += tc;
    commonTime = t;
    // 验证动量守恒
    near(m * vb + M * vp, m * ib.vxMps + M * ip.vxMps);
  } else {
    commonTime = 0;
  }
  const relDisp = (xb - xp) - (ib.xM - ip.xM);
  let postAccel = null;
  if (s.postCommonForce) {
    const { blockForceXN: Fb, plankForceXN: Fp, durationSeconds: dur } = s.postCommonForce;
    const aCo = (Fb + Fp) / (m + M);
    const fsReq = m * aCo - Fb;
    const fsMax = s.staticFrictionCoefficient * m * g;
    if (Math.abs(fsReq) <= fsMax * (1 + 64 * Number.EPSILON)) {
      postAccel = { block: aCo, plank: aCo };
      xb += vb * dur + 0.5 * aCo * dur * dur;
      vb += aCo * dur;
      xp += vp * dur + 0.5 * aCo * dur * dur;
      vp += aCo * dur;
      t += dur;
    } else {
      const r = -Math.sign(fsReq);
      const ab = (Fb - r * fk) / m, ap = (Fp + r * fk) / M, aRel = ab - ap;
      postAccel = { block: ab, plank: ap };
      const sNow = xb - xp;
      const tEdge = aRel < 0 ? solveEdgeTime(sNow, 0, aRel, 0) : solveEdgeTime(sNow, 0, aRel, L);
      const dt = Math.min(dur, tEdge);
      xb += vb * dt + 0.5 * ab * dt * dt;
      vb += ab * dt;
      xp += vp * dt + 0.5 * ap * dt * dt;
      vp += ap * dt;
      t += dt;
      if (tEdge <= dur + 1e-12) return { t, endReason: "plank_edge_leave", xb, vb, xp, vp, relDisp, commonTime, postAccel };
    }
  }
  return { t, endReason: "prefix_end", xb, vb, xp, vp, relDisp, commonTime, postAccel };
}

for (const c of acceptance.cases) {
  const r = refSolve(read(c.readingFile));
  near(r.t, c.durationSeconds);
  assert.equal(r.endReason, c.endReason); checks++;
  near(r.xb, c.finalBlock.xM);
  near(r.vb, c.finalBlock.vxMps);
  near(r.xp, c.finalPlank.xM);
  near(r.vp, c.finalPlank.vxMps);
  if (c.relativeDisplacementM !== undefined) near(r.relDisp, c.relativeDisplacementM);
  if (c.commonVelocityTimeSeconds !== undefined) near(r.commonTime, c.commonVelocityTimeSeconds);
  if (c.postCommonAccelMps2) {
    near(r.postAccel.block, c.postCommonAccelMps2.block);
    near(r.postAccel.plank, c.postCommonAccelMps2.plank);
  }
}
console.log(`滑块与可移动木板契约独立复算通过：${checks}项断言（未调用生产求解器）。`);
