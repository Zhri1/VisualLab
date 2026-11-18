/**
 * 识别数据契约（C · AI 接口）
 *
 * 唯一来源：CONTRACTS.md 第 1 节 + fixtures/incline-spring.reading.json。
 * 字段、单位、取值范围有变化时，先改 CONTRACTS.md，再改这里和 skills/vision-reading.v1.md。
 */

/** 本版登记的唯一模板 */
export const TEMPLATE_ID = 'incline_spring';

/** 条件字段（全部为 SI 单位） */
export interface Conditions {
  gravityMps2: number;
  inclineAngleDeg: number;
  inclineLengthM: number;
  kineticFrictionCoefficient: number;
  initialSpeedMps: number;
  blockMassKg: number;
  springGapM: number;
  springConstantNpm: number;
}

/** 物理前提，三态：确认 / 否定 / 未知 */
export interface Facts {
  slidesAfterRelease: boolean;
  losslessTurn: boolean;
  horizontalIsFrictionless: boolean;
  springIsUnattached: boolean;
}

export type Nullable<T> = { [K in keyof T]: T[K] | null };

/** 给前端和动画库的识别结果 */
export interface Reading {
  templateId: string;
  conditions: Nullable<Conditions>;
  facts: Nullable<Facts>;
}

export interface NumberRule {
  key: keyof Conditions;
  /** 页面上显示的中文名 */
  label: string;
  unit: string;
  /** 缺项时给用户看的一句话 */
  prompt: string;
  /** 返回 null 表示通过；返回字符串表示越界原因 */
  check: (value: number) => string | null;
}

export interface FactRule {
  key: keyof Facts;
  label: string;
  /** 缺项时给用户看的一句话 */
  prompt: string;
  /** 模型明确否定该前提时的超范围说明 */
  violated: string;
}

const positive = (value: number) =>
  Number.isFinite(value) && value > 0 ? null : '必须是大于 0 的有限数';

const nonNegative = (value: number) =>
  Number.isFinite(value) && value >= 0 ? null : '必须是不小于 0 的有限数';

/** 顺序即缺项提示的顺序，也决定前端条件表的行序 */
export const NUMBER_RULES: NumberRule[] = [
  {
    key: 'gravityMps2',
    label: '重力加速度',
    unit: 'm/s²',
    prompt: '请确认重力加速度 g',
    check: positive,
  },
  {
    key: 'inclineAngleDeg',
    label: '斜面倾角',
    unit: '°',
    prompt: '请确认斜面倾角',
    check: (v) => (v > 0 && v < 90 ? null : '必须在 0° 到 90° 之间（不含端点）'),
  },
  {
    key: 'inclineLengthM',
    label: '斜面长度',
    unit: 'm',
    prompt: '请确认斜面沿斜面方向的长度',
    check: positive,
  },
  {
    key: 'kineticFrictionCoefficient',
    label: '斜面动摩擦因数',
    unit: '—',
    prompt: '请确认斜面动摩擦因数（光滑斜面填 0）',
    check: nonNegative,
  },
  {
    key: 'initialSpeedMps',
    label: '初速度',
    unit: 'm/s',
    prompt: '请确认滑块初速度（由静止释放填 0）',
    check: nonNegative,
  },
  {
    key: 'blockMassKg',
    label: '滑块质量',
    unit: 'kg',
    prompt: '请确认滑块质量',
    check: positive,
  },
  {
    key: 'springGapM',
    label: '弹簧水平间距',
    unit: 'm',
    prompt: '请确认弹簧接触端与斜面底端的水平距离',
    check: positive,
  },
  {
    key: 'springConstantNpm',
    label: '弹簧劲度系数',
    unit: 'N/m',
    prompt: '请确认弹簧劲度系数',
    check: positive,
  },
];

export const FACT_RULES: FactRule[] = [
  {
    key: 'slidesAfterRelease',
    label: '释放后下滑',
    prompt: '请确认滑块释放后是否沿斜面下滑',
    violated: '题设中滑块释放后不滑动',
  },
  {
    key: 'losslessTurn',
    label: '无损转向',
    prompt: '请确认坡底是否经光滑圆弧无损转向',
    violated: '题设中转向过程有明显能量损失或高度变化',
  },
  {
    key: 'horizontalIsFrictionless',
    label: '水平面光滑',
    prompt: '请确认水平面是否光滑',
    violated: '题设中水平面有摩擦',
  },
  {
    key: 'springIsUnattached',
    label: '滑块与弹簧不连接',
    prompt: '请确认滑块与弹簧是否不连接',
    violated: '题设中滑块与弹簧相连',
  },
];

/** 超范围时对外的统一说法，与 CONTRACTS.md 第 2 节一致 */
export const UNSUPPORTED_PREFIX = '当前版本支持斜面接光滑水平面与弹簧的运动';

/** 空的条件骨架，用于构造 needs_input 回包 */
export function emptyConditions(): Nullable<Conditions> {
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

export function emptyFacts(): Nullable<Facts> {
  return {
    slidesAfterRelease: null,
    losslessTurn: null,
    horizontalIsFrictionless: null,
    springIsUnattached: null,
  };
}
