/** 多物体/无 energyAt 时的系统能量估算：动能+重力势+弹性势，耗散用初末差。 */
import type { Motion } from "../../types";

export interface SystemEnergy {
  kineticJ: number;
  gravityJ: number;
  elasticJ: number;
  dissipatedJ: number;
  totalJ: number;
}

const minYCache = new WeakMap<Motion, number>();
function baselineY(motion: Motion): number {
  const hit = minYCache.get(motion);
  if (hit !== undefined) return hit;
  let minY = Infinity;
  for (let i = 0; i <= 32; i += 1) {
    const s = motion.sampleAt((motion.durationSeconds * i) / 32);
    const ps = s.bodies ? Object.values(s.bodies).map((b) => b.position) : [s.position];
    for (const p of ps) minY = Math.min(minY, p.y);
  }
  if (!Number.isFinite(minY)) minY = 0;
  minYCache.set(motion, minY);
  return minY;
}

const gravityFloorCache = new WeakMap<Motion, number>();
/** 原生 energyAt 的重力势零点可能取在抛出点：平移到全程最低点，保证条与图例非负。 */
export function nativeGravityFloor(motion: Motion): number {
  const hit = gravityFloorCache.get(motion);
  if (hit !== undefined) return hit;
  let floor = 0;
  if (motion.energyAt && Number.isFinite(motion.durationSeconds) && motion.durationSeconds > 0) {
    floor = Infinity;
    for (let i = 0; i <= 32; i += 1) {
      const e = motion.energyAt((motion.durationSeconds * i) / 32);
      floor = Math.min(floor, e?.gravitationalPotentialJ ?? 0);
    }
    if (!Number.isFinite(floor)) floor = 0;
  }
  gravityFloorCache.set(motion, floor);
  return floor;
}

export function systemEnergyAt(motion: Motion, time: number): SystemEnergy | null {
  if (!Number.isFinite(motion.durationSeconds) || motion.durationSeconds <= 0) return null;
  const magneticOnly = (motion.stagePlan?.stages ?? []).length > 0 && (motion.stagePlan?.stages ?? []).every((st) => st.kind === "magnetic_deflection");
  const g = magneticOnly ? 0 : motion.stagePlan?.gravityMps2 ?? 10;
  const minY = baselineY(motion);
  const read = (t: number) => {
    const s = motion.sampleAt(t);
    const bodies = s.bodies
      ? Object.values(s.bodies).map((b) => ({ m: (b as { massKg?: number }).massKg ?? motion.stagePlan?.massKg ?? 1, p: b.position, v: b.velocity }))
      : [{ m: motion.stagePlan?.massKg ?? 1, p: s.position, v: s.velocity }];
    let kinetic = 0;
    let gravity = 0;
    for (const b of bodies) {
      kinetic += 0.5 * b.m * (b.v.x * b.v.x + b.v.y * b.v.y);
      gravity += b.m * g * (b.p.y - minY);
    }
    const spring = motion.stagePlan?.stages?.find((st) => st.kind === "spring_contact" || st.kind === "spring_release") as { springConstantNpm?: number | null } | undefined;
    const k = spring?.springConstantNpm ?? 0;
    const elastic = k > 0 ? 0.5 * k * (s.springCompressionM ?? 0) ** 2 : 0;
    return { kinetic, gravity, elastic };
  };
  const now = read(time);
  const initial = read(0);
  const total0 = initial.kinetic + initial.gravity + initial.elastic;
  const total = now.kinetic + now.gravity + now.elastic;
  return {
    kineticJ: now.kinetic,
    gravityJ: now.gravity,
    elasticJ: now.elastic,
    dissipatedJ: Math.max(0, total0 - total),
    totalJ: total,
  };
}
