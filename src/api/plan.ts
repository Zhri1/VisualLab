/**
 * POST /api/animation/plan（C · AI 接口）
 *
 * 契约见 CONTRACTS.md 第 2 节。回包状态只有三种 200（ok / needs_input / unsupported）
 * 加三种错误码（400 图片无效、502 识别失败、504 超时）。
 *
 * 这个文件不绑定框架：直接吃 Web 标准的 Request，吐 Response。
 * - Next.js App Router：export async function POST(req: Request) { return handlePlan(req) }
 * - Node http：见 src/api/server.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { callVisionModel, VisionError } from './dashscope';
import { applyLegacyContract, outputContractFromEnv, type ClientResult } from './legacyBridge';
import { STAGE_HTTP_STATUS } from './stageTypes';
import type { StagePlanResult } from './stageTypes';
import { buildPlanResponse, type PlanResponse } from './validate';
import { UNSUPPORTED_PREFIX } from './contract';
import { validateReading } from '../physics/reading';

/**
 * 判断回包是否来自阶段计划路径。
 *
 * `unsupported` 和 `needs_input + reading:null` 两支与旧模板形状重叠，
 * 但兼容桥对它们原样返回，判错不影响结果。
 */
function isStagePlanResult(result: PlanResponse): result is StagePlanResult {
  if (result.status === 'invalid_reading') return true;
  if (!('reading' in result)) return false;
  const reading = result.reading;
  return (
    reading !== null &&
    typeof reading === 'object' &&
    (reading as Record<string, unknown>).kind === 'stage_plan'
  );
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_EDGE_HINT = '单张图片请控制在 8 MB 以内';

/** 按文件头判断真实格式，不信任前端声明的 content-type */
function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte)) {
    return 'image/png';
  }
  return null;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

let cachedSkill: string | null = null;

/**
 * 默认发 v2（阶段组合版）。v1 只用于回放历史数据，不再作为默认。
 * 云函数不走文件读取，而是内联常量（见 functions/skill.ts）。
 */
export function loadSkillText(): string {
  if (cachedSkill) return cachedSkill;

  const candidates = [
    process.env.SKILL_PATH,
    join(process.cwd(), 'skills', 'vision-reading.v2.md'),
    join(process.cwd(), '..', 'skills', 'vision-reading.v2.md'),
  ].filter((item): item is string => Boolean(item));

  for (const path of candidates) {
    try {
      cachedSkill = readFileSync(path, 'utf8');
      return cachedSkill;
    } catch {
      // 继续找下一个候选路径
    }
  }

  throw new Error('未找到 skills/vision-reading.v2.md，可用 SKILL_PATH 指定绝对路径');
}

function corsHeaders(request: Request): Record<string, string> {
  const allowed = (process.env.ALLOWED_ORIGINS ?? '*')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const headers: Record<string, string> = {
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  };

  const origin = request.headers.get('origin') ?? '';
  if (allowed.includes('*')) {
    headers['access-control-allow-origin'] = '*';
  } else if (origin && allowed.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'origin';
  }

  return headers;
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export async function handlePlan(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const requestId = Math.random().toString(36).slice(2, 10);
  const base = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: base });
  }
  if (request.method !== 'POST') {
    return json({ message: '仅支持 POST' }, 405, base);
  }

  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('multipart/form-data')) {
    return json({ message: '请求需为 multipart/form-data，图片字段名为 image' }, 400, base);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ message: '无法解析上传内容，请重新选择图片' }, 400, base);
  }

  // 文字模式：只输文字、不传图时 image 可以缺席（见 HANDOFF-C.md）
  const rawText = form.get('text');
  const text = typeof rawText === 'string' ? rawText.trim().slice(0, 2000) : '';

  const file = form.get('image');
  let imageBase64: string | undefined;
  let mime: string | undefined;

  if (file instanceof Blob) {
    if (file.size === 0) {
      return json({ message: '图片为空，请重新选择' }, 400, base);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return json({ message: `图片超过 8 MB，${MAX_EDGE_HINT}` }, 400, base);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffImageMime(bytes);
    if (!sniffed) {
      return json({ message: '只支持 JPG 或 PNG 图片' }, 400, base);
    }

    imageBase64 = toBase64(bytes);
    mime = sniffed;
  }

  if (!imageBase64 && !text) {
    return json({ message: '请上传题图，或输入题目文字' }, 400, base);
  }

  let vision;
  try {
    vision = await callVisionModel({
      imageBase64,
      mime,
      text,
      skillText: loadSkillText(),
    });
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    const failure = error instanceof VisionError ? error.kind : 'upstream';
    const message =
      error instanceof VisionError ? error.message : '识别服务异常，请稍后重试';
    const status = failure === 'timeout' ? 504 : 502;

    console.error(`[plan] ${requestId} ${failure} ${elapsed}ms ${message}`);
    return json({ message }, status, {
      ...base,
      'x-request-id': requestId,
      'x-elapsed-ms': String(elapsed),
    });
  }

  // 内部统一按 stage_plan 校验，对外形状由 API_CONTRACT_MODE 决定：
  // 默认 legacy（A 的前端尚未接入），设成 stage_plan 才吐新契约。
  const internal = buildPlanResponse(vision.raw);
  const result: ClientResult =
    isStagePlanResult(internal) && outputContractFromEnv(process.env.API_CONTRACT_MODE) === 'legacy'
      ? applyLegacyContract(internal, validateReading, UNSUPPORTED_PREFIX)
      : (internal as ClientResult);
  const elapsed = Date.now() - startedAt;

  // 契约第 2 节：ok / needs_input / unsupported 都是 200，只有 invalid_reading 是 502
  const status = result.status === 'invalid_reading' ? STAGE_HTTP_STATUS.invalid_reading : 200;

  console.log(
    `[plan] ${requestId} ${result.status} ${elapsed}ms model=${vision.model} image=${imageBase64 ? 'yes' : 'no'} text=${text.length}`,
  );

  return json(result, status, {
    ...base,
    'x-request-id': requestId,
    'x-elapsed-ms': String(elapsed),
    'x-vision-model': vision.model,
  });
}
