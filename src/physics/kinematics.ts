import type { MotionSample } from "./motion.ts";

export function linearState(xM: number, yM: number, vxMps: number, vyMps: number, axMps2: number, ayMps2: number, time: number): MotionSample {
  return {
    xM: xM + vxMps * time + 0.5 * axMps2 * time * time,
    yM: yM + vyMps * time + 0.5 * ayMps2 * time * time,
    vxMps: vxMps + axMps2 * time,
    vyMps: vyMps + ayMps2 * time,
    springCompressionM: 0,
  };
}

export function landingTime(heightM: number, vyMps: number, gravityMps2: number): number {
  if (heightM === 0 && vyMps <= 0) return 0;
  const root = Math.hypot(vyMps, Math.sqrt(2) * Math.sqrt(gravityMps2) * Math.sqrt(heightM));
  // 向下初速时用有理化形式，避免两相近数相减。
  if (vyMps < 0) return 2 * heightM / (root - vyMps);
  return vyMps / gravityMps2 + root / gravityMps2;
}

export function springMetrics(speedMps: number, massKg: number, constantNpm: number) {
  const angularFrequency = Math.sqrt(constantNpm) / Math.sqrt(massKg);
  return {
    angularFrequency,
    quarterPeriod: (Math.PI / 2) / angularFrequency,
    maxCompressionM: speedMps / angularFrequency,
  };
}

export function springState(contactXM: number, speedMps: number, angularFrequency: number, maxCompressionM: number, elapsedSeconds: number): MotionSample {
  const phase = Math.min(Math.PI, elapsedSeconds * angularFrequency);
  const springCompressionM = maxCompressionM * Math.sin(phase);
  return {
    xM: contactXM + springCompressionM, yM: 0,
    vxMps: speedMps * Math.cos(phase), vyMps: 0, springCompressionM,
  };
}
