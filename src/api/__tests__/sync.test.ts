/**
 * 云函数与 Node 服务同源校验（C · AI 接口）
 *
 * Qoder 云函数只能打包 functions/，不能 import src/，所以共享实现是**复制**过去的。
 * 复制就有漂移风险：有人手改了 functions/legacyBridge.ts，两端回包就会不一致，
 * 而这种不一致只有在线上才会暴露。
 *
 * 这里把「复制规则」重新跑一遍，逐字比对磁盘上的产物。
 * 规则本身与 scripts/sync-functions.mjs 的 withDenoExtensions 相同，改动需同步。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');

/** 与 scripts/sync-functions.mjs 的 FILES 一致 */
const FILES = [
  { from: 'src/physics/bodyPlanError.ts', to: 'functions/bodyPlanError.ts' },
  { from: 'src/physics/horizontalKinematics.ts', to: 'functions/horizontalKinematics.ts' },
  { from: 'src/physics/horizontalTypes.ts', to: 'functions/horizontalTypes.ts' },
  { from: 'src/physics/bodyTrack.ts', to: 'functions/bodyTrack.ts' },
  { from: 'src/physics/horizontalDynamics.ts', to: 'functions/horizontalDynamics.ts' },
  { from: 'src/physics/horizontalPlan.ts', to: 'functions/horizontalPlan.ts' },
  { from: 'src/api/command.ts', to: 'functions/command.ts' },
  { from: 'src/api/stageCommand.ts', to: 'functions/stageCommand.ts' },
  { from: 'src/physics/geometryTypes.ts', to: 'functions/geometryTypes.ts' },
  { from: 'src/physics/quadrature.ts', to: 'functions/quadrature.ts' },
  { from: 'src/physics/kinematics.ts', to: 'functions/kinematics.ts' },
  { from: 'src/physics/multiBodyTypes.ts', to: 'functions/multiBodyTypes.ts' },
  { from: 'src/physics/pendulum.ts', to: 'functions/pendulum.ts' },
  { from: 'src/physics/collision.ts', to: 'functions/collision.ts' },
  { from: 'src/physics/multiBodyPlan.ts', to: 'functions/multiBodyPlan.ts' },
  { from: 'src/physics/springEnergy.ts', to: 'functions/springEnergy.ts' },
  { from: 'src/physics/stagePlan.ts', to: 'functions/stagePlan.ts' },
  { from: 'src/api/stageTypes.ts', to: 'functions/stageTypes.ts' },
  { from: 'src/api/stageStatus.ts', to: 'functions/stageStatus.ts' },
  { from: 'src/api/legacyBridge.ts', to: 'functions/legacyBridge.ts' },
];

/** 与 scripts/sync-functions.mjs 的 withDenoExtensions 一致 */
function withDenoExtensions(code: string): string {
  return code.replace(
    /(from\s+['"])(\.\/[^'"]+?)(['"])/g,
    (_match, head: string, specifier: string, tail: string) =>
      /\.(ts|tsx|js|mjs)$/.test(specifier) ? `${head}${specifier}${tail}` : `${head}${specifier}.ts${tail}`,
  );
}

function render(from: string, source: string): string {
  const header = [
    `// 由 scripts/sync-functions.mjs 从 ${from} 复制生成，请勿手改。`,
    '// 改动请改源文件后重新运行：node scripts/sync-functions.mjs',
    '',
  ].join('\n');
  return header + withDenoExtensions(source);
}

describe('云函数同步', () => {
  for (const { from, to } of FILES) {
    it(`${to} 与 ${from} 逐字一致`, () => {
      const source = readFileSync(resolve(ROOT, from), 'utf8');
      const actual = readFileSync(resolve(ROOT, to), 'utf8');

      expect(
        actual,
        `${to} 与源文件不一致，请运行 npm run sync:functions（不要手改 functions/ 下的副本）`,
      ).toBe(render(from, source));
    });
  }
});
