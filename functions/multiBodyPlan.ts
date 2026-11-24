// 由 scripts/sync-functions.mjs 从 src/physics/multiBodyPlan.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
import {validateHorizontalFields} from './horizontalPlan.ts';
import {validateBlockPlankFields} from './blockPlankPlan.ts';
import {validatePulleyFields} from './pulleyPlan.ts';
import type { StagePlanDraft, StagePlanValidation, ResolvedStagePlan, StageFieldError } from './stagePlan.ts';
import { createPendulum } from './pendulum.ts';
import { collide1D } from './collision.ts';

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v: unknown): unknown => Array.isArray(v) ? v.map(clone) : obj(v) ? Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)])) : v;
export function validateMultiBodyPlan(input: Obj, legacy: (v: unknown) => StagePlanValidation): StagePlanValidation {
  const missing: string[] = [], errors: StageFieldError[] = [];
  const draft = clone(input) as Obj;
  let structural = false;
  const issue = (path: string, code: string, message: string) => errors.push({path,code,message});
  const result = (): StagePlanValidation => {
    const damaged=structural||errors.some(e=>e.code==='TYPE'), unsupported=errors.some(e=>e.code==='UNSUPPORTED');
    if (!missing.length && !errors.length) return {ok:true,reading:draft as unknown as ResolvedStagePlan};
    return {ok:false,code:damaged?'INVALID_READING':unsupported?'UNSUPPORTED':errors.length?'INCONSISTENT_CONDITIONS':'NEEDS_INPUT',message:damaged?'阶段计划的字段类型损坏，请重新识别。':unsupported?'当前不支持标记的模块或接续。':errors.length?'请修正标记的条件。':'请补齐标记的物体或阶段条件。',reading:structural?null:draft as unknown as StagePlanDraft,missingKeys:[...new Set(missing)],fieldErrors:errors};
  };
  const num=(o:Obj,k:string,p:string,rule:(n:number)=>boolean=()=>true,required=true)=>{
    const v=o[k];if(v==null){if(required){o[k]=null;missing.push(p);}return;}
    if(typeof v!=='number'){o[k]=null;issue(p,'TYPE','需要SI单位数值。');}
    else if(!Number.isFinite(v)){o[k]=null;issue(p,'NOT_FINITE','数值须为有限数。');}
    else if(!rule(v))issue(p,'RANGE','数值超出该字段范围。');
  };
  const choice=(o:Obj,k:string,p:string,allowed:readonly unknown[])=>{if(o[k]==null){o[k]=null;missing.push(p);}else if(typeof o[k]!==typeof allowed[0])issue(p,'TYPE','枚举字段类型错误。');else if(!allowed.includes(o[k]))issue(p,'UNSUPPORTED','未登记的取值。');};
  const fact=(o:Obj,k:string,p:string)=>{if(o[k]==null){o[k]=null;missing.push(p);}else if(typeof o[k]!=='boolean')issue(p,'TYPE','事实须为布尔值。');else if(o[k]!==true)issue(p,'UNSUPPORTED','题面不满足该理想模型的前提。');};
  const block=(o:Obj,k:string,p:string):Obj|null=>{if(o[k]==null){o[k]=null;missing.push(p);return null;}if(!obj(o[k])){issue(p,'TYPE','需要对象。');return null;}return o[k] as Obj;};
  choice(draft,'kind','/kind',['stage_plan']);
  if(draft.schemaVersion==null)missing.push('/schemaVersion');else if(typeof draft.schemaVersion!=='number')issue('/schemaVersion','TYPE','版本号须为数字。');else if(draft.schemaVersion!==1)issue('/schemaVersion','UNSUPPORTED','仅支持版本1。');
  const blockPlank = Array.isArray(draft.stages) && draft.stages.some(s => obj(s) && s.kind === 'block_plank');
  const pulley = !blockPlank && Array.isArray(draft.stages) && draft.stages.some(s => obj(s) && s.kind === 'pulley_system');
  const horizontal = !blockPlank && !pulley && (Array.isArray(draft.stages) && draft.stages.some(s => obj(s) && s.kind === 'horizontal_approach') || obj(draft.initial) && 'bodies' in draft.initial);
  const usesGravity=(v:unknown):boolean=>Array.isArray(v)?v.some(usesGravity):obj(v)?v.kind==='projectile'||v.kind==='pendulum_swing'||v.kind==='pendulum_string'||typeof v.kineticFrictionCoefficient==='number'&&v.kineticFrictionCoefficient>0||Object.values(v).some(usesGravity):false;
  num(draft,'gravityMps2','/gravityMps2',v=>v>0,!horizontal||usesGravity(draft));
  if('massKg'in draft)issue('/massKg','PRECONDITION_CONFLICT','新摆计划的质量只取body表，请移除旧顶层质量。');
  if(!Array.isArray(draft.stages)){if(draft.stages==null)missing.push('/stages');else issue('/stages','TYPE','阶段列表须为数组。');structural=true;return result();}
  const stages=draft.stages as unknown[];
  if(!stages.length)missing.push('/stages');
  if(!Array.isArray(draft.bodies)){if(draft.bodies==null)missing.push('/bodies');else issue('/bodies','TYPE','物体表须为数组。');return result();}
  const bodies=draft.bodies as unknown[], ids=new Set<string>();
  if(!bodies.length)missing.push('/bodies');else if(bodies.length>2)issue('/bodies','UNSUPPORTED','本增量最多支持两个物体。');
  bodies.forEach((b,i)=>{
    const p=`/bodies/${i}`;if(!obj(b)){issue(p,'TYPE','物体须为对象。');return;}
    if(b.bodyId==null){b.bodyId=null;missing.push(p+'/bodyId');}
    else if(typeof b.bodyId!=='string')issue(p+'/bodyId','TYPE','物体ID须为字符串。');
    else{if(!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(b.bodyId))issue(p+'/bodyId','RANGE','ID格式不合法。');if(ids.has(b.bodyId))issue(p+'/bodyId','PRECONDITION_CONFLICT','物体ID不能重复。');ids.add(b.bodyId);}
    num(b,'massKg',p+'/massKg',v=>v>0);
  });
  const ref=(value:unknown,p:string)=>{if(value==null)missing.push(p);else if(typeof value!=='string')issue(p,'TYPE','物体引用须为字符串。');else if(ids.size===bodies.length&&!ids.has(value))issue(p,'PRECONDITION_CONFLICT','物体引用不存在。');};
  ref(draft.primaryBodyId,'/primaryBodyId');
  const bodyList=(o:Obj,k:string,p:string,required=true):string[]=>{
    if(o[k]==null){if(required){o[k]=null;missing.push(p);}return [];}
    if(!Array.isArray(o[k])){issue(p,'TYPE','物体引用列表须为数组。');return [];}
    const list=o[k] as unknown[];if(!list.length)missing.push(p);
    list.forEach((id,j)=>ref(id,p+'/'+j));
    if(new Set(list).size!==list.length)issue(p,'PRECONDITION_CONFLICT','同一轨道/碰撞不能重复引用物体。');
    return list.filter((v):v is string=>typeof v==='string');
  };
  if(blockPlank){validateBlockPlankFields(draft,{missing,errors,issue,num,choice,fact,block,ref});return result();}
  if(pulley){validatePulleyFields(draft,{missing,errors,issue,num,choice,fact,block,ref});return result();}
  if(horizontal){validateHorizontalFields(draft,{missing,errors,issue,num,choice,fact,block,ref,bodyList},legacy);return result();}
  const initial=block(draft,'initial','/initial');
  if(initial){
    const keys=['speedMps','tangentialSpeedMps','vxMps','vyMps'].filter(k=>k in initial);
    if(keys.length>1||keys.includes('vxMps')||keys.includes('vyMps'))issue('/initial','PRECONDITION_CONFLICT','摆初态只选择零标量速度或带符号切向速度。');
    const k='tangentialSpeedMps'in initial?'tangentialSpeedMps':'speedMps';num(initial,k,'/initial/'+k);
    if(k==='speedMps'&&typeof initial[k]==='number'&&initial[k]!==0)issue('/initial/speedMps','PRECONDITION_CONFLICT','非零摆初速须使用带符号tangentialSpeedMps。');
  }
  function pendulum(s:Obj,p:string,index:number,trackIds?:string[]) {
    if(!trackIds)bodyList(s,'bodyIds',p+'/bodyIds');
    const inherited='inheritFromStageIndex'in s;
    if(inherited){
      num(s,'inheritFromStageIndex',p+'/inheritFromStageIndex',v=>Number.isInteger(v)&&v>=0&&v<index);
      const r=s.inheritFromStageIndex;
      if(typeof r==='number'&&obj(stages[r])&&stages[r].kind!=null&&stages[r].kind!=='pendulum_swing')issue(p+'/inheritFromStageIndex','PRECONDITION_CONFLICT','应引用之前的摆几何。');
      if(typeof r==='number'&&r!==0)issue(p+'/inheritFromStageIndex','PRECONDITION_CONFLICT','本增量引用首段摆的固定几何。');
      if(['lengthM','initialAngleDeg','initialStringState','pivotFixed','lightInextensibleString','airResistanceNegligible'].some(k=>k in s))issue(p,'PRECONDITION_CONFLICT','继承摆与重复定义几何/初态互斥。');
    }else{
      num(s,'lengthM',p+'/lengthM',v=>v>0);num(s,'initialAngleDeg',p+'/initialAngleDeg',v=>v>-180&&v<180);
      choice(s,'initialStringState',p+'/initialStringState',['taut','released_at_length']);
      for(const k of ['pivotFixed','lightInextensibleString','airResistanceNegligible'])fact(s,k,p+'/'+k);
      if(index!==0)issue(p,'PRECONDITION_CONFLICT','碰后摆须继承已有绳几何。');
      if(Array.isArray(s.bodyIds)&&s.bodyIds.length!==1)issue(p+'/bodyIds','PRECONDITION_CONFLICT','初始摆只绑定一个物体。');
    }
    const end=block(s,'end',p+'/end');if(end)choice(end,'kind',p+'/end/kind',trackIds?['scene_end']:inherited?['first_turn','first_return_lowest']:['lowest_point','first_turn','first_return_lowest']);
    if('slackContinuation'in s){const c=block(s,'slackContinuation',p+'/slackContinuation');if(c)choice(c,'kind',p+'/slackContinuation/kind',['free_flight_until_retaut']);}
  }
  for(const [i,s] of stages.entries()) {
    const p=`/stages/${i}`;if(!obj(s)){issue(p,'TYPE','阶段须为对象。');continue;}
    if(s.kind==null){s.kind=null;missing.push(p+'/kind');continue;}
    if(typeof s.kind!=='string'){issue(p+'/kind','TYPE','阶段种类须为字符串。');continue;}
    if(s.kind==='pendulum_swing')pendulum(s,p,i);
    else if(s.kind==='collision_1d'){
      const bs=bodyList(s,'bodyIds',p+'/bodyIds');if(bs.length&&bs.length!==2)issue(p+'/bodyIds','PRECONDITION_CONFLICT','正碰需要两个不同物体。');
      choice(s,'mode',p+'/mode',['elastic','perfectly_inelastic']);num(s,'normalXM',p+'/normalXM',v=>v===1||v===-1);
      fact(s,'externalImpulseNegligible',p+'/externalImpulseNegligible');
      const contact=block(s,'contact',p+'/contact');if(contact){choice(contact,'kind',p+'/contact/kind',['pendulum_lowest']);num(contact,'pendulumStageIndex',p+'/contact/pendulumStageIndex',v=>Number.isInteger(v)&&v>=0&&v<i);if(typeof contact.pendulumStageIndex==='number'&&contact.pendulumStageIndex!==i-1)issue(p+'/contact/pendulumStageIndex','PRECONDITION_CONFLICT','碰撞须紧接到达最低点的摆段。');}
      const approach=block(s,'targetApproach',p+'/targetApproach');if(approach){choice(approach,'kind',p+'/targetApproach/kind',['uniform_horizontal']);num(approach,'velocityXMps',p+'/targetApproach/velocityXMps');fact(approach,'endsAtContact',p+'/targetApproach/endsAtContact');num(approach,'initialXM',p+'/targetApproach/initialXM',()=>true,false);}
      const prev=stages[i-1];if(obj(prev)&&prev.kind!=null&&(prev.kind!=='pendulum_swing'||(obj(prev.end)&&prev.end.kind!=null&&prev.end.kind!=='lowest_point')))issue(p+'/contact','PRECONDITION_CONFLICT','碰撞前的摆须以最低点结束。');
      if(obj(prev)&&Array.isArray(prev.bodyIds)&&bs.length&&prev.bodyIds[0]!==bs[0])issue(p+'/bodyIds/0','PRECONDITION_CONFLICT','第一物体须为前段摆锤。');
    }else if(s.kind==='parallel_motion'){
      if(!Array.isArray(s.tracks)){if(s.tracks==null)missing.push(p+'/tracks');else issue(p+'/tracks','TYPE','并行轨道须为数组。');}
      else{
        const occupied:string[]=[];
        if(!s.tracks.length)missing.push(p+'/tracks');
        s.tracks.forEach((tr,j)=>{
          const tp=p+`/tracks/${j}`;if(!obj(tr)){issue(tp,'TYPE','轨道须为对象。');return;}
          const bs=bodyList(tr,'bodyIds',tp+'/bodyIds');occupied.push(...bs);
          if(!Array.isArray(tr.stages)){if(tr.stages==null)missing.push(tp+'/stages');else issue(tp+'/stages','TYPE','轨道阶段须为数组。');return;}
          if(!tr.stages.length){missing.push(tp+'/stages');return;}
          const head=tr.stages[0];
          if(obj(head)&&head.kind==='pendulum_swing'){
            if(tr.stages.length!==1)issue(tp+'/stages','UNSUPPORTED','摆轨道的松绳接续用slackContinuation表示。');
            pendulum(head,tp+'/stages/0',i,bs);
          }else{
            const legacyStages=tr.stages.map(leaf=>obj(leaf)&&leaf.kind==='projectile'&&!('landingPlaneYM'in leaf)&&!('dropHeightM'in leaf)?{...leaf,landingPlaneYM:null}:leaf);
            const checked=legacy({kind:'stage_plan',schemaVersion:1,gravityMps2:draft.gravityMps2,initial:obj(head)&&head.kind==='projectile'?{vxMps:1,vyMps:0}:{speedMps:1},stages:legacyStages});
            if(!checked.ok){
              for(const m of checked.missingKeys)missing.push(m.startsWith('/stages/')?m.replace('/stages/',tp+'/stages/'):m);
              for(const e of checked.fieldErrors){
                // 初速度由碰撞继承，光滑停止的动态矛盾由后续真实速度核对。
                if(e.path==='/stages/0/end'&&obj(head)&&head.kineticFrictionCoefficient===0)continue;
                errors.push({...e,path:e.path.startsWith('/stages/')?e.path.replace('/stages/',tp+'/stages/'):e.path});
              }
            }
            const normalizedLeaves=checked.ok?checked.reading.stages:checked.reading?.stages??tr.stages;
            tr.stages=normalizedLeaves;
            for(const [k,leaf] of normalizedLeaves.entries()){
              const lp=tp+`/stages/${k}`;if(!obj(leaf))continue;
              if(leaf.kind!=null&&!['horizontal_slide','projectile'].includes(String(leaf.kind)))issue(lp+'/kind','UNSUPPORTED','目标轨道只接水平与抛体。');
              if(leaf.kind==='projectile'){if('dropHeightM'in leaf)issue(lp,'PRECONDITION_CONFLICT','多物体目标飞行使用固定landingPlaneYM。');num(leaf,'landingPlaneYM',lp+'/landingPlaneYM');if(typeof leaf.landingPlaneYM==='number'&&leaf.landingPlaneYM>0)issue(lp+'/landingPlaneYM','PRECONDITION_CONFLICT','目标从最低点水平发射，地面不能高于其发射点。');}
            }
          }
        });
        if(new Set(occupied).size!==occupied.length)issue(p+'/tracks','PRECONDITION_CONFLICT','物体不能重复占用两条轨道。');
        if(ids.size===bodies.length&&occupied.length&&[...ids].some(id=>!occupied.includes(id)))issue(p+'/tracks','PRECONDITION_CONFLICT','碰后轨道不能遗漏物体。');
      }
      const end=block(s,'end',p+'/end');if(end){choice(end,'kind',p+'/end/kind',['all_finite_tracks','pendulum_turn']);if(end.kind==='pendulum_turn')ref(end.bodyId,p+'/end/bodyId');}
    }else issue(p+'/kind','UNSUPPORTED','新摆计划中未登记的顶层阶段。');
    if(i===0&&s.kind!=='pendulum_swing')issue(p+'/kind','PRECONDITION_CONFLICT','新摆计划以显式摆定义开始。');
    if(i>2)issue(p,'UNSUPPORTED','本增量只安排一次最低点正碰及碰后受控轨道。');
  }
  const first=obj(stages[0])?stages[0]:null, collision=obj(stages[1])&&stages[1].kind==='collision_1d'?stages[1]:null;
  if(stages.length>1&&obj(stages[1])&&stages[1].kind!=null&&!collision)issue('/stages/1/kind','PRECONDITION_CONFLICT','独立摆或最低点正碰接续，请保留明确结构。');
  if(collision&&obj(stages[2])){
    const post=stages[2],bs=collision.bodyIds;
    if(collision.mode==='elastic'&&post.kind!=null&&post.kind!=='parallel_motion')issue('/stages/2/kind','PRECONDITION_CONFLICT','弹性分离后两物体需按并行轨道接续。');
    if(collision.mode==='perfectly_inelastic'&&Array.isArray(bs)){
      const groups=post.kind==='parallel_motion'&&Array.isArray(post.tracks)?post.tracks.filter(obj).map(t=>t.bodyIds):[post.bodyIds];
      if(groups.some(x=>!Array.isArray(x)||x.length!==2||bs.some(id=>!x.includes(id))))issue('/stages/2','PRECONDITION_CONFLICT','粘连后必须将两个ID保留在同一绳轨道。');
    }
    if(post.kind==='parallel_motion'&&Array.isArray(post.tracks)&&Array.isArray(bs)){
      for(const [j,tr]of post.tracks.entries()){
        if(!obj(tr)||!Array.isArray(tr.bodyIds)||!Array.isArray(tr.stages))continue;
        const h=tr.stages[0],p=`/stages/2/tracks/${j}`;
        if(obj(h)&&h.kind!=null){
          if(tr.bodyIds.includes(bs[0])&&h.kind!=='pendulum_swing')issue(p+'/stages/0/kind','PRECONDITION_CONFLICT','原摆锤必须继承原绳，不能被换成目标滑动轨道。');
          if(collision.mode==='elastic'&&tr.bodyIds.includes(bs[1])&&h.kind==='pendulum_swing')issue(p+'/bodyIds','PRECONDITION_CONFLICT','弹性分离的目标不受原摆绳约束。');
        }
      }
      const end=post.end;
      if(obj(end)&&end.kind==='pendulum_turn'&&typeof end.bodyId==='string'&&!post.tracks.some(tr=>obj(tr)&&Array.isArray(tr.bodyIds)&&tr.bodyIds.includes(end.bodyId)&&Array.isArray(tr.stages)&&obj(tr.stages[0])&&tr.stages[0].kind==='pendulum_swing'))issue('/stages/2/end/bodyId','PRECONDITION_CONFLICT','转折结束条件须引用实际摆轨道的物体。');
    }
  }
  if(bodies.length===2&&stages.length===1)missing.push('/stages/1');
  // 质量不影响摆的运动学时刻；只有所有质量已知时才核对碰后量，不补写任何缺失质量。
  if(first?.kind==='pendulum_swing'&&initial&&typeof first.lengthM==='number'&&first.lengthM>0&&typeof first.initialAngleDeg==='number'&&Math.abs(first.initialAngleDeg)<180&&typeof draft.gravityMps2==='number'&&draft.gravityMps2>0){
    const q=typeof initial.tangentialSpeedMps==='number'?initial.tangentialSpeedMps:initial.speedMps===0?0:null;
    if(q!==null){
      if(q!==0&&first.initialAngleDeg!==0)issue('/initial','UNSUPPORTED','本增量的非零摆初速从最低点开始。');
      else try{
        const trajectory=createPendulum(first.lengthM,draft.gravityMps2,1,first.initialAngleDeg*Math.PI/180,q,obj(first.slackContinuation));
        if(first.initialStringState==='taut'&&trajectory.initiallySlack)issue('/stages/0/initialStringState','PRECONDITION_CONFLICT','所需张力为负，轻绳无法保持该张紧初态。');
        const end=obj(first.end)?first.end.kind:null;
        if(end==='first_turn'&&!Number.isFinite(trajectory.endTime('first_turn')))issue('/stages/0/end','PRECONDITION_CONFLICT','该能量持续绕行，不存在首个转折，请选择返回最低点等实际终点。');
        if(collision&&obj(collision.targetApproach)){
          const tc=trajectory.firstLowest,u1=trajectory.at(tc).vxMps,u2=collision.targetApproach.velocityXMps;
          if(!Number.isFinite(tc))issue('/stages/1/contact','PRECONDITION_CONFLICT','当前摆无法按张紧路径到达约定碰撞点。');
          else if(typeof u2==='number'){
            if(typeof collision.normalXM==='number'&&(u1-u2)*collision.normalXM<=0)issue('/stages/1/targetApproach/velocityXMps','PRECONDITION_CONFLICT','碰前相对速度并非沿接触法线接近。');
            const x=collision.targetApproach.initialXM;
            if(typeof x==='number'&&Math.abs(x+u2*tc)>1e-6*Math.max(1,Math.abs(x),Math.abs(u2*tc)))issue('/stages/1/targetApproach/initialXM','PRECONDITION_CONFLICT','给定初位与最低点同步到达不相容。');
            if(Array.isArray(collision.bodyIds)){
              const masses=collision.bodyIds.map(id=>bodies.find(b=>obj(b)&&b.bodyId===id)).map(b=>obj(b)?b.massKg:undefined);
              if(masses.every((m):m is number=>typeof m==='number'&&m>0)&&['elastic','perfectly_inelastic'].includes(String(collision.mode)))collide1D(masses[0],masses[1],u1,u2,collision.mode as 'elastic'|'perfectly_inelastic');
            }
          }
        }
      }catch(error){if(error instanceof RangeError)issue('/initial','RANGE',error.message);else throw error;}
    }
  }
  return result();
}
