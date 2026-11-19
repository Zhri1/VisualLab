/**
 * 识别数据的展示元信息（C · AI 接口）
 *
 * 这里**只放中文名、提示语和对外措辞**，不放取值范围。
 * 字段的合法性由 B 的 `validateReading` 统一判定（src/physics/reading.ts），
 * 避免接口层和动画库各有一套规则、出现"接口说 ok、动画库说不行"。
 *
 * 字段清单与 CONTRACTS.md 第 1 节、fixtures/incline-spring.reading.json 一致。
 */

/** 本版登记的唯一模板 */
export const TEMPLATE_ID = 'incline_spring';

/** 条件字段顺序 = 前端条件表行序 = 缺项提示顺序 */
export const CONDITION_KEYS = [
  'gravityMps2',
  'inclineAngleDeg',
  'inclineLengthM',
  'kineticFrictionCoefficient',
  'initialSpeedMps',
  'blockMassKg',
  'springGapM',
  'springConstantNpm',
] as const;

export const FACT_KEYS = [
  'slidesAfterRelease',
  'losslessTurn',
  'horizontalIsFrictionless',
  'springIsUnattached',
] as const;

export type ConditionKey = (typeof CONDITION_KEYS)[number];
export type FactKey = (typeof FACT_KEYS)[number];

export interface FieldLabel {
  label: string;
  /** 缺项时给用户看的一句话 */
  prompt: string;
}

export const CONDITION_LABELS: Record<ConditionKey, FieldLabel> = {
  gravityMps2: { label: '重力加速度', prompt: '请确认重力加速度 g' },
  inclineAngleDeg: { label: '斜面倾角', prompt: '请确认斜面倾角' },
  inclineLengthM: { label: '斜面长度', prompt: '请确认斜面沿斜面方向的长度' },
  kineticFrictionCoefficient: {
    label: '斜面动摩擦因数',
    prompt: '请确认斜面动摩擦因数（光滑斜面填 0）',
  },
  initialSpeedMps: { label: '初速度', prompt: '请确认滑块初速度（由静止释放填 0）' },
  blockMassKg: { label: '滑块质量', prompt: '请确认滑块质量' },
  springGapM: { label: '弹簧水平间距', prompt: '请确认弹簧接触端与斜面底端的水平距离' },
  springConstantNpm: { label: '弹簧劲度系数', prompt: '请确认弹簧劲度系数' },
};

export const FACT_LABELS: Record<FactKey, FieldLabel & { violated: string }> = {
  slidesAfterRelease: {
    label: '释放后下滑',
    prompt: '请确认滑块释放后是否沿斜面下滑',
    violated: '题设中滑块释放后不滑动',
  },
  losslessTurn: {
    label: '无损转向',
    prompt: '请确认坡底是否经光滑圆弧无损转向',
    violated: '题设中转向过程有明显能量损失或高度变化',
  },
  horizontalIsFrictionless: {
    label: '水平面光滑',
    prompt: '请确认水平面是否光滑',
    violated: '题设中水平面有摩擦',
  },
  springIsUnattached: {
    label: '滑块与弹簧不连接',
    prompt: '请确认滑块与弹簧是否不连接',
    violated: '题设中滑块与弹簧相连',
  },
};

/** 超范围时对外的统一说法，与 CONTRACTS.md 第 2 节一致 */
export const UNSUPPORTED_PREFIX = '当前版本支持斜面接光滑水平面与弹簧的运动';

/** 空的条件骨架，用于缺项时给前端一个完整形状 */
export function emptyConditions(): Record<ConditionKey, number | null> {
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

export function emptyFacts(): Record<FactKey, boolean | null> {
  return {
    slidesAfterRelease: null,
    losslessTurn: null,
    horizontalIsFrictionless: null,
    springIsUnattached: null,
  };
}

/** 字段中文名，缺项提示和日志共用 */
export function labelOf(key: string): string {
  if (key in CONDITION_LABELS) return CONDITION_LABELS[key as ConditionKey].label;
  if (key in FACT_LABELS) return FACT_LABELS[key as FactKey].label;
  return key;
}
