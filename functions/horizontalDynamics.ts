// 由 scripts/sync-functions.mjs 从 src/physics/horizontalDynamics.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
import { BodyPlanError } from './bodyPlanError.ts';
import { frictionPieces, firstIntersection, polynomialAt, nearValue } from './horizontalKinematics.ts';
import type { PolynomialPiece } from './horizontalKinematics.ts';
import { linearBodyTrack } from './bodyTrack.ts';
import type { Scalar, TrackSegment } from './bodyTrack.ts';
import { createPendulum, createPegPendulum } from './pendulum.ts';
import type { PegPendulumResult } from './pendulum.ts';
import { collide1D, collide1DSpecifiedPostVelocity } from './collision.ts';
import { solveConveyorBelt } from './conveyorBelt.ts';
import type { BodySnapshot, BodyGeometry, BodyTrackStage, StringState } from './multiBodyTypes.ts';
import type { HorizontalPlan, BodyEvent, TrackGeometry, CollisionValues, ConveyorApproach } from './horizontalTypes.ts';

type TrackEvent = {time:number;kind:string;path:string;before?:Scalar;after?:Scalar;constraintBefore?:StringState;constraintAfter?:StringState};
type ExtraCalc = {quantity:string;value:number;unit:string;source:'derived';rule:string;inputPaths:string[]};
type Track = { ids:string[]; duration:number; reason:string; limit:number; path:string; pieces:PolynomialPiece[]; segments:TrackSegment[];
  events:TrackEvent[]; geometry:{start:number;value:TrackGeometry}[]; at:(age:number)=>Scalar; stringAt?:(age:number)=>StringState;
  pendulum?:ReturnType<typeof createPendulum>; pegPendulum?:PegPendulumResult; geometryPendulum?:NonNullable<BodyGeometry['pendulums']>[number]; extraCalcs?:ExtraCalc[] };
const scalar=(s:{xM:number;yM:number;vxMps:number;vyMps:number}):Scalar=>({...s,springCompressionM:0,status:s.vxMps===0&&s.vyMps===0?'resting':'moving'});

// 已校验的两物体阶段装配。校验和运动入口共用这一实现，服务端不另算接触公式。
export function solveHorizontal(plan:HorizontalPlan) {
  const defs=plan.bodies,ids=defs.map(b=>b.bodyId),g=plan.gravityMps2??0,[approach,collision,parallel]=plan.stages;
  const initial=(id:string)=>plan.initial.bodies.find(b=>b.bodyId===id)!;
  const isConveyor=approach.kind==='conveyor_belt';
  let preAt:(t:number)=>BodySnapshot;
  let tc:number, contactHappens:boolean;
  let stopTimes:[number,number]=[Infinity,Infinity];
  let conveyorStage:ConveyorApproach|undefined;
  let conveyorRun:ReturnType<typeof solveConveyorBelt>|undefined;
  let beltBodyId='', otherBodyId='';

  if(isConveyor){
    conveyorStage=approach;
    beltBodyId=approach.bodyId??plan.initial.bodies.find(b=>!b.constraint)?.bodyId??ids[0];
    otherBodyId=ids.find(id=>id!==beltBodyId)!;
    const beltInit=initial(beltBodyId), otherInit=initial(otherBodyId);
    conveyorRun=solveConveyorBelt(approach,beltInit.xM,beltInit.vxMps,g);
    const targetEdge=Math.abs(otherInit.xM)<1e-9?'start':'end';
    const startsAtBob=nearValue(beltInit.xM,otherInit.xM);
    contactHappens=startsAtBob||conveyorRun.exitEdge===targetEdge;
    tc=startsAtBob?0:conveyorRun.duration;
    if(!Number.isFinite(tc))throw new BodyPlanError('/stages/0','传送带未能在有限时间内完成运动，请检查带长或带速。');
    preAt=(t:number):BodySnapshot=>{
      const ct=Math.max(0,Math.min(conveyorRun!.duration,t));
      const bs=conveyorRun!.evalAt(ct);
      const beltResting=Math.abs(bs.vxMps)<1e-12&&conveyorRun!.stopped&&ct>=conveyorRun!.duration;
      const bodies:BodySnapshot['bodies']={
        [beltBodyId]:{...defs.find(d=>d.bodyId===beltBodyId)!,xM:bs.xM,yM:0,vxMps:bs.vxMps,vyMps:0,springCompressionM:0,status:beltResting?'resting':'moving'},
        [otherBodyId]:{...defs.find(d=>d.bodyId===otherBodyId)!,xM:otherInit.xM,yM:0,vxMps:0,vyMps:0,springCompressionM:0,status:'resting'},
      };
      const constraints:BodySnapshot['constraints']={};
      for(const b of plan.initial.bodies)if(b.constraint){const c=b.constraint,key='string:'+b.bodyId,s=bodies[b.bodyId];s.constraintId=key;constraints[key]={kind:'pendulum_string',constraintId:key,bodyIds:[b.bodyId],pivot:{xM:c.pivotXM,yM:c.lengthM},lengthM:c.lengthM,state:'taut',tensionN:s.massKg*(s.vxMps*s.vxMps/c.lengthM+g),angleDeg:0,angularVelocityRadps:s.vxMps/c.lengthM};}
      return {bodies,constraints};
    };
  }else{
    const mu=(id:string)=>approach.tracks.find(t=>t.bodyId===id)!.kineticFrictionCoefficient;
    const beforePieces=ids.map(id=>frictionPieces(initial(id).xM,initial(id).vxMps,mu(id)*g));
    preAt=(t:number):BodySnapshot=>{
      const bodies:BodySnapshot['bodies']=Object.fromEntries(defs.map((d,i)=>{const piece=beforePieces[i].find(p=>t>=p.start&&t<p.end)??beforePieces[i][beforePieces[i].length-1];return[d.bodyId,{...d,...scalar(polynomialAt(piece,t))}];}));
      const constraints:BodySnapshot['constraints']={};
      for(const b of plan.initial.bodies)if(b.constraint){const c=b.constraint,key='string:'+b.bodyId,s=bodies[b.bodyId];s.constraintId=key;constraints[key]={kind:'pendulum_string',constraintId:key,bodyIds:[b.bodyId],pivot:{xM:c.pivotXM,yM:c.lengthM},lengthM:c.lengthM,state:'taut',tensionN:s.massKg*(s.vxMps*s.vxMps/c.lengthM+g),angleDeg:0,angularVelocityRadps:s.vxMps/c.lengthM};}
      return {bodies,constraints};
    };
    const contact=firstIntersection(beforePieces[0],beforePieces[1],Infinity);
    stopTimes=ids.map((id,i)=>initial(id).vxMps===0?0:beforePieces[i][0].end) as [number,number];
    const horizon=approach.end.kind==='time_limit'?approach.end.durationSeconds:Math.max(...stopTimes);
    contactHappens=contact!==undefined&&(contact<=horizon||nearValue(contact,horizon));
    // 尚未接触而永不停止时不能捏造播放时长。
    if(!contactHappens&&!Number.isFinite(horizon))throw new BodyPlanError('/stages/0/end','没有有限接触或全体静止时刻，请给出观察时长。',true);
    tc=contactHappens?contact!:horizon;
  }
  if(!Number.isFinite(tc))throw new RangeError('水平接近时刻无法表示。');
  const preContact=preAt(tc),pair=collision?.bodyIds??ids as [string,string];
  const u1=preContact.bodies[pair[0]].vxMps,u2=preContact.bodies[pair[1]].vxMps;
  const n=(collision?.normalXM??Math.sign(initial(pair[1]).xM-initial(pair[0]).xM)) as 1|-1;
  if(contactHappens&&initial(pair[0]).xM===initial(pair[1]).xM&&(u1-u2)*n<=0)throw new BodyPlanError('/stages/1/normalXM','初始同点须明确沿法线接近，不能制造冲击。');
  const impact=contactHappens&&(u1-u2)*n>0&&!nearValue(u1,u2);
  let reason=contactHappens?impact?'prefix_end':'contact_without_impact':Object.values(preContact.bodies).every(b=>b.status==='resting')?'no_collision':'approach_range_end';
  let status:'complete'|'range_end'|'model_limit'=reason==='no_collision'?'complete':'range_end',duration=tc;
  const geometry:BodyGeometry&{blockSizeM:number;positionReference:'particle'}={blockSizeM:.3,positionReference:'particle',bodies:defs.map(b=>({...b})),bodyTracks:[],pendulums:[],...(conveyorRun?{conveyor:conveyorRun.geometry}:{})};
  const segments:{stageIndex:number;kind:'horizontal_approach'|'conveyor_belt'|BodyTrackStage['kind'];startSeconds:number;endSeconds:number;bodyIds:string[];stagePath:string}[]=[];
  const events:BodyEvent[]=[];
  const extraCalculations:ExtraCalc[]=[];
  function add(t:number,kind:string,index:number,path:string,owners:string[],before:BodySnapshot,after=before,values?:CollisionValues){events.push({timeSeconds:t,kind,stageIndex:index,stagePath:path,bodyIds:owners.slice(),before:structuredClone(before),after:structuredClone(after),...(values?{collision:values}:{})});}
  add(0,'release',0,'/stages/0',ids,preAt(0));
  if(isConveyor&&conveyorRun){
    if(tc>0)segments.push({stageIndex:0,kind:'conveyor_belt',startSeconds:0,endSeconds:tc,bodyIds:[beltBodyId],stagePath:'/stages/0'});
    for(const id of ids){
      if(initial(id).constraint){const c=initial(id).constraint!;geometry.pendulums!.push({constraintId:'string:'+id,bodyIds:[id],definitionStageIndex:0,pivot:{xM:c.pivotXM,yM:c.lengthM},lowestPoint:{xM:c.pivotXM,yM:0},lengthM:c.lengthM,initialPosition:{xM:initial(id).xM,yM:0}});}
    }
    for(const e of conveyorRun.events){
      if(e.time>0&&e.time<tc&&!nearValue(e.time,tc))add(e.time,e.kind,0,'/stages/0',[beltBodyId],preAt(e.time));
    }
  }else if(approach.kind==='horizontal_approach'){
    for(const [i,id]of ids.entries()){
      const inputIndex=approach.tracks.findIndex(t=>t.bodyId===id),path=`/stages/0/tracks/${inputIndex}`,end=Math.min(tc,stopTimes[i]);
      if(end>0)segments.push({stageIndex:0,kind:'horizontal_approach',startSeconds:0,endSeconds:end,bodyIds:[id],stagePath:path});
      geometry.bodyTracks!.push({bodyIds:[id],stagePath:path,horizontal:{start:{xM:initial(id).xM,yM:0},plannedEnd:contactHappens?{xM:preContact.bodies[id].xM,yM:0}:null}});
      if(initial(id).constraint){const c=initial(id).constraint!;geometry.pendulums!.push({constraintId:'string:'+id,bodyIds:[id],definitionStageIndex:0,pivot:{xM:c.pivotXM,yM:c.lengthM},lowestPoint:{xM:c.pivotXM,yM:0},lengthM:c.lengthM,initialPosition:{xM:initial(id).xM,yM:0}});}
    }
    for(const i of [0,1].sort((a,b)=>stopTimes[a]-stopTimes[b]))if(stopTimes[i]>0&&stopTimes[i]<=tc){add(stopTimes[i],'stop',0,`/stages/0/tracks/${approach.tracks.findIndex(t=>t.bodyId===ids[i])}`,[ids[i]],preAt(stopTimes[i]));}
  }
  if(contactHappens)add(tc,'contact',0,'/stages/0',ids,preContact);
  else if(reason==='approach_range_end')add(tc,'range_end',0,'/stages/0',ids,preContact);
  let tracks:Track[]=[],postStart=structuredClone(preContact),collisionValues:CollisionValues|undefined,postAge=0;
  const sticky=collision?.mode==='perfectly_inelastic',groupId=sticky?'group:'+pair.slice().sort().join(','):undefined;
  if(impact&&collision){
    const [m1,m2]=pair.map(id=>defs.find(b=>b.bodyId===id)!.massKg);
    let r:{v1:number;v2:number;energyBeforeJ:number;energyAfterJ:number;energyLostJ:number};
    if(collision.mode==='specified_post_velocity'){
      const kv=collision.knownPostVelocity!;
      const knownIndex=kv.bodyId===pair[0]?0:1;
      const spec=collide1DSpecifiedPostVelocity(m1,m2,u1,u2,n,knownIndex,kv.vxMps);
      if(spec.superElastic)throw new BodyPlanError('/stages/1/knownPostVelocity','题给碰后速度导致系统总动能增加，违反能量守恒。');
      if(spec.interpenetrating)throw new BodyPlanError('/stages/1/knownPostVelocity','题给碰后速度导致两物体碰后相互穿透。');
      r=spec;
      extraCalculations.push({
        quantity:'post_collision_speed',
        value:knownIndex===0?spec.v2:spec.v1,
        unit:'m/s',
        source:'derived',
        rule:'momentum_conservation',
        inputPaths:['/bodies','/stages/0','/stages/1/knownPostVelocity'],
      });
    }else{
      r=collide1D(m1,m2,u1,u2,collision.mode);
    }
    collisionValues={mode:collision.mode,normalXM:n,momentumBeforeKgMps:m1*u1+m2*u2,momentumAfterKgMps:m1*r.v1+m2*r.v2,energyBeforeJ:r.energyBeforeJ,energyAfterJ:r.energyAfterJ,energyLostJ:r.energyLostJ};
    const x=preContact.bodies[pair[0]].xM;
    for(const [i,id]of pair.entries()){postStart.bodies[id]={...postStart.bodies[id],xM:x,vxMps:i===0?r.v1:r.v2,status:(i===0?r.v1:r.v2)===0?'resting':'moving',...(groupId?{groupId}:{})};}
    // 碰后已有绳的质量/张力由实际组合ID重算，只保留一条约束。
    const constrained=pair.find(id=>initial(id).constraint);
    if(constrained){const c=initial(constrained).constraint!,owners=sticky?pair:[constrained],key='string:'+constrained,mass=owners.reduce((s,id)=>s+postStart.bodies[id].massKg,0),v=postStart.bodies[owners[0]].vxMps;
      postStart.constraints={[key]:{kind:'pendulum_string',constraintId:key,bodyIds:owners.slice(),pivot:{xM:c.pivotXM,yM:c.lengthM},lengthM:c.lengthM,state:'taut',tensionN:mass*(v*v/c.lengthM+g),angleDeg:0,angularVelocityRadps:v/c.lengthM}};
      for(const id of owners)postStart.bodies[id].constraintId=key;
    }
    reason='collision_complete';
    if(parallel){
      tracks=parallel.tracks.map((tr,i)=>makeTrack(tr.stages,tr.bodyIds,i));
      for(const tr of tracks)if(tr.extraCalcs)extraCalculations.push(...tr.extraCalcs);
      let age:number;
      let pegFallbackReason:string|undefined;
      if(parallel.end.kind==='pendulum_turn'){
        const tr=tracks.find(t=>t.ids.includes(parallel.end.kind==='pendulum_turn'?parallel.end.bodyId:''));
        age=tr?.pendulum?.firstTurn??Infinity;
        if(age===0||!Number.isFinite(age))throw new BodyPlanError('/stages/2/end','指定摆没有有限首转折。');
      }else if(parallel.end.kind==='pendulum_peg_top'){
        const tr=tracks.find(t=>t.ids.includes(parallel.end.kind==='pendulum_peg_top'?parallel.end.bodyId:''));
        const topT=tr?.pegPendulum?.pegTopTime??Infinity;
        if(Number.isFinite(topT)){age=topT;}
        else if(tr&&Number.isFinite(tr.limit)){age=tr.limit;}
        else if(tr?.pendulum&&Number.isFinite(tr.pendulum.firstTurn)&&tr.pendulum.firstTurn>0){age=tr.pendulum.firstTurn;pegFallbackReason='pendulum_first_turn';}
        else throw new BodyPlanError('/stages/2/end','指定摆无法到达钉子正上方最高点，且无有限松绳或转折终点。');
      }else{
        const finite=tracks.filter(t=>Number.isFinite(t.duration));
        if(!finite.length)throw new BodyPlanError('/stages/2/end','没有可确定共同范围的有限轨道。',true);
        age=Math.max(...finite.map(t=>t.duration));
        if(age===0&&tracks.some(t=>t.at(0).status!=='resting'))throw new BodyPlanError('/stages/2/end','仍有运动物体，请明确共同终点。',true);
      }
      const firstBoundary=Math.min(...tracks.map(t=>t.limit));
      if(firstBoundary<=age||nearValue(firstBoundary,age)){
        const boundary=tracks.find(t=>t.limit===firstBoundary)!;
        const coincident=tracks.filter(t=>nearValue(t.limit,firstBoundary));
        // 同刻保留各轨道事件，由绳约束边界或接地决定共同终止原因。
        const stringBoundary=coincident.find(t=>t.reason==='string_retaut_boundary'||t.reason==='string_slack');
        const landing=boundary.reason==='landed'?boundary:coincident.find(t=>t.reason==='landed');
        const endTrack=stringBoundary??landing??boundary;
        age=endTrack.limit;reason=endTrack.reason;status=reason==='string_retaut_boundary'?'model_limit':'range_end';
      }
      else reason=pegFallbackReason??(parallel.end.kind==='pendulum_turn'?'pendulum_first_turn':parallel.end.kind==='pendulum_peg_top'?'pendulum_peg_top':'stopped');
      const crossing=tracks.length===2?secondContact(tracks[0],tracks[1],age):undefined;
      if(crossing!==undefined&&(crossing<=age||nearValue(crossing,age))){
        if(!nearValue(crossing,age))age=crossing;
        reason='second_contact_boundary';status='model_limit';
      }
      postAge=age;duration=tc+age;
      if(age>0&&duration===tc)throw new RangeError('碰后时长不能与碰撞时刻区分。');
      if(reason==='stopped'){status=tracks.every(t=>t.at(age).status==='resting')?'complete':'range_end';if(status==='range_end')reason='prefix_end';}
      for(const tr of tracks){
        if(tr.geometryPendulum)geometry.pendulums=geometry.pendulums!.filter(p=>!tr.ids.some(id=>p.bodyIds.includes(id))).concat(tr.geometryPendulum);
        geometry.bodyTracks!.push(...tr.geometry.filter(v=>v.start<=age).map(v=>v.value));
        for(const s of tr.segments){const end=Math.min(s.endSeconds,age);if(end>s.startSeconds)segments.push({...s,startSeconds:tc+s.startSeconds,endSeconds:tc+end});}
      }
    }
    add(tc,'collision',1,'/stages/1',pair,preContact,postStart,collisionValues);
    if(parallel){
      const age=postAge,endKind=reason==='landed'?'land':reason==='pendulum_peg_top'?'pendulum_top':reason;
      const isEnd=(kind:string,time:number)=>Number(time===age&&kind===endKind);
      const all=tracks.flatMap((tr,i)=>tr.events
        .filter(e=>e.time<=age||nearValue(e.time,age))
        .map(e=>({tr,i,e,time:nearValue(e.time,age)?age:e.time})))
        .sort((a,b)=>a.time-b.time||isEnd(a.e.kind,a.time)-isEnd(b.e.kind,b.time)||a.i-b.i);
      for(const {tr,e,time}of all){const before=postSnapshot(time),after=postSnapshot(time);
        if(e.before)for(const id of tr.ids)Object.assign(before.bodies[id],e.before);
        if(e.after)for(const id of tr.ids)Object.assign(after.bodies[id],e.after);
        if(e.constraintBefore)before.constraints[e.constraintBefore.constraintId]=e.constraintBefore;
        if(e.constraintAfter)after.constraints[e.constraintAfter.constraintId]=e.constraintAfter;
        add(tc+time,e.kind,2,e.path,tr.ids,before,after);
      }
      if(reason==='second_contact_boundary')add(duration,'second_contact_boundary',2,'/stages/2',ids,postSnapshot(age));
      else if(!events.some(e=>e.timeSeconds===duration))add(duration,'range_end',2,'/stages/2',ids,postSnapshot(age));
    }
  }
  function postSnapshot(age:number):BodySnapshot{
    if(!tracks.length)return structuredClone(postStart);
    const s=structuredClone(postStart);s.constraints={};
    for(const tr of tracks){const value=tr.at(age),c=tr.stringAt?.(age);if(c)s.constraints[c.constraintId]=c;
      for(const id of tr.ids){delete s.bodies[id].constraintId;Object.assign(s.bodies[id],value);if(c)s.bodies[id].constraintId=c.constraintId;}}
    return s;
  }
  const snapshot=(t:number)=>impact&&collision&&t>=tc?postSnapshot(t===duration?postAge:t-tc):preAt(t);
  const finite=(s:BodySnapshot)=>Object.values(s.bodies).every(b=>[b.xM,b.yM,b.vxMps,b.vyMps,b.massKg].every(Number.isFinite))&&Object.values(s.constraints).every(c=>Number.isFinite(c.tensionN));
  if(!Number.isFinite(duration)||!finite(snapshot(duration))||events.some(e=>!finite(e.before)||!finite(e.after)))throw new RangeError('水平正碰数值量级无法表示。');
  return {geometry,segments,events,duration,reason,status,snapshot,initial:preAt(0),collisionValues,extraCalculations};

  function makeTrack(stages:BodyTrackStage[],owners:string[],i:number):Track{
    const path=`/stages/2/tracks/${i}/stages/0`,head=stages[0],start=postStart.bodies[owners[0]];
    if(head.kind==='conveyor_belt'){
      const postBelt=solveConveyorBelt(conveyorStage!,start.xM,start.vxMps,g);
      const trackEvents:TrackEvent[]=postBelt.events.map(e=>({time:e.time,kind:e.kind,path}));
      const atBelt=(age:number):Scalar=>{
        const ct=Math.max(0,Math.min(postBelt.duration,age));
        const s=postBelt.evalAt(ct);
        const resting=postBelt.stopped&&ct>=postBelt.duration&&Math.abs(s.vxMps)<1e-12;
        return{xM:s.xM,yM:0,vxMps:s.vxMps,vyMps:0,springCompressionM:0,status:resting?'resting':'moving'};
      };
      return{
        ids:owners,
        path,
        duration:postBelt.duration,
        reason:postBelt.exitEdge?'conveyor_exit':'stopped',
        limit:postBelt.exitEdge?postBelt.duration:Infinity,
        pieces:[],
        segments:postBelt.duration>0?[{stageIndex:2,stagePath:path,bodyIds:owners,kind:'conveyor_belt' as unknown as BodyTrackStage['kind'],startSeconds:0,endSeconds:postBelt.duration}]:[],
        events:trackEvents,
        geometry:[],
        at:atBelt,
      };
    }
    if(head.kind!=='pendulum_swing'){
      const tr=linearBodyTrack(stages,start,owners,i,g);
      const limit=Number.isFinite(tr.duration)&&tr.at(tr.duration).status!=='resting'?tr.duration:Infinity;
      return {...tr,ids:owners,path,limit};
    }
    const origin=initial(head.inheritFromBodyId!),c=origin.constraint!,mass=owners.reduce((s,id)=>s+postStart.bodies[id].massKg,0);
    if(!nearValue(start.xM,c.pivotXM))throw new BodyPlanError(path+'/inheritFromBodyId','碰后位置不在已有绳最低点。');
    const key='string:'+origin.bodyId;
    if(head.peg){
      let pegP:PegPendulumResult;
      try{
        pegP=createPegPendulum(c.lengthM,g,mass,start.vxMps,head.peg,!!head.slackContinuation);
      }catch(err){
        const code=err instanceof Error?err.message:'';
        if(code==='PENDULUM_CANNOT_REACH_PEG')throw new BodyPlanError(path+'/peg','碰后摆锤动能不足以摆至水平位置碰钉，无法反求临界钉距。');
        if(code==='PEG_NOT_NEEDED')throw new BodyPlanError(path+'/peg','碰后摆锤不碰钉即可完整过顶点，无需临界钉距。');
        if(code==='PEG_OFFSET_CONFLICT')throw new BodyPlanError(path+'/peg/offsetXM','题给钉距与临界不松弛条件矛盾。');
        throw err;
      }
      const translate=(s:ReturnType<typeof pegP.at>):Scalar=>({xM:s.xM+c.pivotXM,yM:s.yM,vxMps:s.vxMps,vyMps:s.vyMps,springCompressionM:0,status:s.status});
      const makeStringState=(v:ReturnType<typeof pegP.at>,pivotOffset:number,activeLen:number):StringState=>({
        kind:'pendulum_string',constraintId:key,bodyIds:owners.slice(),
        pivot:{xM:c.pivotXM+pivotOffset,yM:c.lengthM},lengthM:activeLen,
        state:v.stringState,tensionN:v.tensionN,
        ...(v.stringState==='taut'?{angleDeg:v.angleRad!*180/Math.PI,angularVelocityRadps:v.angularVelocityRadps}:{}),
      });
      const stringAt=(t:number):StringState=>makeStringState(pegP.at(t),pegP.pivotOffsetAt(t),pegP.activeLengthAt(t));
      const duration=head.end.kind==='scene_end'&&!pegP.equilibrium?Infinity:pegP.endTime(head.end.kind);
      const geometryPendulum={
        constraintId:key,bodyIds:owners.slice(),definitionStageIndex:0,
        pivot:{xM:c.pivotXM,yM:c.lengthM},lowestPoint:{xM:c.pivotXM,yM:0},lengthM:c.lengthM,initialPosition:{xM:origin.xM,yM:0},
        ...(pegP.pegOffsetXM>0?{peg:{xM:c.pivotXM+pegP.pegSideSign*pegP.pegOffsetXM,yM:c.lengthM,offsetXM:pegP.pegOffsetXM,effectiveLengthM:pegP.pegEffectiveLengthM}}:{}),
      };
      const extraCalcs:ExtraCalc[]=[];
      if(pegP.pegSpeedMps!=null)extraCalcs.push({quantity:'peg_contact_speed',value:pegP.pegSpeedMps,unit:'m/s',source:'derived',rule:'energy_conservation_to_horizontal',inputPaths:['/gravityMps2','/initial/bodies',path+'/peg']});
      if(pegP.derivedPegOffsetXM!=null){
        extraCalcs.push({quantity:'peg_min_offset',value:pegP.derivedPegOffsetXM,unit:'m',source:'derived',rule:'peg_top_non_slack_critical',inputPaths:['/gravityMps2','/initial/bodies',path+'/peg']});
        extraCalcs.push({quantity:'peg_effective_radius',value:pegP.pegEffectiveLengthM,unit:'m',source:'derived',rule:'peg_top_non_slack_critical',inputPaths:['/gravityMps2','/initial/bodies',path+'/peg']});
      }
      if(pegP.pegTopSpeedMps!=null)extraCalcs.push({quantity:'peg_top_speed',value:pegP.pegTopSpeedMps,unit:'m/s',source:'derived',rule:'peg_top_energy',inputPaths:['/gravityMps2','/initial/bodies',path+'/peg']});
      if(pegP.pegTopTensionN!=null)extraCalcs.push({quantity:'peg_top_tension',value:pegP.pegTopTensionN,unit:'N',source:'derived',rule:'peg_top_centripetal',inputPaths:['/bodies','/gravityMps2','/initial/bodies',path+'/peg']});

      const result:Track={ids:owners,path,duration,reason:pegP.limitKind,limit:pegP.limit,pieces:[],segments:[],events:[],geometry:[],at:t=>translate(pegP.at(t)),stringAt,pendulum:pegP,pegPendulum:pegP,geometryPendulum,extraCalcs};
      Object.defineProperty(result,'events',{get(){
        const age=Math.min(duration,globalAge());
        return[{time:0,kind:'pendulum_enter',path},...pegP.eventsUntil(age).map(e=>{
          const isPeg=e.kind==='peg_contact';
          const cBefore=isPeg?makeStringState(e.before,0,c.lengthM):undefined;
          const cAfter=isPeg?makeStringState(e.after,pegP.pegSideSign*pegP.pegOffsetXM,pegP.pegEffectiveLengthM):undefined;
          return{time:e.time,kind:e.kind,path,before:translate(e.before),after:translate(e.after),constraintBefore:cBefore,constraintAfter:cAfter};
        })];
      }});
      Object.defineProperty(result,'segments',{get(){const age=globalAge(),arc=Math.min(age,pegP.lossTime);return[...(arc>0&&!pegP.equilibrium?[{stageIndex:2,stagePath:path,bodyIds:owners,kind:'pendulum_swing' as const,startSeconds:0,endSeconds:arc}]:[]),...(age>pegP.lossTime?[{stageIndex:2,stagePath:path+'/slackContinuation',bodyIds:owners,kind:'projectile' as const,startSeconds:pegP.lossTime,endSeconds:age}]:[])];}});
      if(Number.isFinite(pegP.lossTime)){const s=translate(pegP.loss);result.pieces.push({start:pegP.lossTime,end:pegP.limit,x:s.xM,y:s.yM,vx:s.vxMps,vy:s.vyMps,ax:0,ay:-g});result.geometry.push({start:pegP.lossTime,value:{bodyIds:owners,stagePath:path+'/slackContinuation',projectile:{launch:{xM:s.xM,yM:s.yM}}}});}
      return result;
    }

    const p=createPendulum(c.lengthM,g,mass,0,start.vxMps,!!head.slackContinuation);
    const translate=(s:ReturnType<typeof p.at>):Scalar=>({xM:s.xM+c.pivotXM,yM:s.yM,vxMps:s.vxMps,vyMps:s.vyMps,springCompressionM:0,status:s.status});
    // 首转折合并到共同终点时，位置、速度与张力都取精确的转折状态。
    const samplePendulum=(age:number)=>p.at(age===globalAge()&&nearValue(p.firstTurn,age)?p.firstTurn:age);
    const stringAt=(t:number):StringState=>{const v=samplePendulum(t);return{kind:'pendulum_string',constraintId:key,bodyIds:owners.slice(),pivot:{xM:c.pivotXM,yM:c.lengthM},lengthM:c.lengthM,state:v.stringState,tensionN:v.tensionN,...(v.stringState==='taut'?{angleDeg:v.angleRad!*180/Math.PI,angularVelocityRadps:v.angularVelocityRadps}:{})};};
    const duration=head.end.kind==='scene_end'&&!p.equilibrium?Infinity:p.endTime(head.end.kind);
    const geometryPendulum={constraintId:key,bodyIds:owners.slice(),definitionStageIndex:0,pivot:{xM:c.pivotXM,yM:c.lengthM},lowestPoint:{xM:c.pivotXM,yM:0},lengthM:c.lengthM,initialPosition:{xM:origin.xM,yM:0}};
    // 事件仅在共同范围确定后填充，避免为scene_end无界生成无限事件。
    const result:Track={ids:owners,path,duration,reason:p.limitKind,limit:p.limit,pieces:p.equilibrium?[{start:0,end:Infinity,x:c.pivotXM,y:0,vx:0,vy:0,ax:0,ay:0}]:[],segments:[],events:[],geometry:[],at:t=>translate(samplePendulum(t)),stringAt,pendulum:p,geometryPendulum};
    Object.defineProperty(result,'events',{get(){
      const age=Math.min(duration,globalAge()),eventAge=nearValue(p.firstTurn,age)?Math.max(age,p.firstTurn):age;
      return[{time:0,kind:'pendulum_enter',path},...p.eventsUntil(eventAge).map(e=>({time:e.time,kind:e.kind,path,before:translate(e.before),after:translate(e.after)}))];
    }});
    Object.defineProperty(result,'segments',{get(){const age=globalAge(),arc=Math.min(age,p.lossTime);return[...(arc>0&&!p.equilibrium?[{stageIndex:2,stagePath:path,bodyIds:owners,kind:'pendulum_swing' as const,startSeconds:0,endSeconds:arc}]:[]),...(age>p.lossTime?[{stageIndex:2,stagePath:path+'/slackContinuation',bodyIds:owners,kind:'projectile' as const,startSeconds:p.lossTime,endSeconds:age}]:[])];}});
    if(Number.isFinite(p.lossTime)){const s=translate(p.loss);result.pieces.push({start:p.lossTime,end:p.limit,x:s.xM,y:s.yM,vx:s.vxMps,vy:s.vyMps,ax:0,ay:-g});result.geometry.push({start:p.lossTime,value:{bodyIds:owners,stagePath:path+'/slackContinuation',projectile:{launch:{xM:s.xM,yM:s.yM}}}});}
    return result;
  }
  function globalAge(){return postAge;}
  function secondContact(a:Track,b:Track,age:number){
    let found=firstIntersection(a.pieces,b.pieces,age,true);
    // 张紧摆与水平面仅可能在真实最低点相交，不按画布采样猜交点。
    for(const [p,other]of [[a,b],[b,a]] as const)if(p.pendulum&&!p.pendulum.equilibrium)for(const e of p.pendulum.eventsUntil(age))if(e.kind==='pendulum_lowest'&&e.time>0){const s=p.at(e.time),o=other.at(e.time);if(nearValue(s.xM,o.xM)&&nearValue(s.yM,o.yM)&&(found===undefined||e.time<found))found=e.time;}
    return found;
  }
}
