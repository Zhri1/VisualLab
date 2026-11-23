import {solveHorizontal} from './horizontalDynamics.ts';
import type {HorizontalPlan} from './horizontalTypes.ts';
import type {ResolvedStagePlan} from './stagePlan.ts';
import type {StageMotion,EndReason} from './stageMotion.ts';
import type {BodySnapshot} from './multiBodyTypes.ts';
const labels:Record<string,[string,string]>={
 release:['初态','按题给的两物体初位与带符号速度开始。'],stop:['停止','此物体已持续静止；另一物体仍按同一时钟运动。'],
 contact:['实际接触','由两条真实轨迹求得首次接触，尚未应用碰撞冲量。'],collision:['水平正碰','按实际碰前速度和两质量同时更新两物体，保留世界位置。'],
 range_end:['播放范围终点','保留此刻两物体的真实位置和速度，不表示永久静止。'],second_contact_boundary:['再次接触边界','只计算到第二次接触的入射状态，尚未执行第二次碰撞。'],
 projectile_launch:['碰后飞出','题面明确无支撑，以真实碰后速度从接触点飞出。'],leave_table:['离开桌沿','正速到达真实桌沿，开始只受重力的运动。'],
 land:['落地','首次接地，保留入射速度；另一物体取同一时刻状态。'],reach_target:['到达目标','到达题给的有限轨道终点。'],
 pendulum_enter:['绳保持张紧','继承题面已有的绳几何，以真实碰后速度摆动。'],pendulum_turn:['摆动转折','速度瞬时为零，随后反向，不代表永久静止。'],pendulum_lowest:['经过最低点','保留世界坐标与真实切向速度。'],
 string_slack:['绳开始松弛','张力降为零，沿实际切线继续。'],string_retaut_boundary:['再次张紧边界','保留再次张紧前状态，后续冲量未建模。'],apex:['飞行最高点','竖直速度瞬时为零，水平速度保持。'],
};
export function computeHorizontalMotion(plan:ResolvedStagePlan):StageMotion{
 const r=solveHorizontal(plan as unknown as HorizontalPlan),primary=plan.primaryBodyId!;
 const events=r.events.map((e,order)=>{const a=e.before.bodies[primary],b=e.after.bodies[primary],[label,explanation]=labels[e.kind]??[e.kind,'按实际轨道更新状态。'];return{id:`${e.stageIndex}:${e.kind}:${order}`,stageIndex:e.stageIndex,stagePath:e.stagePath,kind:e.kind,timeSeconds:e.timeSeconds,order,bodyIds:e.bodyIds,label,explanation,position:{xM:b.xM,yM:b.yM},velocityBefore:{vxMps:a.vxMps,vyMps:a.vyMps},velocityAfter:{vxMps:b.vxMps,vyMps:b.vyMps},bodyStatesBefore:e.before.bodies,bodyStatesAfter:e.after.bodies,constraintsBefore:e.before.constraints,constraintsAfter:e.after.constraints,...(e.collision?{collision:e.collision}:{})};});
 const last=events[events.length-1],termination={reason:r.reason as EndReason,eventId:last.id,stageIndex:last.stageIndex};
 const project=(s:BodySnapshot)=>{const copy=structuredClone(s),b=copy.bodies[primary];return{xM:b.xM,yM:b.yM,vxMps:b.vxMps,vyMps:b.vyMps,springCompressionM:0,...copy};};
 const message=r.reason==='contact_without_impact'?'已接触但无相对冲击，未执行反弹或粘连。':r.reason==='second_contact_boundary'?'计算到再次接触前，未执行第二次冲击。':r.reason==='no_collision'?'两物体已静止且未发生接触。':r.status==='complete'?'所有物体已真正静止。':r.status==='model_limit'?'已到真实模型边界，后续运动尚未求解。':'这是有限播放范围终点；保留各物体真实末态。';
 return{geometry:r.geometry,primaryBodyId:primary,durationSeconds:r.duration,segments:r.segments,events,termination,get endReason(){return termination.reason;},motionStatus:{state:r.status,reason:r.reason,bodyIds:plan.bodies!.map(b=>b.bodyId),message},...(r.collisionValues?{calculations:[{quantity:'collision_energy_lost',value:r.collisionValues.energyLostJ,unit:'J',source:'derived' as const,rule:r.collisionValues.mode,inputPaths:['/bodies','/initial/bodies','/stages/0/tracks','/stages/1/mode']}]}:{}),sampleAt(time){
  if(time<0)return project(r.initial);
  const t=Number.isNaN(time)?0:Math.min(r.duration,time);
  let nearest=-1,distance=Infinity;
  for(let i=events.length-1;i>=0;i--){const et=events[i].timeSeconds,d=Math.abs(et-t);if(et===t)return project(r.events[i].after);if(d<distance&&d<=8*Number.EPSILON*Math.max(Math.abs(t),Math.abs(et),Number.MIN_VALUE)){nearest=i;distance=d;}}
  return project(nearest>=0?r.events[nearest].after:r.snapshot(t));
 }};
}
