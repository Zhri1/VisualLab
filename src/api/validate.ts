/**
 * 模型回包 → 契约里的四种状态（C · AI 接口）
 *
 * 分工：
 * - C（这里）：把模型不可信的输出**归一化**成契约形状（字符串数字转数值、"true" 转布尔、缺项置 null），
 *   再把 B 的判定结果**映射**成 HTTP 契约里的 status 和中文提示。
 * - B（src/physics/reading.ts）：唯一的字段规则来源，决定哪些值合法、缺什么、是否超范围。
 *
 * 这样接口层和动画库不会各有一套规则，也不会出现"接口返回 ok、assembleScene 却报错"。
 */

import { validateReading } from '../physics/reading';
import type { Reading } from '../physics/reading';

import {
  CONDITION_KEYS,
  FACT_KEYS,
  FACT_LABELS,
  TEMPLATE_ID,
  UNSUPPORTED_PREFIX,
  emptyConditions,
  emptyFacts,
  labelOf,
  type FactKey,
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

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** 模型常把数字写成 "4"、把单位写进字符串，这里只做类型归一，不改数值 */
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

/** 把模型输出整理成完整形状：8 个条件 + 4 个事实，读不到就是 null */
function normalizeReading(data: Record<string, unknown>): Reading {
  const rawConditions = asRecord(data.conditions);
  const rawFacts = asRecord(data.facts);

  const conditions = emptyConditions();
  for (const key of CONDITION_KEYS) {
    conditions[key] = toNumber(rawConditions[key]);
  }

  const facts = emptyFacts();
  for (const key of FACT_KEYS) {
    facts[key] = toBoolean(rawFacts[key]);
  }

  return { templateId: TEMPLATE_ID, conditions, facts };
}

/** 超范围时补一句人话，而不是只丢一个通用提示 */
function explainUnsupported(fields: string[]): string {
  if (fields.includes('initialSpeedMps')) {
    return '题设中滑块有初速度，首版只支持由静止释放';
  }
  const fact = fields.find((key): key is FactKey => key in FACT_LABELS);
  if (fact) return FACT_LABELS[fact].violated;
  return '题设与斜面弹簧模板的前提不符';
}

function describeMissing(code: string, keys: string[]): string {
  if (keys.length === 0) return '识别结果需要确认，请核对条件表';
  const labels = keys.map(labelOf).join('、');
  return code === 'INVALID_READING'
    ? `以下条件超出合理范围，请核对：${labels}`
    : `识别到 ${keys.length} 项需要确认：${labels}`;
}

/**
 * 校验并归一化模型输出。raw 是模型返回的 JSON 对象（已 parse）。
 */
export function buildPlan(raw: unknown): PlanResult {
  const data = asRecord(raw);
  const assumptions = toStringList(data.assumptions);
  const templateId = typeof data.templateId === 'string' ? data.templateId.trim() : '';

  // 1. 题型：先由模型自报，再由 B 复核
  if (templateId === 'unsupported') {
    const reason =
      typeof data.unsupportedReason === 'string' ? data.unsupportedReason.trim() : '';
    return {
      status: 'unsupported',
      message: reason ? `${UNSUPPORTED_PREFIX}。识别结果：${reason}` : UNSUPPORTED_PREFIX,
    };
  }

  // 连模板都认不出（图片模糊、不是题图、文字信息不足）→ 让用户重拍或补文字，
  // 而不是报"超范围"。前端会用 reading: null 展示一张全空的可编辑表单。
  if (!templateId) {
    return {
      status: 'needs_input',
      reading: null,
      missingKeys: [],
      message: '没能识别出题型，请重拍清晰的题图，或补充题目文字',
      assumptions,
    };
  }

  if (templateId !== TEMPLATE_ID) {
    return {
      status: 'unsupported',
      message: `${UNSUPPORTED_PREFIX}。模型给出的模板为「${templateId}」，未在登记表中`,
    };
  }

  // 2. 交给 B 判定字段是否合法
  const reading = normalizeReading(data);
  const verdict = validateReading(reading);

  if (verdict.ok) {
    return { status: 'ok', reading: verdict.reading as Reading, assumptions };
  }

  const fields = Array.isArray(verdict.fields)
    ? verdict.fields.filter((field): field is string => typeof field === 'string')
    : [];

  // 3. 题设前提被明确否定 → 超范围，不进计算
  if (verdict.code === 'UNSUPPORTED') {
    return {
      status: 'unsupported',
      message: `${UNSUPPORTED_PREFIX}。${explainUnsupported(fields)}`,
    };
  }

  // 4. 缺项或越界 → 让用户补，保留已识别的字段
  const missingKeys = fields.filter((key) => key !== 'templateId');
  return {
    status: 'needs_input',
    reading,
    missingKeys,
    message: describeMissing(verdict.code, missingKeys),
    assumptions,
  };
}
