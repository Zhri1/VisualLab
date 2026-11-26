import {computeHorizontalMotion} from './horizontalMotion.ts';
import {computeBlockPlankMotion} from './blockPlankMotion.ts';
import {computePulleyMotion} from './pulleyMotion.ts';
import {linearBodyTrack} from './bodyTrack.ts';
import {BodyPlanError as PlanError} from './bodyPlanError.ts';
import type { ResolvedStagePlan, StagePlanDraft, StagePlanFailure, StageKind } from './stagePlan.ts';
import type { StageMotion, StageEvent, EndReason } from './stageMotion.ts';
import type { BodyState, BodySnapshot, BodyDefinition, StringState, MotionStatus, PendulumStage, CollisionStage, ParallelStage, BodyTrackStage } from './multiBodyTypes.ts';
import { createPendulum } from './pendulum.ts';
import type { PendulumSample } from './pendulum.ts';
import { collide1D } from './collision.ts';
import { linearState } from './kinematics.ts';

type Pendulum = ReturnType<typeof createPendulum>;
type Scalar = Pick<BodyState, 'xM'|'yM'|'vxMps'|'vyMps'|'springCompressionM'|'status'>;
type RawEvent = { time: number; kind: string; stageIndex: number; path: string; bodyIds: string[]; track: number; pre?: boolean; pendBefore?: PendulumSample; pendAfter?: PendulumSample; targetBefore?:Scalar; targetAfter?:Scalar };
const close = (a: number, b: number) => Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=16*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b),Number.MIN_VALUE);
const pos = (s: Scalar) => ({xM:s.xM,yM:s.yM});
const vel = (s: Scalar) => ({vxMps:s.vxMps,vyMps:s.vyMps});
const text: Record<string,[string,string]> = {
  release:['释放','从题面明确的初始位置和速度开始；各物体共用物理时钟。'],pendulum_enter:['绳保持张紧','轻绳只承担非负张力，按真实非线性摆方程运动。'],
  pendulum_lowest:['经过最低点','位置到达固定最低点，速度沿水平切线。'],pendulum_turn:['摆动转折','切向速度瞬时为零，随后将沿原弧反向；不代表永久停止。'],
  collision:['最低点正碰','以两质量和带符号水平速度计算碰后状态，同时更新两个物体。'],string_slack:['绳开始松弛','继续圆周将需要负张力；保持真实位置和切向速度，张力变为零。'],
  projectile_launch:['进入自由飞行','以真实发射位置和速度接只受重力的运动；没有题定地面时不生成落地。'],apex:['飞行最高点','竖直速度降到零，水平速度连续。'],
  string_retaut_boundary:['到达再次张紧边界','此处保留再次张紧前的入射状态；尚未求径向冲量和后续运动。'],stop:['停止','此物体因摩擦真正停止，其他物体是否仍运动须分别查看。'],
  reach_target:['到达目标','按实际位移到达题设距离目标。'],leave_table:['离开桌沿','以实际非零水平速度离桌，另一物体继续按同一时钟取样。'],land:['落地','首次到达题定地面，保留接地瞬间的入射速度。'],
};

export function computeMultiBodyMotion(plan: ResolvedStagePlan): StageMotion | StagePlanFailure {
  if (plan.stages[0]?.kind === 'block_plank') return computeBlockPlankMotion(plan);
  if (plan.stages[0]?.kind === 'pulley_system') return computePulleyMotion(plan);
  try { return 'bodies'in plan.initial ? computeHorizontalMotion(plan) : solve(plan); } catch(error) {
    if(!(error instanceof PlanError)&&!(error instanceof RangeError))throw error;
    const path=error instanceof PlanError?error.path:'/initial', missing=error instanceof PlanError&&error.missing;
    return {ok:false,code:missing?'NEEDS_INPUT':'INCONSISTENT_CONDITIONS',reading:plan as StagePlanDraft,message:error.message,missingKeys:missing?[path]:[],fieldErrors:missing?[]:[{path,code:error instanceof RangeError?'RANGE':'PRECONDITION_CONFLICT',message:error.message}]};
  }
}
function solve(plan: ResolvedStagePlan): StageMotion {
  const definitions=plan.bodies!,primary=plan.primaryBodyId!,g=plan.gravityMps2!,first=plan.stages[0] as PendulumStage;
  const bobId=first.bodyIds![0], L=first.lengthM!, constraintId='string:'+bobId;
  const mass=(ids:string[])=>ids.reduce((sum,id)=>sum+definitions.find(b=>b.bodyId===id)!.massKg,0);
  const q='tangentialSpeedMps'in plan.initial?plan.initial.tangentialSpeedMps:0;
  const source=createPendulum(L,g,mass([bobId]),first.initialAngleDeg!*Math.PI/180,q,!!first.slackContinuation);
  const tc=source.endTime(first.end.kind),collision=plan.stages[1] as CollisionStage|undefined;
  if(!Number.isFinite(tc))throw new PlanError('/stages/0/end','当前结束条件不会在可求运动内发生。');
  const geometry: StageMotion['geometry']={blockSizeM:.3,positionReference:'particle',bodies:definitions.map(b=>({...b})),pendulums:[{constraintId,bodyIds:[bobId],definitionStageIndex:0,pivot:{xM:0,yM:L},lowestPoint:{xM:0,yM:0},lengthM:L,initialPosition:pos(source.initial)}],bodyTracks:[]};
  let duration=tc, postAge=0, postPendulum:Pendulum|undefined,postIds=[bobId],postPath='/stages/2',postTrack=0;
  let targetId:string|undefined,targetVelocity=0,targetRun:ReturnType<typeof linearTrack>|undefined;
  let sticky=false, groupId:string|undefined, scopeReason:EndReason='prefix_end',status:MotionStatus['state']='range_end',scopeBodies=[bobId];
  const raw:RawEvent[]=[],segments:StageMotion['segments']=[];
  const add=(time:number,kind:string,index:number,path:string,bodyIds:string[],track=0,pre=false,pendBefore?:PendulumSample,pendAfter?:PendulumSample)=>raw.push({time,kind,stageIndex:index,path,bodyIds,track,pre,pendBefore,pendAfter});
  add(0,'release',0,'/stages/0',[bobId],0,true);
  if(!source.initiallySlack)add(0,'pendulum_enter',0,'/stages/0',[bobId],0,true);
  let collisionResult:ReturnType<typeof collide1D>|undefined;
  if(collision){
    if(collision.kind!=='collision_1d')throw new PlanError('/stages/1','摆后只接约定的最低点正碰。');
    targetId=collision.bodyIds[1];const u1=source.at(tc).vxMps,u2=collision.targetApproach.velocityXMps;
    collisionResult=collide1D(mass([bobId]),mass([targetId]),u1,u2,collision.mode);
    targetVelocity=collisionResult.v2;sticky=collision.mode==='perfectly_inelastic';
    postIds=sticky?[bobId,targetId]:[bobId];
    if(sticky)groupId='group:'+postIds.slice().sort().join(',');
    const next=plan.stages[2] as PendulumStage|ParallelStage|undefined;
    let pendStage:PendulumStage|undefined,parallel:ParallelStage|undefined;
    if(next?.kind==='parallel_motion'){
      parallel=next;
      const pi=parallel.tracks.findIndex(t=>t.bodyIds.includes(bobId));postTrack=pi;
      pendStage=parallel.tracks[pi]?.stages[0] as PendulumStage;
      postPath=`/stages/2/tracks/${pi}/stages/0`;
      if(!pendStage||pendStage.kind!=='pendulum_swing')throw new PlanError(postPath,'原摆锤碰后必须沿原绳的摆模块接续。');
      if(!sticky){
        const ti=parallel.tracks.findIndex(t=>t.bodyIds.includes(targetId!));
        if(ti<0)throw new PlanError('/stages/2/tracks','目标没有明确的碰后轨道。');
        targetRun=linearTrack(parallel.tracks[ti].stages,targetVelocity,targetId,ti);
      }
    }else if(next?.kind==='pendulum_swing')pendStage=next;
    postPendulum=createPendulum(L,g,mass(postIds),0,collisionResult.v1,!!pendStage?.slackContinuation);
    add(tc,'collision',1,'/stages/1',collision.bodyIds);
    if(!next){duration=tc;scopeReason='collision_complete';scopeBodies=collision.bodyIds;}
    else{
      let endAge:number;
      if(parallel){
        if(parallel.end.kind==='pendulum_turn'){
          if(!postIds.includes(parallel.end.bodyId)||postPendulum.equilibrium)throw new PlanError('/stages/2/end','指定物体没有将发生的摆动转折。');
          endAge=postPendulum.firstTurn;
        }else if(targetRun){
          endAge=targetRun.duration;
          if(!Number.isFinite(endAge))throw new PlanError('/stages/2/end','没有有限目标轨道决定共同播放范围。',true);
          if(endAge===0&&!postPendulum.equilibrium)throw new PlanError('/stages/2/end','目标已在入口静止，摆仍运动，请明确观察终点。',true);
        }else throw new PlanError('/stages/2/end','没有有限目标轨道决定共同播放范围。',true);
      }else endAge=postPendulum.endTime(pendStage!.end.kind);
      const landing=targetRun?.reason==='landed'?targetRun.duration:Infinity;
      const firstBoundary=Math.min(endAge,postPendulum.limit,landing);
      if(close(postPendulum.limit,firstBoundary))endAge=postPendulum.limit;
      else if(close(landing,firstBoundary))endAge=landing;
      else endAge=firstBoundary;
      postAge=endAge;
      if(!Number.isFinite(endAge))throw new PlanError('/stages/2/end','当前运动没有所指定的有限终点。');
      duration=tc+endAge;
      if(endAge>0&&!(duration>tc))throw new RangeError('碰后时长与全局时刻无法区分，请核对量级。');
      scopeBodies=postIds;
      if(close(endAge,postPendulum.limit)||endAge===postPendulum.limit){scopeReason=postPendulum.limitKind as EndReason;status=postPendulum.limitKind==='string_retaut_boundary'?'model_limit':'range_end';}
      else if(postPendulum.equilibrium&&(!targetRun||targetRun.at(endAge).status==='resting')){scopeReason='stopped';status='complete';scopeBodies=definitions.map(b=>b.bodyId);}
      else if(landing===endAge){scopeReason='landed';scopeBodies=[targetId!];}
      else if(parallel?.end.kind==='pendulum_turn'||(!parallel&&pendStage?.end.kind==='first_turn')){scopeReason='pendulum_first_turn';}
      else if(targetRun){scopeReason=targetRun.reason==='landed'?'landed':'prefix_end';scopeBodies=[targetId!];}
      if(!postPendulum.initiallySlack)add(tc,'pendulum_enter',2,postPath,postIds,postTrack);
      const turn=postPendulum.firstTurn;
      const pendulumEventAge=close(turn,endAge)?Math.max(turn,endAge):endAge;
      for(const e of postPendulum.eventsUntil(pendulumEventAge))add(tc+(close(e.time,endAge)?endAge:e.time),e.kind,2,postPath,postIds,postTrack,false,e.before,e.after);
      appendPendulumSegments(postPendulum,endAge,tc,2,postPath,postIds);
      if(targetRun){
        for(const e of targetRun.events)if(e.time<=endAge||close(e.time,endAge))raw.push({time:tc+(close(e.time,endAge)?endAge:e.time),kind:e.kind,stageIndex:2,path:e.path,bodyIds:[targetId!],track:targetRun.track,targetBefore:e.before,targetAfter:e.after});
        for(const s of targetRun.segments){const end=Math.min(endAge,s.endSeconds);if(end>s.startSeconds)segments.push({...s,startSeconds:tc+s.startSeconds,endSeconds:tc+end});}
        geometry.bodyTracks!.push(...targetRun.geometry.filter(x=>x.start<=endAge).map(x=>x.value));
      }
    }
  }else{
    if(source.equilibrium){scopeReason='stopped';status='complete';}
    else if(close(tc,source.limit)||tc===source.limit){scopeReason=source.limitKind as EndReason;status=source.limitKind==='string_retaut_boundary'?'model_limit':'range_end';}
    else scopeReason=first.end.kind==='first_turn'?'pendulum_first_turn':'prefix_end';
  }
  for(const e of source.eventsUntil(tc))add(e.time,e.kind,0,'/stages/0',[bobId],0,true,e.before,e.after);
  if(first.end.kind==='lowest_point'&&tc===0&&!source.initiallySlack)add(0,'pendulum_lowest',0,'/stages/0',[bobId],0,true);
  if(!collision&&source.equilibrium)add(0,'stop',0,'/stages/0',[bobId],0,true);
  appendPendulumSegments(source,tc,0,0,'/stages/0',[bobId]);
  function appendPendulumSegments(p:Pendulum,age:number,start:number,index:number,path:string,ids:string[]){
    const arcEnd=Math.min(age,p.lossTime);
    if(!p.equilibrium&&arcEnd>0)segments.push({stageIndex:index,stagePath:path,bodyIds:ids,kind:'pendulum_swing',startSeconds:start,endSeconds:start+arcEnd});
    if(age>p.lossTime){
      const flightPath=path+'/slackContinuation';segments.push({stageIndex:index,stagePath:flightPath,bodyIds:ids,kind:'projectile',startSeconds:start+p.lossTime,endSeconds:start+age});
      geometry.bodyTracks!.push({bodyIds:ids,stagePath:flightPath,projectile:{launch:pos(p.loss)}});
    }
  }
  function snapshot(t:number,pre=false,override?:PendulumSample,targetOverride?:Scalar):BodySnapshot{
    const after=!!collision&&t>=tc&&!pre, p=after?postPendulum!:source, ids=after?postIds:[bobId];
    const age=after?(t===duration?postAge:t-tc):t;
    const state=override??p.at(age),bodies:Record<string,BodyState>={},constraints:Record<string,StringState>={};
    const string:StringState={kind:'pendulum_string',constraintId,bodyIds:ids.slice(),pivot:{xM:0,yM:L},lengthM:L,state:state.stringState,tensionN:state.tensionN};
    if(state.stringState==='taut'){string.angleDeg=state.angleRad!*180/Math.PI;string.angularVelocityRadps=state.angularVelocityRadps!;}
    constraints[constraintId]=string;
    for(const b of definitions){
      let scalar:Scalar;
      if(ids.includes(b.bodyId))scalar=state;
      else if(b.bodyId===targetId){
        if(after)scalar=targetOverride??(targetRun?targetRun.at(age):{...linearState(0,0,targetVelocity,0,0,0,0),status:targetVelocity===0?'resting':'moving'});
        else{const speed=collision!.targetApproach.velocityXMps;scalar={...linearState(-speed*tc,0,speed,0,0,0,t),status:speed===0?'resting':'moving'};}
      }else throw new PlanError('/bodies','物体没有可求的初态或运动轨道。');
      bodies[b.bodyId]={bodyId:b.bodyId,massKg:b.massKg,xM:scalar.xM,yM:scalar.yM,vxMps:scalar.vxMps,vyMps:scalar.vyMps,springCompressionM:0,status:scalar.status,...(ids.includes(b.bodyId)?{constraintId,...(after&&groupId?{groupId}:{})}:{})};
    }
    return {bodies,constraints};
  }
  const events:StageEvent[]=[],states:BodySnapshot[]=[];
  const endKind=scopeReason==='landed'?'land':scopeReason;
  const isEnd=(event:RawEvent)=>Number(event.time===duration&&event.kind===endKind);
  raw.sort((a,b)=>a.time-b.time||a.stageIndex-b.stageIndex||isEnd(a)-isEnd(b)||a.track-b.track);
  for(const item of raw){
    if(item.time>duration)continue;
    const before=item.kind==='collision'?snapshot(item.time,true):snapshot(item.time,item.pre,item.pendBefore,item.targetBefore);
    const after=snapshot(item.time,item.kind==='collision'?false:item.pre,item.pendAfter,item.kind==='collision'&&!sticky?{...linearState(0,0,targetVelocity,0,0,0,0),status:targetVelocity===0?'resting':'moving'}:item.targetAfter);
    const order=events.length,[label,explanation]=text[item.kind]??[item.kind,'按实际物理状态更新。'];
    events.push({id:`${item.stageIndex}:${item.kind}:${order}`,stageIndex:item.stageIndex,stagePath:item.path,kind:item.kind,timeSeconds:item.time,order,bodyIds:item.bodyIds.slice(),label,explanation,position:pos(after.bodies[primary]),velocityBefore:vel(before.bodies[primary]),velocityAfter:vel(after.bodies[primary]),bodyStatesBefore:before.bodies,bodyStatesAfter:after.bodies,constraintsBefore:before.constraints,constraintsAfter:after.constraints});
    states.push(structuredClone(after));
  }
  const last=events[events.length-1],termination={reason:scopeReason,eventId:last.id,stageIndex:last.stageIndex};
  const allFinite=(s:BodySnapshot)=>Object.values(s.bodies).every(b=>[b.massKg,b.xM,b.yM,b.vxMps,b.vyMps].every(Number.isFinite))&&Object.values(s.constraints).every(c=>Number.isFinite(c.tensionN));
  if(!Number.isFinite(duration)||duration<0||!allFinite(snapshot(duration))||states.some(s=>!allFinite(s)))throw new RangeError('多物体的时刻、状态或张力量级无法表示。');
  const motionStatus:MotionStatus={state:status,reason:scopeReason,bodyIds:scopeBodies,message:status==='complete'?'所有物体在本范围末已真正静止。':status==='model_limit'?'只求到再次张紧之前的入射状态，后续冲量尚未建模。':'这是题设指定的播放范围终点；仍运动的物体保留真实速度，不能解释为永久静止。'};
  const calculations:NonNullable<StageMotion['calculations']>=source.firstLowest<=tc?[{quantity:'pendulum_lowest_speed',value:Math.abs(source.at(source.firstLowest).vxMps),unit:'m/s',source:first.initialAngleDeg===0&&q!==0?'given':'derived',rule:'nonlinear_pendulum_energy',inputPaths:['/stages/0/lengthM','/stages/0/initialAngleDeg','/initial','/gravityMps2']}]:[];
  if(collisionResult)calculations.push({quantity:'collision_energy_lost',value:collisionResult.energyLostJ,unit:'J',source:'derived',rule:collision!.mode,inputPaths:['/bodies','/stages/1/targetApproach/velocityXMps']});
  return {geometry,primaryBodyId:primary,motionStatus,calculations,durationSeconds:duration,segments:segments.sort((a,b)=>a.startSeconds-b.startSeconds),events,termination,get endReason(){return termination.reason;},sampleAt(time){
    const t=Number.isNaN(time)?0:Math.max(0,Math.min(duration,time));
    let nearest=-1,distance=Infinity;
    for(let i=events.length-1;i>=0;i--){const et=events[i].timeSeconds,d=Math.abs(et-t);if(et===t)return project(states[i]);if(d<=8*Number.EPSILON*Math.max(Math.abs(et),Math.abs(t),Number.MIN_VALUE)&&d<distance){nearest=i;distance=d;}}
    return project(nearest>=0?states[nearest]:snapshot(t));
  }};
  function project(s:BodySnapshot){const copy=structuredClone(s),b=copy.bodies[primary];return {xM:b.xM,yM:b.yM,vxMps:b.vxMps,vyMps:b.vyMps,springCompressionM:0,...copy};}

  function linearTrack(stages:BodyTrackStage[],speed:number,id:string,track:number){
    return linearBodyTrack(stages,{...linearState(0,0,speed,0,0,0,0),status:speed===0?'resting':'moving'},[id],track,g);
  }
}
