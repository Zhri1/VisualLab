const templateId = "incline_spring";

function isPositive(value: number): boolean {
  return value > 0;
}

const conditionRules = {
  gravityMps2: isPositive,
  inclineAngleDeg: (value: number) => value > 0 && value < 90,
  inclineLengthM: isPositive,
  kineticFrictionCoefficient: (value: number) => value >= 0,
  initialSpeedMps: (value: number) => value >= 0,
  blockMassKg: isPositive,
  springGapM: isPositive,
  springConstantNpm: isPositive,
};

const factKeys = [
  "slidesAfterRelease",
  "losslessTurn",
  "horizontalIsFrictionless",
  "springIsUnattached",
] as const;

type ConditionKey = keyof typeof conditionRules;
type FactKey = (typeof factKeys)[number];
type ReadingField = "templateId" | "conditions" | "facts" | ConditionKey | FactKey;

export type Reading = {
  templateId: typeof templateId;
  conditions: Record<ConditionKey, number | null>;
  facts: Record<FactKey, boolean | null>;
};

type CompleteReading = {
  templateId: typeof templateId;
  conditions: Record<ConditionKey, number>;
  facts: Record<FactKey, true>;
};

export type PhysicsFailure = {
  ok: false;
  code: "NEEDS_INPUT" | "UNSUPPORTED" | "INVALID_READING" | "INCONSISTENT_CONDITIONS";
  message: string;
  fields: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateReading(input: unknown): { ok: true; reading: CompleteReading } | PhysicsFailure {
  if (!isRecord(input)) {
    return { ok: false, code: "INVALID_READING", message: "识别数据应为对象。", fields: [] };
  }
  if (input.templateId == null) {
    return { ok: false, code: "NEEDS_INPUT", message: "请确认题型。", fields: ["templateId"] };
  }
  if (typeof input.templateId !== "string" || input.templateId.trim() === "") {
    return { ok: false, code: "INVALID_READING", message: "题型标识应为非空字符串。", fields: ["templateId"] };
  }
  if (input.templateId !== templateId) {
    return { ok: false, code: "UNSUPPORTED", message: "当前版本支持斜面接光滑水平面与弹簧的运动。", fields: ["templateId"] };
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

  for (const key of factKeys) {
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

  // 两组字段均已逐一填入，错误结果在上方提前返回。
  return { ok: true, reading: { templateId, conditions, facts } as CompleteReading };
}
