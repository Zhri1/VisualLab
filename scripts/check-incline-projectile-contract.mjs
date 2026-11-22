// 契约数据独立复算：只检查解析基准，不导入或宣称生产接续已实现。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const data = read('incline-projectile.acceptance.json');
let checks = 0;
const same = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const close = (actual, expected, tolerance = 1e-12) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${actual} 与 ${expected} 不符`);
  checks++;
};
const state = (actual, expected) => { for (const key of ['xM', 'yM', 'vxMps', 'vyMps', 'springCompressionM']) if (key in expected) close(actual[key], expected[key]); };

const main = data.cases[0];
for (const entry of data.cases) {
  const input = read(entry.readingFile);
  same([input.kind, input.schemaVersion], ['stage_plan', 1]);
  same(input.stages.map(s => s.kind), ['incline_slide', 'projectile']);
  same('massKg' in input, false);
  const [slope, flight] = input.stages;
  const expected = entry.equivalentTo ? main : entry;
  const angle = slope.angleDeg * Math.PI / 180, sine = Math.sin(angle), cosine = Math.cos(angle);
  const g = input.gravityMps2, u = input.initial.speedMps, L = slope.lengthM;
  const a = g * (sine - slope.kineticFrictionCoefficient * cosine);
  close(sine, .6); close(cosine, .8); close(a, expected.accelerationAlongInclineMps2);
  state({ xM: -L * cosine, yM: L * sine, vxMps: u * cosine, vyMps: -u * sine }, expected.start);
  same(expected.inclineEnd, { xM: 0, yM: 0 });
  same(expected.positionReference, 'particle');
  const plane = 'landingPlaneYM' in flight ? flight.landingPlaneYM : -flight.dropHeightM;
  same(('landingPlaneYM' in flight) !== ('dropHeightM' in flight), true);
  if (u === 0) {
    same(slope.slidesAfterRelease, true);
    const speed = Math.sqrt(u * u + 2 * a * L), t = (speed - u) / a;
    const vx = speed * cosine, vy = -speed * sine;
    // 独立取二次方程正根，与生产 landingTime 的有理化实现分开核对。
    const air = (vy + Math.sqrt(vy * vy - 2 * g * plane)) / g;
    close(t, expected.handoff.timeSeconds);
    state({ xM: 0, yM: 0, vxMps: vx, vyMps: vy }, expected.handoff);
    close(air, expected.flightSeconds); close(t + air, expected.durationSeconds);
    close(plane, expected.landingPlaneYM);
    const final = { xM: vx * air, yM: plane, vxMps: vx, vyMps: vy - g * air, springCompressionM: 0 };
    state(final, expected.final);
    close(Math.hypot(final.vxMps, final.vyMps), expected.landingSpeedMps);
    close(speed * speed - 2 * g * plane, expected.landingSpeedMps ** 2);
    same(expected.handoff.eventKinds, ['reach_bottom', 'projectile_launch']);
    same(expected.handoff.eventOrders, [1, 2]); same(expected.handoff.stageIndices, [0, 1]);
    same(expected.eventKinds, ['release', 'reach_bottom', 'projectile_launch', 'land']);
    same(expected.segmentKinds, ['incline_slide', 'projectile']);
    same(expected.terminationReason, 'landed'); same(expected.terminationStageIndex, 1);
    if (entry.equivalentTo) { same(entry.equivalentTo, main.readingFile); close(plane, entry.landingPlaneYM); }
  } else {
    const stop = -u / a, distance = -u * u / (2 * a);
    close(stop, expected.durationSeconds); close(distance, expected.distanceAlongInclineM);
    state({ xM: -L * cosine + distance * cosine, yM: L * sine - distance * sine, vxMps: 0, vyMps: 0, springCompressionM: 0 }, expected.final);
    same(expected.terminationReason, Math.abs(distance - L) <= 1e-12 ? 'stop_at_target' : 'stop_before_target');
    same(expected.terminationStageIndex, 0); same(expected.hasProjectileGeometry, false);
    same(expected.eventKinds, ['release', 'stop']); same(expected.segmentKinds, ['incline_slide']);
  }
  for (const kind of data.forbiddenEventKinds) same(expected.eventKinds.includes(kind), false);
}

// 解析边界两侧独立展开，避免把连续速度误写成水平转向。
const e = data.epsilonSeconds;
state({ xM: -4 * e + 2 * e ** 2, yM: 3 * e - 1.5 * e ** 2, vxMps: 4 - 4 * e, vyMps: -3 + 3 * e }, data.handoffSamples.before);
state({ xM: 0, yM: 0, vxMps: 4, vyMps: -3 }, data.handoffSamples.at);
state({ xM: 4 * e, yM: -3 * e - 5 * e ** 2, vxMps: 4, vyMps: -3 - 10 * e }, data.handoffSamples.after);
same(data.handoffSamples.timeSeconds, main.handoff.timeSeconds);
close(data.prefix.durationSeconds, main.handoff.timeSeconds);
state(data.prefix.final, { ...data.handoffSamples.at, springCompressionM: 0 });
same(data.prefix.eventKinds, ['release', 'reach_bottom']); same(data.prefix.terminationReason, 'prefix_end');
same(data.prefix.positionReference, 'front_bottom'); same(data.prefix.throughStageIndex, 0);
console.log(`斜面斜抛契约独立复算通过：${checks} 项断言（未调用生产求解器）。`);
