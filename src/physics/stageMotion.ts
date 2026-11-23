import { solveVerticalArc } from "./verticalArc.ts";
import { circularEntry, circularGeometry, solveCircularArc } from './circularArc.ts';
import type { StageSample as MotionSample, VerticalArcGeometry } from "./verticalArc.ts";
export type { StageSample, ArcConstraint, VerticalArcGeometry } from "./verticalArc.ts";
import type { Point } from "./scene.ts";
import type { ResolvedStagePlan, Stage, SingleStage, StageKind, StagePlanDraft, StagePlanFailure, PlaybackScope } from "./stagePlan.ts";
import type { BodyGeometry, BodySnapshot, MotionStatus } from './multiBodyTypes.ts';
import { computeMultiBodyMotion } from './multiBodyMotion.ts';
import { validateStagePlan } from "./stagePlan.ts";
import { landingTime, linearState, springMetrics, springState } from "./kinematics.ts";

type Velocity = { vxMps: number; vyMps: number };
export type StageGeometry = BodyGeometry & {
  incline?: { start: Point; end: Point };
  horizontal?: { start: Point; plannedEnd: Point | null };
  spring?: { contact: Point; anchor: Point };
  projectile?: { launch: Point; landingPlane: { yM: number } };
  verticalArc?: VerticalArcGeometry;
  springRelease?: { stageIndex: number; start: Point; naturalContact: Point; initialCompressionM: number; anchor: Point | null };
  landmarks?: { label: string; position: Point }[];
  schematic?: { stageIndices: number[]; horizontal?: { start: Point; plannedEnd: Point }; springIconAt?: Point; verticalArc?: Omit<VerticalArcGeometry, "stageIndex" | "actualExit" | "startAngleDeg"> & {startAngleDeg?:number}; reason: string };
  blockSizeM: number;
  positionReference: "front_bottom" | "particle";
};
export type EndReason = "stop_before_target" | "stop_at_target" | "stopped" | "landed" | "spring_detached" | "prefix_end" | "arc_detached" | "returned_to_entry" | "spring_released" | "spring_stopped_before_release" | "spring_stopped_at_release" | 'pendulum_first_turn' | 'collision_complete' | 'string_slack' | 'string_retaut_boundary' | 'no_collision' | 'approach_range_end' | 'contact_without_impact' | 'second_contact_boundary';
export type StageEvent = {
  collision?: import('./horizontalTypes.ts').CollisionValues;
  bodyIds?: string[]; stagePath?: string;
  bodyStatesBefore?: BodySnapshot['bodies']; bodyStatesAfter?: BodySnapshot['bodies'];
  constraintsBefore?: BodySnapshot['constraints']; constraintsAfter?: BodySnapshot['constraints'];
  id: string; stageIndex: number; kind: string; timeSeconds: number; order: number;
  velocityBefore: Velocity; velocityAfter: Velocity; label: string; explanation: string;
  position?: Point; normalForceBeforeN?: number; normalForceAfterN?: number;
};
export type StageMotion = {
  primaryBodyId?: string; motionStatus?: MotionStatus;
  timing?: PlaybackScope & { anchor: { label: string; position: Point }; absoluteStartSeconds: number | null; excludedStageIndices: number[] };
  calculations?: { quantity: string; value: number; unit: string; source: "given" | "user" | "derived"; rule?: string; inputPaths: string[] }[];
  geometry: StageGeometry;
  durationSeconds: number;
  segments: { stageIndex: number; kind: StageKind; startSeconds: number; endSeconds: number; bodyIds?: string[]; stagePath?: string }[];
  events: StageEvent[];
  termination: { reason: EndReason; eventId: string; stageIndex: number };
  readonly endReason: EndReason;
  sampleAt(timeSeconds: number): MotionSample & Partial<BodySnapshot>;
};
export type StageScene = { kind: "stage_scene"; reading: ResolvedStagePlan; geometry: StageGeometry; motion: StageMotion };
type EventState = { kind: string; time: number; before: MotionSample; after: MotionSample; label: string; explanation: string;
  position?: Point; normalForceBeforeN?: number; normalForceAfterN?: number };
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

function incline(stage: Extract<Stage, { kind: "incline_slide" }>, start: MotionSample, gravity: number, geometry: StageGeometry, fliesFromEnd: boolean): Run {
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
    events: [event(stopped ? "stop" : "reach_bottom", boundary.duration, end, end, stopped ? "斜面停止" : fliesFromEnd ? "到达檐口" : "到达坡底",
      stopped ? "滑块在斜面上速度降为零，运动结束。" : `到达${fliesFromEnd ? "檐口" : "坡底"}，沿坡速率约 ${boundary.speed.toFixed(4)} m/s。`)],
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
    plannedEnd: stage.end.kind !== "stop" ? { xM: stage.end.kind === "distance_from_stage_start" ? stage.end.distanceM : start.xM + stage.end.distanceM, yM: start.yM } : null,
  };
  const distance = stage.end.kind === "stop" ? 0 : stage.end.kind === "distance_from_stage_start" ? Math.max(0, stage.end.distanceM - start.xM) : stage.end.distanceM;
  const boundary = stage.end.kind !== "stop" ? travel(speed, -braking, distance) : {
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

function release(stage: Extract<Stage, { kind: "spring_release" }>, start: MotionSample, mass: number, gravity: number, geometry: StageGeometry, continues: boolean): Run {
  const c = stage.initialCompressionM!;
  geometry.springRelease = { stageIndex: 0, start: point(start), naturalContact: { xM: start.xM + c, yM: start.yM }, initialCompressionM: c, anchor: null };
  const initial = { ...start, springCompressionM: c };
  if (!stage.slidesAfterRelease) return { duration: 0, end: initial, reason: "stopped", events: [event("stop", 0, initial, initial, "A点静止", "题设明确释放后未开始滑动。")], sampleAt: () => ({ ...initial }) };
  const k = stage.springConstantNpm!, force = stage.kineticFrictionCoefficient * mass * gravity;
  const D = c - force / k, w = Math.sqrt(k / mass), maximum = 2 * D;
  const tolerance = 32 * Number.EPSILON * Math.max(c, maximum);
  const stops = maximum <= c + tolerance, atNatural = Math.abs(maximum - c) <= tolerance;
  const duration = stops ? Math.PI / w : Math.acos(1 - c / D) / w;
  const end = { ...moving(start.xM + (stops && !atNatural ? maximum : c), start.yM, stops ? 0 : Math.sqrt((k * c * c - 2 * force * c) / mass)), springCompressionM: stops && !atNatural ? c - maximum : 0 };
  return { duration, end, reason: stops ? atNatural ? "spring_stopped_at_release" : "spring_stopped_before_release" : continues ? undefined : "spring_released",
    events: [event("spring_release_start", 0, initial, initial, "预压弹簧释放", "弹簧推动滑块，压缩阶段同时扣除动摩擦做功。"), event(stops ? "stop" : "spring_release_end", duration, end, end, stops ? atNatural ? "原长处停止" : "未释放完即停止" : "恢复原长并脱离", stops ? "速度第一次降为零，保留实际残余压缩量，后续阶段不执行。" : "弹簧恢复原长，继承正向速度继续运动。")],
    sampleAt(t) { if (t <= 0) return { ...initial }; if (t >= duration) return { ...end }; const s = D * 2 * Math.sin(w * t / 2) ** 2;
      return { ...moving(start.xM + s, start.yM, D * w * Math.sin(w * t)), springCompressionM: Math.max(0, c - s) }; },
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

function arc(stage: Extract<Stage, { kind: "vertical_arc" }>, start: MotionSample, gravity: number, mass: number, geometry: StageGeometry, index: number, continues: boolean): Run {
  if (stage.path) {
    const solved=solveCircularArc({...stage,path:stage.path},start,gravity,mass,index);
    geometry.verticalArc=solved.geometry;
    const make=(kind:string,t:number,before:MotionSample,after:MotionSample,label:string,explanation:string):EventState=>({
      ...event(kind,t,before,after,label,explanation),position:point(after),normalForceBeforeN:before.constraint?.normalForceN??0,normalForceAfterN:after.constraint?.normalForceN??0,
    });
    const events=[make('arc_enter',0,index===0?solved.entry:start,solved.entry,'进入圆弧','按实际入口位置和带方向的切线速度进入内轨。')];
    for(const marker of solved.markers)events.push(make(marker.kind,marker.time,marker.state,marker.state,marker.kind==='arc_top'?'经过圆轨最高点':'经过圆轨最低点','仍按圆轨约束运动，支持力由当前速度与位置计算。'));
    const reason=solved.geometry.actualExit.reason;
    if(reason==='stationary'){events.push(make('stop',0,solved.entry,solved.end,'最低点静止','重力与支持力平衡。'));return{...solved,events,reason:'stopped'};}
    if(solved.returns){
      events.push(make('arc_turn',solved.ascentSeconds,solved.boundary,solved.boundary,'圆轨转折','瞬时速度为零，随后沿原轨反向，保持真实支持力。'));
      events.push(make('arc_return_entry',solved.duration,solved.end,solved.end,'返回圆弧入口','原路返回入口，保留反向速度与约束；未计算前序轨道的返程。'));
    }else if(reason==='range_end')events.push(make('arc_range_end',solved.duration,solved.end,solved.end,'圆轨观察终点','仅结束观察范围，物体仍沿轨道运动并保持支持力。'));
    else events.push(make(reason==='contact_lost'?'arc_contact_lost':'arc_endpoint',solved.duration,solved.boundary,solved.end,reason==='contact_lost'?'失去接触':'到达圆弧端点','从真实位置沿实际切线离开圆轨。'));
    // 同刻极值在边界前，返回途中极值与转折按真实时间归位。
    events.sort((a,b)=>a.time-b.time);
    return{...solved,events,reason:solved.returns?'returned_to_entry':reason==='range_end'?'prefix_end':continues?undefined:'arc_detached'};
  }
  const solved = solveVerticalArc(stage, start, gravity, mass, index);
  geometry.verticalArc = solved.geometry;
  const arcEvent = (kind: string, time: number, before: MotionSample, after: MotionSample, label: string, explanation: string): EventState => ({
    ...event(kind, time, before, after, label, explanation), position: point(after),
    normalForceBeforeN: before.constraint?.normalForceN ?? 0,
    normalForceAfterN: after.constraint?.normalForceN ?? 0,
  });
  const events = [arcEvent("arc_enter", 0, index === 0 ? solved.entry : start, solved.entry, "进入圆弧", `从最低点沿切线入弧，圆轨道法向力约 ${solved.entry.constraint!.normalForceN.toFixed(4)} N。`)];
  if (solved.geometry.actualExit.reason === "stationary") {
    events.push(arcEvent("stop", 0, solved.entry, solved.end, "最低点静止", "最低点初速度为零，重力与支持力平衡。"));
    return { ...solved, events, reason: "stopped" };
  }
  if (solved.returns) {
    events.push(arcEvent("arc_turn", solved.ascentSeconds, solved.boundary, solved.boundary, "停下并回滑", "此刻速度为零，沿切线的重力分量使滑块反向，随后沿圆弧返回。"));
    const before = { ...solved.end, constraint: { ...solved.entry.constraint!, angularVelocityRadps: -start.vxMps / stage.radiusM } };
    events.push(arcEvent("arc_return_entry", solved.duration, before, solved.end, "返回圆弧入口", "沿原轨道返回最低点，速度水平向左；本次计算在入口结束，保留返回速度。"));
    return { ...solved, events, reason: "returned_to_entry" };
  }
  const lost = solved.geometry.actualExit.reason === "contact_lost";
  events.push(arcEvent(lost ? "arc_contact_lost" : "arc_endpoint", solved.duration, solved.boundary, solved.end,
    lost ? "失去接触" : "到达圆弧端点", lost ? "圆轨道法向力降为零，滑块沿此处的实际切线飞出。" : "到达计划端点，离开轨道后保持切向速度。"));
  return { ...solved, events, reason: continues ? undefined : "arc_detached" };
}

function projectile(stage: Extract<Stage, { kind: "projectile" }>, start: MotionSample, gravity: number, geometry: StageGeometry, from: StageKind | undefined): Run {
  const planeYM = stage.landingPlaneYM ?? start.yM - stage.dropHeightM!;
  const duration = landingTime(start.yM - planeYM, start.vyMps, gravity);
  geometry.projectile = { launch: point(start), landingPlane: { yM: planeYM } };
  const sampleAt = (time: number) => linearState(start.xM, start.yM, start.vxMps, start.vyMps, 0, -gravity, time);
  const end = { ...sampleAt(duration), yM: planeYM };
  const events: EventState[] = [];
  if (from === "horizontal_slide") events.push(event("leave_table", 0, start, start, "离开桌沿", "以正水平速度到达桌沿，开始平抛。"));
  if (from === "vertical_arc") events.push(event("projectile_launch", 0, start, start, "沿切线飞出", "以实际离弧位置和切向速度开始抛体运动，落地平面保持固定。"));
  if (from === "incline_slide") events.push(event("projectile_launch", 0, start, start, "离开檐口", "离开斜面末端，沿坡切向斜抛；水平与向下的竖直速度连续，此后只受重力。"));
  const apexTime = start.vyMps / gravity;
  if (apexTime > 0 && apexTime < duration) {
    const maximum = { ...sampleAt(apexTime), vyMps: 0 };
    events.push(event("apex", apexTime, maximum, maximum, "最高点", "竖直速度降为零，水平速度保持。"));
  }
  events.push(event("land", duration, end, end, "落地", "首次到达落地平面，末帧保留接地瞬间的入射速度。"));
  return { duration, end, reason: "landed", events, sampleAt };
}

function compute(plan: ResolvedStagePlan, scope?: PlaybackScope): StageMotion | StagePlanFailure {
  if (plan.bodies) return computeMultiBodyMotion(plan);
  const geometry: StageGeometry = { blockSizeM: 0.3, positionReference: plan.stages.some((stage, i) => stage.kind === "vertical_arc" || stage.kind === "spring_release"
    || stage.kind === "incline_slide" && plan.stages[i + 1]?.kind === "projectile") ? "particle" : "front_bottom" };
  const first = plan.stages[0];
  let state = "speedMps" in plan.initial ? moving(0, 0, plan.initial.speedMps) : "vxMps" in plan.initial ? moving(0, 0, plan.initial.vxMps, plan.initial.vyMps) : moving(0,0,"tangentialSpeedMps" in plan.initial ? plan.initial.tangentialSpeedMps : 0);
  if(first.kind==='vertical_arc'&&first.path)state=circularEntry({...first,path:first.path},Math.hypot(state.vxMps,state.vyMps),plan.gravityMps2!,plan.massKg!,0);
  if (first.kind === "spring_release" && scope?.mode === "full") state.springCompressionM = first.initialCompressionM!;
  if (scope && scope.mode !== "full") state = moving(scope.xM!, 0, scope.vxMps!);
  const ref = plan.stages[1];
  const target = ref?.kind === "horizontal_slide" && ref.end.kind === "distance_from_stage_start" ? ref.end.distanceM : undefined;
  if (scope) {
    geometry.landmarks = [{ label: "A", position: { xM: 0, yM: 0 } }, ...(target === undefined ? [] : [{ label: "B", position: { xM: target, yM: 0 } }])];
    const arcStage = plan.stages[2];
    if (target !== undefined && arcStage?.kind === "vertical_arc" && !arcStage.path) {
      const phi = arcStage.endAngleDeg! * Math.PI / 180;
      const plannedEnd = { xM: target + arcStage.radiusM * (arcStage.endAngleDeg === 180 ? 0 : Math.sin(phi)), yM: arcStage.radiusM * (1 - Math.cos(phi)) };
      geometry.landmarks.push({ label: arcStage.endAngleDeg === 180 ? "C" : "端点", position: plannedEnd });
      if (scope.mode === "state_only") geometry.schematic = { stageIndices: plan.stages.map((_, i) => i), reason: scope.reason, verticalArc: { entry: { xM: target, yM: 0 }, center: { xM: target, yM: arcStage.radiusM }, radiusM: arcStage.radiusM, endAngleDeg: arcStage.endAngleDeg!, plannedEnd } };
    }
    if (scope.mode !== "full") geometry.schematic = { ...geometry.schematic, stageIndices: scope.mode === "suffix" ? [0, 1] : plan.stages.map((_, i) => i), horizontal: { start: { xM: 0, yM: 0 }, plannedEnd: { xM: target!, yM: 0 } }, springIconAt: { xM: 0, yM: 0 }, reason: scope.reason };
  }
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
      ...(item.position ? { position: item.position, normalForceBeforeN: item.normalForceBeforeN, normalForceAfterN: item.normalForceAfterN } : {}),
    });
    eventStates.push({ ...item.after });
  }
  const from = scope?.mode === "suffix" ? scope.startStageIndex : 0;
  append(event(scope?.mode === "state_only" ? "state_anchor" : scope?.mode === "suffix" ? "playback_start" : "release", 0, state, state, scope?.mode === "state_only" ? "已知状态" : scope?.mode === "suffix" ? "从B开始计时" : "释放", scope?.reason ?? "从题设初态开始运动。"), scope?.mode === "state_only" ? scope.startStageIndex : from, 0);
  if (scope?.mode === "state_only") reason = scope.stopReason ?? "prefix_end";
  for (const [index, stage] of (plan.stages as SingleStage[]).entries()) {
    if (scope?.mode === "state_only") break;
    if (index < from) continue;
    let run: Run;
    const failure = (message: string, path = "/stages/" + index, code = "RANGE"): StagePlanFailure => ({
      ok: false, code: "INCONSISTENT_CONDITIONS", message, reading: plan as StagePlanDraft, missingKeys: [], fieldErrors: [{ path, code, message }],
    });
    if (stage.kind === "projectile" && stage.landingPlaneYM !== undefined && stage.landingPlaneYM > state.yM) {
      return failure("固定落地平面不能高于实际发射点。", "/stages/" + index + "/landingPlaneYM", "PRECONDITION_CONFLICT");
    }
    if (stage.kind === "vertical_arc") {
      if(!stage.path&&(state.vxMps < 0 || state.vyMps !== 0)) return failure("圆弧入口需要水平向右的切向速度。", "/stages/" + index, "PRECONDITION_CONFLICT");
      if(stage.path){
        try{
          const expected=circularEntry({...stage,path:stage.path},Math.hypot(state.vxMps,state.vyMps),plan.gravityMps2!,plan.massKg!,index);
          const positionScale=Math.max(stage.radiusM,Math.abs(state.xM),Math.abs(state.yM),Math.abs(expected.xM),Math.abs(expected.yM));
          const velocityScale=Math.max(Math.hypot(state.vxMps,state.vyMps),Number.MIN_VALUE);
          if(Math.hypot(state.xM-expected.xM,state.yM-expected.yM)>32*Number.EPSILON*positionScale
            ||Math.hypot(state.vxMps-expected.vxMps,state.vyMps-expected.vyMps)>32*Number.EPSILON*velocityScale)return failure('圆轨入口位置或速度不符合声明的切线与方向。','/stages/'+index+'/path','PRECONDITION_CONFLICT');
        }catch(e){return failure((e as Error).message,'/stages/'+index+((e as {field?:string}).field??'/path'),e instanceof RangeError?'RANGE':'PRECONDITION_CONFLICT');}
      }
    }
    try { switch (stage.kind) {
      case "incline_slide": run = incline(stage, state, plan.gravityMps2!, geometry, plan.stages[index + 1]?.kind === "projectile"); break;
      case "lossless_turn": run = turn(state); break;
      case "horizontal_slide": run = horizontal(stage, state, plan.gravityMps2 ?? 0, geometry); break;
      case "spring_contact": run = spring(stage, state, plan.massKg!, geometry); break;
      case "spring_release": run = release(stage, state, plan.massKg!, plan.gravityMps2 ?? 0, geometry, index + 1 < plan.stages.length); break;
      case "projectile": run = projectile(stage, state, plan.gravityMps2!, geometry, plan.stages[index - 1]?.kind); break;
      case "vertical_arc": run = arc(stage, state, plan.gravityMps2!, plan.massKg!, geometry, index, plan.stages[index + 1]?.kind === "projectile"); break;
    } } catch (error) { if (error instanceof RangeError) return failure(error.message,'/stages/'+index+((error as {field?:string}).field??'')); throw error; }
    const nextTime = time + run.duration;
    const sampleNumbers = (s: MotionSample) => [s.xM, s.yM, s.vxMps, s.vyMps, s.springCompressionM,
      ...(s.constraint ? [s.constraint.angleDeg, s.constraint.angularVelocityRadps, s.constraint.normalForceN] : [])];
    const numbers = [run.duration, nextTime, ...sampleNumbers(run.end), ...sampleNumbers(run.sampleAt(run.duration / 2)), ...run.events.flatMap((item) => [time + item.time, ...sampleNumbers(item.after)])];
    if (geometry.verticalArc) numbers.push(...Object.values(geometry.verticalArc.center), ...Object.values(geometry.verticalArc.plannedEnd));
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
  if(!geometry.verticalArc){const i=plan.stages.findIndex(s=>s.kind==='vertical_arc'&&s.path);const s=plan.stages[i];
    if(s?.kind==='vertical_arc'&&s.path){const {stageIndex:_,actualExit:__,...planned}=circularGeometry({...s,path:s.path},i);geometry.schematic={...geometry.schematic,stageIndices:[i],reason:'题设圆弧尚未到达，仅作示意。',verticalArc:planned};}}
  const last = events[events.length - 1];
  const termination = { reason, eventId: last.id, stageIndex: last.stageIndex };
  const calculations: NonNullable<StageMotion["calculations"]> = plan.energy ? [{ quantity: "initial_elastic_energy", value: plan.energy.elasticEnergyJ, unit: "J", source: plan.energy.origin === "given" || plan.energy.origin === "user" ? plan.energy.origin : "derived", rule: plan.energy.origin, inputPaths: ["/energy"] }] : [];
  if (scope) for (const e of events) {
    if (e.kind !== "spring_release_end" && e.kind !== "arc_enter") continue;
    const inputPaths = ["/massKg", "/gravityMps2"];
    if (scope.mode !== "full") inputPaths.push("/energy");
    // 使用实际前驱阶段的来源，直接释放入弧时没有水平目标或水平摩擦字段。
    for (let i = 0; i <= (e.kind === "spring_release_end" ? e.stageIndex : e.stageIndex - 1); i++) {
      const stage = plan.stages[i], path = `/stages/${i}`;
      if (stage.kind === "spring_release") {
        if (scope.mode === "full") inputPaths.push(`${path}/springConstantNpm`, `${path}/initialCompressionM`);
        inputPaths.push(`${path}/kineticFrictionCoefficient`);
      } else if (stage.kind === "horizontal_slide") inputPaths.push(`${path}/end`, `${path}/kineticFrictionCoefficient`);
    }
    calculations.push({ quantity: e.kind === "spring_release_end" ? "release_speed" : "arc_entry_speed", value: Math.hypot(e.velocityAfter.vxMps, e.velocityAfter.vyMps), unit: "m/s", source: "derived", rule: "energy_with_friction", inputPaths });
  }
  return {
    ...(plan.stages.some(s=>s.kind==='vertical_arc'&&s.path)?{motionStatus:{state:['stopped','stop_at_target','stop_before_target'].includes(reason)?'complete' as const:'range_end' as const,reason,bodyIds:[],message:reason==='prefix_end'?'观察范围结束，仍保持真实速度与支持力。':reason==='returned_to_entry'?'返回入口的已求范围结束，保留反向速度和约束。':reason==='landed'?'首次接地，保留入射速度。':reason==='arc_detached'?'实际离轨，保留切向速度。':'物体真实静止。'}}:{}),
    ...(scope ? { timing: { ...scope, anchor: { label: scope.mode === "full" ? "A" : scope.mode === "suffix" || scope.stopReason === "prefix_end" ? "B" : "静止点", position: scope.mode === "full" ? { xM: 0, yM: 0 } : { xM: scope.xM!, yM: 0 } }, absoluteStartSeconds: scope.mode === "full" ? 0 : null, excludedStageIndices: scope.mode === "full" ? [] : scope.mode === "suffix" ? Array.from({ length: from }, (_, i) => i) : plan.stages.map((_, i) => i) }, calculations } : {}),
    geometry, durationSeconds: time, segments, events, termination,
    get endReason() { return termination.reason; },
    sampleAt(timeSeconds) {
      const t = Number.isNaN(timeSeconds) ? 0 : Math.min(time, Math.max(0, timeSeconds));
      // 同刻的最后一个事件状态优先，确保转向、接触和零时长终止可精确停靠。
      // 吸收累加时刻和十进制播放值的 ulp 误差，按物理时刻缩放。
      // 固定绝对容差会把极短圆弧的离弧事件错误吸附到 t=0。
      const copy = (s: MotionSample): MotionSample => ({ ...s, ...(s.constraint ? { constraint: { ...s.constraint, ...(s.constraint.normalDirection?{normalDirection:{...s.constraint.normalDirection}}:{}) } } : {}) });
      if(timeSeconds<0&&plan.stages.some(s=>s.kind==='vertical_arc'&&s.path))return copy(eventStates[0]);
      let nearestIndex = -1, nearestDistance = Infinity;
      for (let i = events.length - 1; i >= 0; i--) {
        const eventTime = events[i].timeSeconds;
        // 精确时刻优先。逆序保留同刻最后事件，近似命中不能抢走另一精确时刻。
        if (eventTime === t) return copy(eventStates[i]);
        const distance = Math.abs(eventTime - t);
        const tolerance = 8 * Number.EPSILON * Math.max(Math.abs(eventTime), Math.abs(t), Number.MIN_VALUE);
        if (distance <= tolerance && distance < nearestDistance) { nearestIndex = i; nearestDistance = distance; }
      }
      // 只有无精确命中时才选最近事件；等距不覆盖，沿用逆序的最后事件优先。
      if (nearestIndex >= 0) return copy(eventStates[nearestIndex]);
      const active = runs.find((item) => t >= item.start && t < item.end);
      return copy(active ? active.run.sampleAt(t - active.start) : final);
    },
  };
}

export function assembleStageScene(input: unknown): { ok: true; scene: StageScene } | StagePlanFailure {
  const validation = validateStagePlan(input);
  if (!validation.ok) return validation;
  const motion = compute(validation.reading, validation.playback);
  if ("ok" in motion) return motion;
  return { ok: true, scene: { kind: "stage_scene", reading: validation.reading, geometry: motion.geometry, motion } };
}
export function buildStageMotion(scene: StageScene): { ok: true; motion: StageMotion } {
  return { ok: true, motion: scene.motion };
}
