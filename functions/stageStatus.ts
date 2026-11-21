// 由 scripts/sync-functions.mjs 从 src/api/stageStatus.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
/**
 * validateStagePlan 结果 → HTTP 回包（C · AI 接口）
 *
 * 契约：STAGE_COMPOSITION.md 第 2 节映射表。
 * 这里只做映射，不判字段；Node 服务与 Qoder 云函数共用本模块，保证两端 status 一致。
 */

import type {
  StagePlanDraft,
  StagePlanResult,
  StagePlanValidation,
  FieldError,
} from './stageTypes.ts';
import { STAGE_HTTP_STATUS, stripReservedFields } from './stageTypes.ts';

const DEFAULT_MESSAGES = {
  ok: '已按题面条件识别完成',
  needs_input: '请补齐或确认标记的题设条件。',
  inconsistent: '题设条件存在冲突，请修正标记的字段。',
  unsupported: '当前题型或阶段接续不在支持范围内。',
  invalid_reading: '模型回包无法解析为阶段计划，请重试。',
} as const;

function pickMessage(message: string | undefined, fallback: string): string {
  const text = (message ?? '').trim();
  return text || fallback;
}

/** 空数组保持为空数组，不要输出 undefined，前端按数组消费 */
function asList<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export interface StageAssumptions {
  assumptions: string[];
}

/**
 * 把校验结果映射成对外回包。
 *
 * - `ok` → `status: "ok"`，`reading` 原样透传
 * - `NEEDS_INPUT` / `INCONSISTENT_CONDITIONS` → `status: "needs_input"`
 * - `UNSUPPORTED` → `status: "unsupported"`
 * - `INVALID_READING` → `status: "invalid_reading"`，HTTP 502（由调用方取 STAGE_HTTP_STATUS）
 */
export function toStagePlanResult(
  validation: StagePlanValidation,
  { assumptions }: StageAssumptions,
): StagePlanResult {
  if (validation.ok) {
    return {
      status: 'ok',
      reading: validation.reading,
      message: DEFAULT_MESSAGES.ok,
      assumptions,
    };
  }

  const message = pickMessage(validation.message, DEFAULT_MESSAGES.needs_input);

  switch (validation.code) {
    case 'INVALID_READING':
      return {
        status: 'invalid_reading',
        message: pickMessage(validation.message, DEFAULT_MESSAGES.invalid_reading),
      };

    case 'UNSUPPORTED':
      return {
        status: 'unsupported',
        message: pickMessage(validation.message, DEFAULT_MESSAGES.unsupported),
        assumptions,
      };

    case 'INCONSISTENT_CONDITIONS':
      return {
        status: 'needs_input',
        reading: validation.reading as StagePlanDraft | null,
        missingKeys: asList(validation.missingKeys),
        fieldErrors: asList<FieldError>(validation.fieldErrors),
        message: pickMessage(validation.message, DEFAULT_MESSAGES.inconsistent),
        assumptions,
      };

    case 'NEEDS_INPUT':
    default:
      return {
        status: 'needs_input',
        reading: validation.reading as StagePlanDraft | null,
        missingKeys: asList(validation.missingKeys),
        fieldErrors: asList<FieldError>(validation.fieldErrors),
        message,
        assumptions,
      };
  }
}

/** 回包对应的 HTTP 状态码，契约第 2 节 */
export function httpStatusOf(result: StagePlanResult): number {
  return STAGE_HTTP_STATUS[result.status];
}

/** B 提供的校验函数签名，Node 与云函数各自传入同一份实现 */
export type StagePlanValidator = (input: unknown) => StagePlanValidation;

/**
 * 阶段计划的统一入口：剥保留字段 → 调校验 → 映射状态。
 *
 * Node 的 `src/api/validate.ts` 与 Qoder 云函数都应调用本函数，
 * 只在参数里传入各自的 `validateStagePlan` 实现，避免两端各写一套映射。
 */
export function buildStagePlanResult(
  input: Record<string, unknown>,
  validate: StagePlanValidator,
  assumptions: string[],
): StagePlanResult {
  const plain = stripReservedFields(input);
  const validation = validate(plain);
  return toStagePlanResult(validation, { assumptions });
}
