/**
 * Qoder Sites 云函数：POST /functions/v1/app
 *
 * 这是 src/api/plan.ts 的 Deno edge 运行时版本。平台只打包 functions/ 目录、
 * 不解析 TS 路径别名、不转译 Node 模块，所以这里保持**完全自包含**：
 * - 字段规则复制自 src/physics/reading.ts（唯一来源仍是 B 的那份，改动需同步）
 * - 归一化与状态映射复制自 src/api/validate.ts
 * - Skill 文案来自 scripts/build-skill-module.mjs 生成的 ./skill.ts
 *
 * 契约见 CONTRACTS.md 第 2 节：三种 200（ok / needs_input / unsupported）
 * 加三种错误码（400 图片无效、502 识别失败、504 超时）。
 */

import { SKILL_TEXT } from "./skill.ts";
import { dispatchStageCommand } from './stageCommand.ts';
import { INLINE_API_KEY } from "./inline-key.ts";
import { applyLegacyContract, outputContractFromEnv } from "./legacyBridge.ts";
import type { ClientResult } from "./legacyBridge.ts";
import { validateStagePlan } from "./stagePlan.ts";
import { buildStagePlanResult } from "./stageStatus.ts";
import { STAGE_HTTP_STATUS, isStagePlan } from "./stageTypes.ts";
import type { StagePlanResult } from "./stageTypes.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(options: { port?: number } | ((request: Request) => Promise<Response>), handler?: (request: Request) => Promise<Response>): unknown;
};

const TEMPLATE_ID = "incline_spring";
const UNSUPPORTED_PREFIX = "当前版本支持斜面接光滑水平面与弹簧的运动";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 2000;

const CONDITION_KEYS = [
  "gravityMps2",
  "inclineAngleDeg",
  "inclineLengthM",
  "kineticFrictionCoefficient",
  "initialSpeedMps",
  "blockMassKg",
  "springGapM",
  "springConstantNpm",
] as const;

const FACT_KEYS = [
  "slidesAfterRelease",
  "losslessTurn",
  "horizontalIsFrictionless",
  "springIsUnattached",
] as const;

type ConditionKey = (typeof CONDITION_KEYS)[number];
type FactKey = (typeof FACT_KEYS)[number];
type ReadingField = "templateId" | "conditions" | "facts" | ConditionKey | FactKey;

type Reading = {
  templateId: typeof TEMPLATE_ID;
  conditions: Record<ConditionKey, number | null>;
  facts: Record<FactKey, boolean | null>;
};

type CompleteReading = {
  templateId: typeof TEMPLATE_ID;
  conditions: Record<ConditionKey, number>;
  facts: Record<FactKey, true>;
};

const CONDITION_LABELS: Record<ConditionKey, string> = {
  gravityMps2: "重力加速度",
  inclineAngleDeg: "斜面倾角",
  inclineLengthM: "斜面长度",
  kineticFrictionCoefficient: "斜面动摩擦因数",
  initialSpeedMps: "初速度",
  blockMassKg: "滑块质量",
  springGapM: "弹簧水平间距",
  springConstantNpm: "弹簧劲度系数",
};

const FACT_LABELS: Record<FactKey, { label: string; violated: string }> = {
  slidesAfterRelease: { label: "释放后下滑", violated: "题设中滑块释放后不滑动" },
  losslessTurn: { label: "无损转向", violated: "题设中转向过程有明显能量损失或高度变化" },
  horizontalIsFrictionless: { label: "水平面光滑", violated: "题设中水平面有摩擦" },
  springIsUnattached: { label: "滑块与弹簧不连接", violated: "题设中滑块与弹簧相连" },
};

function labelOf(key: string): string {
  if (key in CONDITION_LABELS) return CONDITION_LABELS[key as ConditionKey];
  if (key in FACT_LABELS) return FACT_LABELS[key as FactKey].label;
  return key;
}

/* ============================ 字段校验（同 src/physics/reading.ts） ============================ */

function isPositive(value: number): boolean {
  return value > 0;
}

const conditionRules: Record<ConditionKey, (value: number) => boolean> = {
  gravityMps2: isPositive,
  inclineAngleDeg: (value) => value > 0 && value < 90,
  inclineLengthM: isPositive,
  kineticFrictionCoefficient: (value) => value >= 0,
  initialSpeedMps: (value) => value >= 0,
  blockMassKg: isPositive,
  springGapM: isPositive,
  springConstantNpm: isPositive,
};

type PhysicsFailure = {
  ok: false;
  code: "NEEDS_INPUT" | "UNSUPPORTED" | "INVALID_READING" | "INCONSISTENT_CONDITIONS";
  message: string;
  fields: ReadingField[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateReading(input: unknown): { ok: true; reading: CompleteReading } | PhysicsFailure {
  if (!isRecord(input)) {
    return { ok: false, code: "INVALID_READING", message: "识别数据应为对象。", fields: [] };
  }
  if (input.templateId == null) {
    return { ok: false, code: "NEEDS_INPUT", message: "请确认题型。", fields: ["templateId"] };
  }
  if (typeof input.templateId !== "string" || input.templateId.trim() === "") {
    return { ok: false, code: "INVALID_READING", message: "题型标识应为非空字符串。", fields: ["templateId"] };
  }
  if (input.templateId !== TEMPLATE_ID) {
    return { ok: false, code: "UNSUPPORTED", message: UNSUPPORTED_PREFIX, fields: ["templateId"] };
  }

  const rawConditions = input.conditions ?? {};
  const rawFacts = input.facts ?? {};
  if (!isRecord(rawConditions)) {
    return { ok: false, code: "INVALID_READING", message: "数值条件应为对象。", fields: ["conditions"] };
  }
  if (!isRecord(rawFacts)) {
    return { ok: false, code: "INVALID_READING", message: "题设前提应为对象。", fields: ["facts"] };
  }

  const missing: ReadingField[] = [];
  const invalid: ReadingField[] = [];
  const unsupported: ReadingField[] = [];
  const conditions: Partial<CompleteReading["conditions"]> = {};
  const facts: Partial<CompleteReading["facts"]> = {};

  for (const key of Object.keys(conditionRules) as ConditionKey[]) {
    const value = rawConditions[key];
    if (value == null) {
      missing.push(key);
    } else if (typeof value !== "number" || !Number.isFinite(value) || !conditionRules[key](value)) {
      invalid.push(key);
    } else if (key === "initialSpeedMps" && value !== 0) {
      unsupported.push(key);
    } else {
      conditions[key] = value;
    }
  }

  for (const key of FACT_KEYS) {
    const value = rawFacts[key];
    if (value == null) {
      missing.push(key);
    } else if (value === true) {
      facts[key] = value;
    } else if (value === false) {
      unsupported.push(key);
    } else {
      invalid.push(key);
    }
  }

  if (unsupported.length > 0) {
    return { ok: false, code: "UNSUPPORTED", message: "题设与当前斜面弹簧模板的前提不符。", fields: unsupported };
  }
  if (invalid.length > 0) {
    return { ok: false, code: "INVALID_READING", message: "请检查标记字段的格式和取值范围。", fields: invalid };
  }
  if (missing.length > 0) {
    return { ok: false, code: "NEEDS_INPUT", message: "请补齐或确认标记的题设条件。", fields: missing };
  }

  return { ok: true, reading: { templateId: TEMPLATE_ID, conditions, facts } as CompleteReading };
}

/* ============================ 归一化与状态映射（同 src/api/validate.ts） ============================ */

type PlanResult =
  | { status: "ok"; reading: Reading; message: string; assumptions: string[] }
  | { status: "needs_input"; reading: Reading | null; missingKeys: string[]; message: string; assumptions: string[] }
  | { status: "unsupported"; message: string };

/**
 * 对外回包：旧模板（templateId）或阶段计划（kind: "stage_plan"）。
 * 与 Node 侧 `PlanResponse` 同一形状，前端按 `reading.kind` 分派。
 */
type PlanResponse = PlanResult | StagePlanResult;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true") return true;
    if (text === "false") return false;
  }
  return null;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .map((item) => item.trim())
    .slice(0, 3);
}

function emptyConditions(): Record<ConditionKey, number | null> {
  return {
    gravityMps2: null,
    inclineAngleDeg: null,
    inclineLengthM: null,
    kineticFrictionCoefficient: null,
    initialSpeedMps: null,
    blockMassKg: null,
    springGapM: null,
    springConstantNpm: null,
  };
}

function emptyFacts(): Record<FactKey, boolean | null> {
  return {
    slidesAfterRelease: null,
    losslessTurn: null,
    horizontalIsFrictionless: null,
    springIsUnattached: null,
  };
}

function normalizeReading(data: Record<string, unknown>): Reading {
  const rawConditions = asRecord(data.conditions);
  const rawFacts = asRecord(data.facts);

  const conditions = emptyConditions();
  for (const key of CONDITION_KEYS) conditions[key] = toNumber(rawConditions[key]);

  const facts = emptyFacts();
  for (const key of FACT_KEYS) facts[key] = toBoolean(rawFacts[key]);

  return { templateId: TEMPLATE_ID, conditions, facts };
}

function explainUnsupported(fields: string[]): string {
  if (fields.includes("initialSpeedMps")) return "题设中滑块有初速度，首版只支持由静止释放";
  const fact = fields.find((key): key is FactKey => key in FACT_LABELS);
  if (fact) return FACT_LABELS[fact].violated;
  return "题设与斜面弹簧模板的前提不符";
}

function describeMissing(code: string, keys: string[]): string {
  if (keys.length === 0) return "识别结果需要确认，请核对条件表";
  const labels = keys.map(labelOf).join("、");
  return code === "INVALID_READING"
    ? `以下条件超出合理范围，请核对：${labels}`
    : `识别到 ${keys.length} 项需要确认：${labels}`;
}

function describeOk(assumptions: string[]): string {
  if (assumptions.length === 0) return "已按题面条件识别完成";
  return `已按 ${assumptions.join("；")} 计算`;
}

function buildPlan(raw: unknown): PlanResult {
  const data = asRecord(raw);
  const assumptions = toStringList(data.assumptions);
  const templateId = typeof data.templateId === "string" ? data.templateId.trim() : "";

  if (templateId === "unsupported") {
    const reason = typeof data.unsupportedReason === "string" ? data.unsupportedReason.trim() : "";
    return {
      status: "unsupported",
      message: reason ? `${UNSUPPORTED_PREFIX}。识别结果：${reason}` : UNSUPPORTED_PREFIX,
    };
  }

  if (!templateId) {
    return {
      status: "needs_input",
      reading: null,
      missingKeys: [],
      message: "没能识别出题型，请重拍清晰的题图，或补充题目文字",
      assumptions,
    };
  }

  if (templateId !== TEMPLATE_ID) {
    return {
      status: "unsupported",
      message: `${UNSUPPORTED_PREFIX}。模型给出的模板为「${templateId}」，未在登记表中`,
    };
  }

  const reading = normalizeReading(data);
  const verdict = validateReading(reading);

  if (verdict.ok) {
    return { status: "ok", reading: verdict.reading as Reading, message: describeOk(assumptions), assumptions };
  }

  const fields = Array.isArray(verdict.fields) ? verdict.fields.map((field): string => field) : [];

  if (verdict.code === "UNSUPPORTED") {
    return { status: "unsupported", message: `${UNSUPPORTED_PREFIX}。${explainUnsupported(fields)}` };
  }

  const missingKeys = fields.filter((key) => key !== "templateId");
  return { status: "needs_input", reading, missingKeys, message: describeMissing(verdict.code, missingKeys), assumptions };
}

/**
 * 识别接口的唯一入口（同 src/api/validate.ts 的 buildPlanResponse）。
 *
 * - `kind === "stage_plan"` → 剥保留字段 → validateStagePlan → 契约第 2 节状态映射
 * - 其余 → 旧 templateId 路径，行为不变
 *
 * 这里与 Node 服务调用的是**同一份** stageStatus / stagePlan 代码
 * （由 scripts/sync-functions.mjs 复制，非手写第二份），保证两端回包一致。
 */
function buildPlanResponse(raw: unknown): PlanResponse {
  const data = asRecord(raw);

  if (isStagePlan(data)) {
    const assumptions = toStringList(data.assumptions);
    return buildStagePlanResult(data, validateStagePlan, assumptions);
  }

  return buildPlan(data);
}

/**
 * 判断回包是否来自阶段计划路径（同 src/api/plan.ts）。
 *
 * `unsupported` 与 `needs_input + reading:null` 两支与旧模板形状重叠，
 * 但兼容桥对它们原样返回，判错不影响结果。
 */
function isStagePlanResult(result: PlanResponse): result is StagePlanResult {
  if (result.status === "invalid_reading") return true;
  if (!("reading" in result)) return false;
  const reading = result.reading;
  return (
    reading !== null &&
    typeof reading === "object" &&
    (reading as Record<string, unknown>).kind === "stage_plan"
  );
}

/* ============================ 百炼视觉模型（同 src/api/dashscope.ts） ============================ */

type VisionFailure = "timeout" | "upstream" | "parse";

class VisionError extends Error {
  readonly kind: VisionFailure;
  constructor(kind: VisionFailure, message: string) {
    super(message);
    this.name = "VisionError";
    this.kind = kind;
  }
}

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL = "qwen4-max";
const DEFAULT_MAX_TOKENS = 2048;

function env(name: string): string {
  let fromRuntime = "";
  try {
    fromRuntime = (Deno.env.get(name) ?? "").trim();
  } catch {
    fromRuntime = "";
  }
  if (fromRuntime) return fromRuntime;

  // 平台 Secret 未配置时的兜底：构建期注入，仓库中恒为空。
  // 一旦在站点设置里填了 DASHSCOPE_API_KEY，上面的运行时值会优先，这里自动失效。
  if (name === "DASHSCOPE_API_KEY") return INLINE_API_KEY.trim();
  return "";
}

function timeoutMs(): number {
  const value = Number(env("VISION_TIMEOUT_MS"));
  return Number.isFinite(value) && value > 0 ? value : 25_000;
}

function maxTokens(): number {
  const value = Number(env("VISION_MAX_TOKENS"));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_TOKENS;
}

function repairRetryEnabled(): boolean {
  return env("VISION_REPAIR_RETRY") !== "0";
}

function extractJson(text: string): unknown {
  let body = text.trim();
  if (!body) throw new VisionError("parse", "识别服务返回了空内容");

  body = body.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new VisionError("parse", "识别服务没有返回 JSON 对象");

  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new VisionError("parse", "识别服务返回的 JSON 无法解析");
  }
}

interface VisionRepairError {
  path: string;
  code: string;
  message: string;
}

interface VisionRepairContext {
  previousRaw: unknown;
  errors: VisionRepairError[];
  missingKeys?: string[];
}

interface VisionRequest {
  imageBase64?: string;
  mime?: string;
  text?: string;
  repairContext?: VisionRepairContext;
}

function formatRepairPrompt(repairContext: VisionRepairContext): string {
  const previousJson = JSON.stringify(repairContext.previousRaw);
  const errorLines =
    repairContext.errors.length > 0
      ? repairContext.errors
          .map((err, index) => `${index + 1}. [${err.code}] ${err.path || "/"}: ${err.message}`)
          .join("\n")
      : "1. [INVALID_READING] /: 整体结构或字段类型不符合 schema 契约";
  const missingLine =
    Array.isArray(repairContext.missingKeys) && repairContext.missingKeys.length > 0
      ? `\n当前标记的缺项路径（若题面确实未给仍保持 null，绝不猜测）：${repairContext.missingKeys.join("、")}`
      : "";

  return [
    "你上一次输出的 JSON 未通过后端校验，请根据报错只修正出错字段并重新输出单个合法 JSON 对象：",
    `上一次输出的 JSON：\n${previousJson}`,
    `后端校验报错列表：\n${errorLines}${missingLine}`,
    "要求：只修正上述报错字段，保持其他正确识别的题面条件不变；题面未给的数值一律保持 null，绝不猜数；只输出一个纯 JSON 对象，不要任何额外文字。",
  ].join("\n\n");
}

function buildRepairContext(raw: unknown, result: PlanResponse): VisionRepairContext | null {
  if (!isStagePlanResult(result)) return null;
  if (result.status === "invalid_reading") {
    return {
      previousRaw: raw,
      errors: [{ path: "/", code: "INVALID_READING", message: result.message }],
    };
  }
  if (result.status === "needs_input" && result.fieldErrors.length > 0) {
    return {
      previousRaw: raw,
      errors: result.fieldErrors,
      missingKeys: result.missingKeys.length > 0 ? result.missingKeys : undefined,
    };
  }
  return null;
}

function isRepairImproved(before: PlanResponse, after: PlanResponse): boolean {
  if (after.status === "ok") return true;
  if (before.status === "invalid_reading") {
    return after.status === "needs_input" || after.status === "unsupported";
  }
  if (
    before.status === "needs_input" &&
    isStagePlanResult(before) &&
    after.status === "needs_input" &&
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

async function callOnce(model: string, request: VisionRequest, apiKey: string): Promise<{ raw: unknown; model: string }> {
  const baseUrl = env("DASHSCOPE_BASE_URL") || DEFAULT_BASE_URL;
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const limit = timeoutMs();

  const userContent: Array<Record<string, unknown>> = [];
  if (request.imageBase64 && request.mime) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${request.mime};base64,${request.imageBase64}` },
    });
  } else {
    userContent.push({ type: "text", text: "本题没有图片，只有下面的文字描述。" });
  }
  if (request.text) {
    userContent.push({
      type: "text",
      text: `学生补充的文字描述（与图片冲突时以文字为准）：\n${request.text}`,
    });
  }
  if (request.repairContext) {
    userContent.push({
      type: "text",
      text: formatRepairPrompt(request.repairContext),
    });
  } else {
    userContent.push({ type: "text", text: "按 Skill 输出这一个 JSON 对象，不要任何额外文字。" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limit);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: maxTokens(),
        messages: [
          { role: "system", content: [{ type: "text", text: SKILL_TEXT }] },
          { role: "user", content: userContent },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new VisionError("timeout", `识别超时（${limit} ms）`);
    }
    throw new VisionError("upstream", "无法连接识别服务，请检查网络或服务地址");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    if (response.status === 401 || response.status === 403) {
      throw new VisionError("upstream", "识别服务鉴权失败，请检查 DASHSCOPE_API_KEY 是否有效");
    }
    if (response.status === 404) {
      throw new VisionError("upstream", `模型「${model}」不存在或当前账号未开通`);
    }
    if (response.status === 429) {
      throw new VisionError("upstream", "识别服务调用频率或额度受限，请稍后重试");
    }
    throw new VisionError("upstream", `识别服务返回 ${response.status}：${detail || "无详细信息"}`);
  }

  const payload = (await response.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: unknown } }> }
    | null;

  const content = payload?.choices?.[0]?.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              typeof part === "string"
                ? part
                : typeof (part as { text?: unknown })?.text === "string"
                  ? (part as { text: string }).text
                  : "",
            )
            .join("")
        : "";

  return { raw: extractJson(text), model };
}

async function callVisionModel(request: VisionRequest): Promise<{ raw: unknown; model: string }> {
  const apiKey = env("DASHSCOPE_API_KEY");
  if (!apiKey) {
    throw new VisionError("upstream", "站点未配置 DASHSCOPE_API_KEY，请在 Site Settings 的 Secrets 中填写");
  }

  const primary = env("DASHSCOPE_VISION_MODEL") || DEFAULT_MODEL;
  const fallback = env("DASHSCOPE_FALLBACK_MODEL");

  try {
    return await callOnce(primary, request, apiKey);
  } catch (error) {
    const retryable = error instanceof VisionError && (error.kind === "timeout" || error.kind === "upstream");
    if (!retryable || !fallback || fallback === primary) throw error;
    return callOnce(fallback, request, apiKey);
  }
}

/* ============================ HTTP 入口 ============================ */

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte)) return "image/png";
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function buildTutorSystemPrompt(context?: Record<string, unknown> | null): string {
  const base = [
    "你是 VisualLab 的高中物理 AI 助教，正在结合交互动画一步步辅导学生理解当前这道物理题。",
    "要求：",
    "1. 紧扣下面提供的「当前题目与物理引擎实算数据」作答：涉及时刻、速度、位置、支持力/张力、能量或反求半径等数值时，严格以实算数据为准，绝不编造与实算矛盾的数值。",
    "2. 像有经验的高中物理老师一样讲清受力分析、运动过程拆分、守恒定律与临界条件；先给清晰结论，再分步列式推导。",
    "3. 表达简洁易读，公式用直观文本写法（如 N + mg = mv²/R、v = √(gR)、ΔEk = W合），不要输出大段套话，不要输出复杂 Markdown 表格。",
    "4. 必要时可提醒学生在时间轴点击对应关键事件观察，或在「查看原题」中修改参数做对比实验。",
  ].join("\n");
  if (!context || Object.keys(context).length === 0) return base;
  let serialized = "";
  try {
    serialized = JSON.stringify(context, null, 2).slice(0, 6000);
  } catch {
    serialized = "";
  }
  return serialized ? `${base}\n\n【当前题目与物理引擎实算数据】\n${serialized}` : base;
}

async function callTutorChat(request: {
  message: string;
  context?: Record<string, unknown> | null;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
}): Promise<{ reply: string; model: string }> {
  const apiKey = env("DASHSCOPE_API_KEY");
  if (!apiKey) throw new VisionError("upstream", "服务端未配置 DASHSCOPE_API_KEY");
  const primary = env("DASHSCOPE_CHAT_MODEL") || env("DASHSCOPE_VISION_MODEL") || DEFAULT_MODEL;
  const fallback = env("DASHSCOPE_FALLBACK_MODEL");

  const runOnce = async (model: string): Promise<{ reply: string; model: string }> => {
    const baseUrl = env("DASHSCOPE_BASE_URL") || DEFAULT_BASE_URL;
    const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const limit = timeoutMs();
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: buildTutorSystemPrompt(request.context) },
    ];
    for (const item of (request.history ?? []).slice(-8)) {
      const content = typeof item.text === "string" ? item.text.trim().slice(0, 1200) : "";
      if (!content) continue;
      messages.push({ role: item.role === "assistant" ? "assistant" : "user", content });
    }
    messages.push({ role: "user", content: request.message.trim().slice(0, 2000) });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, temperature: 0.3, max_tokens: Math.min(maxTokens(), 1400), messages }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new VisionError("timeout", `助教回答超时（${limit} ms）`);
      throw new VisionError("upstream", "无法连接 AI 助教服务，请检查网络或服务地址");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      if (response.status === 401 || response.status === 403) throw new VisionError("upstream", "AI 服务鉴权失败，请检查 DASHSCOPE_API_KEY 是否有效");
      if (response.status === 429) throw new VisionError("upstream", "AI 服务调用频率或额度受限，请稍后重试");
      throw new VisionError("upstream", `AI 助教服务返回 ${response.status}：${detail || "无详细信息"}`);
    }
    const payload = (await response.json().catch(() => null)) as { choices?: Array<{ message?: { content?: unknown } }> } | null;
    const content = payload?.choices?.[0]?.message?.content;
    const reply =
      typeof content === "string"
        ? content.trim()
        : Array.isArray(content)
          ? content.map((part) => (typeof part === "string" ? part : typeof (part as { text?: unknown })?.text === "string" ? (part as { text: string }).text : "")).join("").trim()
          : "";
    if (!reply) throw new VisionError("parse", "AI 助教返回了空内容");
    return { reply, model };
  };

  try {
    return await runOnce(primary);
  } catch (error) {
    const retryable = error instanceof VisionError && (error.kind === "timeout" || error.kind === "upstream");
    if (!retryable || !fallback || fallback === primary) throw error;
    return runOnce(fallback);
  }
}

export async function handler(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const requestId = Math.random().toString(36).slice(2, 10);

  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return json({ message: "仅支持 POST" }, 405);

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    return json({ message: "请求需为 multipart/form-data，图片字段名为 image" }, 400);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ message: "无法解析上传内容，请重新选择图片" }, 400);
  }

  const commandResult=dispatchStageCommand(form);
  if(commandResult)return json(commandResult.body,commandResult.status);

  const rawChat = form.get("chatMessage");
  if (typeof rawChat === "string") {
    const chatMessage = rawChat.trim().slice(0, MAX_TEXT_CHARS);
    if (!chatMessage) return json({ message: "提问内容不能为空" }, 400);
    if (form.get("image") instanceof Blob || form.get("command") !== null) {
      return json({ message: "问答模式不能同时提交图片或阶段指令" }, 400);
    }
    let context: Record<string, unknown> | null = null;
    let history: Array<{ role: "user" | "assistant"; text: string }> = [];
    const rawContext = form.get("chatContext");
    if (typeof rawContext === "string" && rawContext.trim()) {
      try {
        const parsed = JSON.parse(rawContext) as { history?: Array<{ role: "user" | "assistant"; text: string }>; [key: string]: unknown };
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          if (Array.isArray(parsed.history)) history = parsed.history;
          const { history: _h, ...rest } = parsed;
          context = rest;
        }
      } catch {
        return json({ message: "chatContext 须为合法 JSON 字符串" }, 400);
      }
    }
    try {
      const chat = await callTutorChat({ message: chatMessage, context, history });
      const elapsed = Date.now() - startedAt;
      return json(
        { status: "ok", reply: chat.reply },
        200,
        { "x-request-id": requestId, "x-elapsed-ms": String(elapsed), "x-vision-model": chat.model },
      );
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      const failure = error instanceof VisionError ? error.kind : "upstream";
      const message = error instanceof VisionError ? error.message : "AI 助教服务异常，请稍后重试";
      const status = failure === "timeout" ? 504 : 502;
      return json({ status: "error", message }, status, { "x-request-id": requestId, "x-elapsed-ms": String(elapsed) });
    }
  }
  const rawText = form.get("text");
  const text = typeof rawText === "string" ? rawText.trim().slice(0, MAX_TEXT_CHARS) : "";

  const file = form.get("image");
  let imageBase64: string | undefined;
  let mime: string | undefined;

  if (file instanceof Blob) {
    if (file.size === 0) return json({ message: "图片为空，请重新选择" }, 400);
    if (file.size > MAX_IMAGE_BYTES) return json({ message: "图片超过 8 MB，单张图片请控制在 8 MB 以内" }, 400);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffImageMime(bytes);
    if (!sniffed) return json({ message: "只支持 JPG 或 PNG 图片" }, 400);

    imageBase64 = toBase64(bytes);
    mime = sniffed;
  }

  if (!imageBase64 && !text) {
    return json({ message: "请上传题图，或输入题目文字" }, 400);
  }

  let vision: { raw: unknown; model: string };
  try {
    vision = await callVisionModel({ imageBase64, mime, text });
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    const failure = error instanceof VisionError ? error.kind : "upstream";
    const message = error instanceof VisionError ? error.message : "识别服务异常，请稍后重试";
    const status = failure === "timeout" ? 504 : 502;

    console.error(`[plan] ${requestId} ${failure} ${elapsed}ms ${message}`);
    return json({ message }, status, {
      "x-request-id": requestId,
      "x-elapsed-ms": String(elapsed),
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
        repairContext,
      });
      const repairedInternal = buildPlanResponse(repairedVision.raw);
      if (isRepairImproved(internal, repairedInternal)) {
        vision = repairedVision;
        internal = repairedInternal;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[plan] ${requestId} repair_fallback ${reason}`);
    }
  }

  const result: ClientResult =
    isStagePlanResult(internal) && outputContractFromEnv(env("API_CONTRACT_MODE")) === "legacy"
      ? applyLegacyContract(internal, validateReading, UNSUPPORTED_PREFIX)
      : (internal as ClientResult);
  const elapsed = Date.now() - startedAt;

  // 契约第 2 节：ok / needs_input / unsupported 都是 200，只有 invalid_reading 是 502
  const status = result.status === "invalid_reading" ? STAGE_HTTP_STATUS.invalid_reading : 200;

  console.log(
    `[plan] ${requestId} ${result.status} ${elapsed}ms model=${vision.model} image=${imageBase64 ? "yes" : "no"} text=${text.length}`,
  );

  return json(result, status, {
    "x-request-id": requestId,
    "x-elapsed-ms": String(elapsed),
    "x-vision-model": vision.model,
  });
}
