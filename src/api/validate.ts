/**
 * 把模型回包校验成契约里的四种状态之一（C · AI 接口）
 *
 * 这一层是"模型说什么"和"前端能信什么"之间的闸门：
 * - 数值类型不对、越界、缺项 → needs_input，让用户补，不静默改数；
 * - 模板不在登记表、前提被明确否定、有初速度 → unsupported；
 * - 只有全部通过才返回 ok。
 */

import {
  FACT_RULES,
  NUMBER_RULES,
  TEMPLATE_ID,
  UNSUPPORTED_PREFIX,
  emptyConditions,
  emptyFacts,
  type Facts,
  type Nullable,
  type Reading,
} from './contract';

export interface PlanOk {
  status: 'ok';
  reading: Reading;
  assumptions: string[];
}

export interface PlanNeedsInput {
  status: 'needs_input';
  reading: Reading | null;
  missingKeys: string[];
  message: string;
  assumptions: string[];
}

export interface PlanUnsupported {
  status: 'unsupported';
  message: string;
}

export type PlanResult = PlanOk | PlanNeedsInput | PlanUnsupported;

/** 模型可能把数字写成字符串、把布尔写成 "true"，这里统一收口 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true') return true;
    if (text === 'false') return false;
  }
  return null;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim())
    .slice(0, 3);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * 校验并归一化模型输出。
 * raw 是模型返回的 JSON 对象（已 parse）。
 */
export function buildPlan(raw: unknown): PlanResult {
  const data = asRecord(raw);
  const assumptions = toStringList(data.assumptions);
  const templateId = typeof data.templateId === 'string' ? data.templateId.trim() : '';

  // 1. 模板判定
  if (templateId === 'unsupported') {
    const reason =
      typeof data.unsupportedReason === 'string' ? data.unsupportedReason.trim() : '';
    return {
      status: 'unsupported',
      message: reason ? `${UNSUPPORTED_PREFIX}。识别结果：${reason}` : UNSUPPORTED_PREFIX,
    };
  }

  if (templateId !== TEMPLATE_ID) {
    return {
      status: 'unsupported',
      message: templateId
        ? `${UNSUPPORTED_PREFIX}。模型给出的模板为「${templateId}」，未在登记表中`
        : `${UNSUPPORTED_PREFIX}。未能从图片中识别出题型`,
    };
  }

  const rawConditions = asRecord(data.conditions);
  const rawFacts = asRecord(data.facts);

  // 2. 事实判定：明确否定的前提直接超范围，不进入计算
  const facts: Nullable<Facts> = emptyFacts();
  for (const rule of FACT_RULES) {
    const value = toBoolean(rawFacts[rule.key]);
    facts[rule.key] = value;
    if (value === false) {
      return { status: 'unsupported', message: `${UNSUPPORTED_PREFIX}。${rule.violated}` };
    }
  }

  // 3. 数值判定：缺项、类型错、越界都收敛成"需要用户确认"
  const conditions = emptyConditions();
  const missing: string[] = [];
  const notes: string[] = [];

  for (const rule of NUMBER_RULES) {
    const value = toNumber(rawConditions[rule.key]);
    if (value === null) {
      missing.push(rule.key);
      continue;
    }
    const problem = rule.check(value);
    if (problem) {
      missing.push(rule.key);
      notes.push(`${rule.label}识别为 ${value}${rule.unit === '—' ? '' : rule.unit}，${problem}`);
      continue;
    }
    conditions[rule.key] = value;
  }

  // 4. 首版只支持由静止释放
  if (conditions.initialSpeedMps !== null && conditions.initialSpeedMps > 0) {
    return {
      status: 'unsupported',
      message: `${UNSUPPORTED_PREFIX}。题设中滑块有 ${conditions.initialSpeedMps} m/s 的初速度，首版只支持由静止释放`,
    };
  }

  // 5. 事实未知同样要用户确认，不能替用户假设"水平面光滑"
  for (const rule of FACT_RULES) {
    if (facts[rule.key] === null) missing.push(rule.key);
  }

  const reading: Reading = { templateId, conditions, facts };

  if (missing.length > 0) {
    const labels = [
      ...NUMBER_RULES.filter((rule) => missing.includes(rule.key)).map((rule) => rule.label),
      ...FACT_RULES.filter((rule) => missing.includes(rule.key)).map((rule) => rule.label),
    ];
    const head = notes.length > 0 ? notes.join('；') : `识别到 ${missing.length} 项需要确认`;
    return {
      status: 'needs_input',
      reading,
      missingKeys: missing,
      message: `${head}：${labels.join('、')}`,
      assumptions,
    };
  }

  return { status: 'ok', reading, assumptions };
}

/** 给前端展示用的字段中文名，缺项提示可以复用 */
export function labelOf(key: string): string {
  return (
    NUMBER_RULES.find((rule) => rule.key === key)?.label ??
    FACT_RULES.find((rule) => rule.key === key)?.label ??
    key
  );
}
