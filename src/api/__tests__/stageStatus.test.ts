/**
 * stage_plan 状态映射的回归测试。
 *
 * 契约：STAGE_COMPOSITION.md 第 2 节映射表。
 * 重点：Node 与云函数共用本映射，四种 code 必须落到固定 status，INVALID_READING 必须是 502。
 */
import { describe, expect, it } from 'vitest';
import { buildStagePlanResult, httpStatusOf, toStagePlanResult } from '../stageStatus';
import { isStagePlan, stripReservedFields } from '../stageTypes';
import type { StagePlanDraft, StagePlanValidation } from '../stageTypes';

const DRAFT: StagePlanDraft = {
  kind: 'stage_plan',
  schemaVersion: 1,
  gravityMps2: 10,
  initial: { speedMps: 0 },
  stages: [{ kind: 'incline_slide' }],
};

describe('toStagePlanResult', () => {
  it('ok → status ok，reading 原样透传', () => {
    const validation: StagePlanValidation = { ok: true, reading: DRAFT };
    const result = toStagePlanResult(validation, { assumptions: [] });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.reading).toBe(DRAFT);
    expect(result.message).toBe('已按题面条件识别完成');
    expect(httpStatusOf(result)).toBe(200);
  });

  it('NEEDS_INPUT → needs_input，保留路径与字段错误', () => {
    const validation: StagePlanValidation = {
      ok: false,
      code: 'NEEDS_INPUT',
      message: '',
      reading: DRAFT,
      missingKeys: ['/stages/2/end/distanceM'],
      fieldErrors: [],
    };
    const result = toStagePlanResult(validation, { assumptions: [] });
    expect(result.status).toBe('needs_input');
    if (result.status !== 'needs_input') return;
    expect(result.missingKeys).toEqual(['/stages/2/end/distanceM']);
    expect(result.fieldErrors).toEqual([]);
    expect(result.reading).toBe(DRAFT);
    expect(httpStatusOf(result)).toBe(200);
  });

  it('INCONSISTENT_CONDITIONS 同样归入 needs_input', () => {
    const validation: StagePlanValidation = {
      ok: false,
      code: 'INCONSISTENT_CONDITIONS',
      message: '光滑面上无法因摩擦停止',
      reading: DRAFT,
      missingKeys: [],
      fieldErrors: [
        { path: '/stages/2/kineticFrictionCoefficient', code: 'PRECONDITION_CONFLICT', message: '光滑面' },
      ],
    };
    const result = toStagePlanResult(validation, { assumptions: [] });
    expect(result.status).toBe('needs_input');
    if (result.status !== 'needs_input') return;
    expect(result.fieldErrors).toHaveLength(1);
    expect(result.message).toBe('光滑面上无法因摩擦停止');
    expect(httpStatusOf(result)).toBe(200);
  });

  it('UNSUPPORTED → unsupported', () => {
    const validation: StagePlanValidation = {
      ok: false,
      code: 'UNSUPPORTED',
      message: '斜面直接接抛体，缺少水平段',
      reading: null,
      missingKeys: [],
      fieldErrors: [],
    };
    const result = toStagePlanResult(validation, { assumptions: [] });
    expect(result.status).toBe('unsupported');
    expect(httpStatusOf(result)).toBe(200);
    if (result.status !== 'unsupported') return;
    expect(result.message).toContain('缺少水平段');
  });

  it('INVALID_READING → 502，且不带 reading', () => {
    const validation: StagePlanValidation = {
      ok: false,
      code: 'INVALID_READING',
      message: '',
      reading: null,
      missingKeys: [],
      fieldErrors: [],
    };
    const result = toStagePlanResult(validation, { assumptions: [] });
    expect(result.status).toBe('invalid_reading');
    expect(httpStatusOf(result)).toBe(502);
    expect(result.message).toBe('模型回包无法解析为阶段计划，请重试。');
    expect('reading' in result).toBe(false);
  });

  it('message 为空时按 code 给默认提示', () => {
    const result = toStagePlanResult(
      {
        ok: false,
        code: 'NEEDS_INPUT',
        message: '   ',
        reading: null,
        missingKeys: [],
        fieldErrors: [],
      },
      { assumptions: [] },
    );
    expect(result.message).toBe('请补齐或确认标记的题设条件。');
  });
});

describe('isStagePlan / stripReservedFields', () => {  it('识别 stage_plan', () => {
    expect(isStagePlan({ kind: 'stage_plan' })).toBe(true);
    expect(isStagePlan({ templateId: 'incline_spring' })).toBe(false);
    expect(isStagePlan(null)).toBe(false);
    expect(isStagePlan('stage_plan')).toBe(false);
  });

  it('剥掉保留字段且不改原对象', () => {
    const input = { kind: 'stage_plan', stages: [], assumptions: ['题面未给 g'], unsupportedReason: '' };
    const stripped = stripReservedFields(input);
    expect(stripped).not.toHaveProperty('assumptions');
    expect(stripped).not.toHaveProperty('unsupportedReason');
    expect(stripped).toHaveProperty('kind', 'stage_plan');
    expect(input.assumptions).toEqual(['题面未给 g']);
  });
});

describe('buildStagePlanResult（两端共用入口）', () => {
  it('剥掉保留字段后再交给校验函数', () => {
    let received: Record<string, unknown> | null = null;
    const result = buildStagePlanResult(
      { kind: 'stage_plan', stages: [], assumptions: ['题面未给 g'], unsupportedReason: '' },
      (input) => {
        received = input as Record<string, unknown>;
        return { ok: true, reading: DRAFT };
      },
      ['题面未给 g'],
    );

    expect(received).not.toBeNull();
    expect(received).not.toHaveProperty('assumptions');
    expect(received).not.toHaveProperty('unsupportedReason');
    expect(result.status).toBe('ok');
  });

  it('校验失败时把 assumptions 一并带回', () => {
    const result = buildStagePlanResult(
      { kind: 'stage_plan', stages: [] },
      () => ({
        ok: false,
        code: 'NEEDS_INPUT',
        message: '缺少桌面距离',
        reading: null,
        missingKeys: ['/stages/2/end/distanceM'],
        fieldErrors: [],
      }),
      ['题面未给 g'],
    );

    expect(result.status).toBe('needs_input');
    if (result.status !== 'needs_input') return;
    expect(result.missingKeys).toEqual(['/stages/2/end/distanceM']);
    expect(result.assumptions).toEqual(['题面未给 g']);
  });
});
