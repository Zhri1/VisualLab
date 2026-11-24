/**
 * 百炼视觉模型调用（C · AI 接口）
 *
 * 走百炼的 OpenAI 兼容接口，方便以后换模型或换供应商。
 * 密钥只从服务端环境变量读，绝不下发到浏览器。
 */

export type VisionFailure = 'timeout' | 'upstream' | 'parse';

export class VisionError extends Error {
  readonly kind: VisionFailure;

  constructor(kind: VisionFailure, message: string) {
    super(message);
    this.name = 'VisionError';
    this.kind = kind;
  }
}

export interface VisionRepairError {
  path: string;
  code: string;
  message: string;
}

export interface VisionRepairContext {
  previousRaw: unknown;
  errors: VisionRepairError[];
  missingKeys?: string[];
}

export interface VisionRequest {
  /** 不带 data: 前缀的 base64；文字模式下可以没有 */
  imageBase64?: string;
  /** image/jpeg 或 image/png；与 imageBase64 同时存在 */
  mime?: string;
  /** 文字模式下学生补充的题目描述，可为空 */
  text?: string;
  skillText: string;
  /** 校验失败后发起定向自修正时的上下文 */
  repairContext?: VisionRepairContext;
}

export interface VisionResponse {
  raw: unknown;
  /** 实际使用的模型，回写到 x-vision-model 便于验收记录 */
  model: string;
}

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen4-max';
const DEFAULT_MAX_TOKENS = 2048;

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

function timeoutMs(): number {
  const value = Number(env('VISION_TIMEOUT_MS'));
  return Number.isFinite(value) && value > 0 ? value : 25_000;
}

function maxTokens(): number {
  const value = Number(env('VISION_MAX_TOKENS'));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_TOKENS;
}

function formatRepairPrompt(repairContext: VisionRepairContext): string {
  const previousJson = JSON.stringify(repairContext.previousRaw);
  const errorLines =
    repairContext.errors.length > 0
      ? repairContext.errors
          .map((err, index) => `${index + 1}. [${err.code}] ${err.path || '/'}: ${err.message}`)
          .join('\n')
      : '1. [INVALID_READING] /: 整体结构或字段类型不符合 schema 契约';
  const missingLine =
    Array.isArray(repairContext.missingKeys) && repairContext.missingKeys.length > 0
      ? `\n当前标记的缺项路径（若题面确实未给仍保持 null，绝不猜测）：${repairContext.missingKeys.join('、')}`
      : '';

  return [
    '你上一次输出的 JSON 未通过后端校验，请根据报错只修正出错字段并重新输出单个合法 JSON 对象：',
    `上一次输出的 JSON：\n${previousJson}`,
    `后端校验报错列表：\n${errorLines}${missingLine}`,
    '要求：只修正上述报错字段，保持其他正确识别的题面条件不变；题面未给的数值一律保持 null，绝不猜数；只输出一个纯 JSON 对象，不要任何额外文字。',
  ].join('\n\n');
}

/** 从模型输出里抠出 JSON：容忍 ```json 围栏和前后多余文字 */
export function extractJson(text: string): unknown {
  let body = text.trim();
  if (!body) throw new VisionError('parse', '识别服务返回了空内容');

  body = body.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();

  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new VisionError('parse', '识别服务没有返回 JSON 对象');
  }

  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new VisionError('parse', '识别服务返回的 JSON 无法解析');
  }
}

async function callOnce(model: string, request: VisionRequest, apiKey: string): Promise<VisionResponse> {
  const baseUrl = env('DASHSCOPE_BASE_URL') || DEFAULT_BASE_URL;
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const limit = timeoutMs();

  const userContent: Array<Record<string, unknown>> = [];
  if (request.imageBase64 && request.mime) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${request.mime};base64,${request.imageBase64}` },
    });
  } else {
    userContent.push({ type: 'text', text: '本题没有图片，只有下面的文字描述。' });
  }
  if (request.text) {
    userContent.push({
      type: 'text',
      text: `学生补充的文字描述（与图片冲突时以文字为准）：\n${request.text}`,
    });
  }
  if (request.repairContext) {
    userContent.push({
      type: 'text',
      text: formatRepairPrompt(request.repairContext),
    });
  } else {
    userContent.push({ type: 'text', text: '按 Skill 输出这一个 JSON 对象，不要任何额外文字。' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limit);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: maxTokens(),
        messages: [
          { role: 'system', content: [{ type: 'text', text: request.skillText }] },
          { role: 'user', content: userContent },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new VisionError('timeout', `识别超时（${limit} ms）`);
    }
    throw new VisionError('upstream', '无法连接识别服务，请检查网络或服务地址');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    if (response.status === 401 || response.status === 403) {
      throw new VisionError('upstream', '识别服务鉴权失败，请检查 DASHSCOPE_API_KEY 是否有效');
    }
    if (response.status === 404) {
      throw new VisionError('upstream', `模型「${model}」不存在或当前账号未开通`);
    }
    if (response.status === 429) {
      throw new VisionError('upstream', '识别服务调用频率或额度受限，请稍后重试');
    }
    throw new VisionError('upstream', `识别服务返回 ${response.status}：${detail || '无详细信息'}`);
  }

  const payload = (await response.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: unknown } }> }
    | null;

  const content = payload?.choices?.[0]?.message?.content;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              typeof part === 'string' ? part : typeof (part as { text?: unknown })?.text === 'string' ? (part as { text: string }).text : '',
            )
            .join('')
        : '';

  return { raw: extractJson(text), model };
}

/**
 * 主模型失败时按配置换备用模型再试一次。
 * 只在网络/服务端故障时降级，鉴权失败和 JSON 解析失败不降级（换模型也救不回来）。
 */
export async function callVisionModel(request: VisionRequest): Promise<VisionResponse> {
  const apiKey = env('DASHSCOPE_API_KEY');
  if (!apiKey) {
    throw new VisionError('upstream', '服务端未配置 DASHSCOPE_API_KEY');
  }

  const primary = env('DASHSCOPE_VISION_MODEL') || DEFAULT_MODEL;
  const fallback = env('DASHSCOPE_FALLBACK_MODEL');

  try {
    return await callOnce(primary, request, apiKey);
  } catch (error) {
    const retryable =
      error instanceof VisionError && (error.kind === 'timeout' || error.kind === 'upstream');
    if (!retryable || !fallback || fallback === primary) throw error;

    console.warn(`[vision] ${primary} 失败（${(error as Error).message}），改用 ${fallback} 重试`);
    return callOnce(fallback, request, apiKey);
  }
}
