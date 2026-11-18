/**
 * 真实照片验收脚本（C · AI 接口与部署）
 *
 * 用法：
 *   npx --yes tsx scripts/smoke.ts <图片路径> [接口地址]
 *   npx --yes tsx scripts/smoke.ts fixtures/standard.jpg http://127.0.0.1:8787
 *
 * 输出 HTTP 状态、耗时、实际模型和完整回包，用于 11/20 公网验收记录。
 */

import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

function mimeOf(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  throw new Error(`只支持 jpg / png，收到 ${ext || '无扩展名'}`);
}

async function main(): Promise<void> {
  const [, , imagePath, baseArg] = process.argv;
  if (!imagePath) {
    console.error('用法：npx --yes tsx scripts/smoke.ts <图片路径> [接口地址]');
    process.exit(1);
  }

  const base = (baseArg ?? process.env.API_BASE ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
  const buffer = readFileSync(imagePath);

  const form = new FormData();
  form.set('image', new Blob([buffer], { type: mimeOf(imagePath) }), basename(imagePath));

  const startedAt = Date.now();
  const response = await fetch(`${base}/api/animation/plan`, { method: 'POST', body: form });
  const elapsed = Date.now() - startedAt;

  const body = await response.json().catch(() => null);

  console.log(
    `HTTP ${response.status} · ${elapsed} ms · model=${response.headers.get('x-vision-model') ?? '-'} · id=${response.headers.get('x-request-id') ?? '-'}`,
  );
  console.log(JSON.stringify(body, null, 2));

  if (!response.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
