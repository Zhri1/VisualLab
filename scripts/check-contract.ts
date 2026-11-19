/**
 * 契约自检：不调用模型，直接跑校验层（C · AI 接口）
 *
 * 运行：npx --yes tsx scripts/check-contract.ts
 * 用途：改字段、改单位、改状态机之后，30 秒内确认四种回包仍然对得上 CONTRACTS.md。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildPlan } from '../src/api/validate';

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures', 'incline-spring.reading.json'), 'utf8'),
);

interface Case {
  name: string;
  input: unknown;
  expect: string;
  /** 期望的 missingKeys，用于 needs_input */
  missing?: string[];
  /** 期望的 assumptions 条目：ok 与 needs_input 都是 0–3 条，unsupported 没有该字段 */
  assumptions?: string[];
}

const clone = (): any => JSON.parse(JSON.stringify(fixture));

const missingGap = clone();
missingGap.conditions.springGapM = null;

/** 缺项同时带假设：needs_input 与 ok 同一形状，已识别的部分照样要透传 */
const missingGapWithAssumptions = clone();
missingGapWithAssumptions.conditions.springGapM = null;
missingGapWithAssumptions.assumptions = ['g=10 m/s²', 'μ=0.5', '倾角 37°'];

const frictionFloor = clone();
frictionFloor.facts.horizontalIsFrictionless = false;

const withInitialSpeed = clone();
withInitialSpeed.conditions.initialSpeedMps = 2;

const stringNumbers = clone();
stringNumbers.conditions.inclineLengthM = '4';
stringNumbers.conditions.springConstantNpm = '400';

const angleOutOfRange = clone();
angleOutOfRange.conditions.inclineAngleDeg = 120;

const cases: Case[] = [
  { name: '标准题', input: clone(), expect: 'ok' },
  { name: '缺弹簧间距', input: missingGap, expect: 'needs_input', missing: ['springGapM'] },
  {
    name: '缺弹簧间距且带假设',
    input: missingGapWithAssumptions,
    expect: 'needs_input',
    missing: ['springGapM'],
    assumptions: ['g=10 m/s²', 'μ=0.5', '倾角 37°'],
  },
  { name: '水平面有摩擦', input: frictionFloor, expect: 'unsupported' },
  { name: '有初速度', input: withInitialSpeed, expect: 'unsupported' },
  { name: '数字写成字符串', input: stringNumbers, expect: 'ok' },
  { name: '倾角 120°', input: angleOutOfRange, expect: 'needs_input', missing: ['inclineAngleDeg'] },
  {
    name: '超范围题型',
    input: { templateId: 'unsupported', conditions: {}, facts: {}, unsupportedReason: '带电粒子在磁场中做圆周运动' },
    expect: 'unsupported',
  },
  { name: '空回包（认不出题型）', input: {}, expect: 'needs_input' },
];

let failed = 0;

for (const testCase of cases) {
  const result = buildPlan(testCase.input);
  const okStatus = result.status === testCase.expect;
  const okMissing =
    !testCase.missing ||
    (result.status === 'needs_input' &&
      testCase.missing.every((key) => result.missingKeys.includes(key)));
  const okMessage =
    result.status !== 'ok' || (typeof result.message === 'string' && result.message.length > 0);

  // assumptions 只存在于 ok / needs_input；unsupported 是纯提示，不带假设
  const carried = result.status === 'ok' || result.status === 'needs_input' ? result.assumptions : null;
  const okAssumptionsShape =
    result.status !== 'needs_input' ||
    (Array.isArray(carried) &&
      carried.length <= 3 &&
      carried.every((item) => typeof item === 'string' && item.trim() !== ''));
  const okAssumptions =
    !testCase.assumptions ||
    (Array.isArray(carried) && testCase.assumptions.every((item) => carried.includes(item)));

  const failures: string[] = [];
  if (!okStatus) failures.push(`status 期望 ${testCase.expect}，实际 ${result.status}`);
  if (!okMissing) failures.push(`missingKeys 期望包含 ${testCase.missing?.join('、')}`);
  if (!okMessage) failures.push('ok 回包的 message 为空');
  if (!okAssumptionsShape) failures.push('needs_input 的 assumptions 不是 0–3 条的字符串数组');
  if (!okAssumptions) failures.push(`assumptions 期望包含 ${testCase.assumptions?.join('、')}`);

  if (failures.length === 0) {
    console.log(`✓ ${testCase.name} → ${result.status}`);
  } else {
    failed += 1;
    console.error(`✗ ${testCase.name}：${failures.join('；')}`);
    console.error('  ', JSON.stringify(result));
  }
}

if (failed > 0) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}

console.log(`\n${cases.length} 个用例全部通过`);
