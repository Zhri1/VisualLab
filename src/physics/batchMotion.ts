import type { MotionSample } from "./motion.ts";
import type { Point } from "./scene.ts";
import type { PhysicsFailure } from "./reading.ts";
import { failure, validateBatchReading } from "./batchReading.ts";
import type { BatchReading, ResolvedBatchReading } from "./batchReading.ts";
import { landingTime, linearState, springMetrics, springState } from "./kinematics.ts";

type Line = { start: Point; end: Point };
export type BatchGeometry =
  | { templateId: "horizontal_spring"; horizontal: Line; spring: { contact: Point; anchor: Point } }
  | { templateId: "incline_to_stop"; incline: Line; horizontal: Line }
  | { templateId: "table_edge_projectile"; table: { start: Point; edge: Point }; ground: Line }
  | { templateId: "projectile_motion"; start: Point; ground: Line };
export type BatchEvent = {
  id: "release" | "turn" | "spring_contact" | "max_compression" | "spring_detach" | "stop" | "table_edge" | "apex" | "land";
  timeSeconds: number;
  label: string;
  explanation: string;
  beforeVelocity?: { vxMps: number; vyMps: number };
  afterVelocity?: { vxMps: number; vyMps: number };
};
export type BatchMotion = {
  geometry: BatchGeometry;
  durationSeconds: number;
  segments: { id: "incline" | "horizontal" | "spring" | "table" | "projectile"; startSeconds: number; endSeconds: number }[];
  events: BatchEvent[];
  sampleAt(timeSeconds: number): MotionSample;
};
export type BatchScene = {
  templateId: BatchReading["templateId"];
  reading: ResolvedBatchReading;
  geometry: BatchGeometry;
  /** 装配时确定运动边界，同时缓存求解结果，避免重复求解。 */
  motion: BatchMotion;
};

const origin = (): Point => ({ xM: 0, yM: 0 });
const stationary = (xM: number, yM = 0): MotionSample => ({ xM, yM, vxMps: 0, vyMps: 0, springCompressionM: 0 });
const event = (id: BatchEvent["id"], timeSeconds: number, label: string, explanation: string): BatchEvent => ({ id, timeSeconds, label, explanation });

function finishMotion(
  geometry: BatchGeometry, segments: BatchMotion["segments"], events: BatchEvent[],
  durationSeconds: number, sample: (timeSeconds: number) => MotionSample,
): BatchMotion {
  return {
    geometry, durationSeconds, segments, events,
    sampleAt(timeSeconds) {
      const time = Number.isNaN(timeSeconds) ? 0 : Math.max(0, Math.min(durationSeconds, timeSeconds));
      return sample(time);
    },
  };
}

function horizontalSpring(reading: Extract<ResolvedBatchReading, { templateId: "horizontal_spring" }>): BatchMotion {
  const { initialSpeedMps: speed, blockMassKg, springGapM: gap, springConstantNpm } = reading.conditions;
  const { angularFrequency, quarterPeriod, maxCompressionM } = springMetrics(speed, blockMassKg, springConstantNpm);
  const contactSeconds = gap / speed;
  const maxSeconds = contactSeconds + quarterPeriod;
  const duration = contactSeconds + 2 * quarterPeriod;
  const anchorXM = gap + maxCompressionM + Math.max(1, maxCompressionM / 4);
  return finishMotion(
    {
      templateId: reading.templateId,
      horizontal: { start: origin(), end: { xM: anchorXM, yM: 0 } },
      spring: { contact: { xM: gap, yM: 0 }, anchor: { xM: anchorXM, yM: 0 } },
    },
    [{ id: "horizontal", startSeconds: 0, endSeconds: contactSeconds }, { id: "spring", startSeconds: contactSeconds, endSeconds: duration }],
    [
      event("release", 0, "开始水平运动", `滑块以 ${speed} m/s 向右运动，水平面光滑，速率保持。`),
      event("spring_contact", contactSeconds, "接触弹簧", `前进 ${gap} m 后接触原长弹簧，压缩量为零。`),
      event("max_compression", maxSeconds, "最大压缩", `压缩量约 ${maxCompressionM.toFixed(4)} m，速度为零，弹力向左。`),
      event("spring_detach", duration, "恢复原长并脱离", `压缩量回到零，水平速度为 ${-speed} m/s。`),
    ], duration,
    (time) => {
      if (time < contactSeconds) return linearState(0, 0, speed, 0, 0, 0, time);
      if (time === maxSeconds) return { ...stationary(gap + maxCompressionM), springCompressionM: maxCompressionM };
      if (time === duration) return { ...stationary(gap), vxMps: -speed };
      return springState(gap, speed, angularFrequency, maxCompressionM, time - contactSeconds);
    },
  );
}

function inclineToStop(reading: Extract<ResolvedBatchReading, { templateId: "incline_to_stop" }>): BatchMotion | PhysicsFailure {
  const p = reading.conditions;
  const angle = p.inclineAngleDeg * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const acceleration = p.gravityMps2 * (sin - p.kineticFrictionCoefficient * cos);
  if (acceleration <= 0) return failure("INCONSISTENT_CONDITIONS", "题设无法支持从静止开始沿坡下滑，请核对倾角与斜面摩擦。", ["inclineAngleDeg", "kineticFrictionCoefficient"]);
  const turnSeconds = Math.SQRT2 * Math.sqrt(p.inclineLengthM) / Math.sqrt(acceleration);
  const speed = Math.SQRT2 * Math.sqrt(p.inclineLengthM) * Math.sqrt(acceleration);
  const braking = p.horizontalKineticFrictionCoefficient * p.gravityMps2;
  const stopDuration = speed / braking;
  const stopXM = 0.5 * speed * stopDuration;
  const duration = turnSeconds + stopDuration;
  const top = { xM: -p.inclineLengthM * cos, yM: p.inclineLengthM * sin };
  const turn = event("turn", turnSeconds, "到达坡底并转向", `速率约 ${speed.toFixed(4)} m/s，转为水平向右。`);
  turn.beforeVelocity = { vxMps: speed * cos, vyMps: -speed * sin };
  turn.afterVelocity = { vxMps: speed, vyMps: 0 };
  return finishMotion(
    { templateId: reading.templateId, incline: { start: top, end: origin() }, horizontal: { start: origin(), end: { xM: stopXM, yM: 0 } } },
    [{ id: "incline", startSeconds: 0, endSeconds: turnSeconds }, { id: "horizontal", startSeconds: turnSeconds, endSeconds: duration }],
    [
      event("release", 0, "释放", `沿坡加速度约 ${acceleration.toFixed(4)} m/s²，摩擦系数只用于所在表面。`),
      turn,
      event("stop", duration, "水平停止", `在水平面再滑行约 ${stopXM.toFixed(4)} m 后停下。`),
    ], duration,
    (time) => {
      if (time === duration) return stationary(stopXM);
      if (time < turnSeconds) return linearState(top.xM, top.yM, 0, 0, acceleration * cos, -acceleration * sin, time);
      return linearState(0, 0, speed, 0, -braking, 0, time - turnSeconds);
    },
  );
}

function tableProjectile(reading: Extract<ResolvedBatchReading, { templateId: "table_edge_projectile" }>): BatchMotion {
  const p = reading.conditions;
  const speed = p.initialSpeedMps;
  const braking = p.kineticFrictionCoefficient * p.gravityMps2;
  const stopTime = braking === 0 ? Infinity : speed / braking;
  const stopDistance = 0.5 * speed * stopTime;
  const edge = p.distanceToEdgeM;
  const tolerance = 16 * Number.EPSILON * Math.max(stopDistance, edge);
  const stopsOnTable = braking > 0 && Number.isFinite(stopDistance)
    && (stopDistance <= edge || Math.abs(stopDistance - edge) <= tolerance);
  const start = { xM: 0, yM: p.tableHeightM };
  const release = event("release", 0, "开始桌面运动", `初速为 ${speed} m/s，桌面减速度为 ${braking} m/s²。`);
  if (stopsOnTable) {
    const stopXM = Math.min(stopDistance, edge);
    return finishMotion(
      { templateId: reading.templateId, table: { start, edge: { xM: edge, yM: p.tableHeightM } }, ground: { start: origin(), end: { xM: edge, yM: 0 } } },
      [{ id: "table", startSeconds: 0, endSeconds: stopTime }],
      [release, event("stop", stopTime, "桌面停止", `在起点右侧约 ${stopXM.toFixed(4)} m 停住，未以正速离桌。`)],
      stopTime, (time) => time === stopTime ? stationary(stopXM, p.tableHeightM) : linearState(0, p.tableHeightM, speed, 0, -braking, 0, time),
    );
  }
  const edgeSpeed = Math.sqrt(Math.max(0, speed * speed - 2 * braking * edge));
  // 有理化位移公式，零摩擦时也可直接使用。
  const edgeTime = 2 * edge / (speed + edgeSpeed);
  const flightTime = landingTime(p.tableHeightM, 0, p.gravityMps2);
  const duration = edgeTime + flightTime;
  const landXM = edge + edgeSpeed * flightTime;
  return finishMotion(
    { templateId: reading.templateId, table: { start, edge: { xM: edge, yM: p.tableHeightM } }, ground: { start: origin(), end: { xM: landXM, yM: 0 } } },
    [{ id: "table", startSeconds: 0, endSeconds: edgeTime }, { id: "projectile", startSeconds: edgeTime, endSeconds: duration }],
    [
      release,
      event("table_edge", edgeTime, "离开桌沿", `以水平速度约 ${edgeSpeed.toFixed(4)} m/s 离桌，开始平抛。`),
      event("land", duration, "落地", `飞行约 ${flightTime.toFixed(4)} s，在桌沿右侧约 ${(landXM - edge).toFixed(4)} m 落地。`),
    ], duration,
    (time) => {
      if (time < edgeTime) return linearState(0, p.tableHeightM, speed, 0, -braking, 0, time);
      if (time === duration) return { xM: landXM, yM: 0, vxMps: edgeSpeed, vyMps: -p.gravityMps2 * flightTime, springCompressionM: 0 };
      return linearState(edge, p.tableHeightM, edgeSpeed, 0, 0, -p.gravityMps2, time - edgeTime);
    },
  );
}

function projectile(reading: Extract<ResolvedBatchReading, { templateId: "projectile_motion" }>): BatchMotion {
  const p = reading.conditions;
  const duration = landingTime(p.initialHeightM, p.initialVyMps, p.gravityMps2);
  const landXM = p.initialVxMps * duration;
  const apexTime = p.initialVyMps / p.gravityMps2;
  const hasApex = apexTime > 0 && apexTime < duration;
  const events: BatchEvent[] = [event("release", 0, "释放", "从给定高度和速度开始，只受竖直向下的重力。")];
  if (hasApex) {
    const height = p.initialHeightM + 0.5 * p.initialVyMps * apexTime;
    events.push(event("apex", apexTime, "最高点", `竖直速度为零，最高点高度约 ${height.toFixed(4)} m。`));
  }
  events.push(event("land", duration, "落地", duration === 0 ? "起点已在地面，且没有向上的初速度，运动在释放时结束。" : `经过约 ${duration.toFixed(4)} s 首次到达地面。`));
  return finishMotion(
    { templateId: reading.templateId, start: { xM: 0, yM: p.initialHeightM }, ground: { start: { xM: Math.min(0, landXM), yM: 0 }, end: { xM: Math.max(0, landXM), yM: 0 } } },
    duration === 0 ? [] : [{ id: "projectile", startSeconds: 0, endSeconds: duration }],
    events, duration,
    (time) => {
      if (time === duration) return { xM: landXM, yM: 0, vxMps: p.initialVxMps, vyMps: p.initialVyMps - p.gravityMps2 * duration, springCompressionM: 0 };
      const sample = linearState(0, p.initialHeightM, p.initialVxMps, p.initialVyMps, 0, -p.gravityMps2, time);
      if (hasApex && time === apexTime) sample.vyMps = 0;
      return sample;
    },
  );
}

function solve(reading: ResolvedBatchReading): BatchMotion | PhysicsFailure {
  switch (reading.templateId) {
    case "horizontal_spring": return horizontalSpring(reading);
    case "incline_to_stop": return inclineToStop(reading);
    case "table_edge_projectile": return tableProjectile(reading);
    case "projectile_motion": return projectile(reading);
  }
}

export function assembleBatchScene(input: unknown): { ok: true; scene: BatchScene } | PhysicsFailure {
  const validation = validateBatchReading(input);
  if (!validation.ok) return validation;
  const reading = validation.reading;
  const motion = solve(reading);
  if ("ok" in motion) return motion;
  // 对时间、关键点与输出的数值可表示性做一次集中检查。
  const values: number[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "number") values.push(value);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(motion.geometry);
  collect(motion.events);
  collect(motion.segments);
  for (const e of motion.events) collect(motion.sampleAt(e.timeSeconds));
  const zeroFlight = reading.templateId === "projectile_motion" && reading.conditions.initialHeightM === 0 && reading.conditions.initialVyMps <= 0;
  const ordered = motion.events.every((e, i) => i === 0 || e.timeSeconds > motion.events[i - 1].timeSeconds || zeroFlight);
  if (!values.every(Number.isFinite) || !Number.isFinite(motion.durationSeconds) || !ordered || (motion.durationSeconds <= 0 && !zeroFlight)) {
    return failure("INVALID_READING", "题设数值无法生成可表示的运动边界，请核对量级。", Object.keys(reading.conditions));
  }
  return { ok: true, scene: { templateId: reading.templateId, reading, geometry: motion.geometry, motion } };
}

export function buildBatchMotion(scene: BatchScene): { ok: true; motion: BatchMotion } {
  return { ok: true, motion: scene.motion };
}
