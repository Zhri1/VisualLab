/**
 * 识别接口的分派与回包一致性（C · AI 接口）
 *
 * 这里测的是**对外入口** `buildPlanResponse`，不是 `validateStagePlan` 本身：
 * - `kind: "stage_plan"` 必须走阶段组合契约（STAGE_COMPOSITION.md 第 2 节）
 * - 旧 `templateId` 形状必须保持原有行为（历史数据回放）
 *
 * Node 服务与 Qoder 云函数都调这个入口，所以本文件的断言同时是两端的验收标准。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildPlanResponse } from '../validate';
import { STAGE_HTTP_STATUS } from '../stageTypes';
import type { StagePlanDraft } from '../stageTypes';

const FIXTURES = resolve(__dirname, '../../../fixtures');

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8')) as T;
}

/** 完整组合：斜面 → 无损转向 → 水平 5 m → 平抛 */
const COMPLETE = () => readFixture<Record<string, unknown>>('stage-composition.reading.json');

/** 同一道题，但水平段距离缺失，应产出 /stages/2/end/distanceM */
const MISSING_DISTANCE = () =>
  readFixture<Record<string, unknown>>('stage-missing-distance.reading.json');

describe('buildPlanResponse · stage_plan 分派', () => {
  it('完整组合返回 ok，reading 是 stage_plan 且四段顺序不变', () => {
    const result = buildPlanResponse(COMPLETE());

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const reading = result.reading as StagePlanDraft & {
      stages: Array<{ kind: string }>;
    };
    expect(reading.kind).toBe('stage_plan');
    expect(reading.schemaVersion).toBe(1);
    expect(reading.stages.map((stage) => stage.kind)).toEqual([
      'incline_slide',
      'lossless_turn',
      'horizontal_slide',
      'projectile',
    ]);
    expect(result.message.trim().length).toBeGreaterThan(0);
  });

  it('缺 distanceM 返回 needs_input，缺项路径指向第 3 段', () => {
    const result = buildPlanResponse(MISSING_DISTANCE());

    expect(result.status).toBe('needs_input');
    if (result.status !== 'needs_input') return;

    // 契约要求零基 JSON Pointer：/stages/2 是第三段（horizontal_slide）
    expect(result.missingKeys).toContain('/stages/2/end/distanceM');
    // 旧的 needs_input 不带 fieldErrors；阶段计划必须带（可以为空数组）
    expect('fieldErrors' in result ? result.fieldErrors : undefined).toEqual([]);
    expect(result.reading).not.toBeNull();
  });

  it('缺项时保留已识别的前两段，供前端填表', () => {
    const result = buildPlanResponse(MISSING_DISTANCE());
    if (result.status !== 'needs_input' || !result.reading) {
      throw new Error('应返回 needs_input 且保留 reading');
    }

    const stages = (result.reading as StagePlanDraft).stages as Array<Record<string, unknown>>;
    expect(stages).toHaveLength(4);
    expect(stages[0].kind).toBe('incline_slide');
    expect(stages[1].kind).toBe('lossless_turn');
  });

  it('assumptions 由识别层透传，不进入结构校验', () => {
    const result = buildPlanResponse({ ...COMPLETE(), assumptions: ['g=10 m/s²'] });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.assumptions).toEqual(['g=10 m/s²']);
  });

  it('斜面直接接抛体已登记，回包为200且不插入转向或水平段', () => {
    const plan = COMPLETE();
    const stages = plan.stages as unknown[];
    plan.stages = [stages[0], stages[3]];
    const result = buildPlanResponse(plan);

    expect(result.status).toBe('ok');
    expect(STAGE_HTTP_STATUS[result.status]).toBe(200);
    if (result.status !== 'ok') throw new Error('应支持沿斜面末端直接抛出');
    expect((result.reading as StagePlanDraft).stages.map(s => s.kind)).toEqual(['incline_slide', 'projectile']);
    expect(result.message.trim().length).toBeGreaterThan(0);
  });

  it('结构损坏返回 invalid_reading，HTTP 映射为 502', () => {
    const result = buildPlanResponse({ kind: 'stage_plan', schemaVersion: 1, stages: 'not-an-array' });

    expect(result.status).toBe('invalid_reading');
    expect(STAGE_HTTP_STATUS[result.status]).toBe(502);
  });
});

describe('buildPlanResponse · 旧模板不受影响', () => {
  it('templateId 形状仍走旧路径', () => {
    const result = buildPlanResponse(readFixture<Record<string, unknown>>('incline-spring.reading.json'));

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const reading = result.reading as { templateId?: string };
    expect(reading.templateId).toBe('incline_spring');
  });

  it('模型自报 unsupported 时仍是纯提示，不带 assumptions', () => {
    const result = buildPlanResponse({
      templateId: 'unsupported',
      conditions: {},
      facts: {},
      unsupportedReason: '带电粒子在磁场中做圆周运动',
    });

    expect(result.status).toBe('unsupported');
    expect('assumptions' in result).toBe(false);
  });
});
