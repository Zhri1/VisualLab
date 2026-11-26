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

export interface TutorChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export type TutorChatMode = 'tutor' | 'similar';

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

/** 兼容多形态与推理模型回包，并过滤字面 NULL / undefined 等无效空回复。 */
export function extractTutorReply(payload: unknown): string {
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

  const reasoning = extractTextFromField(choice?.message?.reasoning_content);
  if (isUsableReply(reasoning)) return reasoning;

  const legacyText = extractTextFromField(choice?.text);
  if (isUsableReply(legacyText)) return legacyText;

  return '';
}

function normalizeSimilarProblems(raw: unknown): TutorSimilarProblem[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { similarProblems?: unknown; problems?: unknown }).similarProblems)
      ? (raw as { similarProblems: unknown[] }).similarProblems
      : raw && typeof raw === 'object' && Array.isArray((raw as { problems?: unknown }).problems)
        ? (raw as { problems: unknown[] }).problems
        : [];

  const result: TutorSimilarProblem[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title.trim() : '';
    const stem = typeof obj.stem === 'string' ? obj.stem.trim() : '';
    if (!title || !stem || NULLISH_REPLY_RE.test(title) || NULLISH_REPLY_RE.test(stem)) continue;
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
  return result;
}

export function parseSimilarResponse(text: string): { summary: string; similarProblems: TutorSimilarProblem[] } {
  let body = text.trim();
  body = body.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const candidates: string[] = [];
  const objStart = body.indexOf('{');
  const objEnd = body.lastIndexOf('}');
  const arrStart = body.indexOf('[');
  const arrEnd = body.lastIndexOf(']');

  if (objStart !== -1 && objEnd > objStart) candidates.push(body.slice(objStart, objEnd + 1));
  if (arrStart !== -1 && arrEnd > arrStart) candidates.push(body.slice(arrStart, arrEnd + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const problems = normalizeSimilarProblems(parsed);
      if (problems.length > 0) {
        const rawSummary =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof (parsed as { summary?: unknown }).summary === 'string'
            ? (parsed as { summary: string }).summary.trim()
            : '';
        const summary = isUsableReply(rawSummary)
          ? rawSummary
          : `结合当前题目的物理模型，为你精选了 ${problems.length} 道高中力学相似变式题，点击「生成动画试做」可直接加载运行：`;
        return { summary, similarProblems: problems };
      }
    } catch {
      // 尝试下一个 JSON 片段
    }
  }

  return { summary: isUsableReply(text) ? text.trim() : '', similarProblems: [] };
}

function buildTutorSystemPrompt(context?: Record<string, unknown> | null, mode: TutorChatMode = 'tutor'): string {
  const base =
    mode === 'similar'
      ? [
          '你是 VisualLab 的资深高中物理命题教师，擅长根据当前物理题的模型与阶段组合设计高质量相似变式题。',
          '请基于下面提供的当前题目信息与物理引擎实算数据，设计 2~3 道高中力学相似变式题。',
          '严格要求：',
          '1. 只输出一个合法 JSON 对象，格式为：{"summary":"一句话说明推荐思路","similarProblems":[{"title":"题目标题","tags":["考点1","考点2"],"difficulty":"基础|中档|拔高","stem":"完整题干（包含明确物理量数值、单位与 g=10 m/s²，可直接用于物理动画建模）","focus":"变式亮点（1~2句）","hint":"核心解题思路与关键方程（纯文本公式，不要 LaTeX 反斜杠）"}]}。',
          '2. 每道题的 stem 必须条件自洽、数值具体明确、无歧义，且尽量对应常见力学过程（如斜面下滑、水平摩擦、弹簧压缩/释放、竖直圆弧、平抛、可动圆弧槽、双球弹簧、板块、传送带、滑轮、一维碰撞等）。',
          '3. 绝不输出 null、NULL、undefined 或空数组；所有字符串字段必须为自然流畅的中文。',
        ].join('\n')
      : [
          '你是 VisualLab 的资深高中物理 AI 助教，正在结合交互动画一步步辅导学生理解物理题。',
          '核心原则：',
          '1. 即使上下文里没有 problemText（例如用户上传题图识别，没有原始文字题干），也要直接根据 reading（阶段组合与数值参数）、events（关键时刻与事件）、derivedCalculations（反求/推导结果）和 currentSnapshot 完整理解物理情景，像有经验的高中物理老师一样自然、清晰地回答用户的任何自由提问。',
          '2. 绝不输出字面 null、NULL、undefined 或空白回复，也不要机械复读原始 JSON 字段名；如果用户问的是开放性概念、推导或拓展问题，请直接展开讲解。',
          '3. 涉及时刻、速度、位置、支持力/张力、能量或半径等数值时，严格以「当前题目与物理引擎实算数据」为准，绝不编造与实算矛盾的数值。',
          '4. 先给清晰结论，再分步讲清受力分析、运动过程拆分、守恒定律与临界条件。表达简洁易读，直接用中文自然段或「1. / 2.」分点；不要输出 # 标题、--- 分割线、Markdown 表格或 LaTeX 反斜杠命令（如 \\frac、\\sqrt、\\[...\\]），公式一律用直观符号写成纯文本（如 N + mg = mv²/R、v = √(gR)、ΔEk = W合）。',
          '5. 必要时可提醒学生在时间轴点击对应关键事件观察，或直接说「把某参数改成某值」做对比实验。',
        ].join('\n');

  if (!context || Object.keys(context).length === 0) return base;
  let serialized = '';
  try {
    serialized = JSON.stringify(context, null, 2).slice(0, 6000);
  } catch {
    serialized = '';
  }
  return serialized ? `${base}\n\n【当前题目与物理引擎实算数据】\n${serialized}` : base;
}

async function callTutorOnce(
  model: string,
  request: TutorChatRequest,
  apiKey: string,
): Promise<TutorChatResponse> {
  const baseUrl = env('DASHSCOPE_BASE_URL') || DEFAULT_BASE_URL;
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const limit = timeoutMs();
  const mode: TutorChatMode = request.mode === 'similar' ? 'similar' : 'tutor';

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: buildTutorSystemPrompt(request.context, mode) },
  ];
  if (mode === 'tutor') {
    for (const item of (request.history ?? []).slice(-8)) {
      const content = typeof item.text === 'string' ? item.text.trim().slice(0, 1200) : '';
      if (!content || NULLISH_REPLY_RE.test(content)) continue;
      messages.push({ role: item.role === 'assistant' ? 'assistant' : 'user', content });
    }
  }
  messages.push({ role: 'user', content: request.message.trim().slice(0, 2000) });

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
        max_tokens: Math.min(maxTokens(), mode === 'similar' ? 2000 : 1400),
        messages,
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
  const rawReply = extractTutorReply(payload);

  if (!rawReply) throw new VisionError('parse', 'AI 助教返回了无效空内容');

  if (mode === 'similar') {
    const parsed = parseSimilarResponse(rawReply);
    return {
      reply: parsed.summary || '已根据当前题目生成相似变式参考：',
      model,
      similarProblems: parsed.similarProblems,
    };
  }

  return { reply: rawReply, model };
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
    console.warn(`[chat] ${primary} 失败（${(error as Error).message}），改用 ${retryModel} 重试`);
    return callTutorOnce(retryModel, request, apiKey);
  }
}
