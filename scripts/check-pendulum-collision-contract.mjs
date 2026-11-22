// 只核对契约数据：不导入生产求解器，也不提前登记尚待联审的新阶段。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
const expected = read('pendulum-collision.acceptance');
const elastic = read('pendulum-elastic.reading');
const sticky = read('pendulum-sticky.reading');
const alone = read('pendulum-alone.reading');
const unequal = read('pendulum-unequal.reading');
const moving = read('pendulum-moving-target.reading');
const targetFlight = read('pendulum-target-projectile.reading');
const slack = read('pendulum-slack.reading');
const initialSlack = read('pendulum-initial-slack.reading');
const output = read('pendulum-collision.output');
let checks = 0;
function near(actual, value, tolerance = expected.toleranceSI) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - value) <= tolerance, `${actual} != ${value}`);
  checks++;
}
function equal(actual, value) { assert.deepEqual(actual, value); checks++; }
function ok(condition, message) { assert.ok(condition, message); checks++; }
const rad = angle => angle * Math.PI / 180;
const mass = (plan, id) => plan.bodies.find(body => body.bodyId === id).massKg;
function simpson(f, end, count = 50000) {
  const h = end / count;
  let sum = f(0) + f(end);
  for (let i = 1; i < count; i++) sum += (i % 2 ? 4 : 2) * f(i * h);
  return sum * h / 3;
}
const quarter = (angle, L, g) => Math.sqrt(L / g) * simpson(p => 1 / Math.sqrt(1 - Math.sin(angle / 2) ** 2 * Math.sin(p) ** 2), Math.PI / 2);
const collide = (m1, m2, u1, u2) => [((m1 - m2) * u1 + 2 * m2 * u2) / (m1 + m2), (2 * m1 * u1 + (m2 - m1) * u2) / (m1 + m2)];

// 独立RK4直接积分非线性方程，交叉验证能量积分的时刻和连续运动，未使用小角近似。
function rk4(angle, q, time, L, g) {
  const f = (a, v) => [v / L, -g * Math.sin(a)];
  const count = Math.max(1, Math.ceil(time / 1e-4)), h = time / count;
  for (let i = 0; i < count; i++) {
    const a = f(angle, q), b = f(angle + h * a[0] / 2, q + h * a[1] / 2);
    const c = f(angle + h * b[0] / 2, q + h * b[1] / 2), d = f(angle + h * c[0], q + h * c[1]);
    angle += h * (a[0] + 2 * b[0] + 2 * c[0] + d[0]) / 6;
    q += h * (a[1] + 2 * b[1] + 2 * c[1] + d[1]) / 6;
  }
  return { angle, q, xM: L * Math.sin(angle), yM: L * (1 - Math.cos(angle)), vxMps: q * Math.cos(angle), vyMps: q * Math.sin(angle) };
}
function checkState(state, reference) { for (const key of ['xM', 'yM', 'vxMps', 'vyMps']) near(state[key], reference[key]); }

const g = elastic.gravityMps2, L = elastic.stages[0].lengthM, theta0 = rad(elastic.stages[0].initialAngleDeg);
const m1 = mass(elastic, 'bob'), m2 = mass(elastic, 'target');
const tc = quarter(Math.abs(theta0), L, g), u1 = Math.sqrt(2 * g * L * (1 - Math.cos(theta0)));
near(tc, expected.collisionTimeSeconds, 1e-10);
near(L * Math.sin(theta0), expected.release.position.xM);
near(L * (1 - Math.cos(theta0)), expected.release.position.yM);
near(m1 * g * Math.cos(theta0), expected.release.tensionN);
const atBottom = rk4(theta0, 0, tc, L, g);
checkState(atBottom, { xM: 0, yM: 0, vxMps: u1, vyMps: 0 });
near(m1 * (u1 * u1 / L + g), expected.elastic.before.tensionN);
near(.5 * m1 * u1 * u1, expected.elastic.before.kineticEnergyJ);
const [v1, v2] = collide(m1, m2, u1, elastic.stages[1].targetApproach.velocityXMps);
near(v1, expected.elastic.after.bobXMps); near(v2, expected.elastic.after.targetXMps);
near(.5 * m1 * v1 * v1 + .5 * m2 * v2 * v2, expected.elastic.after.kineticEnergyJ);
near(m1 * u1, m1 * v1 + m2 * v2, 1e-12);
near(m1 * (v1 * v1 / L + g), expected.elastic.after.tensionN);
const mu = elastic.stages[2].tracks[1].stages[0].kineticFrictionCoefficient;
near(tc + v2 / (mu * g), expected.elastic.durationSeconds, 1e-10);
near(v2 * v2 / (2 * mu * g), expected.elastic.targetFinal.xM);
equal(expected.elastic.endReason, 'stopped'); equal(expected.elastic.motionStatus, 'complete');

const stickMass = mass(sticky, 'bob') + mass(sticky, 'target');
const stickV = mass(sticky, 'bob') * u1 / stickMass, amplitude = Math.acos(1 - stickV * stickV / (2 * g * L));
near(stickV, expected.sticky.velocityXMps);
near(stickMass * (stickV * stickV / L + g), expected.sticky.tensionAfterN);
near(.5 * stickMass * stickV * stickV, expected.sticky.kineticEnergyAfterJ);
near(.5 * (m1 * m2 / (m1 + m2)) * u1 * u1, expected.sticky.kineticEnergyBeforeJ - expected.sticky.kineticEnergyAfterJ);
near(amplitude * 180 / Math.PI, expected.sticky.turnAngleDeg);
const turnTime = quarter(amplitude, L, g);
near(tc + turnTime, expected.sticky.durationSeconds, 1e-10);
checkState(rk4(0, stickV, turnTime, L, g), { ...expected.sticky.position, vxMps: 0, vyMps: 0 });
near(stickMass * g * Math.cos(amplitude), expected.sticky.turnTensionN);
equal(sticky.stages[2].bodyIds, ['bob', 'target']);
equal(sticky.stages[2].inheritFromStageIndex, 0);

near(2 * tc, expected.alone.durationSeconds, 1e-10);
checkState(rk4(theta0, 0, 2 * tc, L, g), { ...expected.alone.position, vxMps: 0, vyMps: 0 });
equal(alone.bodies.length, 1); equal(alone.stages[0].end.kind, 'first_turn');

const [unequalBob, unequalTarget] = collide(mass(unequal, 'bob'), mass(unequal, 'target'), u1, 0);
near(unequalBob, expected.unequal.bobAfterXMps); near(unequalTarget, expected.unequal.targetAfterXMps);
near(.5 * unequalBob ** 2 + .5 * 3 * unequalTarget ** 2, 5, 1e-12);
near(unequalBob + 3 * unequalTarget, u1, 1e-12);
const targetStopAge = unequalTarget / (mu * g);
near(tc + targetStopAge, expected.unequal.targetStopTimeSeconds, 1e-10);
near(tc + turnTime, expected.unequal.bobTurnTimeSeconds, 1e-10);
near(unequalTarget ** 2 / (2 * mu * g), expected.unequal.targetFinalXM);
checkState(rk4(0, unequalBob, targetStopAge, L, g), expected.unequal.bobAtTargetStop);
ok(targetStopAge > turnTime, '目标停下晚于摆锤转折，摆锤必须继续取样');
ok(expected.unequal.bobAtTargetStop.vxMps > 0, '摆锤已反向，不冻结在左转折');
equal(unequal.stages[2].tracks[0].stages[0].end.kind, 'scene_end');
equal(expected.unequal.endReason, 'prefix_end'); equal(expected.unequal.motionStatus, 'range_end');

const u2 = moving.stages[1].targetApproach.velocityXMps, [movingBob, movingTarget] = collide(m1, m2, u1, u2);
near(-u2 * tc, moving.stages[1].targetApproach.initialXM);
near(-u2 * tc, expected.movingTarget.initialXM);
near(movingBob, expected.movingTarget.bobAfterXMps); near(movingTarget, expected.movingTarget.targetAfterXMps);
near(movingBob + movingTarget, expected.movingTarget.momentumKgMps);
near(.5 * movingBob ** 2 + .5 * movingTarget ** 2, expected.movingTarget.kineticEnergyJ);
ok((u1 - u2) * moving.stages[1].normalXM > 0, '确实接近才有碰撞');
const mirrored = collide(m1, m2, -u1, 0);
near(mirrored[0], 0); near(mirrored[1], -u1);
near(-(mirrored[1] ** 2) / (2 * mu * g), -2.5);

const table = targetFlight.stages[2].tracks[1].stages[0], projectile = targetFlight.stages[2].tracks[1].stages[1];
const vEdge = Math.sqrt(unequalTarget ** 2 - 2 * mu * g * table.end.distanceM);
const tEdge = (unequalTarget - vEdge) / (mu * g), tFlight = Math.sqrt(-2 * projectile.landingPlaneYM / g);
near(vEdge, Math.sqrt(.9)); near(tc + tEdge, expected.targetProjectile.leaveTimeSeconds, 1e-10);
near(tFlight, expected.targetProjectile.flightSeconds);
near(tc + tEdge + tFlight, expected.targetProjectile.durationSeconds, 1e-10);
checkState({ xM: table.end.distanceM + vEdge * tFlight, yM: projectile.landingPlaneYM, vxMps: vEdge, vyMps: -g * tFlight }, expected.targetProjectile.targetFinal);
checkState(rk4(0, unequalBob, tEdge + tFlight, L, g), expected.targetProjectile.bobAtLanding);
ok(tEdge < turnTime && tEdge + tFlight > turnTime, '目标飞行期间摆锤转折并继续运动');
equal(expected.targetProjectile.endReason, 'landed'); equal(expected.targetProjectile.motionStatus, 'range_end');

const q0 = slack.initial.tangentialSpeedMps, ratio = q0 * q0 / (g * L), phi = Math.acos((2 - ratio) / 3);
const lossSpeed = Math.sqrt(-g * L * Math.cos(phi));
const loss = { xM: L * Math.sin(phi), yM: L * (1 - Math.cos(phi)), vxMps: lossSpeed * Math.cos(phi), vyMps: lossSpeed * Math.sin(phi) };
const tLoss = Math.sqrt(L / g) * simpson(p => 1 / Math.sqrt(ratio - 4 * Math.sin(p / 2) ** 2), phi);
near(q0 * q0 / L + g, expected.slack.initialTensionN);
near(phi * 180 / Math.PI, expected.slack.lossAngleDeg); near(lossSpeed, expected.slack.lossSpeedMps);
checkState(loss, expected.slack.loss); near(tLoss, expected.slack.lossTimeSeconds, 1e-10);
checkState(rk4(0, q0, tLoss, L, g), loss);
near(lossSpeed * lossSpeed / L + g * Math.cos(phi), 0, 1e-12);
const ballistic = (start, t) => ({ xM: start.xM + start.vxMps * t, yM: start.yM + start.vyMps * t - .5 * g * t * t, vxMps: start.vxMps, vyMps: start.vyMps - g * t });
const tReta = 4 * loss.vyMps / g, reta = ballistic(loss, tReta), inside = ballistic(loss, tReta / 2);
near(tReta, expected.slack.flightSeconds); near(tLoss + tReta, expected.slack.retautTimeSeconds);
checkState(ballistic(loss, 0), loss); checkState(reta, expected.slack.retaut);
near(Math.hypot(reta.xM, reta.yM - L), L, 1e-12);
ok(Math.hypot(inside.xM, inside.yM - L) < L, '松绳自由段在绳长以内');
ok(reta.xM * reta.vxMps + (reta.yM - L) * reta.vyMps > 0, '再次到绳长时径向向外');
equal(expected.slack.motionStatus, 'model_limit');

const slackAngle = rad(initialSlack.stages[0].initialAngleDeg), start = { xM: L * Math.sin(slackAngle), yM: L * (1 - Math.cos(slackAngle)), vxMps: 0, vyMps: 0 };
const tInitial = 2 * Math.sqrt(-L * Math.cos(slackAngle) / g);
near(g * Math.cos(slackAngle), expected.initialSlack.requiredTensionN);
near(tInitial, expected.initialSlack.retautTimeSeconds); checkState(ballistic(start, tInitial), expected.initialSlack.retaut);
near(Math.hypot(ballistic(start, tInitial).xM, ballistic(start, tInitial).yM - L), L);
equal(initialSlack.stages[0].initialStringState, 'released_at_length');

// 零张力不是解除约束的充分条件；临界两侧保持各自真实分支。
for (const angle of [-Math.PI / 2, Math.PI / 2]) {
  near(g * Math.cos(angle), 0);
  const next = rk4(angle, 0, 1e-4, L, g);
  ok(next.q ** 2 / L + g * Math.cos(next.angle) > 0, '90度释放后张力转正');
}
const qTwo = Math.sqrt(2 * g * L), tTwo = quarter(Math.PI / 2, L, g);
const atTwo = rk4(0, qTwo, tTwo, L, g), afterTwo = rk4(0, qTwo, tTwo + 1e-4, L, g);
near(atTwo.angle, Math.PI / 2); near(atTwo.q, 0);
ok(afterTwo.q < 0 && afterTwo.q ** 2 / L + g * Math.cos(afterTwo.angle) > 0, '2gL临界转折后仍张紧');
const topTime = Math.sqrt(L / g) * simpson(p => 1 / Math.sqrt(5 - 4 * Math.sin(p / 2) ** 2), Math.PI);
const atTop = rk4(0, Math.sqrt(5 * g * L), topTime, L, g), afterTop = rk4(0, Math.sqrt(5 * g * L), topTime + 1e-4, L, g);
near(atTop.angle, Math.PI); near(atTop.q, Math.sqrt(g * L)); near(atTop.q ** 2 / L + g * Math.cos(atTop.angle), 0);
ok(afterTop.q > 0 && afterTop.q ** 2 / L + g * Math.cos(afterTop.angle) > 0, '5gL越顶后继续绕行且张力转正');
ok(g * (1 - (2 - 1e-8) / 2) > 0, '2gL下侧转折张力为正');
for (const r of [2 + 1e-8, 5 - 1e-8]) {
  const cosLoss = (2 - r) / 3;
  ok(cosLoss < 0 && cosLoss > -1 && r - 2 * (1 - cosLoss) > 0, '临界间松绳发生在最高点前且有正速度');
}
ok(g * ((5 + 1e-8) - 5) > 0, '5gL上侧过顶张力为正');

equal(output.sampleAtCollision.bodies, output.collisionEvent.bodyStatesAfter);
equal(output.sampleAtCollision.constraints, output.collisionEvent.constraintsAfter);
equal(Object.keys(output.collisionEvent.bodyStatesBefore), ['bob', 'target']);
equal(Object.keys(output.collisionEvent.bodyStatesAfter), ['bob', 'target']);
near(output.collisionEvent.bodyStatesBefore.bob.vxMps, u1); near(output.collisionEvent.bodyStatesAfter.bob.vxMps, v1);
near(output.collisionEvent.bodyStatesAfter.target.vxMps, v2); near(output.collisionEvent.timeSeconds, tc);
near(output.collisionEvent.constraintsBefore['string:bob'].tensionN, 20); near(output.collisionEvent.constraintsAfter['string:bob'].tensionN, 10);
equal(output.collisionEvent.kind, 'collision'); equal(output.collisionEvent.order, 3);
equal(output.endReason, output.termination.reason);
console.log(`摆与碰撞契约独立核对通过：${checks}条断言；新阶段运行时尚待联审后实现。`);
