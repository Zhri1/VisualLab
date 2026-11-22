// 契约数据的独立手算式与数值积分核对，不调用或实现未来的生产求解入口。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => JSON.parse(readFileSync(new URL("../fixtures/" + name, import.meta.url), "utf8"));
const expected = read("precompressed-spring.acceptance.json");
const complete = read("precompressed-spring-complete.reading.json");
const critical = read("precompressed-spring-critical.reading.json");
const fixed = read("precompressed-spring-fixed-energy.reading.json");
let checks = 0;
function near(actual, reference) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - reference) <= expected.toleranceSI, `${actual} != ${reference}`);
  checks++;
}
function equal(actual, reference) { assert.deepEqual(actual, reference); checks++; }
function simpson(f, end) {
  const n = 100000, h = end / n;
  let sum = f(0) + f(end);
  for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * f(i * h);
  return sum * h / 3;
}
const release = (m, k, c, mu, g) => {
  const f = mu * m * g, D = c - f / k, w = Math.sqrt(k / m);
  if (c <= 2 * f / k) return { time: Math.PI / w, position: 2 * D, speed: 0, compression: c - 2 * D };
  const time = Math.acos(1 - c / D) / w;
  return { time, position: c, speed: D * w * Math.sin(w * time), compression: 0 };
};
// 独立能量/向心力边界和Simpson积分；转折用ψ代换，避免可积奇点。
function arcReference(u2, R, g, entryX) {
  const tolerance = 32 * Number.EPSILON * Math.max(u2, 5 * g * R);
  const returning = u2 <= 2 * g * R + tolerance;
  const endpoint = u2 >= 5 * g * R - tolerance;
  const phi = returning ? Math.acos(1 - u2 / (2 * g * R)) : endpoint ? Math.PI : Math.acos((2 * g * R - u2) / (3 * g * R));
  if (returning) {
    const k2 = u2 / (4 * g * R);
    const up = Math.sqrt(R / g) * simpson(p => 1 / Math.sqrt(1 - k2 * Math.sin(p) ** 2), Math.PI / 2);
    return { duration: 2 * up, x: entryX, vx: -Math.sqrt(u2), vy: 0, reason: "returned_to_entry" };
  }
  const arcTime = simpson(p => R / Math.sqrt(u2 - 2 * g * R * (1 - Math.cos(p))), phi);
  const y = R * (1 - Math.cos(phi));
  const speed = Math.sqrt(Math.max(0, u2 - 2 * g * y));
  const vx = endpoint ? -speed : speed * Math.cos(phi), vy = endpoint ? 0 : speed * Math.sin(phi);
  const flight = (vy + Math.sqrt(vy * vy + 2 * g * y)) / g;
  return { duration: arcTime + flight, x: entryX + R * Math.sin(phi) + vx * flight, vx, vy: vy - g * flight, reason: "landed" };
}

const m = complete.massKg, g = complete.gravityMps2;
const spring = complete.stages[0], horizontal = complete.stages[1], arc = complete.stages[2];
const L = horizontal.end.distanceM, f = horizontal.kineticFrictionCoefficient * m * g;
const E = .5 * spring.springConstantNpm * spring.initialCompressionM ** 2;
const r = release(m, spring.springConstantNpm, spring.initialCompressionM, spring.kineticFrictionCoefficient, g);
const eb = E - spring.kineticFrictionCoefficient * m * g * r.position - f * (L - r.position);
const vB = Math.sqrt(2 * eb / m);
const tB = r.time + 2 * (L - r.position) / (r.speed + vB);
near(E, expected.complete.initialElasticEnergyJ);
near(r.time, expected.complete.release.timeSeconds); near(r.speed, expected.complete.release.vxMps);
near(r.position, expected.complete.release.xM); near(r.compression, 0);
near(tB, expected.complete.entry.timeSeconds); near(vB, expected.complete.entry.vxMps);
near(m * (vB * vB / arc.radiusM + g), expected.complete.entry.normalForceN);
const travel = arcReference(vB * vB, arc.radiusM, g, L);
near(tB + travel.duration, expected.complete.durationSeconds);
near(travel.x, expected.complete.final.xM); near(travel.vx, expected.complete.final.vxMps); near(travel.vy, expected.complete.final.vyMps);
near(tB + travel.duration - .4, expected.complete.top.timeSeconds);

equal(critical.energy, undefined); equal(fixed.constraints, undefined);
equal(critical.stages, fixed.stages);
equal(critical.constraints, [{ kind: "critical_arc_top", stageIndex: 2 }]);
equal(fixed.stages[0].springConstantNpm, null); equal(fixed.stages[0].initialCompressionM, null);
const b = fixed.energy.basis;
const derivedE = 2.5 * b.massKg * b.gravityMps2 * b.radiusM + b.horizontalKineticFrictionCoefficient * b.massKg * b.gravityMps2 * b.distanceM;
near(derivedE, fixed.energy.elasticEnergyJ);
near(b.springKineticFrictionCoefficient, b.horizontalKineticFrictionCoefficient);
near(b.releaseCompleteByM, 2);

for (const row of expected.fixedEnergyEdits) {
  near(row.initialElasticEnergyJ, fixed.energy.elasticEnergyJ);
  const before = JSON.stringify(fixed.energy);
  const edited = structuredClone(fixed); edited.stages[1].end.distanceM = row.ABM;
  equal(JSON.stringify(edited.energy), before);
  if (row.ABM < b.releaseCompleteByM) { equal(row.status, "needs_input"); equal(row.mode, null); continue; }
  const remaining = fixed.energy.elasticEnergyJ - f * row.ABM;
  if (row.ABM >= 7) {
    assert.ok(fixed.energy.elasticEnergyJ / f >= b.releaseCompleteByM); checks++;
    equal(row.mode, "state_only"); equal(row.absoluteStartSeconds, null);
    equal(row.eventKinds, ["state_anchor"]); equal(row.segmentKinds, []);
    equal(row.durationSeconds, 0); near(row.final.xM, fixed.energy.elasticEnergyJ / f);
    near(row.final.vxMps, 0); equal(row.terminationReason, row.ABM === 7 ? "stop_at_target" : "stop_before_target");
  } else {
    const result = arcReference(2 * remaining / m, arc.radiusM, g, row.ABM);
    equal(row.mode, "suffix"); equal(row.absoluteStartSeconds, null);
    near(row.initialState.xM, row.ABM); near(row.initialState.vxMps, Math.sqrt(2 * remaining / m));
    near(row.durationSeconds, result.duration); near(row.final.xM, result.x);
    near(row.final.vxMps, result.vx); near(row.final.vyMps, result.vy); equal(row.terminationReason, result.reason);
  }
}
for (const row of expected.releaseBoundaries) {
  if (row.name === "natural_length_at_B") {
    near(row.overrides["/stages/1/end/distanceM"], r.position);
    near(row.handoffTimeSeconds, r.time); near(row.entry.vxMps, r.speed);
    equal(row.handoffEventKinds, ["spring_release_end", "reach_target", "arc_enter"]);
    equal(row.positiveDurationStageIndices, [0, 2, 3]);
  } else {
    const stop = release(row.massKg, row.springConstantNpm, row.initialCompressionM, row.kineticFrictionCoefficient, row.gravityMps2);
    near(row.durationSeconds, stop.time); near(row.final.xM, stop.position); near(row.final.springCompressionM, stop.compression);
  }
}
const single = expected.singleMissingParameter;
const singleE = 2.5 * single.massKg * single.gravityMps2 * single.radiusM
  + single.horizontalKineticFrictionCoefficient * single.massKg * single.gravityMps2 * single.ABM
  + (single.springKineticFrictionCoefficient - single.horizontalKineticFrictionCoefficient) * single.massKg * single.gravityMps2 * single.initialCompressionM;
near(singleE, single.derivedEnergyJ); near(2 * singleE / single.initialCompressionM ** 2, single.derivedSpringConstantNpm);
// 同样E=.1、μ=.2且c≤2：可能在压缩中停.375m，也可能释放后停.5m，证明不能一概报E/f。
const ambiguous = release(.1, 2 * .1 / (.75 ** 2), .75, .2, 10);
near(ambiguous.position, .375); assert.ok(ambiguous.compression > 0); checks++;
const detached = release(.1, 2 * .1 / (.2 ** 2), .2, .2, 10);
assert.ok(detached.speed > 0); checks++;
near(.1 / (.2 * .1 * 10), expected.unknownStopPosition.mustNotClaimStopXM);
console.log(`预压弹簧契约独立核对通过：${checks} 条断言。新增阶段运行时尚待实现。`);
