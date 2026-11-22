/**
 * stage_plan → 旧 `Reading` 的兼容桥（C · AI 接口）
 *
 * 为什么需要：A 的前端（PR #14）还没接 `stage_plan`，`assembleScene` 只认
 * `{ templateId, conditions, facts }`。云函数若直接吐新形状，前端会整页报错。
 * 所以线上默认输出**旧首题回包**，等前端接好后用环境变量切到新契约。
 *
 * 为什么能无损转：V1 的「斜面 → 无损转向 → 水平 → 弹簧」四段，字段与旧的
 * `incline_spring` 模板一一对应；三段（转向直接接弹簧）也能转，只是弹簧距离
 * 无从得知，走追问。其它形状（含抛体、单段、缺段）旧前端渲染不了，按
 * unsupported 返回，不硬塞。
 *
 * 为什么校验函数是参数：本文件要被 `scripts/sync-functions.mjs` 原样复制进
 * Qoder 云函数目录，不能 import `src/physics/reading.ts`。两端各自传入自己的
 * `validateReading`，规则仍只有 B 那一份。
 */

import type { StagePlanResult } from './stageTypes';

/**
 * 旧模板能表达的阶段序列。
 *
 * 四段是标准题面。三段（转向直接接弹簧）是 STAGE_COMPOSITION.md 第 3 节允许的
 * 接续，模型对「弹簧紧贴坡底」的题会这么输出，所以不能当非法形状拒掉。
 */
const LEGACY_SHAPES = [
  ['incline_slide', 'lossless_turn', 'horizontal_slide', 'spring_contact'],
  ['incline_slide', 'lossless_turn', 'spring_contact'],
];

/** 对外输出契约：`legacy` 给旧前端，`stage_plan` 给接好的新前端 */
export type OutputContract = 'legacy' | 'stage_plan';

/** 读环境变量，默认 legacy（A 的前端尚未接入 stage_plan） */
export function outputContractFromEnv(value: string | undefined): OutputContract {
  return value === 'stage_plan' ? 'stage_plan' : 'legacy';
}

/** B 的 `validateReading` 结构，注入以避免 import */
export type ReadingValidator = (input: unknown) =>
  | { ok: true; reading: unknown }
  | { ok: false; code: string; message: string; fields: string[] };

/** 旧模板的 `Reading` 形状，与 src/physics/reading.ts 一致 */
export interface LegacyReading {
  templateId: 'incline_spring';
  conditions: Record<string, number | null>;
  facts: Record<string, boolean | null>;
}

/**
 * 对外回包。`reading` 放宽为 unknown：兼容模式下是旧 `Reading`，
 * 新契约下是 `StagePlanDraft`，两者形状不同但前端按 status 消费。
 */
export type ClientResult =
  | { status: 'ok'; reading: unknown; message: string; assumptions: string[] }
  | {
      status: 'needs_input';
      reading: unknown;
      missingKeys: string[];
      fieldErrors: unknown[];
      message: string;
      assumptions: string[];
    }
  | { status: 'unsupported'; message: string; assumptions?: string[] }
  | { status: 'invalid_reading'; message: string };

type StageRecord = Record<string, unknown>;

function asRecord(value: unknown): StageRecord {
  return value !== null && typeof value === 'object' ? (value as StageRecord) : {};
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * 把阶段计划压回旧的 `Reading`。形状不匹配时返回 null，由调用方降级为 unsupported。
 *
 * 这里**不判合法性**：范围、前提冲突交给 `validateReading` 统一裁决。
 */
export function stagePlanToLegacyReading(plan: unknown): LegacyReading | null {
  const data = asRecord(plan);
  const stages = data.stages;
  if (!Array.isArray(stages)) return null;

  const kinds = stages.map((stage) => asRecord(stage).kind).join(',');
  const shape = LEGACY_SHAPES.find((candidate) => candidate.join(',') === kinds);
  if (!shape) return null;

  const incline = asRecord(stages[0]);
  const turn = asRecord(stages[1]);
  // 三段时没有水平段，弹簧紧贴坡底
  const horizontal = shape.length === 4 ? asRecord(stages[2]) : null;
  const spring = asRecord(stages[stages.length - 1]);
  const initial = asRecord(data.initial);

  // 旧模板只支持由静止释放；有初速度的题旧前端算不了
  const speedMps = num(initial.speedMps);
  if (speedMps !== null && speedMps !== 0) return null;

  // 三段：题面没给弹簧与坡底的距离，填 null 交给前端追问。
  // 不能填 0 冒充「紧贴坡底」—— 模型漏段和题面真的紧贴，这两种情况这里分不清。
  let springGapM: number | null = null;
  if (horizontal) {
    const end = asRecord(horizontal.end);
    springGapM = end.kind === 'distance' ? num(end.distanceM) : null;
  }

  // 旧模板的水平面只有「光滑 / 不光滑」两态，没有独立摩擦因数。
  // 模型给了非零 μ 就如实标成有摩擦，交给 validateReading 判超范围，不能悄悄抹掉。
  const horizontalMu = horizontal ? num(horizontal.kineticFrictionCoefficient) : null;
  const horizontalIsFrictionless =
    horizontalMu === null ? bool(spring.frictionless) : horizontalMu === 0;

  return {
    templateId: 'incline_spring',
    conditions: {
      gravityMps2: num(data.gravityMps2),
      inclineAngleDeg: num(incline.angleDeg),
      inclineLengthM: num(incline.lengthM),
      kineticFrictionCoefficient: num(incline.kineticFrictionCoefficient),
      initialSpeedMps: speedMps,
      blockMassKg: num(data.massKg),
      springGapM,
      springConstantNpm: num(spring.springConstantNpm),
    },
    facts: {
      slidesAfterRelease: bool(incline.slidesAfterRelease),
      losslessTurn: bool(turn.lossless),
      horizontalIsFrictionless,
      springIsUnattached: bool(spring.unattached),
    },
  };
}

/**
 * 把内部结果转成对外回包。
 *
 * - `output === 'stage_plan'`：原样返回，给已接入的新前端
 * - `output === 'legacy'`：压回旧 `Reading` 并用 `validateReading` 重算状态，
 *   形状无法表达时降级为 unsupported（不假装成功）
 */
export function applyLegacyContract(
  result: StagePlanResult,
  validate: ReadingValidator,
  unsupportedPrefix: string,
): ClientResult {
  if (result.status === 'unsupported' || result.status === 'invalid_reading') return result;

  const plan = result.reading as unknown;
  const reading = plan ? stagePlanToLegacyReading(plan) : null;

  if (!reading) {
    // 模型连题型都没读出来 → 让用户重拍或补文字，而不是报「超范围」
    if (result.status === 'needs_input' && !plan) {
      return {
        status: 'needs_input',
        reading: null,
        missingKeys: [],
        fieldErrors: [],
        message: result.message,
        assumptions: result.assumptions,
      };
    }
    return {
      status: 'unsupported',
      message: `${unsupportedPrefix}。当前题型包含旧版界面无法渲染的运动组合`,
      assumptions: result.assumptions,
    };
  }

  const verdict = validate(reading);
  if (verdict.ok) {
    return {
      status: 'ok',
      reading: verdict.reading,
      message: result.message,
      assumptions: result.assumptions,
    };
  }

  // 题设与旧模板前提冲突（有摩擦的水平面、有初速度、滑块与弹簧相连……）
  // 不是「缺值」，追问也补不出来，必须如实报超范围。
  if (verdict.code === 'UNSUPPORTED') {
    return {
      status: 'unsupported',
      message: `${unsupportedPrefix}。${verdict.message}`,
      assumptions: result.assumptions,
    };
  }

  const fields = verdict.fields.filter((field) => field !== 'templateId');
  return {
    status: 'needs_input',
    reading,
    missingKeys: fields,
    fieldErrors: [],
    message: verdict.message,
    assumptions: result.assumptions,
  };
}
