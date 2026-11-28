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
import { dispatchStageCommand } from './stageCommand';
import { join } from 'node:path';

import { callTutorChat, callVisionModel, VisionError, type TutorChatMessage, type TutorChatMode, type VisionRepairContext } from './dashscope';
import { applyLegacyContract, outputContractFromEnv, type ClientResult } from './legacyBridge';
import { STAGE_HTTP_STATUS } from './stageTypes';
import type { StagePlanResult } from './stageTypes';
import { buildPlanResponse, type PlanResponse } from './validate';
import { UNSUPPORTED_PREFIX } from './contract';
import { validateReading } from '../physics/reading';
import { formatRagForVision, searchPhysicsRag } from '../rag/retriever';

function repairRetryEnabled(): boolean {
  return (process.env.VISION_REPAIR_RETRY ?? '').trim() !== '0';
}

function buildRepairContext(raw: unknown, result: PlanResponse): VisionRepairContext | null {
  if (!isStagePlanResult(result)) return null;
  if (result.status === 'invalid_reading') {
    return {
      previousRaw: raw,
      errors: [{ path: '/', code: 'INVALID_READING', message: result.message }],
    };
  }
  if (result.status === 'needs_input' && result.fieldErrors.length > 0) {
    return {
      previousRaw: raw,
      errors: result.fieldErrors,
      missingKeys: result.missingKeys.length > 0 ? result.missingKeys : undefined,
    };
  }
  return null;
}

function isRepairImproved(before: PlanResponse, after: PlanResponse): boolean {
  if (after.status === 'ok') return true;
  if (before.status === 'invalid_reading') {
    return after.status === 'needs_input' || after.status === 'unsupported';
  }
  if (
    before.status === 'needs_input' &&
    isStagePlanResult(before) &&
    after.status === 'needs_input' &&
    isStagePlanResult(after)
  ) {
    if (after.fieldErrors.length < before.fieldErrors.length) return true;
    if (
      after.fieldErrors.length === before.fieldErrors.length &&
      after.missingKeys.length < before.missingKeys.length
    ) {
      return true;
    }
  }
  return false;
}

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
      cachedSkill = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
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

  const commandResult=dispatchStageCommand(form);
  if(commandResult)return json(commandResult.body,commandResult.status,base);

  const rawChat = form.get('chatMessage');
  if (typeof rawChat === 'string') {
    const chatMessage = rawChat.trim().slice(0, 2000);
    if (!chatMessage) return json({ message: '提问内容不能为空' }, 400, base);
    if (form.get('image') instanceof Blob || form.get('command') !== null) {
      return json({ message: '问答模式不能同时提交图片或阶段指令' }, 400, base);
    }
    let context: Record<string, unknown> | null = null;
    let history: TutorChatMessage[] = [];
    const rawContext = form.get('chatContext');
    if (typeof rawContext === 'string' && rawContext.trim()) {
      try {
        const parsed = JSON.parse(rawContext) as { history?: TutorChatMessage[]; [key: string]: unknown };
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          if (Array.isArray(parsed.history)) history = parsed.history;
          const { history: _h, ...rest } = parsed;
          context = rest;
        }
      } catch {
        return json({ message: 'chatContext 须为合法 JSON 字符串' }, 400, base);
      }
    }
    const rawMode = form.get('chatMode');
    const modeToken =
      typeof rawMode === 'string' && rawMode.trim()
        ? rawMode.trim().toLowerCase()
        : context && typeof context.mode === 'string' && context.mode.trim()
          ? context.mode.trim().toLowerCase()
          : '';
    const chatMode: TutorChatMode =
      modeToken === 'similar' ? 'similar' : modeToken === 'socratic' ? 'socratic' : 'tutor';
    try {
      const chat = await callTutorChat({ message: chatMessage, context, history, mode: chatMode });
      const elapsed = Date.now() - startedAt;
      console.log(`[chat] ${requestId} ok ${elapsed}ms model=${chat.model} mode=${chatMode} len=${chatMessage.length}`);
      const ragReferences = chat.ragReferences ?? [];
      return json(
        chatMode === 'similar'
          ? { status: 'ok', reply: chat.reply, similarProblems: chat.similarProblems ?? [], ragReferences }
          : { status: 'ok', reply: chat.reply, ragReferences },
        200,
        { ...base, 'x-request-id': requestId, 'x-elapsed-ms': String(elapsed), 'x-vision-model': chat.model },
      );
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      const failure = error instanceof VisionError ? error.kind : 'upstream';
      const message = error instanceof VisionError ? error.message : 'AI 助教服务异常，请稍后重试';
      const status = failure === 'timeout' ? 504 : 502;
      console.error(`[chat] ${requestId} ${failure} ${elapsed}ms ${message}`);
      return json({ status: 'error', message }, status, { ...base, 'x-request-id': requestId, 'x-elapsed-ms': String(elapsed) });
    }
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

  const visionRagHits = text ? searchPhysicsRag({ text, mode: 'vision', topK: 2 }) : [];
  const ragHint = formatRagForVision(visionRagHits) || undefined;

  let vision;
  try {
    vision = await callVisionModel({
      imageBase64,
      mime,
      text,
      skillText: loadSkillText(),
      ragHint,
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
  let internal = buildPlanResponse(vision.raw);
  const repairContext = repairRetryEnabled() ? buildRepairContext(vision.raw, internal) : null;
  if (repairContext) {
    try {
      const repairedVision = await callVisionModel({
        imageBase64,
        mime,
        text,
        skillText: loadSkillText(),
        ragHint,
        repairContext,
      });
      const repairedInternal = buildPlanResponse(repairedVision.raw);
      if (isRepairImproved(internal, repairedInternal)) {
        vision = repairedVision;
        internal = repairedInternal;
      }
    } catch (error) {
      if (internal.status === 'invalid_reading') {
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
      // 定向纠错失败或超时时降级保留首次校验结果，避免把可补正的 200 变成 502
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[plan] ${requestId} repair_fallback ${reason}`);
    }
  }

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
