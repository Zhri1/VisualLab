import type { MotionSample } from "./motion.ts";
import type { Point } from "./scene.ts";
import type { ResolvedStagePlan, Stage, StageKind, StagePlanDraft, StagePlanFailure } from "./stagePlan.ts";
import { validateStagePlan } from "./stagePlan.ts";
import { landingTime, linearState, springMetrics, springState } from "./kinematics.ts";

type Velocity = { vxMps: number; vyMps: number };
export type StageGeometry = {
  incline?: { start: Point; end: Point };
  horizontal?: { start: Point; plannedEnd: Point | null };
  spring?: { contact: Point; anchor: Point };
  projectile?: { launch: Point; landingPlane: { yM: number } };
  blockSizeM: number;
  positionReference: "front_bottom";
};
export type EndReason = "stop_before_target" | "stop_at_target" | "stopped" | "landed" | "spring_detached" | "prefix_end";
export type StageEvent = {
  id: string; stageIndex: number; kind: string; timeSeconds: number; order: number;
  velocityBefore: Velocity; velocityAfter: Velocity; label: string; explanation: string;
};
export type StageMotion = {
  geometry: StageGeometry;
  durationSeconds: number;
  segments: { stageIndex: number; kind: StageKind; startSeconds: number; endSeconds: number }[];
  events: StageEvent[];
  termination: { reason: EndReason; eventId: string; stageIndex: number };
  readonly endReason: EndReason;
  sampleAt(timeSeconds: number): MotionSample;
};
export type StageScene = { kind: "stage_scene"; reading: ResolvedStagePlan; geometry: StageGeometry; motion: StageMotion };
type EventState = { kind: string; time: number; before: MotionSample; after: MotionSample; label: string; explanation: string };
type Run = {
  duration: number; end: MotionSample; events: EventState[];
  reason?: EndReason;
  sampleAt(time: number): MotionSample;
};

function velocity(state: MotionSample): Velocity {
  return { vxMps: state.vxMps, vyMps: state.vyMps };
}
function point(state: Point): Point { return { xM: state.xM, yM: state.yM }; }
function event(kind: string, time: number, before: MotionSample, after: MotionSample, label: string, explanation: string): EventState {
  return { kind, time, before, after, label, explanation };
}
function moving(xM: number, yM: number, vxMps: number, vyMps = 0): MotionSample {
  return { xM, yM, vxMps: vxMps === 0 ? 0 : vxMps, vyMps: vyMps === 0 ? 0 : vyMps, springCompressionM: 0 };
}

// 沿运动方向求指定距离与停止两种边界，斜面和水平面共用。
function travel(speed: number, acceleration: number, distance: number) {
  if (speed === 0 && acceleration <= 0) return { duration: 0, distance: 0, speed: 0, reason: "stop_before_target" as EndReason };
  if (acceleration < 0) {
    const stopTime = speed / -acceleration;
    const stopDistance = speed * stopTime / 2;
    const tolerance = 16 * Number.EPSILON * Math.max(stopDistance, distance);
    if (Number.isFinite(stopDistance) && (stopDistance <= distance || Math.abs(stopDistance - distance) <= tolerance)) {
      const atTarget = Math.abs(stopDistance - distance) <= tolerance;
      return { duration: stopTime, distance: atTarget ? distance : stopDistance, speed: 0, reason: (atTarget ? "stop_at_target" : "stop_before_target") as EndReason };
    }
  }
  const endSpeed = Math.sqrt(speed * speed + 2 * acceleration * distance);
  return { duration: 2 * distance / (speed + endSpeed), distance, speed: endSpeed, reason: undefined };
}

function incline(stage: Extract<Stage, { kind: "incline_slide" }>, start: MotionSample, gravity: number, geometry: StageGeometry): Run {
  const angle = stage.angleDeg * Math.PI / 180;
  const dx = Math.cos(angle);
  const dy = -Math.sin(angle);
  const acceleration = gravity * (Math.sin(angle) - stage.kineticFrictionCoefficient * dx);
  const speed = Math.hypot(start.vxMps, start.vyMps);
  const boundary = travel(speed, acceleration, stage.lengthM);
  geometry.incline = { start: point(start), end: { xM: 0, yM: 0 } };
  const end = moving(
    boundary.reason ? start.xM + boundary.distance * dx : 0,
    boundary.reason ? start.yM + boundary.distance * dy : 0,
    boundary.speed * dx, boundary.speed * dy,
  );
  const stopped = boundary.reason !== undefined;
  return {
    duration: boundary.duration, end, reason: boundary.reason,
    events: [event(stopped ? "stop" : "reach_bottom", boundary.duration, end, end, stopped ? "斜面停止" : "到达坡底",
      stopped ? "滑块在斜面上速度降为零，运动结束。" : `到达坡底，沿坡速率约 ${boundary.speed.toFixed(4)} m/s。`)],
    sampleAt(time) { return linearState(start.xM, start.yM, speed * dx, speed * dy, acceleration * dx, acceleration * dy, time); },
  };
}

function turn(start: MotionSample): Run {
  const end = moving(start.xM, start.yM, Math.hypot(start.vxMps, start.vyMps));
  return {
    duration: 0, end,
    events: [event("lossless_turn", 0, start, end, "无损转向", "光滑过渡保持位置和速率，速度转为水平向右。")],
    sampleAt: () => ({ ...end }),
  };
}

function horizontal(stage: Extract<Stage, { kind: "horizontal_slide" }>, start: MotionSample, gravity: number, geometry: StageGeometry): Run {
  const speed = start.vxMps;
  const braking = stage.kineticFrictionCoefficient * gravity;
  geometry.horizontal = {
    start: point(start),
    plannedEnd: stage.end.kind === "distance" ? { xM: start.xM + stage.end.distanceM, yM: start.yM } : null,
  };
  const boundary = stage.end.kind === "distance" ? travel(speed, -braking, stage.end.distanceM) : {
    duration: speed === 0 ? 0 : speed / braking,
    distance: speed === 0 ? 0 : speed * speed / (2 * braking),
    speed: 0, reason: "stopped" as EndReason,
  };
  const end = moving(start.xM + boundary.distance, start.yM, boundary.speed);
  const stopped = boundary.reason !== undefined;
  const explanation = boundary.reason === "stop_at_target" ? "恰在指定距离处停住，末速度为零，后续阶段不再执行。"
    : boundary.reason === "stop_before_target" ? "在到达指定距离前停住，末速度为零，题设目标位置仍保留。"
    : stopped ? "动摩擦使滑块减速至零，运动结束。" : `到达指定距离，水平速度约 ${boundary.speed.toFixed(4)} m/s。`;
  return {
    duration: boundary.duration, end, reason: boundary.reason,
    events: [event(stopped ? "stop" : "reach_target", boundary.duration, end, end, stopped ? "停止" : "到达目标", explanation)],
    sampleAt: (time) => linearState(start.xM, start.yM, speed, 0, -braking, 0, time),
  };
}

function spring(stage: Extract<Stage, { kind: "spring_contact" }>, start: MotionSample, mass: number, geometry: StageGeometry): Run {
  const speed = start.vxMps;
  const metrics = springMetrics(speed, mass, stage.springConstantNpm);
  const duration = 2 * metrics.quarterPeriod;
  const maximum = { ...moving(start.xM + metrics.maxCompressionM, start.yM, 0), springCompressionM: metrics.maxCompressionM };
  const end = moving(start.xM, start.yM, -speed);
  geometry.spring = {
    contact: point(start),
    anchor: { xM: maximum.xM + Math.max(1, metrics.maxCompressionM / 4), yM: start.yM },
  };
  return {
    duration, end, reason: "spring_detached",
    events: [
      event("spring_contact", 0, start, start, "接触弹簧", "弹簧处于原长，压缩量和弹力为零。"),
      event("max_compression", metrics.quarterPeriod, maximum, maximum, "最大压缩",
        `压缩量约 ${metrics.maxCompressionM.toFixed(4)} m，速度为零，弹力约 ${(stage.springConstantNpm * metrics.maxCompressionM).toFixed(2)} N，指向左。`),
      event("spring_detach", duration, end, end, "恢复原长并脱离", `弹簧恢复原长，滑块以 ${(-speed).toFixed(4)} m/s 的水平速度向左脱离。`),
    ],
    sampleAt(time) {
      return { ...springState(start.xM, speed, metrics.angularFrequency, metrics.maxCompressionM, time), yM: start.yM };
    },
  };
}

function projectile(stage: Extract<Stage, { kind: "projectile" }>, start: MotionSample, gravity: number, geometry: StageGeometry, fromTable: boolean): Run {
  const duration = landingTime(stage.dropHeightM, start.vyMps, gravity);
  const planeYM = start.yM - stage.dropHeightM;
  geometry.projectile = { launch: point(start), landingPlane: { yM: planeYM } };
  const sampleAt = (time: number) => linearState(start.xM, start.yM, start.vxMps, start.vyMps, 0, -gravity, time);
  const end = { ...sampleAt(duration), yM: planeYM };
  const events: EventState[] = [];
  if (fromTable) events.push(event("leave_table", 0, start, start, "离开桌沿", "以正水平速度到达桌沿，开始平抛。"));
  const apexTime = start.vyMps / gravity;
  if (apexTime > 0 && apexTime < duration) {
    const maximum = { ...sampleAt(apexTime), vyMps: 0 };
    events.push(event("apex", apexTime, maximum, maximum, "最高点", "竖直速度降为零，水平速度保持。"));
  }
  events.push(event("land", duration, end, end, "落地", "首次到达落地平面，末帧保留接地瞬间的入射速度。"));
  return { duration, end, reason: "landed", events, sampleAt };
}

function compute(plan: ResolvedStagePlan): StageMotion | StagePlanFailure {
  const geometry: StageGeometry = { blockSizeM: 0.3, positionReference: "front_bottom" };
  const first = plan.stages[0];
  let state = "speedMps" in plan.initial ? moving(0, 0, plan.initial.speedMps) : moving(0, 0, plan.initial.vxMps, plan.initial.vyMps);
  if (first.kind === "incline_slide") {
    const angle = first.angleDeg * Math.PI / 180;
    const speed = state.vxMps;
    state = moving(-first.lengthM * Math.cos(angle), first.lengthM * Math.sin(angle), speed * Math.cos(angle), -speed * Math.sin(angle));
  }
  let time = 0;
  let reason: EndReason = "prefix_end";
  const segments: StageMotion["segments"] = [];
  const events: StageEvent[] = [];
  const eventStates: MotionSample[] = [];
  const runs: { start: number; end: number; run: Run }[] = [];
  function append(item: EventState, stageIndex: number, startTime: number) {
    const order = events.length;
    events.push({
      id: `${stageIndex}:${item.kind}:${order}`, stageIndex, kind: item.kind,
      timeSeconds: startTime + item.time, order,
      velocityBefore: velocity(item.before), velocityAfter: velocity(item.after),
      label: item.label, explanation: item.explanation,
    });
    eventStates.push({ ...item.after });
  }
  append(event("release", 0, state, state, "释放", "从题设初态开始运动。"), 0, 0);
  for (const [index, stage] of plan.stages.entries()) {
    let run: Run;
    switch (stage.kind) {
      case "incline_slide": run = incline(stage, state, plan.gravityMps2!, geometry); break;
      case "lossless_turn": run = turn(state); break;
      case "horizontal_slide": run = horizontal(stage, state, plan.gravityMps2 ?? 0, geometry); break;
      case "spring_contact": run = spring(stage, state, plan.massKg!, geometry); break;
      case "projectile": run = projectile(stage, state, plan.gravityMps2!, geometry, index > 0); break;
    }
    const nextTime = time + run.duration;
    const numbers = [run.duration, nextTime, ...Object.values(run.end), ...Object.values(run.sampleAt(run.duration / 2)), ...run.events.flatMap((item) => [time + item.time, ...Object.values(item.after)])];
    if (geometry.spring) numbers.push(geometry.spring.anchor.xM);
    const springTimes = stage.kind !== "spring_contact" || (run.duration > 0
      && time + run.events[1].time > time && time + run.events[1].time < nextTime);
    const valid = numbers.every(Number.isFinite) && run.duration >= 0 && (run.duration === 0 || nextTime > time) && springTimes;
    if (!valid) {
      return { ok: false, code: "INCONSISTENT_CONDITIONS", message: "题设数值无法表示有效的运动边界，请核对量级。", reading: plan as StagePlanDraft, missingKeys: [],
        fieldErrors: [{ path: "/stages/" + index, code: "RANGE", message: "阶段时长、位置或速度超出可计算范围。" }] };
    }
    if (run.duration > 0) {
      segments.push({ stageIndex: index, kind: stage.kind, startSeconds: time, endSeconds: nextTime });
      runs.push({ start: time, end: nextTime, run });
    }
    for (const item of run.events) append(item, index, time);
    state = run.end;
    time = nextTime;
    if (run.reason) { reason = run.reason; break; }
  }
  const final = { ...state };
  const last = events[events.length - 1];
  const termination = { reason, eventId: last.id, stageIndex: last.stageIndex };
  return {
    geometry, durationSeconds: time, segments, events, termination,
    get endReason() { return termination.reason; },
    sampleAt(timeSeconds) {
      const t = Number.isNaN(timeSeconds) ? 0 : Math.min(time, Math.max(0, timeSeconds));
      // 同刻的最后一个事件状态优先，确保转向、接触和零时长终止可精确停靠。
      // 事件时刻由累加得到，常与十进制字面量差 1 ulp（如 1.2000000000000002 与 1.2），
      // 播放进度按十进制推进时严格相等会错过事件、停在事件前一瞬。这里只吸收这一级误差：
      // 容差 1e-9 s 远小于采样步长（前端按 1e-7 s 取事件前后状态），不改变「事件前」语义。
      for (let i = events.length - 1; i >= 0; i--) if (Math.abs(events[i].timeSeconds - t) <= 1e-9) return { ...eventStates[i] };
      const active = runs.find((item) => t >= item.start && t < item.end);
      return active ? active.run.sampleAt(t - active.start) : { ...final };
    },
  };
}

export function assembleStageScene(input: unknown): { ok: true; scene: StageScene } | StagePlanFailure {
  const validation = validateStagePlan(input);
  if (!validation.ok) return validation;
  const motion = compute(validation.reading);
  if ("ok" in motion) return motion;
  return { ok: true, scene: { kind: "stage_scene", reading: validation.reading, geometry: motion.geometry, motion } };
}
export function buildStageMotion(scene: StageScene): { ok: true; motion: StageMotion } {
  return { ok: true, motion: scene.motion };
}
