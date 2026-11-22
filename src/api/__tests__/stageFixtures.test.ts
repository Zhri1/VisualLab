/**
 * 契约用例：fixture 结构断言。
 *
 * 这些用例不依赖 B 的 validateStagePlan，先锁住「样例本身符合 STAGE_COMPOSITION.md」，
 * 等校验函数落地后再补一层「样例 → 校验结果」的断言。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCommand } from '../command';

const ROOT = resolve(__dirname, '../../../fixtures');

function load<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(ROOT, name), 'utf8')) as T;
}

interface StagePlanFixture {
  kind: string;
  schemaVersion: number;
  gravityMps2?: number | null;
  massKg?: number | null;
  initial: Record<string, unknown>;
  stages: Array<Record<string, unknown>>;
}

const EXPECTED_ORDER = ['incline_slide', 'lossless_turn', 'horizontal_slide', 'projectile'];

describe('fixtures/stage-composition.reading.json', () => {
  const plan = load<StagePlanFixture>('stage-composition.reading.json');

  it('顶层形状符合契约', () => {
    expect(plan.kind).toBe('stage_plan');
    expect(plan.schemaVersion).toBe(1);
    expect(plan.gravityMps2).toBe(10);
  });

  it('阶段顺序是 V1 允许的接续', () => {
    expect(plan.stages.map((s) => s.kind)).toEqual(EXPECTED_ORDER);
  });

  it('initial 只用标量形状', () => {
    expect(plan.initial).toEqual({ speedMps: 0 });
  });

  it('完整样例里没有 null 必填值', () => {
    const incline = plan.stages[0]!;
    expect(incline.lengthM).toBe(3.6);
    expect(incline.angleDeg).toBe(30);
    expect(incline.kineticFrictionCoefficient).toBe(0);
    expect(incline.slidesAfterRelease).toBe(true);

    const horizontal = plan.stages[2]!;
    expect(horizontal.end).toEqual({ kind: 'distance', distanceM: 5 });

    expect(plan.stages[3]!.dropHeightM).toBe(1.25);
  });
});

describe('fixtures/stage-missing-distance.reading.json', () => {
  const plan = load<StagePlanFixture>('stage-missing-distance.reading.json');

  it('只缺 distanceM，end.kind 仍保留为 distance', () => {
    const horizontal = plan.stages[2]!;
    expect(horizontal.end).toEqual({ kind: 'distance', distanceM: null });
  });

  it('其余阶段不受影响', () => {
    expect(plan.stages.map((s) => s.kind)).toEqual(EXPECTED_ORDER);
    expect(plan.stages[3]!.dropHeightM).toBe(1.25);
  });

  it('对应的缺项路径是 /stages/2/end/distanceM', () => {
    const horizontal = plan.stages[2]!;
    const end = horizontal.end as { kind: string; distanceM: number | null };
    const path = `/stages/2/end/distanceM`;
    expect(end.kind).toBe('distance');
    expect(end.distanceM).toBeNull();
    expect(path).toBe('/stages/2/end/distanceM');
  });
});

describe('fixtures/stage-truncate.command.json', () => {
  const fixture = load<{
    command: string;
    currentPlan: { stages: Array<{ kind: string }> };
    expected: { status: string; intent: { type: string; throughStageIndex: number } };
  }>('stage-truncate.command.json');

  it('「只看斜面」解析为第 1 段', () => {
    const result = parseCommand(fixture.command, fixture.currentPlan);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.intent).toEqual(fixture.expected.intent);
  });

  it('截断后的前缀仍以斜面开头', () => {
    const kept = fixture.currentPlan.stages.slice(0, fixture.expected.intent.throughStageIndex + 1);
    expect(kept.map((s) => s.kind)).toEqual(['incline_slide']);
  });
});
