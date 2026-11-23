// 由 scripts/sync-functions.mjs 从 src/physics/horizontalPlan.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
import type { HorizontalPlan } from './horizontalTypes.ts';
import { solveHorizontal } from './horizontalDynamics.ts';
import { BodyPlanError } from './bodyPlanError.ts';
import type { StagePlanValidation } from './stagePlan.ts';
type Obj=Record<string,unknown>;
const obj=(x:unknown):x is Obj=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export type HorizontalValidationContext={
 missing:string[];errors:{path:string;code:string;message:string}[];
 issue:(path:string,code:string,message:string)=>void;
 num:(o:Obj,k:string,p:string,rule?:(n:number)=>boolean,required?:boolean)=>void;
 choice:(o:Obj,k:string,p:string,allowed:readonly unknown[])=>void;
 fact:(o:Obj,k:string,p:string)=>void;
 block:(o:Obj,k:string,p:string)=>Obj|null;
 ref:(value:unknown,path:string)=>void;
 bodyList:(o:Obj,k:string,p:string,required?:boolean)=>string[];
};
// 复用多物体入口的数值、类型、事实和ID检查器；叶阶段继续调用既有单物体校验。
export function validateHorizontalFields(draft:Obj,c:HorizontalValidationContext,legacy:(input:unknown)=>StagePlanValidation){
 const {missing,errors,issue,num,choice,fact,block,ref,bodyList}=c;
 const bodies=draft.bodies as Obj[],stages=draft.stages as unknown[];
 if(bodies.length!==2)issue('/bodies','PRECONDITION_CONFLICT','水平正碰需要两个物体。');
 const ids=bodies.filter(obj).map(b=>b.bodyId).filter((x):x is string=>typeof x==='string');
 const initial=block(draft,'initial','/initial');
 if(initial){
  if(['speedMps','tangentialSpeedMps','vxMps','vyMps'].some(k=>k in initial))issue('/initial','PRECONDITION_CONFLICT','两物体初态与旧速度形状互斥。');
  if(!Array.isArray(initial.bodies)){if(initial.bodies==null){initial.bodies=null;missing.push('/initial/bodies');}else issue('/initial/bodies','TYPE','初态物体表须为数组。');}
  else{
   const seen:unknown[]=[];
   initial.bodies.forEach((b,i)=>{const p=`/initial/bodies/${i}`;if(!obj(b)){issue(p,'TYPE','初态须为对象。');return;}
    ref(b.bodyId,p+'/bodyId');seen.push(b.bodyId);num(b,'xM',p+'/xM');num(b,'vxMps',p+'/vxMps');
    if('constraint'in b){const s=block(b,'constraint',p+'/constraint');if(s){choice(s,'kind',p+'/constraint/kind',['pendulum_string']);num(s,'pivotXM',p+'/constraint/pivotXM');num(s,'lengthM',p+'/constraint/lengthM',v=>v>0);choice(s,'initialStringState',p+'/constraint/initialStringState',['taut']);for(const key of ['pivotFixed','lightInextensibleString','airResistanceNegligible'])fact(s,key,p+'/constraint/'+key);
      if(typeof b.xM==='number'&&typeof s.pivotXM==='number'&&b.xM!==s.pivotXM)issue(p+'/constraint/pivotXM','PRECONDITION_CONFLICT','水平初态的绳约束物体须在最低点。');}}
   });
   if(seen.length!==2||new Set(seen).size!==seen.length||ids.some(id=>!seen.includes(id)))issue('/initial/bodies','PRECONDITION_CONFLICT','初态表须精确覆盖两个不同物体。');
   if(initial.bodies.filter(obj).filter(b=>obj(b.constraint)).length>1)issue('/initial/bodies','UNSUPPORTED','本增量最多一根已有绳。');
  }
 }
 const initials=initial&&Array.isArray(initial.bodies)?initial.bodies.filter(obj):[];
 const byId=(id:unknown)=>initials.find(b=>b.bodyId===id);
 for(const [i,s]of stages.entries()){
  const p=`/stages/${i}`;if(!obj(s)){issue(p,'TYPE','阶段须为对象。');continue;}
  choice(s,'kind',p+'/kind',i===0?['horizontal_approach']:i===1?['collision_1d']:['parallel_motion']);
  if(i>2)issue(p,'UNSUPPORTED','仅安排一次正碰及受控碰后轨道。');
  if(i===0){
   if(!Array.isArray(s.tracks)){if(s.tracks==null){s.tracks=null;missing.push(p+'/tracks');}else issue(p+'/tracks','TYPE','接近轨道须为数组。');}
   else{const owners:unknown[]=[];s.tracks.forEach((tr,j)=>{const tp=p+`/tracks/${j}`;if(!obj(tr)){issue(tp,'TYPE','轨道须为对象。');return;}ref(tr.bodyId,tp+'/bodyId');owners.push(tr.bodyId);num(tr,'kineticFrictionCoefficient',tp+'/kineticFrictionCoefficient',v=>v>=0);});if(owners.length!==2||new Set(owners).size!==2||ids.some(id=>!owners.includes(id)))issue(p+'/tracks','PRECONDITION_CONFLICT','接近轨道须精确覆盖两物体。');}
   const end=block(s,'end',p+'/end');if(end){choice(end,'kind',p+'/end/kind',['contact_or_rest','time_limit']);if(end.kind==='time_limit')num(end,'durationSeconds',p+'/end/durationSeconds',v=>v>0);}
  }
  if(i===1){
   const pair=bodyList(s,'bodyIds',p+'/bodyIds');if(pair.length!==2)issue(p+'/bodyIds','PRECONDITION_CONFLICT','碰撞须绑定两物体。');
   choice(s,'mode',p+'/mode',['elastic','perfectly_inelastic']);fact(s,'externalImpulseNegligible',p+'/externalImpulseNegligible');
   const contact=block(s,'contact',p+'/contact');if(contact){choice(contact,'kind',p+'/contact/kind',['horizontal_meeting']);num(contact,'approachStageIndex',p+'/contact/approachStageIndex',v=>v===0);if('pendulumStageIndex'in contact)issue(p+'/contact','PRECONDITION_CONFLICT','水平接触不能混用摆阶段引用。');}
   if('targetApproach'in s)issue(p+'/targetApproach','PRECONDITION_CONFLICT','两物体初态不使用摆的targetApproach。');
   const a=byId(pair[0]),b=byId(pair[1]);
   num(s,'normalXM',p+'/normalXM',v=>v===1||v===-1,!!a&&!!b&&typeof a.xM==='number'&&a.xM===b.xM);
   if(a&&b&&typeof a.xM==='number'&&typeof b.xM==='number'&&a.xM!==b.xM&&typeof s.normalXM==='number'&&s.normalXM!==Math.sign(b.xM-a.xM))issue(p+'/normalXM','PRECONDITION_CONFLICT','法线与题给初位方向冲突。');
  }
  if(i===2){
   const collision=obj(stages[1])?stages[1]:null,sticky=collision?.mode==='perfectly_inelastic';
   if(!Array.isArray(s.tracks)){if(s.tracks==null){s.tracks=null;missing.push(p+'/tracks');}else issue(p+'/tracks','TYPE','碰后轨道须为数组。');}
   else{
    const occupied:string[]=[];
    s.tracks.forEach((tr,j)=>{
     const tp=p+`/tracks/${j}`;if(!obj(tr)){issue(tp,'TYPE','轨道须为对象。');return;}
     const owners=bodyList(tr,'bodyIds',tp+'/bodyIds');occupied.push(...owners);
     if(sticky?owners.length!==2:owners.length!==1)issue(tp+'/bodyIds','PRECONDITION_CONFLICT',sticky?'粘连两ID须在同一轨道。':'弹性分离每条轨道一个ID。');
     if(!Array.isArray(tr.stages)){if(tr.stages==null){tr.stages=null;missing.push(tp+'/stages');}else issue(tp+'/stages','TYPE','轨道阶段须为数组。');return;}
     if(!tr.stages.length){missing.push(tp+'/stages');return;}
     const head=tr.stages[0];
     if(obj(head)&&head.kind!=null&&head.kind!=='pendulum_swing'&&owners.some(id=>obj(byId(id)?.constraint)))issue(tp+'/stages/0/kind','PRECONDITION_CONFLICT','题面已有张紧绳须由摆模块继承，不能直接丢绳进入自由轨道。');
     if(obj(head)&&head.kind==='pendulum_swing'){
      const hp=tp+'/stages/0';if(tr.stages.length!==1)issue(tp+'/stages','UNSUPPORTED','摆后自由段用slackContinuation表示。');
      ref(head.inheritFromBodyId,hp+'/inheritFromBodyId');
      if(typeof head.inheritFromBodyId==='string'){const source=byId(head.inheritFromBodyId);if(source&&!obj(source.constraint))issue(hp+'/inheritFromBodyId','PRECONDITION_CONFLICT','引用物体没有题给初态绳约束。');if(!owners.includes(head.inheritFromBodyId))issue(hp+'/inheritFromBodyId','PRECONDITION_CONFLICT','引用绳须属于该轨道物体。');}
      if(['inheritFromStageIndex','lengthM','initialAngleDeg','initialStringState'].some(k=>k in head))issue(hp,'PRECONDITION_CONFLICT','继承初态已有绳不能重复定义摆几何。');
      const end=block(head,'end',hp+'/end');if(end)choice(end,'kind',hp+'/end/kind',['scene_end','first_turn','first_return_lowest']);
      if('slackContinuation'in head){const sc=block(head,'slackContinuation',hp+'/slackContinuation');if(sc)choice(sc,'kind',hp+'/slackContinuation/kind',['free_flight_until_retaut']);}
     }else{
      const checked=legacy({kind:'stage_plan',schemaVersion:1,gravityMps2:draft.gravityMps2,initial:obj(head)&&head.kind==='projectile'?{vxMps:1,vyMps:0}:{speedMps:1},stages:tr.stages});
      if(!checked.ok){for(const m of checked.missingKeys)missing.push(m.replace(/^\/stages\//,tp+'/stages/'));for(const e of checked.fieldErrors){if(e.path==='/stages/0/end'&&obj(head)&&head.kineticFrictionCoefficient===0)continue;errors.push({...e,path:e.path.replace(/^\/stages\//,tp+'/stages/')});}}
      tr.stages=checked.ok?checked.reading.stages:checked.reading?.stages??tr.stages;
      (tr.stages as unknown[]).forEach((leaf,k)=>{const lp=tp+`/stages/${k}`;if(!obj(leaf))return;if(leaf.kind!=null&&!['horizontal_slide','projectile'].includes(String(leaf.kind)))issue(lp+'/kind','UNSUPPORTED','碰后直线轨道只接水平或抛体。');
       if(leaf.kind==='projectile'){
        if('dropHeightM'in leaf)issue(lp,'PRECONDITION_CONFLICT','两物体飞行使用固定landingPlaneYM。');num(leaf,'landingPlaneYM',lp+'/landingPlaneYM',v=>v<=0);
        if(k===0){if(leaf.supportAbsentAtStart==null){leaf.supportAbsentAtStart=null;missing.push(lp+'/supportAbsentAtStart');}else if(typeof leaf.supportAbsentAtStart!=='boolean')issue(lp+'/supportAbsentAtStart','TYPE','支撑事实须为布尔值。');else if(!leaf.supportAbsentAtStart)issue(lp+'/supportAbsentAtStart','PRECONDITION_CONFLICT','直接飞行与仍有支撑冲突。');const boundary=block(leaf,'supportBoundary',lp+'/supportBoundary');if(boundary){num(boundary,'edgeXM',lp+'/supportBoundary/edgeXM');choice(boundary,'supportedSide',lp+'/supportBoundary/supportedSide',['left','right']);}}
       }
       if(leaf.kind==='horizontal_slide'&&k===0){for(const id of owners){const constraint=byId(id)?.constraint;if(obj(constraint))issue(lp+'/kind','PRECONDITION_CONFLICT','已有绳物体碰后应继承绳约束。');}
        const first=obj(stages[0])?stages[0]:null,pre=first&&Array.isArray(first.tracks)?first.tracks.filter(obj):[];
        // 分离物体同面继续，或原路返程，沿用自己的摩擦。粘连共同μ须题给，不拼凑两份μ。
        if(!sticky&&owners.length===1){const original=pre.find(t=>t.bodyId===owners[0]);if(original&&typeof original.kineticFrictionCoefficient==='number'&&typeof leaf.kineticFrictionCoefficient==='number'&&original.kineticFrictionCoefficient!==leaf.kineticFrictionCoefficient)issue(lp+'/kineticFrictionCoefficient','PRECONDITION_CONFLICT','同一物体同面接续须沿用题给摩擦，本批不装配换面。');}}
      });
     }
    });
    if(occupied.length!==2||new Set(occupied).size!==2||ids.some(id=>!occupied.includes(id)))issue(p+'/tracks','PRECONDITION_CONFLICT','碰后轨道须覆盖两物体且不重复。');
   }
   const end=block(s,'end',p+'/end');if(end){choice(end,'kind',p+'/end/kind',['all_finite_tracks','pendulum_turn']);if(end.kind==='pendulum_turn'){ref(end.bodyId,p+'/end/bodyId');if(Array.isArray(s.tracks)&&!s.tracks.some(tr=>obj(tr)&&Array.isArray(tr.bodyIds)&&tr.bodyIds.includes(end.bodyId)&&Array.isArray(tr.stages)&&obj(tr.stages[0])&&tr.stages[0].kind==='pendulum_swing'))issue(p+'/end/bodyId','PRECONDITION_CONFLICT','首转折须引用实际摆轨道。');}}
  }
 }
 if(!missing.length&&!errors.length)try{
  const plan=draft as unknown as HorizontalPlan,solved=solveHorizontal(plan),tc=solved.events.find(e=>e.kind==='contact')?.timeSeconds;
  for(const [i,b]of plan.initial.bodies.entries())if(b.constraint&&b.vxMps!==0&&tc!==0)issue(`/initial/bodies/${i}/constraint`,'PRECONDITION_CONFLICT','固定张紧绳的物体不能先走一段水平直线。');
  const post=plan.stages[2];if(post&&tc!==undefined&&solved.events.some(e=>e.kind==='collision'))for(const [j,tr]of post.tracks.entries()){
   const h=tr.stages[0],p=`/stages/2/tracks/${j}/stages/0`;
   if(h.kind==='projectile'){
    const bound=h.supportBoundary!,sign=bound.supportedSide==='left'?1:-1,event=solved.events.find(e=>e.kind==='collision')!,body=event.after.bodies[tr.bodyIds[0]];
    if(!Number.isFinite(bound.edgeXM)||Math.abs(body.xM-bound.edgeXM)>32*Number.EPSILON*Math.max(1,Math.abs(body.xM)))issue(p+'/supportBoundary/edgeXM','PRECONDITION_CONFLICT','实际接触点不在题给桌沿。');
    if(body.vxMps*sign<0)issue(p+'/supportBoundary/supportedSide','PRECONDITION_CONFLICT','碰后速度仍指向有支撑侧。');
    for(const b of plan.initial.bodies)if((b.xM-bound.edgeXM)*sign>0)issue(p+'/supportBoundary','PRECONDITION_CONFLICT','预碰轨迹从无支撑侧开始，不能假装水平桌面。');
    for(const [k,other]of post.tracks.entries())if(other.stages[0].kind==='horizontal_slide'){
      const moving=event.after.bodies[other.bodyIds[0]];
      if((moving.xM-bound.edgeXM)*sign>=0&&moving.vxMps*sign>0)issue(`/stages/2/tracks/${k}/stages/0`,'PRECONDITION_CONFLICT','当前水平轨道会走进已明确无支撑的桌沿外侧，应使用实际飞行接续。');
    }
   }
  }
 }catch(error){if(error instanceof BodyPlanError){if(error.missing)missing.push(error.path);else issue(error.path,'PRECONDITION_CONFLICT',error.message);}else if(error instanceof RangeError)issue('/initial','RANGE',error.message);else throw error;}
}
