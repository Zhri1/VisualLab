import { validateReading } from "./reading.ts";
import type { PhysicsFailure } from "./reading.ts";
import type { Point } from './geometryTypes.ts';
export type { Point } from './geometryTypes.ts';

export type Scene = {
  geometry: {
    incline: { start: Point; end: Point };
    spring: { contact: Point };
  };
  incline: {
    lengthM: number;
    accelerationMps2: number;
    direction: { x: number; y: number };
  };
  spring: { blockMassKg: number; constantNpm: number };
};

export function assembleScene(input: unknown): { ok: true; scene: Scene } | PhysicsFailure {
  const validation = validateReading(input);
  if (!validation.ok) {
    return validation;
  }

  const {
    gravityMps2, inclineAngleDeg, inclineLengthM, kineticFrictionCoefficient,
    blockMassKg, springGapM, springConstantNpm,
  } = validation.reading.conditions;
  const angleRad = inclineAngleDeg * (Math.PI / 180);
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const downhillFactor = sin - kineticFrictionCoefficient * cos;
  if (downhillFactor <= 0) {
    return {
      ok: false,
      code: "INCONSISTENT_CONDITIONS",
      message: "按当前倾角和动摩擦因数，滑块无法从静止开始下滑。请核对这两个条件。",
      fields: ["inclineAngleDeg", "kineticFrictionCoefficient"],
    };
  }

  const accelerationMps2 = gravityMps2 * downhillFactor;
  if (accelerationMps2 === 0) {
    return {
      ok: false,
      code: "INVALID_READING",
      message: "沿斜面加速度过小，无法表示。请核对题设数值。",
      fields: ["gravityMps2", "inclineAngleDeg", "kineticFrictionCoefficient"],
    };
  }

  return {
    ok: true,
    scene: {
      geometry: {
        incline: { start: { xM: -inclineLengthM * cos, yM: inclineLengthM * sin }, end: { xM: 0, yM: 0 } },
        spring: { contact: { xM: springGapM, yM: 0 } },
      },
      incline: { lengthM: inclineLengthM, accelerationMps2, direction: { x: cos, y: -sin } },
      spring: { blockMassKg, constantNpm: springConstantNpm },
    },
  };
}
