/**
 * 受力矢量模型：由同一份 motion 采样 + 阶段计划解析出各力箭头，
 * 不引入新物理假设，只把引擎已算出的量（N、T、kx、μN）画出来。
 */
import type { Motion } from "../../types";
import { segmentAt } from "../../ui/components/workspace/playback";

export interface ForceArrow {
  bodyId?: string;
  label: string;
  kind: "gravity" | "normal" | "friction" | "tension" | "spring" | "magnetic";
  from: { x: number; y: number };
  dir: { x: number; y: number };
  magnitudeN: number;
  color: string;
  dashed?: boolean;
}

export const FORCE_COLORS: Record<ForceArrow["kind"], string> = {
  gravity: "#6b7280",
  normal: "#2563eb",
  friction: "#d97706",
  tension: "#7c3aed",
  spring: "#059669",
  magnetic: "#b42318",
};

const norm = (x: number, y: number) => {
  const len = Math.hypot(x, y);
  return len > 1e-9 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
};

export function forcesAt(motion: Motion, time: number, decompose = false): ForceArrow[] {
  const sample = motion.sampleAt(time);
  const plan = motion.stagePlan;
  const g = plan?.gravityMps2 ?? 10;
  const seg = segmentAt(motion.segments, time);
  const stage = (plan?.stages?.[seg?.stageIndex ?? 0] ?? {}) as Record<string, unknown>;
  const arrows: ForceArrow[] = [];
  const push = (a: Omit<ForceArrow, "color">) => arrows.push({ ...a, color: FORCE_COLORS[a.kind] });

  const bodies = sample.bodies
    ? Object.entries(sample.bodies).map(([id, b]) => ({ id, pos: b.position, vel: b.velocity, mass: (b as { massKg?: number }).massKg ?? plan?.massKg ?? 1 }))
    : [{ id: undefined as string | undefined, pos: sample.position, vel: sample.velocity, mass: plan?.massKg ?? 1 }];

  for (const body of bodies) {
    const { pos, vel, mass } = body;
    const speed = Math.hypot(vel.x, vel.y);
    const vdir = norm(vel.x, vel.y);
    const kind = stage?.kind;

    if (kind === "magnetic_deflection") {
      const mg = motion.stageGeometry?.magnetics?.[0] ?? motion.stageGeometry?.magnetic;
      const q = Math.abs((stage.chargeC as number) ?? 0);
      const B = (stage.magneticTeslaB as number) ?? 0;
      const dir = mg ? norm(mg.center.xM - pos.x, mg.center.yM - pos.y) : norm(-vel.y, vel.x);
      push({ bodyId: body.id, label: "F洛", kind: "magnetic", from: pos, dir, magnitudeN: q * speed * B });
      continue;
    }
    push({ bodyId: body.id, label: "G", kind: "gravity", from: pos, dir: { x: 0, y: -1 }, magnitudeN: mass * g });

    if (kind === "incline_slide") {
      const theta = ((stage.angleDeg as number) ?? 37) * Math.PI / 180;
      const mu = (stage.kineticFrictionCoefficient as number) ?? 0;
      const nDir = { x: Math.sin(theta), y: Math.cos(theta) };
      const downDir = { x: Math.cos(theta), y: -Math.sin(theta) };
      push({ bodyId: body.id, label: "N", kind: "normal", from: pos, dir: nDir, magnitudeN: mass * g * Math.cos(theta) });
      if (speed > 1e-6 && mu > 0) {
        push({ bodyId: body.id, label: "f", kind: "friction", from: pos, dir: { x: -vdir.x, y: -vdir.y }, magnitudeN: mu * mass * g * Math.cos(theta) });
      } else if (speed <= 1e-6) {
        push({ bodyId: body.id, label: "f静", kind: "friction", from: pos, dir: { x: -downDir.x, y: -downDir.y }, magnitudeN: mass * g * Math.sin(theta) });
      }
      if (decompose) {
        push({ bodyId: body.id, label: "G∥", kind: "gravity", from: pos, dir: downDir, magnitudeN: mass * g * Math.sin(theta), dashed: true });
        push({ bodyId: body.id, label: "G⊥", kind: "gravity", from: pos, dir: { x: -nDir.x, y: -nDir.y }, magnitudeN: mass * g * Math.cos(theta), dashed: true });
      }
    } else if (kind === "horizontal_slide" || kind === "spring_release" || kind === "conveyor_belt" || kind === "constant_force_1d") {
      push({ bodyId: body.id, label: "N", kind: "normal", from: pos, dir: { x: 0, y: 1 }, magnitudeN: mass * g });
      const mu = (stage.kineticFrictionCoefficient as number) ?? 0;
      let rel = speed;
      let rdir = vdir;
      if (kind === "conveyor_belt") {
        const belt = motion.conveyorAt?.(time)?.beltSpeedMps ?? (stage.initialBeltSpeedMps as number) ?? 0;
        const rv = vel.x - belt;
        rel = Math.abs(rv);
        rdir = { x: Math.sign(rv), y: 0 };
      }
      if (rel > 1e-6 && mu > 0) {
        push({ bodyId: body.id, label: "f", kind: "friction", from: pos, dir: { x: -rdir.x, y: -rdir.y }, magnitudeN: mu * mass * g });
      }
    } else if (kind === "spring_contact" || kind === "spring_release") {
      push({ bodyId: body.id, label: "N", kind: "normal", from: pos, dir: { x: 0, y: 1 }, magnitudeN: mass * g });
      const k = (stage.springConstantNpm as number) ?? 0;
      const x = sample.springCompressionM ?? 0;
      if (k > 0 && x > 1e-6) {
        const anchor = motion.stageGeometry?.spring?.anchor ?? motion.stageGeometry?.springs?.[0]?.anchor;
        const dir = anchor ? norm(pos.x - anchor.xM, 0) : { x: -1, y: 0 };
        push({ bodyId: body.id, label: "F弹", kind: "spring", from: pos, dir, magnitudeN: k * x });
      }
    } else if (kind === "vertical_arc") {
      const c = sample.constraint;
      if (c && c.normalForceN > 1e-6 && c.normalDirection) {
        push({ bodyId: body.id, label: "N", kind: "normal", from: pos, dir: c.normalDirection, magnitudeN: c.normalForceN });
      }
    }

    // 绳/滑轮张力：引擎已给 tensionN 与 pivot
    for (const c of Object.values(sample.constraints ?? {})) {
      if (!c.bodyIds.includes(body.id ?? "") && body.id !== undefined) continue;
      if (c.state !== "taut" || c.tensionN <= 1e-6) continue;
      const dir = norm(c.pivot.xM - pos.x, c.pivot.yM - pos.y);
      push({ bodyId: body.id, label: "T", kind: "tension", from: pos, dir, magnitudeN: c.tensionN });
    }
  }
  return arrows.filter((a) => a.magnitudeN > 1e-6);
}
