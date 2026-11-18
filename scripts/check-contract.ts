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
}

const clone = (): any => JSON.parse(JSON.stringify(fixture));

const missingGap = clone();
missingGap.conditions.springGapM = null;

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
  { name: '水平面有摩擦', input: frictionFloor, expect: 'unsupported' },
  { name: '有初速度', input: withInitialSpeed, expect: 'unsupported' },
  { name: '数字写成字符串', input: stringNumbers, expect: 'ok' },
  { name: '倾角 120°', input: angleOutOfRange, expect: 'needs_input', missing: ['inclineAngleDeg'] },
  {
    name: '超范围题型',
    input: { templateId: 'unsupported', conditions: {}, facts: {}, unsupportedReason: '带电粒子在磁场中做圆周运动' },
    expect: 'unsupported',
  },
  { name: '空回包', input: {}, expect: 'unsupported' },
];

let failed = 0;

for (const testCase of cases) {
  const result = buildPlan(testCase.input);
  const okStatus = result.status === testCase.expect;
  const okMissing =
    !testCase.missing ||
    (result.status === 'needs_input' &&
      testCase.missing.every((key) => result.missingKeys.includes(key)));

  if (okStatus && okMissing) {
    console.log(`✓ ${testCase.name} → ${result.status}`);
  } else {
    failed += 1;
    console.error(`✗ ${testCase.name}：期望 ${testCase.expect}，实际 ${result.status}`);
    console.error('  ', JSON.stringify(result));
  }
}

if (failed > 0) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}

console.log(`\n${cases.length} 个用例全部通过`);
