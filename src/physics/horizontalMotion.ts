import {solveHorizontal} from './horizontalDynamics.ts';
import type {HorizontalPlan} from './horizontalTypes.ts';
import type {ResolvedStagePlan, PlaybackScope} from './stagePlan.ts';
import type {StageMotion,EndReason} from './stageMotion.ts';
import type {BodySnapshot} from './multiBodyTypes.ts';
const labels:Record<string,[string,string]>={
 release:['初态','按题给的两物体初位与带符号速度开始。'],stop:['停止','此物体已持续静止；另一物体仍按同一时钟运动。'],
 conveyor_common_velocity:['与传送带共速','滑块速度达到带速，此后在水平匀速带上匀速前进。'],
 turn_around:['带面折返','滑块速度减为零后在带面滑动摩擦作用下反向加速。'],
 conveyor_exit:['离开传送带','到达传送带端点离开带面；未给地面时不生成虚构落地。'],
 contact:['实际接触','由真实轨迹求得首次接触，尚未应用碰撞冲量。'],collision:['水平正碰','按实际碰前速度、两质量与动量守恒同时更新两物体，保留世界位置。'],
 movable_arc_gap:['未知水平间距（播放时间缺口）','碰撞点到圆弧槽底的水平间距未知：此处省略未计时的自由滑行，动画从球滑入槽底起计时，另一物体仅保留确定速度而不猜测其相对槽的位置或后续二次相遇。'],
 movable_arc_top:['球到达槽顶相对静止','水平动量守恒：球在四分之一圆弧槽顶与槽共速（相对静止），随后沿槽对称滑回。'],
 movable_arc_return_exit:['球返回槽底分离','球对称滑回槽底并与槽首次分离，系统水平动量与机械能守恒。'],
 movable_arc_top_exit:['球从槽顶飞出','入槽动能超过临界值，球到达槽顶时保留向上相对速度。'],
 range_end:['播放范围终点','保留此刻两物体的真实位置和速度，不表示永久静止。'],second_contact_boundary:['再次接触边界','只计算到第二次接触的入射状态，尚未执行第二次碰撞。'],
 projectile_launch:['碰后飞出','题面明确无支撑，以真实碰后速度从接触点飞出。'],leave_table:['离开桌沿','正速到达真实桌沿，开始只受重力的运动。'],
 land:['落地','首次接地，保留入射速度；另一物体取同一时刻状态。'],reach_target:['到达目标','到达题给的有限轨道终点。'],
 pendulum_enter:['绳保持张紧','继承题面已有的绳几何，以真实碰后速度摆动。'],pendulum_turn:['摆动转折','速度瞬时为零，随后反向，不代表永久静止。'],pendulum_lowest:['经过最低点','保留世界坐标与真实切向速度。'],
 peg_contact:['轻绳碰钉改支点','轻绳摆至水平位置碰钉，位置与速度保持连续，支点切至钉子且摆长缩短。'],
 pendulum_top:['通过钉子正上方最高点','沿新半径到达钉子正上方最高点，张力非负。'],
 string_slack:['绳开始松弛','张力降为零，沿实际切线继续。'],string_retaut_boundary:['再次张紧边界','保留再次张紧前状态，后续冲量未建模。'],apex:['飞行最高点','竖直速度瞬时为零，水平速度保持。'],
};
export function computeHorizontalMotion(plan:ResolvedStagePlan, scope?:PlaybackScope):StageMotion{
 const r=solveHorizontal(plan as unknown as HorizontalPlan, scope),primary=plan.primaryBodyId!;
 const events=r.events.map((e,order)=>{const a=e.before.bodies[primary],b=e.after.bodies[primary],[label,explanation]=labels[e.kind]??[e.kind,'按实际轨道更新状态。'];return{id:`${e.stageIndex}:${e.kind}:${order}`,stageIndex:e.stageIndex,stagePath:e.stagePath,kind:e.kind,timeSeconds:e.timeSeconds,order,bodyIds:e.bodyIds,label,explanation,position:{xM:b.xM,yM:b.yM},velocityBefore:{vxMps:a.vxMps,vyMps:a.vyMps},velocityAfter:{vxMps:b.vxMps,vyMps:b.vyMps},bodyStatesBefore:e.before.bodies,bodyStatesAfter:e.after.bodies,constraintsBefore:e.before.constraints,constraintsAfter:e.after.constraints,...(e.collision?{collision:e.collision}:{})};});
 const last=events[events.length-1],termination={reason:r.reason as EndReason,eventId:last.id,stageIndex:last.stageIndex};
 const project=(s:BodySnapshot)=>{const copy=structuredClone(s),b=copy.bodies[primary];return{xM:b.xM,yM:b.yM,vxMps:b.vxMps,vyMps:b.vyMps,springCompressionM:0,...copy};};
 const message=r.reason==='contact_without_impact'?'已接触但无相对冲击，未执行反弹或粘连。':r.reason==='second_contact_boundary'?'计算到再次接触前，未执行第二次冲击。':r.reason==='no_collision'?'两物体已静止且未发生接触。':r.reason==='pendulum_peg_top'?'摆锤已到达钉子正上方最高点，保留两物体此刻真实状态。':r.reason==='movable_arc_return_exit'?'球已对称滑回槽底并与可移动圆弧槽首次分离，保留各物体此刻真实状态。':r.status==='complete'?'所有物体已真正静止。':r.status==='model_limit'?'已到真实模型边界，后续运动尚未求解。':'这是有限播放范围终点；保留各物体真实末态。';
 const calculations=[
  ...(r.collisionValues?[{quantity:'collision_energy_lost',value:r.collisionValues.energyLostJ,unit:'J',source:'derived' as const,rule:r.collisionValues.mode,inputPaths:['/bodies','/initial/bodies','/stages/0','/stages/1/mode']}]:[]),
  ...(r.extraCalculations??[]),
 ];
 const gapUnknown=Boolean(r.geometry.multiBodyMovableArc?.entryGapUnknown);
 const timing=scope?.mode==='suffix'?{...scope,anchor:{label:gapUnknown?'槽底入口':'碰撞点',position:{xM:r.initial.bodies[primary].xM,yM:0}},absoluteStartSeconds:null,excludedStageIndices:[0]}:undefined;
 return{geometry:r.geometry,primaryBodyId:primary,durationSeconds:r.duration,segments:r.segments,events,termination,get endReason(){return termination.reason;},motionStatus:{state:r.status,reason:r.reason,bodyIds:plan.bodies!.map(b=>b.bodyId),message},...(timing?{timing}:{}),...(r.playbackGaps?.length?{playbackGaps:r.playbackGaps}:{}),...(calculations.length?{calculations}:{}),...(r.movableArcAt?{movableArcAt:r.movableArcAt}:{}),sampleAt(time){
  if(time<0)return project(r.initial);
  const t=Number.isNaN(time)?0:Math.min(r.duration,time);
  let nearest=-1,distance=Infinity;
  for(let i=events.length-1;i>=0;i--){const et=events[i].timeSeconds,d=Math.abs(et-t);if(et===t)return project(r.events[i].after);if(d<distance&&d<=8*Number.EPSILON*Math.max(Math.abs(t),Math.abs(et),Number.MIN_VALUE)){nearest=i;distance=d;}}
  return project(nearest>=0?r.events[nearest].after:r.snapshot(t));
 }};
}
