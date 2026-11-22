/**
 * stage_plan → 旧 Reading 兼容桥（C · AI 接口）
 *
 * 背景：A 的前端还没接 `stage_plan`，所以线上默认输出旧首题回包。
 * 这里锁住三件事：
 * 1. 「斜面→转向→水平→弹簧」四段能无损压回旧 Reading
 * 2. 缺项路径要变回旧字段名（`/stages/2/end/distanceM` → `springGapM`）
 * 3. 旧界面渲染不了的形状必须降级为 unsupported，不能假装成功
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyLegacyContract, outputContractFromEnv, stagePlanToLegacyReading } from '../legacyBridge';
import { validateReading } from '../../physics/reading';
import { UNSUPPORTED_PREFIX } from '../contract';
import { buildStagePlanResult } from '../stageStatus';
import { validateStagePlan } from '../../physics';

const FIXTURES = resolve(__dirname, '../../../fixtures');

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8')) as Record<string, unknown>;
}

/**
 * 旧 `incline_spring` 模板对应的阶段组合：斜面 → 无损转向 → 水平 → 弹簧。
 *
 * 注意与 `fixtures/stage-composition.reading.json` 的区别：那份是契约第 5 节的
 * 共享样例，第 4 段是**平抛**，属于新能力，旧界面渲染不了，兼容桥应当降级。
 */
function springPlan(overrides: { distanceM?: number | null } = {}): Record<string, unknown> {
  return {
    kind: 'stage_plan',
    schemaVersion: 1,
    gravityMps2: 10,
    massKg: 1,
    initial: { speedMps: 0 },
    stages: [
      {
        kind: 'incline_slide',
        lengthM: 4,
        angleDeg: 37,
        kineticFrictionCoefficient: 0.5,
        slidesAfterRelease: true,
      },
      { kind: 'lossless_turn', lossless: true },
      {
        kind: 'horizontal_slide',
        kineticFrictionCoefficient: 0,
        // 用 in 判断：distanceM 传 null 是「题面没给」，不能被 ?? 当成缺省
        end: {
          kind: 'distance',
          distanceM: 'distanceM' in overrides ? overrides.distanceM : 1,
        },
      },
      { kind: 'spring_contact', springConstantNpm: 400, frictionless: true, unattached: true },
    ],
  };
}

/** 模型对「弹簧紧贴坡底」的题会省掉水平段，只给三段 */
function tightSpringPlan(): Record<string, unknown> {
  const plan = springPlan();
  plan.stages = (plan.stages as unknown[]).filter(
    (stage) => (stage as { kind?: string }).kind !== 'horizontal_slide',
  );
  return plan;
}

function toClient(plan: Record<string, unknown>) {
  const internal = buildStagePlanResult(plan, validateStagePlan, []);
  return applyLegacyContract(internal, validateReading, UNSUPPORTED_PREFIX);
}

describe('outputContractFromEnv', () => {
  it('默认 stage_plan，只有显式 legacy 才走兼容桥', () => {
    // 前端已接阶段计划（#19），默认值随之切换；漏配环境变量不应静默退回旧形状。
    expect(outputContractFromEnv(undefined)).toBe('stage_plan');
    expect(outputContractFromEnv('')).toBe('stage_plan');
    expect(outputContractFromEnv('stage_plan')).toBe('stage_plan');
    expect(outputContractFromEnv('legacy')).toBe('legacy');
  });
});

describe('stagePlanToLegacyReading', () => {
  it('弹簧四段能压回旧 Reading，字段一一对应', () => {
    const reading = stagePlanToLegacyReading(springPlan());

    expect(reading).not.toBeNull();
    expect(reading?.templateId).toBe('incline_spring');
    expect(reading?.conditions).toMatchObject({
      gravityMps2: 10,
      inclineAngleDeg: 37,
      inclineLengthM: 4,
      kineticFrictionCoefficient: 0.5,
      initialSpeedMps: 0,
      blockMassKg: 1,
      springGapM: 1,
      springConstantNpm: 400,
    });
    expect(reading?.facts).toMatchObject({
      slidesAfterRelease: true,
      losslessTurn: true,
      horizontalIsFrictionless: true,
      springIsUnattached: true,
    });
  });

  it('缺 distanceM 时 springGapM 为 null，不猜值', () => {
    const reading = stagePlanToLegacyReading(springPlan({ distanceM: null }));
    expect(reading?.conditions.springGapM).toBeNull();
  });

  it('含抛体的组合返回 null（旧界面渲染不了）', () => {
    expect(stagePlanToLegacyReading(readFixture('stage-composition.reading.json'))).toBeNull();
  });

  it('阶段数量不对时返回 null', () => {
    const plan = springPlan();
    plan.stages = (plan.stages as unknown[]).slice(0, 2);
    expect(stagePlanToLegacyReading(plan)).toBeNull();
  });

  it('三段接续（转向直接接弹簧）能压回旧 Reading，距离留空不猜', () => {
    const reading = stagePlanToLegacyReading(tightSpringPlan());

    expect(reading).not.toBeNull();
    expect(reading?.templateId).toBe('incline_spring');
    expect(reading?.conditions.springGapM).toBeNull();
    expect(reading?.conditions.springConstantNpm).toBe(400);
    expect(reading?.facts.horizontalIsFrictionless).toBe(true);
  });

  it('水平段有摩擦时如实标成有摩擦，不悄悄抹掉', () => {
    const plan = springPlan();
    const stages = plan.stages as Array<Record<string, unknown>>;
    stages[2].kineticFrictionCoefficient = 0.2;

    const reading = stagePlanToLegacyReading(plan);
    expect(reading?.facts.horizontalIsFrictionless).toBe(false);
  });

  it('水平段缺摩擦因数时退回弹簧段的无摩擦声明', () => {
    const plan = springPlan();
    const stages = plan.stages as Array<Record<string, unknown>>;
    delete stages[2].kineticFrictionCoefficient;

    const reading = stagePlanToLegacyReading(plan);
    expect(reading?.facts.horizontalIsFrictionless).toBe(true);
  });

  it('有初速度的题返回 null（旧模板只支持由静止释放）', () => {
    const plan = springPlan();
    plan.initial = { speedMps: 4 };
    expect(stagePlanToLegacyReading(plan)).toBeNull();
  });
});

describe('applyLegacyContract', () => {
  it('弹簧组合输出旧形状的 ok，不再是 stage_plan', () => {
    const result = toClient(springPlan());

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const reading = result.reading as { templateId?: string; kind?: string };
    expect(reading.templateId).toBe('incline_spring');
    expect(reading.kind).toBeUndefined();
  });

  it('缺项路径转回旧字段名，前端核对表才能高亮', () => {
    const result = toClient(springPlan({ distanceM: null }));

    expect(result.status).toBe('needs_input');
    if (result.status !== 'needs_input') return;
    expect(result.missingKeys).toEqual(['springGapM']);
    expect(result.missingKeys).not.toContain('/stages/2/end/distanceM');
  });

  it('含抛体的组合降级为 unsupported', () => {
    const result = toClient(readFixture('stage-composition.reading.json'));
    expect(result.status).toBe('unsupported');
    if (result.status !== 'unsupported') return;
    expect(result.message).toContain(UNSUPPORTED_PREFIX);
  });

  it('三段接续追问弹簧距离，而不是报超范围', () => {
    const result = toClient(tightSpringPlan());

    expect(result.status).toBe('needs_input');
    if (result.status !== 'needs_input') return;
    expect(result.missingKeys).toEqual(['springGapM']);
    expect(result.reading).toMatchObject({ templateId: 'incline_spring' });
  });

  it('水平段有摩擦时判超范围（旧模板只有光滑水平面）', () => {
    const plan = springPlan();
    (plan.stages as Array<Record<string, unknown>>)[2].kineticFrictionCoefficient = 0.2;

    const result = toClient(plan);
    expect(result.status).toBe('unsupported');
  });

  it('整题超范围原样透传，不二次加工', () => {
    const result = toClient({
      kind: 'stage_plan',
      schemaVersion: 1,
      gravityMps2: null,
      initial: { speedMps: null },
      stages: [],
      unsupportedReason: '带电粒子在磁场中做圆周运动',
    });

    expect(result.status).toBe('unsupported');
    if (result.status !== 'unsupported') return;
    expect(result.message).toBe('带电粒子在磁场中做圆周运动');
  });
});
