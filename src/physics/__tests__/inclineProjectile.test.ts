import { describe, expect, it } from 'vitest';
import { assembleScene, assembleStageScene, buildMotion, buildStageMotion, truncateStagePlan, validateStagePlan } from '../index';
import type { StagePlanDraft, StageSample } from '../index';
import complete from '../../../fixtures/incline-projectile.reading.json';
import fixedPlane from '../../../fixtures/incline-projectile-fixed-plane.reading.json';
import beforeStop from '../../../fixtures/incline-projectile-stop-before.reading.json';
import atStop from '../../../fixtures/incline-projectile-stop-at.reading.json';
import uphill from '../../../fixtures/incline-projectile-uphill.reading.json';
import reference from '../../../fixtures/incline-projectile.acceptance.json';

function run(input: unknown) {
  const checked = validateStagePlan(input);
  if (!checked.ok) throw Error(JSON.stringify(checked));
  const a = assembleScene(checked.reading);
  if (!a.ok) throw Error(JSON.stringify(a));
  return buildMotion(a.scene).motion;
}
function state(actual: StageSample, expected: { xM: number; yM: number; vxMps: number; vyMps: number }, tolerance = 1e-10) {
  for (const k of ['xM', 'yM', 'vxMps', 'vyMps'] as const) expect(Math.abs(actual[k] - expected[k]), k).toBeLessThanOrEqual(tolerance);
  expect(actual.springCompressionM).toBe(0);
}
function edit(path: string[], value: unknown): StagePlanDraft {
  const result = structuredClone(complete) as unknown as StagePlanDraft;
  let target = result as unknown as Record<string, unknown>;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[path[path.length - 1]] = value;
  return result;
}

describe('斜面末端直接斜抛', () => {
  const slope = uphill.stages[0];
  const theta = 37 * Math.PI / 180;
  const aUp = 10 * (Math.sin(theta) + .25 * Math.cos(theta));
  const aDown = 10 * (Math.sin(theta) - .25 * Math.cos(theta));
  const criticalSpeed = Math.sqrt(2 * aUp * 2.5);

  it.each([4, criticalSpeed])('上滑初速 %s 未正速冲出坡顶，保留滑回坡底的末态', speed => {
    const motion = run({ ...uphill, initial: { speedMps: speed } });
    const distance = speed ** 2 / (2 * aUp);
    const returnSpeed = Math.sqrt(2 * aDown * distance);
    const turnTime = speed / aUp;
    expect(motion.durationSeconds).toBeCloseTo(turnTime + Math.sqrt(2 * distance / aDown), 12);
    expect(motion.events.map(e => e.kind)).toEqual(['release', 'incline_turn', 'reach_bottom']);
    expect(motion.segments.map(s => s.kind)).toEqual(['incline_slide']);
    expect(motion.geometry.projectile).toBeUndefined();
    expect(motion.endReason).toBe('returned_to_entry');
    expect(motion.termination.eventId).toBe(motion.events[motion.events.length - 1].id);
    state(motion.sampleAt(motion.events[1].timeSeconds), { xM: distance * Math.cos(theta), yM: distance * Math.sin(theta), vxMps: 0, vyMps: 0 });
    state(motion.sampleAt(Infinity), { xM: 0, yM: 0, vxMps: -returnSpeed * Math.cos(theta), vyMps: -returnSpeed * Math.sin(theta) });
  });

  it('静摩擦足以让物块恰停坡顶时只保留停止事件', () => {
    const motion = run({
      ...uphill, initial: { speedMps: criticalSpeed },
      stages: [{ ...slope, staticFrictionCoefficient: .8 }, uphill.stages[1]],
    });
    expect(motion.endReason).toBe('stop_at_target');
    expect(motion.events.map(e => e.kind)).toEqual(['release', 'stop']);
    expect(motion.geometry.projectile).toBeUndefined();
    state(motion.sampleAt(Infinity), { xM: 2.5 * Math.cos(theta), yM: 2.5 * Math.sin(theta), vxMps: 0, vyMps: 0 });
  });

  it.each([8, criticalSpeed + 1e-10])('上滑初速 %s 正速过顶后真实接斜抛', speed => {
    const motion = run({ ...uphill, initial: { speedMps: speed } });
    const reach = motion.events[1], launch = motion.events[2];
    expect([reach.kind, launch.kind]).toEqual(['reach_top', 'projectile_launch']);
    expect(reach.timeSeconds).toBe(launch.timeSeconds);
    expect(reach.velocityAfter).toEqual(launch.velocityBefore);
    expect(launch.velocityAfter.vyMps).toBeGreaterThan(0);
    expect(launch.velocityAfter.vyMps / launch.velocityAfter.vxMps).toBeCloseTo(Math.tan(theta), 12);
    expect(motion.geometry.projectile?.launch).toEqual(motion.geometry.incline?.end);
    expect(motion.endReason).toBe('landed');
    expect(motion.events[motion.events.length - 1].kind).toBe('land');
  });

  it.each([complete, fixedPlane])('两种地面都从檐口接斜向速度，首次落地速率为8', input => {
    const m = run(input), final = reference.cases[0].final!;
    expect(m.durationSeconds).toBeCloseTo(1.3928203230275509, 12);
    state(m.sampleAt(0), { xM: -2, yM: 1.5, vxMps: 0, vyMps: 0 });
    state(m.sampleAt(m.durationSeconds), final);
    expect(Math.hypot(final.vxMps, final.vyMps)).toBeCloseTo(8, 12);
    expect(m.geometry).toMatchObject({
      incline: { end: { xM: 0, yM: 0 } },
      projectile: { launch: { xM: 0, yM: 0 }, landingPlane: { yM: -1.95 } },
      positionReference: 'particle',
    });
    expect(m.segments.map(s => s.kind)).toEqual(['incline_slide', 'projectile']);
    expect(m.events.map(e => e.kind)).toEqual(['release', 'reach_bottom', 'projectile_launch', 'land']);
    const [reach, launch] = m.events.slice(1, 3);
    expect([reach.order, launch.order]).toEqual([1, 2]);
    expect([reach.stageIndex, launch.stageIndex]).toEqual([0, 1]);
    expect(reach.timeSeconds).toBe(launch.timeSeconds);
    expect(reach.velocityAfter).toEqual(launch.velocityBefore);
    expect(launch.velocityBefore).toEqual(launch.velocityAfter);
    expect(launch.label).toBe('离开檐口'); expect(reach.label).toBe('到达檐口');
    expect(m.endReason).toBe('landed'); expect(m.termination).toMatchObject({ reason: m.endReason, stageIndex: 1, eventId: m.events[m.events.length - 1].id });
  });

  it.each([complete, fixedPlane])('离檐近邻用1e-10绝对精度区分斜面与重力段', input => {
    const m = run(input), t = m.events[2].timeSeconds, e = reference.epsilonSeconds;
    const tolerance = reference.handoffAbsoluteToleranceSI;
    expect(tolerance).toBeLessThanOrEqual(1e-10);
    state(m.sampleAt(t - e), reference.handoffSamples.before, tolerance);
    state(m.sampleAt(t), reference.handoffSamples.at, tolerance);
    state(m.sampleAt(t + e), reference.handoffSamples.after, tolerance);
    // 两侧实际加速度由速度差独立核对；误用同一段不能通过。
    const before = m.sampleAt(t - e), at = m.sampleAt(t), after = m.sampleAt(t + e);
    expect((at.vxMps - before.vxMps) / e).toBeCloseTo(4, 5);
    expect((at.vyMps - before.vyMps) / e).toBeCloseTo(-3, 5);
    expect((after.vxMps - at.vxMps) / e).toBeCloseTo(0, 5);
    expect((after.vyMps - at.vyMps) / e).toBeCloseTo(-10, 5);
  });

  it.each([[beforeStop, 2], [atStop, 3]] as const)('停止优先，保留计划檐口且没有假飞行', (input, index) => {
    const m = run(input), expected = reference.cases[index];
    expect(m.durationSeconds).toBeCloseTo(1, 12);
    state(m.sampleAt(m.durationSeconds), expected.final!);
    expect(m.geometry.incline!.end).toEqual({ xM: 0, yM: 0 });
    expect(m.geometry.positionReference).toBe('particle');
    expect(m.geometry.projectile).toBeUndefined();
    expect(m.events.map(e => e.kind)).toEqual(['release', 'stop']);
    expect(m.segments.map(s => s.kind)).toEqual(['incline_slide']);
    expect(m.endReason).toBe(expected.terminationReason);
    expect(m.termination.eventId).toBe(m.events[1].id);
  });

  it.each([complete, fixedPlane, beforeStop, atStop])('负时间回初态，正超时回各自真实末态', input => {
    const m = run(input), start = m.sampleAt(0), final = m.sampleAt(m.durationSeconds);
    for (const t of [-1, -reference.epsilonSeconds, -Infinity]) expect(m.sampleAt(t)).toEqual(start);
    for (const offset of [0, reference.epsilonSeconds, 1, Infinity]) expect(m.sampleAt(m.durationSeconds + offset)).toEqual(final);
    if (input.initial.speedMps > 0) state(start, { xM: input === atStop ? -.8 : -2, yM: input === atStop ? .6 : 1.5, vxMps: 1.6, vyMps: -1.2 });
  });

  it('独立与统一两个模块入口一致，只看斜面保留原参数和斜向末速度', () => {
    const a = assembleStageScene(complete); if (!a.ok) throw Error(JSON.stringify(a));
    expect(buildStageMotion(a.scene).motion).toBe(a.scene.motion);
    expect(a.scene.motion.sampleAt(1)).toEqual(run(complete).sampleAt(1));
    const prefix = truncateStagePlan(complete as StagePlanDraft, 0), m = run(prefix);
    expect(prefix.initial).toEqual(complete.initial);
    expect(m.endReason).toBe('prefix_end'); expect(m.geometry.positionReference).toBe('front_bottom');
    expect(m.events.map(e => e.kind)).toEqual(['release', 'reach_bottom']);
    expect(m.geometry.projectile).toBeUndefined();
    for (const t of [m.durationSeconds, m.durationSeconds + 1e-7, Infinity]) state(m.sampleAt(t), reference.prefix.final);
    for (const t of [-1, -Infinity]) expect(m.sampleAt(t)).toEqual(m.sampleAt(0));
  });

  it.each(['dropHeightM', 'landingPlaneYM'])('零高度 %s 只保留同刻真实离檐与落地事件', key => {
    const p = structuredClone(complete) as StagePlanDraft; p.stages[1] = { kind: 'projectile', [key]: 0 };
    const m = run(p);
    expect(m.events.map(e => e.kind)).toEqual(['release', 'reach_bottom', 'projectile_launch', 'land']);
    expect(m.events.slice(1).every(e => e.timeSeconds === m.durationSeconds)).toBe(true);
    expect(m.segments.map(s => s.kind)).toEqual(['incline_slide']);
    state(m.sampleAt(m.durationSeconds), { xM: 0, yM: 0, vxMps: 4, vyMps: -3 });
    expect(m.endReason).toBe('landed');
  });

  it('光滑或匀速斜面、正速减速到檐口都继续沿真实切线', () => {
    for (const p of [edit(['stages', '0', 'kineticFrictionCoefficient'], 0),
      { ...beforeStop, stages: [{ ...beforeStop.stages[0], lengthM: .5 }, beforeStop.stages[1]] },
      { ...beforeStop, stages: [{ ...beforeStop.stages[0], kineticFrictionCoefficient: .75 }, beforeStop.stages[1]] }]) {
      const m = run(p), v = m.events.find(e => e.kind === 'projectile_launch')!.velocityAfter;
      expect(v.vxMps).toBeGreaterThan(0); expect(v.vyMps / v.vxMps).toBeCloseTo(-.75, 12);
      expect(m.endReason).toBe('landed');
    }
  });

  it.each([
    ['stages', '0', 'lengthM'], ['stages', '0', 'angleDeg'], ['stages', '0', 'kineticFrictionCoefficient'],
    ['gravityMps2'], ['initial', 'speedMps'], ['stages', '0', 'slidesAfterRelease'], ['stages', '1', 'dropHeightM'],
  ])('缺项 %j 只补对应值即可重新装配', (...path) => {
    const p = edit(path, null), r = validateStagePlan(p);
    expect(r).toMatchObject({ ok: false, code: 'NEEDS_INPUT', missingKeys: ['/' + path.join('/')] });
    if (r.ok) throw Error();
    let original: unknown = complete, target = r.reading as unknown as Record<string, unknown>;
    for (const [i, k] of path.entries()) { original = (original as Record<string, unknown>)[k]; if (i < path.length - 1) target = target[k] as Record<string, unknown>; }
    target[path[path.length - 1]] = original;
    expect(run(r.reading).endReason).toBe('landed');
  });

  it('显式固定地面缺项与高于檐口冲突各自定位', () => {
    const missing = { ...complete, stages: [complete.stages[0], { kind: 'projectile', landingPlaneYM: null }] };
    expect(validateStagePlan(missing)).toMatchObject({ ok: false, missingKeys: ['/stages/1/landingPlaneYM'] });
    expect(assembleStageScene({ ...missing, stages: [complete.stages[0], { kind: 'projectile', landingPlaneYM: 1 }] })).toMatchObject({ ok: false, fieldErrors: [{ path: '/stages/1/landingPlaneYM', code: 'PRECONDITION_CONFLICT' }] });
  });

  it('输入矛盾和坏值不能因停止后缀未执行而被吞掉', () => {
    expect(validateStagePlan(edit(['stages', '1', 'dropHeightM'], -1))).toMatchObject({ ok: false, fieldErrors: [{ path: '/stages/1/dropHeightM', code: 'RANGE' }] });
    expect(validateStagePlan(edit(['stages', '0', 'kineticFrictionCoefficient'], Infinity))).toMatchObject({ ok: false, fieldErrors: expect.arrayContaining([expect.objectContaining({ path: '/stages/0/kineticFrictionCoefficient', code: 'NOT_FINITE' })]) });
    expect(validateStagePlan({ ...beforeStop, stages: [beforeStop.stages[0], { kind: 'projectile', dropHeightM: null }] })).toMatchObject({ ok: false, missingKeys: ['/stages/1/dropHeightM'] });
    expect(validateStagePlan({ ...complete, initial: { speedMps: 0, vxMps: 4, vyMps: -3 } })).toMatchObject({ ok: false, fieldErrors: [{ path: '/initial' }] });
    expect(validateStagePlan({ ...complete, stages: [complete.stages[0], { kind: 'projectile', dropHeightM: 1.95, landingPlaneYM: -1.95 }] })).toMatchObject({ ok: false, fieldErrors: [{ path: '/stages/1', code: 'PRECONDITION_CONFLICT' }] });
    expect(validateStagePlan(edit(['stages', '0', 'kineticFrictionCoefficient'], 1))).toMatchObject({ ok: false, fieldErrors: [{ path: '/stages/0/kineticFrictionCoefficient', code: 'PRECONDITION_CONFLICT' }] });
  });
});
