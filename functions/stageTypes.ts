// 由 scripts/sync-functions.mjs 从 src/api/stageTypes.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
/**
 * 阶段组合契约的线格式类型（C · AI 接口）
 *
 * 来源：STAGE_COMPOSITION.md 第 2 节。这里只声明 C 消费的部分，
 * 校验规则由 B 的 `validateStagePlan` 提供，本文件不含任何判定逻辑。
 */

export type StagePlanKind = 'stage_plan';

/** 未解析形状：未知必填值为 null，可选未用字段可省略 */
export interface StagePlanDraft {
  kind: StagePlanKind;
  schemaVersion: 1;
  gravityMps2?: number | null;
  massKg?: number | null;
  initial:
    | { speedMps: number | null }
    | { vxMps: number | null; vyMps: number | null }
    | { tangentialSpeedMps: number | null }
    | { bodies: Array<Record<string, unknown>> };
  bodies?: Array<{ bodyId: string | null; massKg: number | null }>;
  primaryBodyId?: string | null;
  stages: Array<Record<string, unknown>>;
}

/** 字段级错误：范围、非有限值、前提冲突 */
export interface FieldError {
  /** 以 reading 为根的零基 JSON Pointer */
  path: string;
  /** RANGE | NOT_FINITE | PRECONDITION_CONFLICT 等 */
  code: string;
  message: string;
}

export type StagePlanFailureCode =
  | 'NEEDS_INPUT'
  | 'INVALID_READING'
  | 'INCONSISTENT_CONDITIONS'
  | 'UNSUPPORTED';

/** B 的 validateStagePlan 返回形状 */
export type StagePlanValidation =
  | { ok: true; reading: unknown; playback?: { reason: string } }
  | {
      ok: false;
      code: StagePlanFailureCode;
      message: string;
      reading: StagePlanDraft | null;
      missingKeys: string[];
      fieldErrors: FieldError[];
    };

/** C 对外回包（识别新题） */
export type StagePlanResult =
  | { status: 'ok'; reading: unknown; message: string; assumptions: string[] }
  | {
      status: 'needs_input';
      reading: StagePlanDraft | null;
      missingKeys: string[];
      fieldErrors: FieldError[];
      message: string;
      assumptions: string[];
    }
  | { status: 'unsupported'; message: string; assumptions: string[] }
  | { status: 'invalid_reading'; message: string };

/** 契约第 2 节的 HTTP 映射表 */
export const STAGE_HTTP_STATUS = {
  ok: 200,
  needs_input: 200,
  unsupported: 200,
  invalid_reading: 502,
} as const satisfies Record<StagePlanResult['status'], number>;

/** 模型可能附带、但不属于 reading 的保留字段 */
const RESERVED_FIELDS = ['assumptions', 'unsupportedReason'] as const;

/** 是否为阶段计划。用于在 validate.ts 里与旧模板分派。 */
export function isStagePlan(input: unknown): input is Record<string, unknown> {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as Record<string, unknown>).kind === 'stage_plan'
  );
}

/** 剥掉保留字段，避免它们进入结构校验。返回新对象，不改原值。 */
export function stripReservedFields(input: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if ((RESERVED_FIELDS as readonly string[]).includes(key)) continue;
    copy[key] = value;
  }
  return copy;
}
