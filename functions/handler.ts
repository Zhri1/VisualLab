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
import {
  buildChatRagQuery,
  formatRagForSimilar,
  formatRagForTutor,
  formatRagForVision,
  searchPhysicsRag,
  toRagReferences,
} from "./rag/retriever.ts";
import type { RagReference } from "./rag/types.ts";

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
  ragHint?: string;
  repairContext?: VisionRepairContext;
}

function buildTargetedRepairHints(errors: VisionRepairError[]): string[] {
  const hints: string[] = [];
  const joined = errors.map((e) => `${e.path} ${e.code} ${e.message}`).join("\n");

  if (joined.includes("landingPlaneYM") || joined.includes("圆弧后抛体需固定")) {
    hints.push(
      '- 圆弧后抛体修正指引：必须删除该 projectile 阶段的 dropHeightM 键，只保留世界坐标 landingPlaneYM。换算公式：① 若落地平面与圆弧最低点/水平地面同高，直接填 "landingPlaneYM": 0；② 若从半径 R 的半圆最高点（y = 2R）或端点（y = y_exit）向下落差 h，则填 "landingPlaneYM": y_exit - h（例如半圆最高点向下落差 h 时为 2R - h）；绝不可同时保留 dropHeightM 与 landingPlaneYM。',
    );
  }

  if (
    joined.includes("释放上界小于真实压缩量") ||
    joined.includes("弹簧参数与固定能量不符") ||
    joined.includes("临界条件须指向引用A") ||
    joined.includes("AB不能小于已用释放位移")
  ) {
    hints.push(
      '- 预压弹簧（spring_release）修正指引：若题面已明确给出劲度系数 k 和压缩量 x₀，只填 springConstantNpm 与 initialCompressionM，删除顶层 energy、删除不必要的 constraints，且不要填写或估算 releaseCompleteByM；若后接水平段距离从脱离弹簧后量起，用 end: { "kind": "distance", "distanceM": d }，仅当题面给的是从初始压缩点 A 到圆弧入口 B 的总长 AB 时才用 distance_from_stage_start（且须满足 AB ≥ initialCompressionM）。',
    );
  }

  if (joined.includes("来向速度方向与斜面切向不一致")) {
    hints.push(
      '- 斜面接续修正指引：检查 incline_slide 的 direction（初速冲上斜面须填 "up"）与倾角 angleDeg 是否与来向速度方向一致；若经过光滑弯道转向，请在斜面前补 lossless_turn。',
    );
  }

  return hints;
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
  const targetedHints = buildTargetedRepairHints(repairContext.errors);
  const targetedBlock = targetedHints.length > 0 ? `\n针对性修正指引：\n${targetedHints.join("\n")}` : "";

  return [
    "你上一次输出的 JSON 未通过后端校验，请根据报错只修正出错字段并重新输出单个合法 JSON 对象：",
    `上一次输出的 JSON：\n${previousJson}`,
    `后端校验报错列表：\n${errorLines}${missingLine}${targetedBlock}`,
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
  if (request.ragHint) {
    userContent.push({
      type: "text",
      text: request.ragHint,
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

const NULLISH_REPLY_RE = /^(?:null|none|undefined|nil|nan|n\/a|\{\}|\[\]|""|'')$/i;

type TutorChatMode = "tutor" | "similar" | "socratic";

interface TutorSimilarProblem {
  title: string;
  tags: string[];
  difficulty?: string;
  stem: string;
  focus: string;
  hint: string;
}

function extractTextFromField(field: unknown): string {
  if (typeof field === "string") return field.trim();
  if (Array.isArray(field)) {
    return field
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const obj = part as { text?: unknown; content?: unknown };
          if (typeof obj.text === "string") return obj.text;
          if (typeof obj.content === "string") return obj.content;
        }
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function isUsableReply(text: string): boolean {
  const trimmed = text.trim();
  return Boolean(trimmed) && !NULLISH_REPLY_RE.test(trimmed);
}

function extractTutorReply(payload: unknown, options?: { allowReasoningFallback?: boolean }): string {
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

  // 相似题模式必须关闭 reasoning 回退：思考链（英文推导稿）不是答案。
  if (options?.allowReasoningFallback === false) return "";

  const reasoning = extractTextFromField(choice?.message?.reasoning_content);
  if (isUsableReply(reasoning)) return reasoning;

  return "";
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
    : raw && typeof raw === "object" && Array.isArray((raw as { similarProblems?: unknown }).similarProblems)
      ? (raw as { similarProblems: unknown[] }).similarProblems
      : raw && typeof raw === "object" && Array.isArray((raw as { problems?: unknown }).problems)
        ? (raw as { problems: unknown[] }).problems
        : [];

  const result: TutorSimilarProblem[] = [];
  let rejectedCount = 0;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    const stem = typeof obj.stem === "string" ? obj.stem.trim() : "";
    if (!title || !stem || NULLISH_REPLY_RE.test(title) || NULLISH_REPLY_RE.test(stem)) continue;
    if (hasUnresolvedVariableParam(stem)) {
      rejectedCount += 1;
      continue;
    }
    const tags = Array.isArray(obj.tags)
      ? obj.tags
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          .map((t) => t.trim())
          .slice(0, 4)
      : [];
    const difficulty = typeof obj.difficulty === "string" && obj.difficulty.trim() ? obj.difficulty.trim() : undefined;
    const focus =
      typeof obj.focus === "string" && obj.focus.trim()
        ? obj.focus.trim()
        : "保留核心力学模型，改变关键几何或约束条件以强化迁移理解。";
    const hint =
      typeof obj.hint === "string" && obj.hint.trim()
        ? obj.hint.trim()
        : "按运动阶段拆分过程，分别列出受力方程与能量/动量守恒方程求解。";
    result.push({ title, tags, difficulty, stem, focus, hint });
    if (result.length >= 3) break;
  }
  return { problems: result, rejectedCount };
}

function parseSimilarResponseDetailed(text: string): {
  summary: string;
  similarProblems: TutorSimilarProblem[];
  rejectedCount: number;
} {
  let body = text.trim();
  body = body.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  const candidates: string[] = [];
  const objStart = body.indexOf("{");
  const objEnd = body.lastIndexOf("}");
  const arrStart = body.indexOf("[");
  const arrEnd = body.lastIndexOf("]");

  if (objStart !== -1 && objEnd > objStart) candidates.push(body.slice(objStart, objEnd + 1));
  if (arrStart !== -1 && arrEnd > arrStart) candidates.push(body.slice(arrStart, arrEnd + 1));

  let totalRejected = 0;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const { problems, rejectedCount } = normalizeSimilarProblemsWithStats(parsed);
      totalRejected = Math.max(totalRejected, rejectedCount);
      if (problems.length > 0) {
        const rawSummary =
          parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as { summary?: unknown }).summary === "string"
            ? (parsed as { summary: string }).summary.trim()
            : "";
        const summary = isUsableReply(rawSummary)
          ? rawSummary
          : `结合当前题目的物理模型，为你精选了 ${problems.length} 道高中力学相似变式题，点击「生成动画试做」可直接加载运行：`;
        return { summary, similarProblems: problems, rejectedCount };
      }
    } catch {
      // 尝试下一个 JSON 片段
    }
  }

  return { summary: isUsableReply(text) ? text.trim() : "", similarProblems: [], rejectedCount: totalRejected };
}

function buildTutorSystemPrompt(
  context?: Record<string, unknown> | null,
  mode: TutorChatMode = "tutor",
  ragContext?: string,
): string {
  const base =
    mode === "similar"
      ? [
          "你是 VisualLab 的资深高中物理命题教师，擅长根据当前物理题的模型与阶段组合设计高质量、100% 可在 VisualLab 物理引擎中生成动画的相似变式题。",
          "请基于下面提供的当前题目信息与物理引擎实算数据，设计 2~3 道高中力学相似变式题。",
          "严格要求（每条均为硬性约束，违反任一条都会导致动画生成失败）：",
          '1. 只输出一个合法 JSON 对象，格式为：{"summary":"一句话说明推荐思路","similarProblems":[{"title":"题目标题","tags":["考点1","考点2"],"difficulty":"基础|中档|拔高","stem":"完整题干（包含明确物理量数值、单位与 g=10 m/s²，可直接用于物理动画建模）","focus":"变式亮点（1~2句）","hint":"核心解题思路与关键方程（纯文本公式，不要 LaTeX 反斜杠）"}]}。',
          "2. 模型白名单（每道题必须 100% 属于以下 VisualLab 支持的模型范围，禁止超纲如变力、空气阻力、非线性阻力、弹性绳、多体复杂复合场或三维运动等）：",
          "   - 单物体多过程（可按合理物理顺序串联）：斜面下滑或初速冲上斜面往返（incline_slide）、坡底光滑无损转向（lossless_turn）、水平面滑行（horizontal_slide）、水平或倾斜传送带（conveyor_belt）、平抛或斜抛（projectile）、固定竖直圆弧内轨或轻杆/双轨（vertical_arc）、光滑或粗糙弹簧接触与回弹（spring_contact）、预压弹簧静止释放（spring_release）、分段水平恒定合力（constant_force_1d）、匀强磁场偏转（magnetic_deflection）、可自由滑动的光滑圆弧槽（movable_arc）、不锚墙自由弹簧双球（spring_pair）。",
          "   - 多物体系统（独立出题）：水平两球一维碰撞（可接平抛或滑行）、轻绳单摆最低点正碰、光滑地面滑块-长木板（block_plank）、理想定滑轮连接体（pulley_system）。",
          "3. 严禁非法混拼：单物体多过程模型与多物体系统模型（如 block_plank、pulley_system、pendulum_swing）不可混拼在同一道题中（例如禁止「滑块-长木板 + 竖直圆弧」或「定滑轮 + 斜面平抛」）；且转向（lossless_turn）后不可直接平抛，必须经过一段明确长度的水平面再从桌沿飞出；匀强磁场偏转（magnetic_deflection）只能单独成题、作为首段后接抛体（magnetic_deflection → projectile），或接在水平滑行之后（horizontal_slide → magnetic_deflection），严禁先平抛/斜抛再入磁场，也严禁斜向穿出磁场后直接接水平滑行（horizontal_slide 要求纯水平速度）。",
          "4. 严禁空间几何自相矛盾：同一个轨道端点绝不能「既平滑连接斜面/平面/圆弧，又直接悬空平抛落地」！若设计「传送带 + 斜面折返 + 平抛」，必须明确区分左右两端（例如「水平传送带左端高出地面 h 悬空、右端平滑连接足够长光滑斜面，物块向右冲上斜面折返后从传送带左端水平飞出」，或「斜面下滑 → 水平传送带 → 右端平抛落地」）；平抛切入圆弧必须明确给出圆弧入口角、半径、内侧/轻杆属性与圆心角或终点位置。",
          "5. 严禁遗漏必需数值与前提：题干必须明确给出所有计算必需的具体数字与单位（如 g = 10 m/s²、质量、倾角、长度或高度、半径、动摩擦因数、劲度系数、初速度、初始间距等），禁止出成纯字母符号推导题！严禁写「沿水平面滑行一段距离」或「沿光滑水平面滑行」而不给具体水平距离 d（每一段水平滑行必须给出具体长度，如 d = 1 m，否则不要加水平段）；若弹簧压缩段处于粗糙水平面（μ > 0），必须明确写出最大静摩擦因数（如「静摩擦因数 μₛ = μ = 0.2」）或写明「弹簧压缩区域光滑」。仅在明确考查临界反求（如「恰好通过圆弧最高点」「恰好不再滑上圆弧槽」）或「足够长光滑斜面」时，才允许对应物理量不给数值。",
          "6. 严禁分情形变参题与脆弱长链：严禁出「某参数可调 / 待定 / 变化，第(1)问求最值、第(2)问当 x = … 时」的分情形变参题！所有物理量（如磁场宽度 d、轨道半径 R、桌面长度、弹簧压缩量、外力 F 等）必须在题干开头直接给出唯一确定的具体数值；且单道变式题阶段数控制在 2~4 段经典稳健组合内（不拼凑 5~6 段脆弱长链，圆弧最高点飞出后直接落回与圆弧底端同高的水平地面，不要再硬接非切向斜面）。",
          "7. 绝不输出 null、NULL、undefined 或空数组；所有字符串字段必须为自然流畅的中文，且 stem 与 hint 中的数值推导必须前后自洽。",
        ].join("\n")
      : mode === "socratic"
        ? [
            "你是 VisualLab 循循善诱的苏格拉底式高中物理老师（分步带练模式），正在结合交互动画一步步引导学生自己把物理题想明白、算出来。",
            "硬性教学规则（每条必须严格遵守）：",
            "1. 严禁一次性给出完整全过程解答、严禁直接报出最终答案数值或把所有阶段的方程一次全列出来！每次回复严格控制在 80~160 字以内，保持轻快、聚焦、可互动。",
            "2. 开场首问策略：若是开场首问，先用 1~2 句话帮学生把整道题拆成清晰的几个物理阶段，然后只聚焦【第 1 阶段】，指出关键受力或守恒条件，再提出 1 个具体的思考小问题让学生接招。",
            "3. 多轮追问策略：若学生已在回答上一步问题，先明确肯定答对的部分，或温柔指出卡点与高频易错点（结合【当前题目与物理引擎实算数据】严格核对数值与方向，绝不编造矛盾数据）；确认当前阶段过关后，再推进到下一阶段并抛出下一个引导小问题。",
            "4. 只有当全部物理阶段都引导学生自己推导完成后，才用简短 2~3 句话总结全题关键结论与核心物理方法。",
            "5. 绝不输出字面 null、NULL、undefined、空白回复或原始 JSON 字段名；不要输出 # 标题、--- 分割线、Markdown 表格或 LaTeX 反斜杠命令（如 \\frac、\\sqrt），公式一律用直观纯文本符号（如 a = g(sinθ - μcosθ)、N + mg = mv²/R、v = √(gR)）。必要时可提醒学生观察动画对应时刻。",
          ].join("\n")
        : [
            "你是 VisualLab 的资深高中物理 AI 助教，正在结合交互动画一步步辅导学生理解物理题。",
            "核心原则：",
            "1. 即使上下文里没有 problemText（例如用户上传题图识别，没有原始文字题干），也要直接根据 reading（阶段组合与数值参数）、events（关键时刻与事件）、derivedCalculations（反求/推导结果）和 currentSnapshot 完整理解物理情景，像有经验的高中物理老师一样自然、清晰地回答用户的任何自由提问。",
            "2. 绝不输出字面 null、NULL、undefined 或空白回复，也不要机械复读原始 JSON 字段名；如果用户问的是开放性概念、推导或拓展问题，请直接展开讲解。",
            "3. 涉及时刻、速度、位置、支持力/张力、能量或半径等数值时，严格以「当前题目与物理引擎实算数据」为准，绝不编造与实算矛盾的数值。",
            "4. 先给清晰结论，再分步讲清受力分析、运动过程拆分、守恒定律与临界条件。表达简洁易读，直接用中文自然段或「1. / 2.」分点；不要输出 # 标题、--- 分割线、Markdown 表格或 LaTeX 反斜杠命令（如 \\frac、\\sqrt、\\[...\\]），公式一律用直观符号写成纯文本（如 N + mg = mv²/R、v = √(gR)、ΔEk = W合）。",
            "5. 必要时可提醒学生在时间轴点击对应关键事件观察，或直接说「把某参数改成某值」做对比实验。",
          ].join("\n");
  const sections: string[] = [base];
  if (context && Object.keys(context).length > 0) {
    let serialized = "";
    try {
      serialized = JSON.stringify(context, null, 2).slice(0, 6000);
    } catch {
      serialized = "";
    }
    if (serialized) {
      sections.push(`【当前题目与物理引擎实算数据】\n${serialized}`);
    }
  }
  const trimmedRag = ragContext?.trim();
  if (trimmedRag) {
    sections.push(trimmedRag);
  }
  return sections.join("\n\n");
}

const SIMILAR_REPAIR_HINT =
  "你上一次生成的相似变式题包含「可调 / 待定 / 未知」等未定变参，已被校验过滤。请重新输出 2~3 道完全合规的相似变式题：所有物理量必须在题干开头直接给出唯一确定的具体数值，严禁出现「可调」「待定」或「第(2)问当 x = … 时」的分情形设问，且每题阶段数控制在 2~4 段内。";

async function callTutorChat(request: {
  message: string;
  context?: Record<string, unknown> | null;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  mode?: TutorChatMode;
}): Promise<{ reply: string; model: string; similarProblems?: TutorSimilarProblem[]; ragReferences?: RagReference[] }> {
  const apiKey = env("DASHSCOPE_API_KEY");
  if (!apiKey) throw new VisionError("upstream", "服务端未配置 DASHSCOPE_API_KEY");
  const primary = env("DASHSCOPE_CHAT_MODEL") || env("DASHSCOPE_VISION_MODEL") || DEFAULT_MODEL;
  const fallback = env("DASHSCOPE_FALLBACK_MODEL");
  const mode: TutorChatMode =
    request.mode === "similar" ? "similar" : request.mode === "socratic" ? "socratic" : "tutor";
  const ragMode = mode === "similar" ? "similar" : "tutor";
  const ragHits = searchPhysicsRag(buildChatRagQuery(request.message, request.context, ragMode));
  const ragContext = mode === "similar" ? formatRagForSimilar(ragHits) : formatRagForTutor(ragHits);
  const ragReferences = toRagReferences(ragHits);

  const runOnce = async (
    model: string,
    similarRepairHint?: string,
  ): Promise<{ reply: string; model: string; similarProblems?: TutorSimilarProblem[]; ragReferences?: RagReference[] }> => {
    const baseUrl = env("DASHSCOPE_BASE_URL") || DEFAULT_BASE_URL;
    const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const limit = timeoutMs();
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: buildTutorSystemPrompt(request.context, mode, ragContext) },
    ];
    if (mode === "tutor" || mode === "socratic") {
      for (const item of (request.history ?? []).slice(-8)) {
        const content = typeof item.text === "string" ? item.text.trim().slice(0, 1200) : "";
        if (!content || NULLISH_REPLY_RE.test(content)) continue;
        messages.push({ role: item.role === "assistant" ? "assistant" : "user", content });
      }
    }
    const userMessage = request.message.trim().slice(0, 2000);
    messages.push({
      role: "user",
      content: similarRepairHint ? `${userMessage}\n\n${similarRepairHint}` : userMessage,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: mode === "similar" ? 0.5 : 0.35,
          max_tokens: Math.min(maxTokens(), mode === "similar" ? 2000 : 1400),
          // 相似题要求纯 JSON 输出：开着思考链会把 max_tokens 全耗在 reasoning_content 上。
          ...(mode === "similar" ? { enable_thinking: false } : {}),
          messages,
        }),
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
    const payload = await response.json().catch(() => null);
    const rawReply = extractTutorReply(payload, { allowReasoningFallback: mode !== "similar" });
    if (!rawReply) throw new VisionError("parse", "AI 助教返回了无效空内容");
    if (mode === "similar") {
      const parsed = parseSimilarResponseDetailed(rawReply);
      if (parsed.similarProblems.length === 0 && parsed.rejectedCount > 0 && !similarRepairHint) {
        throw new VisionError("parse", "相似变式题含未定变参，需重新生成");
      }
      return {
        reply: parsed.summary || "已根据当前题目生成相似变式参考：",
        model,
        similarProblems: parsed.similarProblems,
        ragReferences,
      };
    }
    return { reply: rawReply, model, ragReferences };
  };

  try {
    return await runOnce(primary);
  } catch (error) {
    const retryable =
      error instanceof VisionError &&
      (error.kind === "timeout" || error.kind === "upstream" || error.kind === "parse");
    if (!retryable) throw error;
    const retryModel = fallback && fallback !== primary ? fallback : error.kind === "parse" ? primary : "";
    if (!retryModel) throw error;
    const repairHint =
      request.mode === "similar" && error.kind === "parse" && error.message.includes("未定变参")
        ? SIMILAR_REPAIR_HINT
        : undefined;
    return runOnce(retryModel, repairHint);
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
    const rawMode = form.get("chatMode");
    const modeToken =
      typeof rawMode === "string" && rawMode.trim()
        ? rawMode.trim().toLowerCase()
        : context && typeof context.mode === "string" && context.mode.trim()
          ? context.mode.trim().toLowerCase()
          : "";
    const chatMode: TutorChatMode =
      modeToken === "similar" ? "similar" : modeToken === "socratic" ? "socratic" : "tutor";
    try {
      const chat = await callTutorChat({ message: chatMessage, context, history, mode: chatMode });
      const elapsed = Date.now() - startedAt;
      const ragReferences = chat.ragReferences ?? [];
      return json(
        chatMode === "similar"
          ? { status: "ok", reply: chat.reply, similarProblems: chat.similarProblems ?? [], ragReferences }
          : { status: "ok", reply: chat.reply, ragReferences },
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

  const visionRagHits = text ? searchPhysicsRag({ text, mode: "vision", topK: 2 }) : [];
  const ragHint = formatRagForVision(visionRagHits) || undefined;

  let vision: { raw: unknown; model: string };
  try {
    vision = await callVisionModel({ imageBase64, mime, text, ragHint });
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
        ragHint,
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
