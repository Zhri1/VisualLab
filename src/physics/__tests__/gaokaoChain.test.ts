import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assembleScene, buildMotion, validateStagePlan, type StageMotion } from '../index';

const build = (plan: unknown): StageMotion => {
  const assembled = assembleScene(plan);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled));
  if (!('kind' in assembled.scene)) throw new Error('需要阶段场景');
  return buildMotion(assembled.scene).motion;
};

const close = (actual: number, expected: number, tol = 1e-4) =>
  expect(Math.abs(actual - expected), `actual=${actual}, expected=${expected}`).toBeLessThanOrEqual(tol);

const EXACT_53_DEG = (Math.atan2(4, 3) * 180) / Math.PI;

function gaokaoFourStagePlan(angleDeg = EXACT_53_DEG) {
  return {
    kind: 'stage_plan',
    schemaVersion: 1,
    massKg: 2,
    gravityMps2: 10,
    initial: { vxMps: 6, vyMps: 0 },
    stages: [
      { kind: 'projectile', dropHeightM: 3.2 },
      {
        kind: 'vertical_arc',
        radiusM: 5,
        side: 'inside',
        frictionless: true,
        path: {
          startAngleDeg: -angleDeg,
          direction: 'positive',
          end: { kind: 'physical_endpoint', sweepAngleDeg: angleDeg },
        },
      },
      {
        kind: 'horizontal_slide',
        kineticFrictionCoefficient: 0.25,
        end: { kind: 'distance', distanceM: 8 },
      },
      {
        kind: 'vertical_arc',
        radiusM: 2,
        side: 'inside',
        frictionless: true,
        path: {
          startAngleDeg: 0,
          direction: 'positive',
          end: { kind: 'observation', sweepAngleDeg: 360 },
        },
      },
    ],
  };
}

describe('高考多阶段接续矩阵与显式圆弧自动圆心', () => {
  it('经典高考四段真题基准（精确 3-4-5 角）：B/C/D/E 与回底 D 关键物理量精确匹配', () => {
    const plan = gaokaoFourStagePlan(EXACT_53_DEG);
    expect(validateStagePlan(plan).ok).toBe(true);
    const motion = build(plan);

    expect(motion.segments.map((s) => s.kind)).toEqual([
      'projectile',
      'vertical_arc',
      'horizontal_slide',
      'vertical_arc',
    ]);
    expect(motion.endReason).toBe('prefix_end');
    expect(motion.motionStatus?.state).toBe('range_end');

    // 中间抛体段触发 reach_target 而非 land
    expect(motion.events.some((e) => e.stageIndex === 0 && e.kind === 'land')).toBe(false);
    const bEvent = motion.events.find((e) => e.stageIndex === 0 && e.kind === 'reach_target')!;
    expect(bEvent).toBeDefined();
    close(bEvent.timeSeconds, 0.8, 1e-10);
    const bState = motion.sampleAt(bEvent.timeSeconds);
    close(bState.xM, 4.8, 1e-10);
    close(bState.yM, -3.2, 1e-10);
    close(Math.hypot(bEvent.velocityAfter.vxMps, bEvent.velocityAfter.vyMps), 10, 1e-10);

    // C 点（第一段圆弧最低点出口）：vC = √140 ≈ 11.8322 m/s，支持力 N = 76 N
    const cEvent = motion.events.find((e) => e.stageIndex === 1 && e.kind === 'arc_endpoint')!;
    expect(cEvent).toBeDefined();
    close(Math.hypot(cEvent.velocityBefore.vxMps, cEvent.velocityBefore.vyMps), Math.sqrt(140), 1e-9);
    close(cEvent.normalForceBeforeN!, 76, 1e-9);
    close(cEvent.position!.xM, 8.8, 1e-9);
    close(cEvent.position!.yM, -5.2, 1e-9);

    // D 点（水平段终点 / 第二段圆弧入口）：vD = 10 m/s
    const dEnter = motion.events.find((e) => e.stageIndex === 3 && e.kind === 'arc_enter')!;
    expect(dEnter).toBeDefined();
    close(Math.hypot(dEnter.velocityAfter.vxMps, dEnter.velocityAfter.vyMps), 10, 1e-9);
    close(dEnter.position!.xM, 16.8, 1e-9);
    close(dEnter.position!.yM, -5.2, 1e-9);
    close(dEnter.normalForceAfterN!, 120, 1e-9);

    // E 点（第二段圆弧最高点）：临界过顶 vE = √20 ≈ 4.4721 m/s，N = 0 且仍保持约束
    const eTop = motion.events.find((e) => e.stageIndex === 3 && e.kind === 'arc_top')!;
    expect(eTop).toBeDefined();
    close(Math.hypot(eTop.velocityAfter.vxMps, eTop.velocityAfter.vyMps), Math.sqrt(20), 1e-9);
    close(eTop.normalForceAfterN!, 0, 1e-9);
    expect(motion.sampleAt(eTop.timeSeconds).constraint).toBeDefined();

    // 回底 D 点：支持力 N = 120 N，观察一圈结束
    const dReturn = motion.events.find((e) => e.stageIndex === 3 && e.kind === 'arc_range_end')!;
    expect(dReturn).toBeDefined();
    close(Math.hypot(dReturn.velocityAfter.vxMps, dReturn.velocityAfter.vyMps), 10, 1e-9);
    close(dReturn.normalForceAfterN!, 120, 1e-9);
    const finalSample = motion.sampleAt(Infinity);
    close(finalSample.constraint!.normalForceN, 120, 1e-9);

    // 全程机械能 + 摩擦耗能守恒
    const e0 = motion.energyAt!(0)!;
    const total0 = e0.kineticJ + e0.gravitationalPotentialJ! + e0.frictionHeatJ;
    for (const t of [0.4, bEvent.timeSeconds, cEvent.timeSeconds, dEnter.timeSeconds, eTop.timeSeconds, motion.durationSeconds]) {
      const et = motion.energyAt!(t)!;
      close(et.kineticJ + et.gravitationalPotentialJ! + et.frictionHeatJ, total0, 1e-8);
    }
  });

  it('高考整数角 -53° 与 3-4-5 切向差异在 0.03 rad 容差内通过校验并准确求解', () => {
    const plan = gaokaoFourStagePlan(53);
    expect(validateStagePlan(plan).ok).toBe(true);
    const motion = build(plan);

    const bEvent = motion.events.find((e) => e.stageIndex === 0 && e.kind === 'reach_target')!;
    close(Math.hypot(bEvent.velocityAfter.vxMps, bEvent.velocityAfter.vyMps), 10, 1e-9);

    const cEvent = motion.events.find((e) => e.stageIndex === 1 && e.kind === 'arc_endpoint')!;
    close(Math.hypot(cEvent.velocityBefore.vxMps, cEvent.velocityBefore.vyMps), Math.sqrt(100 + 100 * (1 - Math.cos((53 * Math.PI) / 180))), 1e-9);
    close(cEvent.normalForceBeforeN!, 76, 0.1);

    const dEnter = motion.events.find((e) => e.stageIndex === 3 && e.kind === 'arc_enter')!;
    close(Math.hypot(dEnter.velocityAfter.vxMps, dEnter.velocityAfter.vyMps), 10, 0.02);
  });

  it('首段显式圆弧省略 center 时默认从 (0, 0) 入弧并自动反算圆心', () => {
    const plan = {
      kind: 'stage_plan',
      schemaVersion: 1,
      massKg: 1,
      gravityMps2: 10,
      initial: { speedMps: 5 },
      stages: [
        {
          kind: 'vertical_arc',
          radiusM: 2,
          side: 'inside',
          frictionless: true,
          path: {
            startAngleDeg: -30,
            direction: 'positive',
            end: { kind: 'physical_endpoint', sweepAngleDeg: 30 },
          },
        },
      ],
    };
    expect(validateStagePlan(plan).ok).toBe(true);
    const motion = build(plan);
    const arc = motion.geometry.verticalArc!;
    close(arc.entry.xM, 0, 1e-12);
    close(arc.entry.yM, 0, 1e-12);
    close(arc.center.xM, 1, 1e-12);
    close(arc.center.yM, Math.sqrt(3), 1e-12);
  });

  it('圆弧提前脱轨或转折回滑时，不执行后继 horizontal_slide 且保持原终止原因', () => {
    // 提前脱轨：从最低点以 u² = 4gR < 5gR 出发，sweep 180°，在到达实体端点前脱轨
    const detachPlan = {
      kind: 'stage_plan',
      schemaVersion: 1,
      massKg: 1,
      gravityMps2: 10,
      initial: { speedMps: Math.sqrt(40) },
      stages: [
        {
          kind: 'vertical_arc',
          radiusM: 1,
          side: 'inside',
          frictionless: true,
          path: {
            startAngleDeg: 0,
            direction: 'positive',
            end: { kind: 'physical_endpoint', sweepAngleDeg: 180 },
          },
        },
        {
          kind: 'horizontal_slide',
          kineticFrictionCoefficient: 0.2,
          end: { kind: 'distance', distanceM: 5 },
        },
      ],
    };
    const detachMotion = build(detachPlan);
    expect(detachMotion.endReason).toBe('arc_detached');
    expect(detachMotion.segments.map((s) => s.kind)).toEqual(['vertical_arc']);
    expect(detachMotion.geometry.horizontal).toBeUndefined();

    // 转折回滑：从最低点以 u² = gR 出发，sweep 90°，在 60° 处转折回滑
    const turnPlan = {
      ...detachPlan,
      initial: { speedMps: Math.sqrt(10) },
      stages: [
        {
          kind: 'vertical_arc',
          radiusM: 1,
          side: 'inside',
          frictionless: true,
          path: {
            startAngleDeg: 0,
            direction: 'positive',
            end: { kind: 'physical_endpoint', sweepAngleDeg: 90 },
          },
        },
        detachPlan.stages[1],
      ],
    };
    const turnMotion = build(turnPlan);
    expect(turnMotion.endReason).toBe('returned_to_entry');
    expect(turnMotion.segments.map((s) => s.kind)).toEqual(['vertical_arc']);
    expect(turnMotion.geometry.horizontal).toBeUndefined();
  });

  it('切向明显不匹配时返回可定位的 PRECONDITION_CONFLICT', () => {
    // projectile → vertical_arc：来向约 -53.13°，圆弧入口声明 -30°
    const badProjArc = gaokaoFourStagePlan(30);
    expect(assembleScene(badProjArc)).toMatchObject({
      ok: false,
      code: 'INCONSISTENT_CONDITIONS',
      fieldErrors: [{ path: '/stages/1/path', code: 'PRECONDITION_CONFLICT' }],
    });

    // vertical_arc → horizontal_slide：出口在 -23° 非水平
    const badArcHoriz = {
      kind: 'stage_plan',
      schemaVersion: 1,
      massKg: 2,
      gravityMps2: 10,
      initial: { vxMps: 6, vyMps: 0 },
      stages: [
        { kind: 'projectile', dropHeightM: 3.2 },
        {
          kind: 'vertical_arc',
          radiusM: 5,
          side: 'inside',
          frictionless: true,
          path: {
            startAngleDeg: -EXACT_53_DEG,
            direction: 'positive',
            end: { kind: 'physical_endpoint', sweepAngleDeg: 30 },
          },
        },
        {
          kind: 'horizontal_slide',
          kineticFrictionCoefficient: 0.25,
          end: { kind: 'distance', distanceM: 5 },
        },
      ],
    };
    expect(assembleScene(badArcHoriz)).toMatchObject({
      ok: false,
      code: 'INCONSISTENT_CONDITIONS',
      fieldErrors: [{ path: '/stages/2', code: 'PRECONDITION_CONFLICT' }],
    });

    // vertical_arc → vertical_arc：上段出口水平 (0°)，下段入口声明 45°
    const badArcArc = {
      kind: 'stage_plan',
      schemaVersion: 1,
      massKg: 1,
      gravityMps2: 10,
      initial: { speedMps: 6 },
      stages: [
        {
          kind: 'vertical_arc',
          radiusM: 2,
          side: 'inside',
          frictionless: true,
          path: {
            startAngleDeg: -30,
            direction: 'positive',
            end: { kind: 'physical_endpoint', sweepAngleDeg: 30 },
          },
        },
        {
          kind: 'vertical_arc',
          radiusM: 2,
          side: 'inside',
          frictionless: true,
          path: {
            startAngleDeg: 45,
            direction: 'positive',
            end: { kind: 'observation', sweepAngleDeg: 90 },
          },
        },
      ],
    };
    expect(assembleScene(badArcArc)).toMatchObject({
      ok: false,
      code: 'INCONSISTENT_CONDITIONS',
      fieldErrors: [{ path: '/stages/1/path', code: 'PRECONDITION_CONFLICT' }],
    });
  });

  it('支持 projectile → incline_slide 切向落入斜面，并拒绝切向不匹配的斜面', () => {
    const plan = {
      kind: 'stage_plan',
      schemaVersion: 1,
      gravityMps2: 10,
      initial: { vxMps: 6, vyMps: 0 },
      stages: [
        { kind: 'projectile', dropHeightM: 3.2 },
        { kind: 'incline_slide', lengthM: 5, angleDeg: 53, kineticFrictionCoefficient: 0 },
      ],
    };
    const motion = build(plan);
    expect(motion.segments.map((s) => s.kind)).toEqual(['projectile', 'incline_slide']);
    close(motion.geometry.incline!.start.xM, 4.8, 1e-9);
    close(motion.geometry.incline!.start.yM, -3.2, 1e-9);
    const rad = (53 * Math.PI) / 180;
    close(motion.geometry.incline!.end.xM, 4.8 + 5 * Math.cos(rad), 1e-9);
    close(motion.geometry.incline!.end.yM, -3.2 - 5 * Math.sin(rad), 1e-9);
    const endSpeed = Math.hypot(motion.sampleAt(Infinity).vxMps, motion.sampleAt(Infinity).vyMps);
    close(endSpeed, Math.sqrt(100 + 2 * 10 * Math.sin(rad) * 5), 1e-9);

    const mismatch = {
      ...plan,
      stages: [plan.stages[0], { kind: 'incline_slide', lengthM: 5, angleDeg: 30, kineticFrictionCoefficient: 0 }],
    };
    expect(assembleScene(mismatch)).toMatchObject({
      ok: false,
      code: 'INCONSISTENT_CONDITIONS',
      fieldErrors: [{ path: '/stages/1', code: 'PRECONDITION_CONFLICT' }],
    });
  });

  it('支持预压释放 → 水平 → 180°圆弧 → 向左平抛 → 切向进入左下斜面（含摩擦能量守恒）与 lossless_turn → 下滑斜面', () => {
    // 预压释放：k = 200 N/m, x0 = 0.5 m => Ep = 25 J，m = 1 kg, μ = 0 => v = √50
    // 水平滑行：μ = 0.2, d = 1 m => 损能 2 J => v_底² = 46
    // 半圆轨：R = 0.5 m, 180° => 最高点 y = 1.0 m, v_顶² = 46 - 20 = 26，方向向左 (vx = -√26, vy = 0)
    // 平抛落回 y = 0（落差 1.0 m）：落地 vy = -√20，速度倾角 θ = atan(√(20/26))
    // 左下斜面：倾角 θ，长 L = 2 m，动摩擦因数 μ = 0.25，沿左下方向下滑
    const thetaDeg = (Math.atan2(Math.sqrt(20), Math.sqrt(26)) * 180) / Math.PI;
    const rad = (thetaDeg * Math.PI) / 180;
    const fiveStage = {
      kind: 'stage_plan',
      schemaVersion: 1,
      gravityMps2: 10,
      massKg: 1,
      initial: { speedMps: 0 },
      stages: [
        { kind: 'spring_release', springConstantNpm: 200, initialCompressionM: 0.5, kineticFrictionCoefficient: 0, unattached: true, slidesAfterRelease: true },
        { kind: 'horizontal_slide', kineticFrictionCoefficient: 0.2, end: { kind: 'distance', distanceM: 1 } },
        { kind: 'vertical_arc', radiusM: 0.5, endAngleDeg: 180, side: 'inside', frictionless: true },
        { kind: 'projectile', landingPlaneYM: 0 },
        { kind: 'incline_slide', lengthM: 2, angleDeg: thetaDeg, kineticFrictionCoefficient: 0.25 },
      ],
    };
    const motion = build(fiveStage);
    expect(motion.segments.map((s) => s.kind)).toEqual([
      'spring_release',
      'horizontal_slide',
      'vertical_arc',
      'projectile',
      'incline_slide',
    ]);
    const inc = motion.geometry.incline!;
    // 左下斜面终点 x 小于起点 x、y 小于起点 y
    expect(inc.end.xM).toBeLessThan(inc.start.xM);
    expect(inc.end.yM).toBeLessThan(inc.start.yM);
    close(inc.end.xM - inc.start.xM, -2 * Math.cos(rad), 1e-9);
    close(inc.end.yM - inc.start.yM, -2 * Math.sin(rad), 1e-9);
    // 验证左下斜面摩擦方向正确：a = g(sinθ - μcosθ)
    const finalSample = motion.sampleAt(Infinity);
    const expectedV2 = 46 + 2 * 10 * (Math.sin(rad) - 0.25 * Math.cos(rad)) * 2;
    close(Math.hypot(finalSample.vxMps, finalSample.vyMps) ** 2, expectedV2, 1e-6);
    expect(finalSample.vxMps).toBeLessThan(0);
    expect(finalSample.vyMps).toBeLessThan(0);

    // 额外验证 horizontal_slide → lossless_turn → incline_slide(down) 不被误判切向冲突
    const turnIncline = {
      kind: 'stage_plan',
      schemaVersion: 1,
      gravityMps2: 10,
      initial: { speedMps: 4 },
      stages: [
        { kind: 'horizontal_slide', kineticFrictionCoefficient: 0, end: { kind: 'distance', distanceM: 2 } },
        { kind: 'lossless_turn', lossless: true },
        { kind: 'incline_slide', lengthM: 3, angleDeg: 30, kineticFrictionCoefficient: 0 },
      ],
    };
    const turnMotion = build(turnIncline);
    expect(turnMotion.segments.map((s) => s.kind)).toEqual(['horizontal_slide', 'incline_slide']);
    close(Math.hypot(turnMotion.sampleAt(Infinity).vxMps, turnMotion.sampleAt(Infinity).vyMps) ** 2, 16 + 30, 1e-6);
  });

  it('支持 vertical_arc → spring_contact / constant_force_1d / vertical_arc 顺畅接续', () => {
    // vertical_arc → spring_contact
    const arcSpring = {
      kind: 'stage_plan',
      schemaVersion: 1,
      massKg: 2,
      gravityMps2: 10,
      initial: { speedMps: 4 },
      stages: [
        {
          kind: 'vertical_arc',
          radiusM: 2,
          side: 'inside',
          frictionless: true,
          path: {
            startAngleDeg: -60,
            direction: 'positive',
            end: { kind: 'physical_endpoint', sweepAngleDeg: 60 },
          },
        },
        { kind: 'spring_contact', springConstantNpm: 100, frictionless: true, unattached: true },
      ],
    };
    const springMotion = build(arcSpring);
    expect(springMotion.segments.map((s) => s.kind)).toEqual(['vertical_arc', 'spring_contact']);
    expect(springMotion.endReason).toBe('spring_detached');

    // vertical_arc → constant_force_1d
    const arcForce = {
      ...arcSpring,
      stages: [
        arcSpring.stages[0],
        { kind: 'constant_force_1d', netForceXN: -4, end: { kind: 'stop' } },
      ],
    };
    const forceMotion = build(arcForce);
    expect(forceMotion.segments.map((s) => s.kind)).toEqual(['vertical_arc', 'constant_force_1d']);
    expect(forceMotion.endReason).toBe('stopped');

    // vertical_arc → vertical_arc（连续两段同切向圆弧）
    const arcArc = {
      ...arcSpring,
      stages: [
        arcSpring.stages[0],
        {
          kind: 'vertical_arc',
          radiusM: 1,
          side: 'inside',
          frictionless: true,
          path: {
            startAngleDeg: 0,
            direction: 'positive',
            end: { kind: 'observation', sweepAngleDeg: 90 },
          },
        },
      ],
    };
    const arcArcMotion = build(arcArc);
    expect(arcArcMotion.segments.map((s) => s.kind)).toEqual(['vertical_arc', 'vertical_arc']);
    expect(arcArcMotion.endReason).toBe('prefix_end');
  });

  it('显式提供 center 的旧圆轨样例 100% 兼容且仍执行严格坐标匹配校验', () => {
    const inclineFixture = JSON.parse(
      readFileSync(new URL('../../../fixtures/circular-track-incline.reading.json', import.meta.url), 'utf8'),
    );
    const motion = build(inclineFixture);
    expect(motion.endReason).toBe('landed');
    expect(motion.geometry.verticalArc?.center).toEqual(inclineFixture.stages[1].path.center);

    // 显式 center 偏离时仍报 PRECONDITION_CONFLICT
    inclineFixture.stages[1].path.center.xM += 0.05;
    expect(assembleScene(inclineFixture)).toMatchObject({
      ok: false,
      code: 'INCONSISTENT_CONDITIONS',
      fieldErrors: [{ path: '/stages/1/path', code: 'PRECONDITION_CONFLICT' }],
    });
  });

  it('端到端联调：共享声明式高考四段样例通过 validateStagePlan → assembleScene → buildMotion 并保留推导来源、多圆弧几何与 A~E 地标', () => {
    const raw = JSON.parse(
      readFileSync(new URL('../../../fixtures/gaokao-proj-arc-horiz-loop.reading.json', import.meta.url), 'utf8'),
    );
    const validated = validateStagePlan(raw);
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error(JSON.stringify(validated));
    const motion = build(validated.reading);
    expect(motion.segments.map((s) => s.kind)).toEqual(['projectile', 'vertical_arc', 'horizontal_slide', 'vertical_arc']);
    expect(motion.geometry.verticalArcs?.length).toBe(2);
    expect(motion.geometry.horizontals?.length).toBe(1);
    expect(motion.geometry.projectiles?.length).toBe(1);
    expect(motion.geometry.landmarks?.map((l) => l.label)).toEqual(['A', 'B', 'C', 'D', 'E']);
    const dPos = motion.geometry.landmarks!.find((l) => l.label === 'D')!.position;
    const ePos = motion.geometry.landmarks!.find((l) => l.label === 'E')!.position;
    expect(ePos.yM).toBeGreaterThan(dPos.yM + 3.5);
    expect(motion.calculations?.map((c) => c.quantity)).toEqual([
      'projectile_drop_height',
      'arc_radius',
      'critical_arc_top_radius',
    ]);
    const arcTop = motion.events.find((e) => e.stageIndex === 3 && e.kind === 'arc_top')!;
    expect(arcTop.normalForceAfterN).toBeCloseTo(0, 6);
  });
});
