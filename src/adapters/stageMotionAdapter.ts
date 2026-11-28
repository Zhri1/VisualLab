import type { StageMotion, StagePlanFailure } from "../physics";
import type { ResolvedStagePlan, StageKind } from "../physics/stagePlan";
import type { BodyState } from '../physics/multiBodyTypes';
import type { BodyMotionSample } from '../types';
import type {
  FieldError,
  Motion,
  MotionEvent,
  MotionSegment,
  SceneGeometry,
  SegmentKind,
  Vec2,
} from "../types";

const segmentText: Record<StageKind, Pick<MotionSegment, "name" | "summary" | "formula">> = {
  switchable_em_collision: { name:'分区电磁场与正碰', summary:'上半区匀强电场加速、下半区匀强磁场偏转，定点弹性正碰后撤场匀速漂移，至两回旋圆首次有效外切时恢复磁场。', formula:'y = ½(qE/m)t²；R = mv/(qB)；O₁O₂ = R₁ + R₂' },
  magnetic_reencounter: { name:'磁场双粒子正碰与再相遇', summary:'同一垂直匀强磁场中两带电粒子沿切线发生弹性正碰，碰后两回旋圆在接触点外切并按周期同刻再相遇。', formula:'R = mv/(|q|B)；T = 2πm/(|q|B)；Δt = lcm(T甲, T乙)' },
  movable_semicircle: { name:'可平动半圆轨道', summary:'光滑竖直半圆内轨置光滑水平面可自由平动：滑块与轨道水平动量守恒、机械能守恒，实时输出相对速率与支持力。', formula:'m·v块 + M·V轨 = m·v₀；N = m(u²/R + gcosφ)/(1 + (m/M)sin²φ)' },
  movable_arc: { name:'可移动圆弧槽', summary:'槽置于光滑地面可自由滑动：球槽系统水平动量守恒、机械能守恒，球离槽时两者反向分离。', formula:'m·v球 + M·V槽 = 0；mgR = ½mv球² + ½MV槽²' },
  binary_circular_orbit: {name:"双星圆轨道",summary:"两星绕固定质心以共同周期同步运行，星间距保持不变。",formula:"T² = 4π²d³/[G(m₁+m₂)]，m₁r₁=m₂r₂"},
  circular_orbit: { name:'圆周轨道运动', summary:'固定中心天体与低质量单卫星做匀速圆周轨道运动，由万有引力提供向心力决定速率与周期。', formula:'v = √(GM/r)，T = 2π√(r³/(GM))，a = GM/r²' },
  spring_pair: { name:'自由弹簧双球', summary:'弹簧不锚墙：入射球经弹簧与静止球弹性作用，共速时压缩最大，恢复原长后分离。', formula:'v共 = m₁u/(m₁+m₂)；Ep_max = ½m₁u² − ½(m₁+m₂)v共²' },
  magnetic_deflection: { name:'匀强磁场偏转', summary:'洛伦兹力提供向心力，带电粒子在磁场区域内做匀速圆周；穿出边界或转过半圆后离开。', formula:'R = mv/(|q|B)，F = qv×B' },
  horizontal_approach: {name:'水平接近',summary:'各物体按题给初位、带符号速度和各自摩擦同钟运动。',formula:'xᵢ = xᵢ₀ + vᵢ₀t + aᵢt²/2'},
  block_plank: {name:'滑块与可移动木板',summary:'光滑地面双体按相对速度选摩擦方向，比较先共速与先到板边，共速后依静摩擦上限决定共动或重滑。',formula:'m·v块 + M·v板 = 常量；fₖ = μₖmg；|fₛ| ≤ μₛmg'},
  pulley_system: {name:'轻绳与定滑轮连接体',summary:'轻质不可伸长绳绕过理想定滑轮，拉紧时两物体共加速度与同张力，着地或约束失效时张力归零。',formula:'a = (F驱动 − fₖ)/(m₁ + m₂)，T = m₂(g − a) ≥ 0'},
  pendulum_swing: { name:'轻绳摆',summary:'按真实非线性方程计算摆动与张力；转折后继续反向。',formula:'q² = q₀² + 2gL(cosθ − cosθ₀)，T = M(q²/L + gcosθ)' },
  collision_1d: { name:'水平正碰',summary:'带符号速度与总动量确定碰后状态。',formula:'m₁u₁ + m₂u₂ = m₁v₁ + m₂v₂' },
  parallel_motion: { name:'同步运动',summary:'两物体使用同一条物理时间轴。',formula:'t₁ = t₂' },
  spring_release: { name: "预压弹簧释放", summary: "弹簧推动滑块，释放阶段同时计入摩擦。", formula: "s = (c − μmg/k)(1 − cosωt)" },
  vertical_arc: {
    name: "竖直圆弧", summary: "光滑内轨上机械能守恒；法向力降为零时沿切线飞出，速度先降为零时沿轨回滑。",
    formula: "v² = u² − 2gR(1 − cosφ)，N = m(v²/R + gcosφ)",
  },
  incline_slide: {
    name: "斜面下滑",
    summary: "滑块沿斜面运动，重力沿坡分力与滑动摩擦共同决定加速度。",
    formula: "a = g(sinθ − μcosθ)",
  },
  lossless_turn: {
    name: "无损转向",
    summary: "位置和速率保持不变，速度方向转为水平。",
    formula: "|vₐ| = |vᵦ|",
  },
  horizontal_slide: {
    name: "水平滑动",
    summary: "滑块沿水平支撑面运动；若存在动摩擦，速度随时间线性减小。",
    formula: "v = v₀ − μgt",
  },
  constant_force_1d: {
    name: "常力匀变速",
    summary: "由恒定合力与质量求加速度，继承上一段位置与带方向速度。",
    formula: "a = F/m，v = v₀ + at，x = x₀ + v₀t + ½at²",
  },
  conveyor_belt: {
    name: "传送带与滑块",
    summary: "按相对带面速度确定摩擦方向；共速后依带面加速度与静摩擦上限决定随带或重新滑动。",
    formula: "v相对 = v块 − v带，Δx相对 = x块 − x带；|a带| ≤ μₛg",
  },
  spring_contact: {
    name: "压缩与反弹",
    summary: "弹簧压缩到最大后恢复原长，滑块在不连接前提下反向脱离。",
    formula: "x = (v/ω)·sin(ωt)，ω = √(k/m)",
  },
  projectile: {
    name: "抛体运动",
    summary: "离开发射点后只受重力，水平速度保持，竖直方向做匀变速运动。",
    formula: "x = vₓt，y = vᵧt − gt²/2",
  },
};

function segmentKind(kind: StageKind): SegmentKind {
  if(kind==='pendulum_swing')return 'pendulum';
  if (kind === "incline_slide") return "incline";
  if (kind === "horizontal_slide") return "horizontal";
  if (kind === "spring_contact") return "spring";
  if (kind === "spring_release") return "spring";
  if (kind === "projectile") return "projectile";
  if (kind === "vertical_arc") return "vertical_arc";
  if (kind === "movable_arc") return "movable_arc";
  if (kind === "movable_semicircle") return "movable_semicircle";
  if (kind === "switchable_em_collision" || kind === "magnetic_reencounter") return "switchable_em";
  if (kind === "spring_pair") return "spring_pair";
  if (kind === "binary_circular_orbit") return "circular_orbit";
  if (kind === "circular_orbit") return "circular_orbit";
  return "horizontal";
}

function vec(x: number, y: number): Vec2 {
  return { x, y };
}

/** StageGeometry 之外再保留旧几何视图，供原有测试和非画布消费者继续使用。 */
function legacyGeometry(source: StageMotion): SceneGeometry {
  const g = source.geometry;
  const first = source.sampleAt(0);
  const last = source.sampleAt(source.durationSeconds);
  const firstIncline = g.incline ?? g.inclines?.[0];
  const lastHorizontal = g.horizontal ?? g.horizontals?.[g.horizontals.length - 1];
  const lastSpring = g.spring ?? g.springs?.[g.springs.length - 1];
  const inclineStart = firstIncline?.start ?? { xM: first.xM, yM: first.yM };
  const inclineEnd = firstIncline?.end ?? { xM: first.xM, yM: first.yM };
  const horizontalEnd = lastHorizontal?.plannedEnd ?? lastSpring?.contact ?? { xM: last.xM, yM: last.yM };
  return {
    inclineTop: vec(inclineStart.xM, inclineStart.yM),
    inclineBottom: vec(inclineEnd.xM, inclineEnd.yM),
    horizontalEnd: vec(horizontalEnd.xM, horizontalEnd.yM),
    springContactX: lastSpring?.contact.xM ?? horizontalEnd.xM,
    springAnchorX: lastSpring?.anchor.xM ?? horizontalEnd.xM + 1,
    blockSizeM: g.blockSizeM,
  };
}

export function adaptStageMotion(source: StageMotion, plan?: ResolvedStagePlan): Motion {
  const segmentByStage = new Map(source.segments.map((segment) => [segment.stageIndex, segment]));
  const events: MotionEvent[] = source.events.map((event) => {
    const owner = segmentByStage.get(event.stageIndex);
    const fallback: StageKind = event.kind === "projectile" || event.kind === "leave_table" || event.kind === "apex" || event.kind === "land"
      ? "projectile"
      : event.kind === "lossless_turn"
        ? "lossless_turn"
        : event.kind.includes("spring") || event.kind === "max_compression"
          ? "spring_contact"
          : "incline_slide";
    return {
      collision:event.collision,
      bodyIds:event.bodyIds,stagePath:event.stagePath,
      bodyStatesBefore:event.bodyStatesBefore?mapBodies(event.bodyStatesBefore):undefined,
      bodyStatesAfter:event.bodyStatesAfter?mapBodies(event.bodyStatesAfter):undefined,
      constraintsBefore:event.constraintsBefore,constraintsAfter:event.constraintsAfter,
      id: event.id,
      eventKind: event.kind,
      ...(event.conveyorExitEdge ? { conveyorExitEdge: event.conveyorExitEdge } : {}),
      ...(event.conveyorFrictionWorkJ !== undefined ? { conveyorFrictionWorkJ: event.conveyorFrictionWorkJ } : {}),
      ...(event.conveyorSlipDistanceM !== undefined ? { conveyorSlipDistanceM: event.conveyorSlipDistanceM } : {}),
      stageIndex: event.stageIndex,
      order: event.order,
      timeSeconds: event.timeSeconds,
      label: event.label,
      caption: event.explanation,
      detail: event.explanation,
      segment: segmentKind(owner?.kind ?? plan?.stages[event.stageIndex]?.kind ?? fallback),
      ...(event.impulseNs ? {impulseNs:event.impulseNs} : {}),
      velocityBefore: vec(event.velocityBefore.vxMps, event.velocityBefore.vyMps),
      velocityAfter: vec(event.velocityAfter.vxMps, event.velocityAfter.vyMps),
      ...(event.position ? { position: vec(event.position.xM, event.position.yM), normalForceBeforeN: event.normalForceBeforeN, normalForceAfterN: event.normalForceAfterN } : {}),
    };
  });

  // 瞬时入口只增加显示定位标记，物理 segments 仍只保留正时长运动。
  const displaySegments=[...source.segments];
  const finalStage=plan?.stages[source.termination.stageIndex];
  if (finalStage?.kind === "vertical_arc" && finalStage.entryOnly) displaySegments.push({stageIndex:source.termination.stageIndex,kind:"vertical_arc",startSeconds:source.durationSeconds,endSeconds:source.durationSeconds});
  return {
    primaryBodyId:source.primaryBodyId,motionStatus:source.motionStatus,
    timing: source.timing,
    ...(source.playbackGaps ? { playbackGaps: source.playbackGaps } : {}),
    calculations: source.calculations,
    geometry: legacyGeometry(source),
    stageGeometry: source.geometry,
    stagePlan: plan,
    durationSeconds: source.durationSeconds,
    segments: displaySegments.map((segment) => ({
      bodyIds:segment.bodyIds,stagePath:segment.stagePath,
      kind: segmentKind(segment.kind),
      stageKind: segment.kind,
      stageIndex: segment.stageIndex,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      ...segmentText[segment.kind],
      ...(segment.kind==='vertical_arc' && (plan?.stages[segment.stageIndex] as {entryOnly?:boolean}|undefined)?.entryOnly ? {name:"刚进入圆弧",summary:"只计算最低点入弧瞬时的法向力，不推演未知弧内过程。",formula:"N = m(g + v²/R)"} : {}),
      ...(segment.kind==='spring_contact'&&plan?.stages[segment.stageIndex]&&'kineticFrictionCoefficient' in plan.stages[segment.stageIndex]?{
        name:'粗糙压缩与回弹',
        summary:'按实际运动方向计动摩擦；在最大压缩处用静摩擦上限或题给事实判断保持或回弹，回弹可能脱离或带残余压缩静止。',
        formula:'压缩 x″ = −(k/m)x − μₖg；回弹 x″ = −(k/m)x + μₖg；Q = μₖmg·s',
      }:{}),
      ...(segment.kind==='vertical_arc'&&(plan?.stages[segment.stageIndex] as {path?:unknown}|undefined)?.path?{
        summary:'按真实入射角和切线运动；只有继续需要负支持力才脱轨，观察范围结束仍保持约束。',
        formula:'q² = u² + 2gR(cosφ − cosφ₀)，N = m(q²/R + gcosφ)',
      }:{}),
    })),
    events,
    endReason: source.endReason,
    termination: source.termination,
    ...(source.energyAt ? { energyAt: (time: number) => source.energyAt!(Number.isNaN(time) ? 0 : time) } : {}),
    ...(source.conveyorAt ? { conveyorAt: (time: number) => source.conveyorAt!(Number.isNaN(time) ? 0 : time) } : {}),
    ...(source.movableArcAt ? { movableArcAt: (time: number) => source.movableArcAt!(Number.isNaN(time) ? 0 : time) } : {}),
    ...(source.movableSemicircleAt ? { movableSemicircleAt: (time: number) => source.movableSemicircleAt!(Number.isNaN(time) ? 0 : time) } : {}),
    ...(source.springPairAt ? { springPairAt: (time: number) => source.springPairAt!(Number.isNaN(time) ? 0 : time) } : {}),
    sampleAt(timeSeconds) {
      const sample = source.sampleAt(Number.isNaN(timeSeconds) ? 0 : timeSeconds);
      return {
        ...(sample.bodies?{bodies:mapBodies(sample.bodies),constraints:sample.constraints}:{}),
        position: vec(sample.xM, sample.yM),
        velocity: vec(sample.vxMps, sample.vyMps),
        springCompressionM: sample.springCompressionM,
        ...(sample.constraint ? { constraint: { ...sample.constraint } } : {}),
      };
    },
  };
}

function mapBodies(bodies:Record<string,BodyState>):Record<string,BodyMotionSample>{
  return Object.fromEntries(Object.entries(bodies).map(([id,b])=>{const{xM,yM,vxMps,vyMps,...rest}=b;return[id,{...rest,position:vec(xM,yM),velocity:vec(vxMps,vyMps)}];}));
}

export function stageFailureErrors(failure: StagePlanFailure): FieldError[] {
  const missing = failure.missingKeys.map((path) => ({ code: "MISSING", path, message: failure.message }));
  const invalid = failure.fieldErrors.map((error) => ({ code: error.code, path: error.path, message: error.message }));
  if (missing.length + invalid.length > 0) return [...missing, ...invalid];
  return [{ code: failure.code, message: failure.message }];
}
