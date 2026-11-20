import type { PhysicsFailure } from "./reading.ts";

type Input<T extends string, C, F extends string> = {
  templateId: T;
  conditions: { [K in keyof C]: number | null };
  facts: Record<F, boolean | null>;
};

export type HorizontalSpringReading = Input<"horizontal_spring", {
  initialSpeedMps: number; blockMassKg: number; springGapM: number; springConstantNpm: number;
}, "horizontalIsFrictionless" | "springIsUnattached">;

export type InclineToStopReading = Input<"incline_to_stop", {
  gravityMps2: number; inclineAngleDeg: number; inclineLengthM: number;
  kineticFrictionCoefficient: number; initialSpeedMps: number; horizontalKineticFrictionCoefficient: number;
}, "slidesAfterRelease" | "losslessTurn">;

export type TableEdgeProjectileReading = Input<"table_edge_projectile", {
  gravityMps2: number; initialSpeedMps: number; kineticFrictionCoefficient: number;
  tableHeightM: number; distanceToEdgeM: number;
}, "airResistanceIsNegligible">;

export type ProjectileReading = Input<"projectile_motion", {
  gravityMps2: number; initialVxMps: number; initialVyMps: number; initialHeightM: number;
}, "airResistanceIsNegligible">;

export type BatchReading = HorizontalSpringReading | InclineToStopReading | TableEdgeProjectileReading | ProjectileReading;
type Resolved<R extends BatchReading> = R extends BatchReading ? {
  templateId: R["templateId"];
  conditions: { [K in keyof R["conditions"]]: number };
  facts: { [K in keyof R["facts"]]: true };
} : never;
export type ResolvedBatchReading = Resolved<BatchReading>;

const positive = (value: number) => value > 0;
const nonnegative = (value: number) => value >= 0;
const finite = (_value: number) => true;
const schemas = {
  horizontal_spring: {
    conditions: { initialSpeedMps: positive, blockMassKg: positive, springGapM: positive, springConstantNpm: positive },
    facts: ["horizontalIsFrictionless", "springIsUnattached"],
  },
  incline_to_stop: {
    conditions: {
      gravityMps2: positive, inclineAngleDeg: (value: number) => value > 0 && value < 90,
      inclineLengthM: positive, kineticFrictionCoefficient: nonnegative,
      initialSpeedMps: nonnegative, horizontalKineticFrictionCoefficient: nonnegative,
    },
    facts: ["slidesAfterRelease", "losslessTurn"],
  },
  table_edge_projectile: {
    conditions: {
      gravityMps2: positive, initialSpeedMps: positive, kineticFrictionCoefficient: nonnegative,
      tableHeightM: positive, distanceToEdgeM: positive,
    },
    facts: ["airResistanceIsNegligible"],
  },
  projectile_motion: {
    conditions: { gravityMps2: positive, initialVxMps: finite, initialVyMps: finite, initialHeightM: nonnegative },
    facts: ["airResistanceIsNegligible"],
  },
} satisfies Record<BatchReading["templateId"], { conditions: Record<string, (value: number) => boolean>; facts: string[] }>;

export function isBatchTemplate(value: unknown): value is BatchReading["templateId"] {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(schemas, value);
}

export function failure(code: PhysicsFailure["code"], message: string, fields: string[]): PhysicsFailure {
  return { ok: false, code, message, fields };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}

export function validateBatchReading(input: unknown): { ok: true; reading: ResolvedBatchReading } | PhysicsFailure {
  if (!isRecord(input) || !isBatchTemplate(input.templateId)) {
    return failure("UNSUPPORTED", "请确认已登记的运动模板。", ["templateId"]);
  }
  const schema = schemas[input.templateId];
  const conditions = input.conditions ?? {};
  const facts = input.facts ?? {};
  if (!isRecord(conditions) || !isRecord(facts)) {
    return failure("INVALID_READING", "数值条件和题设前提应为对象。", [!isRecord(conditions) ? "conditions" : "facts"]);
  }
  const missing: string[] = [];
  const invalid: string[] = [];
  const unsupported: string[] = [];
  const resolvedConditions: Record<string, number> = {};
  const resolvedFacts: Record<string, true> = {};
  for (const [key, rule] of Object.entries(schema.conditions)) {
    const value = conditions[key];
    if (value == null) missing.push(key);
    else if (typeof value !== "number" || !Number.isFinite(value) || !rule(value)) invalid.push(key);
    else resolvedConditions[key] = value;
  }
  for (const key of schema.facts) {
    const value = facts[key];
    if (value == null) missing.push(key);
    else if (value === false) unsupported.push(key);
    else if (value !== true) invalid.push(key);
    else resolvedFacts[key] = true;
  }
  if (input.templateId === "incline_to_stop") {
    if (resolvedConditions.initialSpeedMps > 0) unsupported.push("initialSpeedMps");
    if (resolvedConditions.horizontalKineticFrictionCoefficient === 0) unsupported.push("horizontalKineticFrictionCoefficient");
  }
  if (unsupported.length) return failure("UNSUPPORTED", "题设不满足所选模板的适用前提。", unsupported);
  if (invalid.length) return failure("INVALID_READING", "请核对字段格式、单位和数值范围。", invalid);
  if (missing.length) return failure("NEEDS_INPUT", "请补齐或确认标记的题设字段。", missing);
  const reading = { templateId: input.templateId, conditions: resolvedConditions, facts: resolvedFacts } as ResolvedBatchReading;
  return { ok: true, reading };
}
