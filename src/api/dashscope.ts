/**
 * 百炼视觉模型调用（C · AI 接口）
 *
 * 走百炼的 OpenAI 兼容接口，方便以后换模型或换供应商。
 * 密钥只从服务端环境变量读，绝不下发到浏览器。
 */

import {
  buildChatRagQuery,
  formatRagForSimilar,
  formatRagForTutor,
  searchPhysicsRag,
  toRagReferences,
} from '../rag/retriever';
import type { RagReference } from '../rag/types';

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
  /** 物理母题知识库召回的拆段骨架提示（无命中时缺省） */
  ragHint?: string;
  /** 校验失败后发起定向自修正时的上下文 */
  repairContext?: VisionRepairContext;
}

export interface VisionResponse {
  raw: unknown;
  /** 实际使用的模型，回写到 x-vision-model 便于验收记录 */
  model: string;
}

export interface TutorChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export type TutorChatMode = 'tutor' | 'similar' | 'socratic';

export interface TutorSimilarProblem {
  title: string;
  tags: string[];
  difficulty?: string;
  stem: string;
  focus: string;
  hint: string;
}

export interface TutorChatRequest {
  message: string;
  context?: Record<string, unknown> | null;
  history?: TutorChatMessage[];
  mode?: TutorChatMode;
}

export interface TutorChatResponse {
  reply: string;
  model: string;
  similarProblems?: TutorSimilarProblem[];
  ragReferences?: RagReference[];
}

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen4-max';
const DEFAULT_MAX_TOKENS = 2048;
/**
 * 助教对话的输出上限，独立于识图用的 VISION_MAX_TOKENS。
 * 推理模型会先花掉一大截 token 写英文思考链，若沿用识图的 2048，
 * 正文常常一个 token 都不剩，只能回退思考稿。
 */
const DEFAULT_CHAT_MAX_TOKENS = 4096;
/**
 * 助教对话的超时，独立于识图的 VISION_TIMEOUT_MS。
 * 推理模型要先写完英文思考链再写正文，复杂多阶段题的整轮耗时可达 20s 以上，
 * 沿用识图的 25s 会偶发超时。
 */
const DEFAULT_CHAT_TIMEOUT_MS = 40_000;

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

/** 助教对话的 token 上限，可用 CHAT_MAX_TOKENS 单独覆盖。 */
function chatMaxTokens(): number {
  const value = Number(env('CHAT_MAX_TOKENS'));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_CHAT_MAX_TOKENS;
}

/** 助教对话的超时，可用 CHAT_TIMEOUT_MS 单独覆盖。 */
function chatTimeoutMs(): number {
  const value = Number(env('CHAT_TIMEOUT_MS'));
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_CHAT_TIMEOUT_MS;
}

function buildTargetedRepairHints(errors: VisionRepairError[]): string[] {
  const hints: string[] = [];
  const joined = errors.map((e) => `${e.path} ${e.code} ${e.message}`).join('\n');

  if (joined.includes('圆弧后抛体需固定')) {
    hints.push(
      '- 圆弧后抛体修正指引：必须删除该 projectile 阶段的 dropHeightM 键，只保留世界坐标 landingPlaneYM。换算公式：① 若落地平面与圆弧最低点/水平地面同高，直接填 "landingPlaneYM": 0；② 若从半径 R 的半圆最高点（y = 2R）或端点（y = y_exit）向下落差 h，则填 "landingPlaneYM": y_exit - h（例如半圆最高点向下落差 h 时为 2R - h）；绝不可同时保留 dropHeightM 与 landingPlaneYM。',
    );
  } else if (joined.includes('landingPlaneYM') || joined.includes('相对落差与固定落地平面互斥')) {
    hints.push(
      '- 抛体高度修正指引：两种高度只保留一项。landingPlaneYM 是固定世界坐标；磁场首段贴地入射时该地面为 y = 0，低于入射地面 h 的接收平台应写 landingPlaneYM = -h。只有从实际出射点量起的落差才写 dropHeightM。',
    );
  }

  if (
    joined.includes('释放上界小于真实压缩量') ||
    joined.includes('弹簧参数与固定能量不符') ||
    joined.includes('临界条件须指向引用A') ||
    joined.includes('AB不能小于已用释放位移')
  ) {
    hints.push(
      '- 预压弹簧（spring_release）修正指引：若题面已明确给出劲度系数 k 和压缩量 x₀，只填 springConstantNpm 与 initialCompressionM，删除顶层 energy、删除不必要的 constraints，且不要填写或估算 releaseCompleteByM；若后接水平段距离从脱离弹簧后量起，用 end: { "kind": "distance", "distanceM": d }，仅当题面给的是从初始压缩点 A 到圆弧入口 B 的总长 AB 时才用 distance_from_stage_start（且须满足 AB ≥ initialCompressionM）。',
    );
  }

  if (joined.includes('来向速度方向与斜面切向不一致')) {
    hints.push(
      '- 斜面接续修正指引：检查 incline_slide 的 direction（初速冲上斜面须填 "up"）与倾角 angleDeg 是否与来向速度方向一致；若经过光滑弯道转向，请在斜面前补 lossless_turn。',
    );
  }

  if (joined.includes('圆轨入口位置或速度不符合声明的切线与方向')) {
    hints.push(
      '- 圆轨入口切线修正指引：显式 path 的入口切向为 (direction==="positive" ? 1 : -1) * (cos φ₀, sin φ₀)。倾角 θ 的下滑斜面直接相切进入向上弯曲圆轨（direction: "positive"）时，startAngleDeg 必须为 -θ（如 37° 斜面填 -37），严禁填 0；两段相连圆弧的后段入口切向须与前段出口切向一致，且后段省略 path.center。',
    );
  }

  return hints;
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
  const targetedHints = buildTargetedRepairHints(repairContext.errors);
  const targetedBlock = targetedHints.length > 0 ? `\n针对性修正指引：\n${targetedHints.join('\n')}` : '';

  return [
    '你上一次输出的 JSON 未通过后端校验，请根据报错只修正出错字段并重新输出单个合法 JSON 对象：',
    `上一次输出的 JSON：\n${previousJson}`,
    `后端校验报错列表：\n${errorLines}${missingLine}${targetedBlock}`,
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
  if (request.ragHint) {
    userContent.push({
      type: 'text',
      text: request.ragHint,
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

const NULLISH_REPLY_RE = /^(?:null|none|undefined|nil|nan|n\/a|\{\}|\[\]|""|'')$/i;

function extractTextFromField(field: unknown): string {
  if (typeof field === 'string') return field.trim();
  if (Array.isArray(field)) {
    return field
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const obj = part as { text?: unknown; content?: unknown };
          if (typeof obj.text === 'string') return obj.text;
          if (typeof obj.content === 'string') return obj.content;
        }
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

function isUsableReply(text: string): boolean {
  const trimmed = text.trim();
  return Boolean(trimmed) && !NULLISH_REPLY_RE.test(trimmed);
}

/**
 * 兼容多形态与推理模型回包，并过滤字面 NULL / undefined 等无效空回复。
 *
 * reasoning_content 的回退分三档：
 * - `allowReasoningFallback: false`：完全禁用（similar 模式要求纯 JSON）；
 * - 未指定：只接受**中文**思考链。qwen 系列推理模型的思考链是英文推导稿，
 *   一旦 content 被思考链耗尽而回退，前端就会拿到整段英文——这正是
 *   「AI 助手有时输出英文」的根因，必须在回退口拦掉；
 * - `true`：强制允许（仅用于兼容只填 reasoning 的中文模型与测试）。
 */
export function extractTutorReply(
  payload: unknown,
  options?: { allowReasoningFallback?: boolean },
): string {
  const choice = (
    payload as {
      choices?: Array<{
        message?: { content?: unknown; reasoning_content?: unknown };
        text?: unknown;
      }>;
    } | null
  )?.choices?.[0];

  const primary = extractTextFromField(choice?.message?.content);
  if (isUsableReply(primary)) return primary;

  const legacyText = extractTextFromField(choice?.text);
  if (isUsableReply(legacyText)) return legacyText;

  if (options?.allowReasoningFallback === false) return '';

  const reasoning = extractTextFromField(choice?.message?.reasoning_content);
  if (!isUsableReply(reasoning)) return '';
  if (options?.allowReasoningFallback === true) return reasoning;
  // 未显式指定时只接受中文思考链：英文思考稿不是答案。
  return looksLikeNonChinese(reasoning) ? '' : reasoning;
}

/**
 * 判断一段回复是否明显不是中文。
 *
 * 只用于 tutor / socratic 的自然语言回复；similar 模式输出 JSON（键名是英文），
 * 不能用这个判据。阈值取「拉丁字母占比 > 72%」，因为正常中文讲解里即便公式
 * 写满 v = √(gR)、N + mg = mv²/R，汉字数量仍远多于拉丁字母。
 */
export function looksLikeNonChinese(text: string): boolean {
  const han = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const total = han + latin;
  if (total < 40) return false;
  if (han === 0) return true;
  return latin / total > 0.72;
}

const AMBIGUOUS_VAR_PARAM_RE = /(?:可调(?:节)?|待定|任意改变|自由调节|大小可变|宽度可变|长度可变|高度可变|半径可变)/;
const UNNAMED_UNKNOWN_PARAM_RE = /(?:宽度|长度|距离|高度|倾角|半径|初速度|速度|质量|磁感应强度|劲度系数)[^，。；;]{0,6}(?:未知|可变|不固定)/;
const CONCRETE_SUBQUESTION_VALUE_RE = /(?:当|若|取)\s*[A-Za-z\u4e00-\u9fff_0-9]{1,8}\s*=\s*-?\d/;

function hasUnresolvedVariableParam(stem: string): boolean {
  if (AMBIGUOUS_VAR_PARAM_RE.test(stem)) return true;
  if (UNNAMED_UNKNOWN_PARAM_RE.test(stem) && !CONCRETE_SUBQUESTION_VALUE_RE.test(stem)) return true;
  return false;
}

function normalizeSimilarProblemsWithStats(raw: unknown): {
  problems: TutorSimilarProblem[];
  rejectedCount: number;
} {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { similarProblems?: unknown; problems?: unknown }).similarProblems)
      ? (raw as { similarProblems: unknown[] }).similarProblems
      : raw && typeof raw === 'object' && Array.isArray((raw as { problems?: unknown }).problems)
        ? (raw as { problems: unknown[] }).problems
        : [];

  const result: TutorSimilarProblem[] = [];
  let rejectedCount = 0;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title.trim() : '';
    const stem = typeof obj.stem === 'string' ? obj.stem.trim() : '';
    if (!title || !stem || NULLISH_REPLY_RE.test(title) || NULLISH_REPLY_RE.test(stem)) continue;
    if (hasUnresolvedVariableParam(stem)) {
      rejectedCount += 1;
      continue;
    }
    const tags = Array.isArray(obj.tags)
      ? obj.tags
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim())
          .slice(0, 4)
      : [];
    const difficulty = typeof obj.difficulty === 'string' && obj.difficulty.trim() ? obj.difficulty.trim() : undefined;
    const focus =
      typeof obj.focus === 'string' && obj.focus.trim()
        ? obj.focus.trim()
        : '保留核心力学模型，改变关键几何或约束条件以强化迁移理解。';
    const hint =
      typeof obj.hint === 'string' && obj.hint.trim()
        ? obj.hint.trim()
        : '按运动阶段拆分过程，分别列出受力方程与能量/动量守恒方程求解。';
    result.push({ title, tags, difficulty, stem, focus, hint });
    if (result.length >= 3) break;
  }
  return { problems: result, rejectedCount };
}

/**
 * 模型常在中文里用英文双引号做强调（如 形成"下滑—反弹"完整链），直接破坏 JSON。
 * 这里逐字符扫描：字符串内的双引号只有后面紧跟 , } ] : 或结尾才算收尾，
 * 否则补成 \" ；同时补齐被截断的字符串与未闭合的括号。
 */
function repairJsonText(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        const next = text[j] ?? '';
        if (next === '' || next === ',' || next === '}' || next === ']' || next === ':') {
          out += ch;
          inString = false;
        } else {
          out += '\\"';
        }
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  if (inString) out += '"';

  const opens: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') opens.push(ch);
    else if (ch === '}' || ch === ']') opens.pop();
  }
  while (opens.length) out += opens.pop() === '{' ? '}' : ']';
  return out;
}

function parseSimilarResponseDetailed(text: string): {
  summary: string;
  similarProblems: TutorSimilarProblem[];
  rejectedCount: number;
} {
  let body = text.trim();
  body = body.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const candidates: string[] = [];
  const objStart = body.indexOf('{');
  const objEnd = body.lastIndexOf('}');
  const arrStart = body.indexOf('[');
  const arrEnd = body.lastIndexOf(']');

  if (objStart !== -1 && objEnd > objStart) candidates.push(body.slice(objStart, objEnd + 1));
  if (arrStart !== -1 && arrEnd > arrStart) candidates.push(body.slice(arrStart, arrEnd + 1));

  let totalRejected = 0;
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate) as unknown;
    } catch {
      // 首次解析失败多半是中文里混进了英文双引号，修一次再试
      try {
        parsed = JSON.parse(repairJsonText(candidate)) as unknown;
      } catch {
        continue;
      }
    }
    const { problems, rejectedCount } = normalizeSimilarProblemsWithStats(parsed);
    totalRejected = Math.max(totalRejected, rejectedCount);
    if (problems.length > 0) {
      const rawSummary =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof (parsed as { summary?: unknown }).summary === 'string'
          ? (parsed as { summary: string }).summary.trim()
          : '';
      const summary = isUsableReply(rawSummary)
        ? rawSummary
        : `结合当前题目的物理模型，为你精选了 ${problems.length} 道高中力学相似变式题，点击「生成动画试做」可直接加载运行：`;
      return { summary, similarProblems: problems, rejectedCount };
    }
  }

  // 解析彻底失败时不要把原始 JSON 片段当正文回给用户
  const looksLikeJson = /^[[{]/.test(body);
  return {
    summary: !looksLikeJson && isUsableReply(text) ? text.trim() : '',
    similarProblems: [],
    rejectedCount: totalRejected,
  };
}

export function parseSimilarResponse(text: string): { summary: string; similarProblems: TutorSimilarProblem[] } {
  const { summary, similarProblems } = parseSimilarResponseDetailed(text);
  return { summary, similarProblems };
}

function buildTutorSystemPrompt(
  context?: Record<string, unknown> | null,
  mode: TutorChatMode = 'tutor',
  ragContext?: string,
): string {
  const base =
    mode === 'similar'
      ? [
          '你是 VisualLab 的资深高中物理命题教师，擅长根据当前物理题的模型与阶段组合设计高质量、100% 可在 VisualLab 物理引擎中生成动画的相似变式题。',
          '请基于下面提供的当前题目信息与物理引擎实算数据，设计 2~3 道高中力学相似变式题。',
          '严格要求（每条均为硬性约束，违反任一条都会导致动画生成失败）：',
          '1. 只输出一个合法 JSON 对象，格式为：{"summary":"一句话说明推荐思路","similarProblems":[{"title":"题目标题","tags":["考点1","考点2"],"difficulty":"基础|中档|拔高","stem":"完整题干（包含明确物理量数值、单位与 g=10 m/s²，可直接用于物理动画建模）","focus":"变式亮点（1~2句）","hint":"核心解题思路与关键方程（纯文本公式，不要 LaTeX 反斜杠）"}]}。',
          '2. 模型白名单（每道题必须 100% 属于以下 VisualLab 支持的模型范围，禁止超纲如变力、空气阻力、非线性阻力、弹性绳、多体复杂复合场或三维运动等）：',
          '   - 单物体多过程（可按合理物理顺序串联）：斜面下滑或初速冲上斜面往返（incline_slide）、坡底光滑无损转向（lossless_turn）、水平面滑行（horizontal_slide）、水平或倾斜传送带（conveyor_belt）、平抛或斜抛（projectile）、固定竖直圆弧内轨或轻杆/双轨（vertical_arc）、光滑或粗糙弹簧接触与回弹（spring_contact）、预压弹簧静止释放（spring_release）、分段水平恒定合力（constant_force_1d）、匀强磁场偏转（magnetic_deflection）、可自由滑动的光滑圆弧槽（movable_arc）、不锚墙自由弹簧双球（spring_pair）。',
          '   - 多物体系统（独立出题）：水平两球一维碰撞（可接平抛或滑行）、轻绳单摆最低点正碰、光滑地面滑块-长木板（block_plank）、理想定滑轮连接体（pulley_system）。',
          '3. 严禁非法混拼：单物体多过程模型与多物体系统模型（如 block_plank、pulley_system、pendulum_swing）不可混拼在同一道题中（例如禁止「滑块-长木板 + 竖直圆弧」或「定滑轮 + 斜面平抛」）；且转向（lossless_turn）后不可直接平抛，必须经过一段明确长度的水平面再从桌沿飞出；可出单粒子匀强磁场偏转题，写明磁感应强度及垂直纸面的方向、质量、带符号电荷量、入射速度、磁场宽度、区内忽略重力。可接在水平滑行之后，也可离场后只受重力（magnetic_deflection → projectile）。接抛体时写明 g 和平台相对哪个基准的高度，保留真实出射方向，不把斜向出射写成平抛。禁止先抛体再入磁场，或斜向离场直接接水平滑行。传送带接斜面或抛体时，写清入带端、接续端和带速方向，按实际固定带端接续。',
          '4. 严禁空间几何自相矛盾：同一个轨道端点绝不能「既平滑连接斜面/平面/圆弧，又直接悬空平抛落地」！若设计「传送带 + 斜面折返 + 平抛」，必须明确区分左右两端（例如「水平传送带左端高出地面 h 悬空、右端平滑连接足够长光滑斜面，物块向右冲上斜面折返后从传送带左端水平飞出」，或「斜面下滑 → 水平传送带 → 右端平抛落地」）；平抛切入圆弧必须明确给出圆弧入口角、半径、内侧/轻杆属性与圆心角或终点位置。',
          '5. 严禁遗漏必需数值与前提：题干必须明确给出所有计算必需的具体数字与单位（如 g = 10 m/s²、质量、倾角、长度或高度、半径、动摩擦因数、劲度系数、初速度、初始间距等），禁止出成纯字母符号推导题！严禁写「沿水平面滑行一段距离」或「沿光滑水平面滑行」而不给具体水平距离 d（每一段水平滑行必须给出具体长度，如 d = 1 m，否则不要加水平段）；若弹簧压缩段处于粗糙水平面（μ > 0），必须明确写出最大静摩擦因数（如「静摩擦因数 μₛ = μ = 0.2」）或写明「弹簧压缩区域光滑」。仅在明确考查临界反求（如「恰好通过圆弧最高点」「恰好不再滑上圆弧槽」）或「足够长光滑斜面」时，才允许对应物理量不给数值。',
          '6. 严禁分情形变参题与脆弱长链：严禁出「某参数可调 / 待定 / 变化，第(1)问求最值、第(2)问当 x = … 时」的分情形变参题！所有物理量（如磁场宽度 d、轨道半径 R、桌面长度、弹簧压缩量、外力 F 等）必须在题干开头直接给出唯一确定的具体数值；且单道变式题阶段数控制在 2~4 段经典稳健组合内（不拼凑 5~6 段脆弱长链，圆弧最高点飞出后直接落回与圆弧底端同高的水平地面，不要再硬接非切向斜面）。',
          '7. 绝不输出 null、NULL、undefined 或空数组；所有字符串字段必须为自然流畅的中文，且 stem 与 hint 中的数值推导必须前后自洽。',
        ].join('\n')
      : mode === 'socratic'
        ? [
            '你是 VisualLab 循循善诱的苏格拉底式高中物理老师（分步带练模式），正在结合交互动画一步步引导学生自己把物理题想明白、算出来。',
            '硬性教学规则（每条必须严格遵守）：',
            '1. 严禁一次性给出完整全过程解答、严禁直接报出最终答案数值或把所有阶段的方程一次全列出来！每次回复严格控制在 80~160 字以内，保持轻快、聚焦、可互动。',
            '2. 开场首问策略：若是开场首问，先用 1~2 句话帮学生把整道题拆成清晰的几个物理阶段，然后只聚焦【第 1 阶段】，指出关键受力或守恒条件，再提出 1 个具体的思考小问题让学生接招。',
            '3. 多轮追问策略：若学生已在回答上一步问题，先明确肯定答对的部分，或温柔指出卡点与高频易错点（结合【当前题目与物理引擎实算数据】严格核对数值与方向，绝不编造矛盾数据）；确认当前阶段过关后，再推进到下一阶段并抛出下一个引导小问题。',
            '4. 只有当全部物理阶段都引导学生自己推导完成后，才用简短 2~3 句话总结全题关键结论与核心物理方法。',
            '5. 绝不输出字面 null、NULL、undefined、空白回复或原始 JSON 字段名；不要输出 # 标题、--- 分割线、Markdown 表格或 LaTeX 反斜杠命令（如 \\frac、\\sqrt），公式一律用直观纯文本符号（如 a = g(sinθ - μcosθ)、N + mg = mv²/R、v = √(gR)）。必要时可提醒学生观察动画对应时刻。',
            '6. 回复必须全部使用简体中文，严禁用英文作答、严禁输出英文思考过程或英文分析草稿；物理量符号与公式保持原样即可。',
          ].join('\n')
        : [
            '你是 VisualLab 的资深高中物理 AI 助教，正在结合交互动画一步步辅导学生理解物理题。',
            '核心原则：',
            '1. 即使上下文里没有 problemText（例如用户上传题图识别，没有原始文字题干），也要直接根据 reading（阶段组合与数值参数）、events（关键时刻与事件）、derivedCalculations（反求/推导结果）和 currentSnapshot 完整理解物理情景，像有经验的高中物理老师一样自然、清晰地回答用户的任何自由提问。',
            '2. 绝不输出字面 null、NULL、undefined 或空白回复，也不要机械复读原始 JSON 字段名；如果用户问的是开放性概念、推导或拓展问题，请直接展开讲解。',
            '3. 涉及时刻、速度、位置、支持力/张力、能量或半径等数值时，严格以「当前题目与物理引擎实算数据」为准，绝不编造与实算矛盾的数值。',
            '4. 先给清晰结论，再分步讲清受力分析、运动过程拆分、守恒定律与临界条件。表达简洁易读，直接用中文自然段或「1. / 2.」分点；不要输出 # 标题、--- 分割线、Markdown 表格或 LaTeX 反斜杠命令（如 \\frac、\\sqrt、\\[...\\]），公式一律用直观符号写成纯文本（如 N + mg = mv²/R、v = √(gR)、ΔEk = W合）。',
            '5. 必要时可提醒学生在时间轴点击对应关键事件观察，或直接说「把某参数改成某值」做对比实验。',
            '6. 回复必须全部使用简体中文，严禁用英文作答、严禁把英文推理草稿或英文提纲当正文输出；物理量符号与公式保持原样即可。',
          ].join('\n');

  const sections: string[] = [base];
  if (context && Object.keys(context).length > 0) {
    let serialized = '';
    try {
      serialized = JSON.stringify(context, null, 2).slice(0, 6000);
    } catch {
      serialized = '';
    }
    if (serialized) {
      sections.push(`【当前题目与物理引擎实算数据】\n${serialized}`);
    }
  }
  const trimmedRag = ragContext?.trim();
  if (trimmedRag) {
    sections.push(trimmedRag);
  }
  return sections.join('\n\n');
}

const SIMILAR_REPAIR_HINT =
  '你上一次生成的相似变式题包含「可调 / 待定 / 未知」等未定变参，已被校验过滤。请重新输出 2~3 道完全合规的相似变式题：所有物理量必须在题干开头直接给出唯一确定的具体数值，严禁出现「可调」「待定」或「第(2)问当 x = … 时」的分情形设问，且每题阶段数控制在 2~4 段内。';

const SIMILAR_JSON_REPAIR_HINT =
  '你上一次输出的 JSON 不合法，无法解析。请重新只输出一个合法 JSON 对象：字符串内部严禁出现英文双引号（需要强调或引用时用「」），不要输出任何解释、注释或代码围栏。';

const CHINESE_REPLY_HINT =
  '你上一次的回复不是中文（或英文占比过高），已被判定为不合格。请只用简体中文重新回答同一个问题：不要输出英文句子、英文分析草稿或英文提纲；物理量符号、单位和公式可以保持原样。';

const SIMILAR_LANGUAGE_HINT =
  '你上一次没有按格式输出，而是用英文写了一段分析说明。请只输出一个合法 JSON 对象：summary 与每道题的所有文字字段都必须用简体中文，不要输出任何英文说明、思考过程或代码围栏。';

async function callTutorOnce(
  model: string,
  request: TutorChatRequest,
  apiKey: string,
  similarRepairHint?: string,
  languageRepair = false,
): Promise<TutorChatResponse> {
  const baseUrl = env('DASHSCOPE_BASE_URL') || DEFAULT_BASE_URL;
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const limit = chatTimeoutMs();
  const mode: TutorChatMode =
    request.mode === 'similar' ? 'similar' : request.mode === 'socratic' ? 'socratic' : 'tutor';

  const ragMode = mode === 'similar' ? 'similar' : 'tutor';
  const ragHits = searchPhysicsRag(buildChatRagQuery(request.message, request.context, ragMode));
  const ragContext = mode === 'similar' ? formatRagForSimilar(ragHits) : formatRagForTutor(ragHits);
  const ragReferences = toRagReferences(ragHits);

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: buildTutorSystemPrompt(request.context, mode, ragContext) },
  ];
  if (mode === 'tutor' || mode === 'socratic') {
    for (const item of (request.history ?? []).slice(-8)) {
      const content = typeof item.text === 'string' ? item.text.trim().slice(0, 1200) : '';
      if (!content || NULLISH_REPLY_RE.test(content)) continue;
      messages.push({ role: item.role === 'assistant' ? 'assistant' : 'user', content });
    }
  }
  const userMessage = request.message.trim().slice(0, 2000);
  const repairHints = [similarRepairHint, languageRepair ? CHINESE_REPLY_HINT : undefined].filter(
    (hint): hint is string => Boolean(hint),
  );
  messages.push({
    role: 'user',
    content: repairHints.length ? `${userMessage}\n\n${repairHints.join('\n\n')}` : userMessage,
  });

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
        temperature: mode === 'similar' ? 0.5 : 0.35,
        // qwen 系列推理模型会先输出英文 reasoning_content 再写正文。正文额度必须在
        // 思考链之后仍有富余，否则 content 为空，前端只能拿到英文思考稿。
        max_tokens: Math.min(chatMaxTokens(), mode === 'similar' ? 2000 : mode === 'socratic' ? 1600 : 3072),
        messages,
        // similar 要纯 JSON、socratic 只要 80~160 字：两者都不值得付思考链的 token 与延迟。
        ...(mode === 'similar' || mode === 'socratic' ? { enable_thinking: false } : {}),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new VisionError('timeout', `助教回答超时（${limit} ms）`);
    }
    throw new VisionError('upstream', '无法连接 AI 助教服务，请检查网络或服务配置');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    if (response.status === 401 || response.status === 403) {
      throw new VisionError('upstream', 'AI 服务鉴权失败，请检查 DASHSCOPE_API_KEY 是否有效');
    }
    if (response.status === 429) {
      throw new VisionError('upstream', 'AI 服务调用频率或额度受限，请稍后重试');
    }
    throw new VisionError('upstream', `AI 助教服务返回 ${response.status}：${detail || '无详细信息'}`);
  }

  const payload = await response.json().catch(() => null);
  // similar 完全禁用回退；tutor / socratic 只接受中文思考链，英文思考稿一律拦掉。
  const rawReply = extractTutorReply(payload, { allowReasoningFallback: mode !== 'similar' });

  if (!rawReply) throw new VisionError('parse', 'AI 助教返回了无效空内容');

  // 语言兜底：模型偶尔仍会用英文作答，追加中文要求重试一次（只重试一次，避免死循环）。
  if (mode !== 'similar' && !languageRepair && looksLikeNonChinese(rawReply)) {
    console.warn(`[chat] ${model} 返回非中文内容，追加中文要求重试一次`);
    return callTutorOnce(model, request, apiKey, similarRepairHint, true);
  }

  if (mode === 'similar') {
    const parsed = parseSimilarResponseDetailed(rawReply);
    if (parsed.similarProblems.length === 0 && !similarRepairHint) {
      if (parsed.rejectedCount > 0) {
        throw new VisionError('parse', '相似变式题含未定变参，需重新生成');
      }
      // 模型已经开始写 JSON 却解析不出来（多为中文里混了英文双引号），值得重试一次；
      // 纯文字拒答则按原样返回，不要重试。
      if (/^\s*[[{]/.test(rawReply)) {
        throw new VisionError('parse', '相似变式题 JSON 解析失败，需重新生成');
      }
      // 模型用英文跑偏（如 "Let me analyze the current problem..."）同样要重试：
      // 英文分析说明不是答案，直接当 summary 返回等于把跑偏内容交给了前端。
      if (looksLikeNonChinese(rawReply)) {
        throw new VisionError('parse', '相似变式题用英文作答，需重新生成');
      }
    }
    // 最后一道保险：模型跑偏留下的英文 summary 不要直接展示给用户。
    const summary =
      parsed.summary && !looksLikeNonChinese(parsed.summary)
        ? parsed.summary
        : '已根据当前题目生成相似变式参考：';
    return {
      reply: summary,
      model,
      similarProblems: parsed.similarProblems,
      ragReferences,
    };
  }

  return { reply: rawReply, model, ragReferences };
}

export async function callTutorChat(request: TutorChatRequest): Promise<TutorChatResponse> {
  const apiKey = env('DASHSCOPE_API_KEY');
  if (!apiKey) {
    throw new VisionError('upstream', '服务端未配置 DASHSCOPE_API_KEY');
  }

  const primary = env('DASHSCOPE_CHAT_MODEL') || env('DASHSCOPE_VISION_MODEL') || DEFAULT_MODEL;
  const fallback = env('DASHSCOPE_FALLBACK_MODEL');

  try {
    return await callTutorOnce(primary, request, apiKey);
  } catch (error) {
    const retryable =
      error instanceof VisionError &&
      (error.kind === 'timeout' || error.kind === 'upstream' || error.kind === 'parse');
    if (!retryable) throw error;
    const retryModel = fallback && fallback !== primary ? fallback : error.kind === 'parse' ? primary : '';
    if (!retryModel) throw error;
    const repairHint =
      request.mode === 'similar' && error.kind === 'parse'
        ? error.message.includes('未定变参')
          ? SIMILAR_REPAIR_HINT
          : error.message.includes('英文')
            ? SIMILAR_LANGUAGE_HINT
            : error.message.includes('JSON')
              ? SIMILAR_JSON_REPAIR_HINT
              : undefined
        : undefined;
    console.warn(`[chat] ${primary} 失败（${(error as Error).message}），改用 ${retryModel} 重试`);
    return callTutorOnce(retryModel, request, apiKey, repairHint);
  }
}
