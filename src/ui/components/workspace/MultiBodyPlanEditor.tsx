import type { StagePlanDraft } from '../../../physics/stagePlan';
import type { FieldError } from '../../../types';
import { useRef, useState } from 'react';
import './multiBody.css';
type Obj=Record<string,unknown>;
const record=(v:unknown):Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const list=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
export function replacePlanValue(draft:StagePlanDraft,path:string,value:unknown):StagePlanDraft{
  const next=structuredClone(draft),keys=path.split('/').slice(1);let cur=next as unknown as Obj;
  keys.slice(0,-1).forEach((key,i)=>{if(cur[key]===null||typeof cur[key]!=='object')cur[key]=/^\d+$/.test(keys[i+1])?[]:{};cur=cur[key] as Obj;});if(value===undefined)delete cur[keys[keys.length-1]];else cur[keys[keys.length-1]]=value;return next;
}
export function renamePlanBody(draft:StagePlanDraft,index:number,value:string|null,previous?:string):StagePlanDraft{
  if(value&&draft.bodies?.some((b,i)=>i!==index&&b.bodyId===value))return structuredClone(draft);
  const old=draft.bodies?.[index]?.bodyId??previous,next=replacePlanValue(draft,`/bodies/${index}/bodyId`,value);
  if(value&&old&&old!==value){
    function visit(v:unknown){if(!v||typeof v!=='object')return;for(const[k,x]of Object.entries(v)){if(k==='bodyIds'&&Array.isArray(x))(v as Obj)[k]=x.map(id=>id===old?value:id);else if((k==='bodyId'||k==='inheritFromBodyId'||k==='blockBodyId'||k==='plankBodyId')&&x===old)(v as Obj)[k]=value;else visit(x);}}
    next.stages.forEach(visit);visit(next.initial);if(next.primaryBodyId===old)next.primaryBodyId=value;
  }return next;
}
export function MultiBodyPlanEditor({draft,onChange,missingKeys,fieldErrors}:{draft:StagePlanDraft;onChange:(p:StagePlanDraft)=>void;missingKeys:string[];fieldErrors:FieldError[]}){
  const root=draft as unknown as Obj,bodies=list(root.bodies),ids=bodies.map(b=>record(b).bodyId).filter((s):s is string=>typeof s==='string');
  const horizontal=draft.stages[0]?.kind==='horizontal_approach'||draft.stages[0]?.kind==='block_plank'||'bodies'in record(root.initial);
  const lastIds=useRef<Record<number,string>>({});bodies.forEach((b,i)=>{const id=record(b).bodyId;if(typeof id==='string'&&id)lastIds.current[i]=id;});
  const [idConflict,setIdConflict]=useState<number|null>(null);
  const get=(p:string)=>p.split('/').slice(1).reduce<unknown>((v,k)=>v!=null&&typeof v==='object'?(v as Obj)[k]:undefined,root);
  const error=(p:string)=>fieldErrors.find(e=>e.path===p||e.path===p.slice(0,p.lastIndexOf('/')))?.message;
  const invalid=(p:string)=>!!error(p)||missingKeys.some(k=>p===k||p.startsWith(k+'/'));
  const set=(p:string,v:unknown)=>onChange(replacePlanValue(draft,p,v));
  function number(p:string,label:string,unit:string,hint?:string){const value=get(p),message=error(p),id='body-field'+p.replace(/\W/g,'_');return <tr key={p} data-field-path={p}><td className="name">{label}{hint&&<span className="hint" id={id+'-hint'}>{hint}</span>}</td><td className="val"><input id={id} type="number" className={'num-input'+(invalid(p)?' invalid':'')} aria-label={label} aria-invalid={invalid(p)} aria-describedby={id+'-help'} data-field-path={p} value={typeof value==='number'&&Number.isFinite(value)?value:''} step="any" placeholder="待补" onChange={e=>set(p,e.target.value.trim()===''?null:Number(e.target.value))}/><span className="unit-tag">{unit}</span></td><td className="body-field-help" id={id+'-help'}>{message??(value==null?'待补':'')}{hint&&<span className="player-sr-only">{hint}</span>}</td></tr>;}
  function select(p:string,label:string,options:{value:unknown;label:string}[],change?:(v:unknown)=>void){const current=get(p)??(p.endsWith('/slackContinuation/kind')?'end_at_slack':undefined),id='body-field'+p.replace(/\W/g,'_');return <tr key={p} data-field-path={p}><td className="name"><label htmlFor={id}>{label}</label></td><td className="val"><select id={id} className={'stage-select'+(invalid(p)?' invalid':'')} aria-label={label} aria-invalid={invalid(p)} aria-describedby={id+'-help'} data-field-path={p} value={current==null?'':JSON.stringify(current)} onChange={e=>(change??(v=>set(p,v)))(e.target.value===''?null:JSON.parse(e.target.value))}><option value="">待确认</option>{current!=null&&!options.some(o=>o.value===current)&&<option value={JSON.stringify(current)}>未登记的取值</option>}{options.map(o=><option key={JSON.stringify(o.value)} value={JSON.stringify(o.value)}>{o.label}</option>)}</select></td><td className="body-field-help" id={id+'-help'}>{error(p)??(current==null?'待确认':'')}</td></tr>;}
  const choices=(pairs:[unknown,string][])=>pairs.map(([value,label])=>({value,label}));
  const facts=[{value:true,label:'是'},{value:false,label:'否'}];
  const ref=(p:string,label:string)=>select(p,label,ids.map(id=>({value:id,label:id})));
  function stage(s:Obj,path:string,owners:string[],index:number):React.ReactNode{
    const owner=owners.join(' + ')||'物体',kind=s.kind;
    return <section className="stage-editor-card" data-stage-path={path} key={path}><p className="body-stage-title">{owner} · {kind==='block_plank'?'滑块与可移动木板':kind==='horizontal_approach'?'水平接近':kind==='pendulum_swing'?'轻绳摆':kind==='horizontal_slide'?'水平滑动':kind==='projectile'?'抛体运动':kind==='collision_1d'?'水平正碰':'同步运动'}</p><table className="cond-table"><tbody>
      {kind==='block_plank'&&<>
        {ref(path+'/blockBodyId','滑块 ID')}
        {ref(path+'/plankBodyId','木板 ID')}
        {number(path+'/plankLengthM','木板长度 L','m')}
        {number(path+'/kineticFrictionCoefficient','块-板动摩擦因数 μₖ','')}
        {number(path+'/staticFrictionCoefficient','块-板静摩擦因数 μₛ','','共速后有外力且影响判定时必填，不默认等于 μₖ')}
        {select(path+'/groundFrictionless','光滑地面',facts)}
        <tr><td className="name">共速后外力</td><td className="val"><select className="stage-select" aria-label="共速后外力开关" value={s.postCommonForce!=null?'on':'off'} onChange={e=>set(path+'/postCommonForce',e.target.value==='on'?{blockForceXN:0,plankForceXN:0,durationSeconds:1}:undefined)}><option value="off">无外力</option><option value="on">施加恒定外力</option></select></td><td/></tr>
        {s.postCommonForce!=null&&<>
          {number(path+'/postCommonForce/blockForceXN','共速后块外力 F块','N')}
          {number(path+'/postCommonForce/plankForceXN','共速后板外力 F板','N')}
          {number(path+'/postCommonForce/durationSeconds','外力作用时长','s')}
        </>}
        {s.postCommonForce==null&&number(path+'/postCommonDurationSeconds','共速后继续观察时长','s','可选，留空则在共速处结束')}
      </>}
      {kind==null&&select(path+'/kind','待确认的运动阶段',choices(path.includes('/tracks/')?[['pendulum_swing','轻绳摆'],['horizontal_slide','水平滑动'],['projectile','抛体运动']]:horizontal&&index===0?[['horizontal_approach','水平接近']]:[['pendulum_swing','轻绳摆'],['collision_1d','正碰'],['parallel_motion','同时运动']]))}
      {kind==='horizontal_approach'&&<>
        {(list(s.tracks).length?list(s.tracks):ids.map(()=>({}))).map((tr,j)=><tr key={j}><td colSpan={3}><table className="cond-table"><tbody>{ref(path+`/tracks/${j}/bodyId`,`接近轨道${j+1} 物体 ID`)}{number(path+`/tracks/${j}/kineticFrictionCoefficient`,`${String(record(tr).bodyId??`轨道${j+1}`)} 接近摩擦 μ`,'')}</tbody></table></td></tr>)}
        {select(path+'/end/kind','接近阶段结束条件',choices([['contact_or_rest','实际接触或全体静止'],['time_limit','题给观察时长']]),v=>set(path+'/end',v==='time_limit'?{kind:v,durationSeconds:record(s.end).durationSeconds??null}:v?{kind:v}:null))}
        {record(s.end).kind==='time_limit'&&number(path+'/end/durationSeconds','接近观察时长','s')}
      </>}
      {kind==='pendulum_swing'&&<>
        {path===`/stages/${index}`&&(list(s.bodyIds).length?list(s.bodyIds):[null]).map((_id,j)=>ref(path+`/bodyIds/${j}`,j===0?'摆锤 ID':'粘连物体 ID'))}
        {horizontal?<>{ref(path+'/inheritFromBodyId','沿用题给绳的物体 ID')}<tr><td colSpan={3}>引用初态已有的绳，碰后速度由实际碰撞继承。</td></tr></>:'inheritFromStageIndex'in s?<>{select(path+'/inheritFromStageIndex','沿用摆绳',draft.stages.flatMap((st,i)=>i<index&&st.kind==='pendulum_swing'&&!('inheritFromStageIndex'in st)?[{value:i,label:`阶段${i+1}的摆绳`}]:[]))}<tr><td colSpan={3}>支点和绳长不变，初速取碰后真实速度。</td></tr></>:<>
          {number(path+'/lengthM','摆长 L','m')}{number(path+'/initialAngleDeg','初始角 θ','°','从竖直向下量起，左负右正。')}
          {select(path+'/initialStringState','释放时绳的条件',choices([['taut','题面确认绷紧'],['released_at_length','只确认距支点为绳长']]))}
          {select(path+'/pivotFixed','支点固定',facts)}{select(path+'/lightInextensibleString','轻且不可伸长的绳',facts)}{select(path+'/airResistanceNegligible','忽略空气阻力',facts)}
        </>}
        {select(path+'/end/kind',`${owner} 摆动范围`,choices(path.includes('/tracks/')?horizontal?[['scene_end','随其他物体到共同终点'],['first_turn','到首个转折'],['first_return_lowest','返回最低点']]:[['scene_end','随其他物体到共同终点']]:index===0?[['lowest_point','到最低点'],['first_turn','到首个转折'],['first_return_lowest','再次回到最低点']]:[['first_turn','到首个转折'],['first_return_lowest','返回最低点']]))}
        {select(path+'/slackContinuation/kind',`${owner} 松绳后`,choices([['end_at_slack','只播放到松绳'],['free_flight_until_retaut','自由飞行到再次张紧前']]),v=>set(path+'/slackContinuation',v==='free_flight_until_retaut'?{kind:v}:undefined))}
        <tr><td colSpan={3} className="body-note">未选择松绳后续时，只算到实际松绳处；再次张紧后尚未建模。</td></tr>
      </>}
      {kind==='horizontal_slide'&&<>
        {number(path+'/kineticFrictionCoefficient',`${owner} 动摩擦因数 μ`,'')}
        {select(path+'/end/kind',`${owner} 水平结束条件`,choices([['distance','指定距离 / 桌沿'],['stop','摩擦停止']]),v=>set(path+'/end',v==='distance'?{kind:v,distanceM:record(s.end).distanceM??null}:v?{kind:v}:null))}
        {record(s.end).kind==='distance'&&number(path+'/end/distanceM',`${owner} 距目标 / 桌沿`,'m')}
      </>}
      {kind==='projectile'&&<>{number(path+'/landingPlaneYM',`${owner} 落地平面 y`,'m',horizontal?'沿用题面世界坐标，不重置碰撞点。':'与摆最低点共用世界坐标。')}
        {horizontal&&path.endsWith('/stages/0')&&<>
          {select(path+'/supportAbsentAtStart',`${owner} 碰后初处无支撑`,facts)}
          {number(path+'/supportBoundary/edgeXM',`${owner} 桌沿世界 x`,'m')}
          {select(path+'/supportBoundary/supportedSide',`${owner} 桌沿支撑侧`,choices([['left','左侧有支撑'],['right','右侧有支撑']]))}
        </>}
      </>}
      {kind==='collision_1d'&&<>
        {ref(path+'/bodyIds/0',horizontal?'碰撞第一物体 ID':'碰撞摆锤 ID')}{ref(path+'/bodyIds/1',horizontal?'碰撞第二物体 ID':'碰撞目标 ID')}
        {horizontal?<>{select(path+'/contact/kind','接触来源',choices([['horizontal_meeting','由两条真实水平轨迹求接触']]))}{select(path+'/contact/approachStageIndex','引用接近阶段',[{value:0,label:'阶段1水平接近'}])}</>:select(path+'/contact/pendulumStageIndex','碰撞前的摆阶段',draft.stages.flatMap((st,i)=>i<index&&st.kind==='pendulum_swing'?[{value:i,label:`阶段${i+1}的最低点`}]:[]))}
        {select(path+'/mode','碰撞模式',choices([['elastic','弹性碰撞'],['perfectly_inelastic','完全非弹性（粘连）']]),v=>{
          let next=replacePlanValue(draft,path+'/mode',v);const pair=list(s.bodyIds),after=draft.stages[index+1];
          if(horizontal){
            if(after&&pair.length===2&&v){
              const constraint=list(record(root.initial).bodies).map(record).find(b=>b.constraint!=null),constrained=constraint?.bodyId;
              const track=(owners:unknown[])=>({bodyIds:owners,stages:constrained&&owners.includes(constrained)?[{kind:'pendulum_swing',inheritFromBodyId:constrained,end:{kind:'scene_end'}}]:[{kind:'horizontal_slide',kineticFrictionCoefficient:null,end:{kind:'distance',distanceM:null}}]});
              next=replacePlanValue(next,`/stages/${index+1}`,{kind:'parallel_motion',tracks:v==='perfectly_inelastic'?[track(pair)]:pair.map(id=>track([id])),end:null});
            }onChange(next);return;
          }
          if(after&&pair.length===2){
            const inherited=record(s.contact).pendulumStageIndex;
            if(v==='perfectly_inelastic')next=replacePlanValue(next,`/stages/${index+1}`,{kind:'pendulum_swing',bodyIds:pair,inheritFromStageIndex:inherited,end:{kind:'first_turn'}});
            else if(v==='elastic')next=replacePlanValue(next,`/stages/${index+1}`,{kind:'parallel_motion',tracks:[{bodyIds:[pair[0]],stages:[{kind:'pendulum_swing',inheritFromStageIndex:inherited,end:{kind:'scene_end'}}]},{bodyIds:[pair[1]],stages:[{kind:'horizontal_slide',kineticFrictionCoefficient:null,end:{kind:'stop'}}]}],end:{kind:'all_finite_tracks'}});
          }onChange(next);
        })}
        <tr><td colSpan={3} className="body-note">{horizontal?'切换模式会重建碰后轨道，请确认共同范围、摩擦与距离。法线可从不同初位推得；同点接触必须确认方向。':'切换模式会重建碰后范围：粘连先看到首转折；分离需确认目标摩擦。'}</td></tr>
        {horizontal?<>
          {select(path+'/normalXM','接触法线（同点须确认）',choices([[1,'第一物体指向第二物体：右'],[-1,'第一物体指向第二物体：左']]))}
          {'normalXM'in s&&<tr><td colSpan={3}><button type="button" onClick={()=>set(path+'/normalXM',undefined)}>从不同初位自动判定方向</button></td></tr>}
        </>:<>
        {select(path+'/normalXM','目标所在接触侧',choices([[1,'摆锤的右侧'],[-1,'摆锤的左侧']]))}
        {select(path+'/targetApproach/kind','目标碰前运动',choices([['uniform_horizontal','已知水平匀速 / 静止']]))}
        {number(path+'/targetApproach/velocityXMps','目标碰前水平速度','m/s','向右为正；题面静止填0。')}
        {select(path+'/targetApproach/endsAtContact','与摆锤在最低点同步接触',facts)}
        {'initialXM'in record(s.targetApproach)&&number(path+'/targetApproach/initialXM','题给目标初始 x','m')}
        </>}
        {select(path+'/externalImpulseNegligible','碰撞水平外冲量可忽略',facts)}
      </>}
      {kind==='parallel_motion'&&<>
        {select(path+'/end/kind','共同播放终点',choices([['all_finite_tracks',horizontal?'有限轨道完成或先到物理边界':'目标轨道完成，摆继续取样'],['pendulum_turn','明确看到摆锤首转折']]),v=>{const pend=list(s.tracks).map(record).find(tr=>list(tr.stages).some(st=>record(st).kind==='pendulum_swing'));set(path+'/end',v==='pendulum_turn'?{kind:v,bodyId:list(pend?.bodyIds)[0]??null}:v?{kind:v}:null);})}
        {record(s.end).kind==='pendulum_turn'&&ref(path+'/end/bodyId','结束时跟随的摆锤 ID')}
      </>}
    </tbody></table>
    {kind==='parallel_motion'&&list(s.tracks).map((track,j)=>{const tr=record(track),owners=list(tr.bodyIds).filter((v):v is string=>typeof v==='string');return <div className="body-track-editor" key={j}><table className="cond-table"><tbody>{list(tr.bodyIds).map((_id,k)=>ref(path+`/tracks/${j}/bodyIds/${k}`,`轨道${j+1} 物体${k+1} ID`))}</tbody></table>{list(tr.stages).map((leaf,k)=>stage(record(leaf),path+`/tracks/${j}/stages/${k}`,owners,index))}</div>;})}
    </section>;
  }
  const initial=record(root.initial),signed='tangentialSpeedMps'in initial;
  return <div className="body-plan-editor" data-testid="multi-body-plan-editor"><p className="section-label">物体与共享条件</p><table className="cond-table"><tbody>
    {bodies.map((b,i)=>{const p=`/bodies/${i}/bodyId`,name=`物体 ${i+1} ID`,htmlId=`body-id-${i}`;return <tr key={p} data-field-path={p}><td className="name"><label htmlFor={htmlId}>{name}</label></td><td className="val"><input className="num-input" id={htmlId} aria-label={name} data-field-path={p} aria-invalid={invalid(p)||idConflict===i} aria-describedby={htmlId+'-help'} value={typeof record(b).bodyId==='string'?String(record(b).bodyId):''} onChange={e=>{const value=e.target.value;if(value&&bodies.some((other,j)=>i!==j&&record(other).bodyId===value)){setIdConflict(i);return;}setIdConflict(null);onChange(renamePlanBody(draft,i,value||null,lastIds.current[i]));}}/></td><td className="body-field-help" id={htmlId+'-help'}>{idConflict===i?'ID已被占用，已保留原引用。':error(p)??(record(b).bodyId==null?'待补':'引用同步更新')}</td></tr>;})}
    {bodies.map((b,i)=>number(`/bodies/${i}/massKg`,`${String(record(b).bodyId??`物体${i+1}`)} 质量 m`,'kg'))}
    {number('/gravityMps2','重力加速度 g','m/s²')}{ref('/primaryBodyId','默认跟踪物体')}
    {!horizontal&&<><tr><td className="name"><label htmlFor="body-initial-mode">摆初态形式</label></td><td className="val"><select id="body-initial-mode" className="stage-select" value={signed?'signed':'rest'} onChange={e=>set('/initial',e.target.value==='signed'?{tangentialSpeedMps:initial.speedMps??null}:{speedMps:initial.tangentialSpeedMps===0?0:null})}><option value="rest">静止释放</option><option value="signed">最低点给定切向初速</option></select></td><td/></tr>
    {number(signed?'/initial/tangentialSpeedMps':'/initial/speedMps',signed?'初始切向速度 q₀':'释放初速 v₀','m/s',signed?'最低点向右为正。':'题面静止填0，非零改用切向初速。')}
    </>}
    {horizontal&&(list(initial.bodies).length?list(initial.bodies):ids.map(()=>({}))).map((b,i)=>{const value=record(b),id=String(value.bodyId??`物体${i+1}`),p=`/initial/bodies/${i}`;return <tr key={p}><td colSpan={3}><table className="cond-table"><tbody>
      {ref(p+'/bodyId',`初态${i+1} 物体 ID`)}{number(p+'/xM',`${id} 初始位置 x`,'m')}{number(p+'/vxMps',`${id} 初始水平速度`,'m/s','向右为正；静止填0。')}
      {('constraint'in value||missingKeys.some(k=>k.startsWith(p+'/constraint')))&&<>
        {select(p+'/constraint/kind',`${id} 已有约束`,choices([['pendulum_string','固定支点轻绳']]))}
        {number(p+'/constraint/pivotXM',`${id} 支点 x`,'m')}{number(p+'/constraint/lengthM',`${id} 已有绳长 L`,'m')}
        {select(p+'/constraint/initialStringState',`${id} 初态绳状态`,choices([['taut','题面确认张紧']]))}
        {select(p+'/constraint/pivotFixed',`${id} 支点固定`,facts)}{select(p+'/constraint/lightInextensibleString',`${id} 轻且不可伸长的绳`,facts)}{select(p+'/constraint/airResistanceNegligible',`${id} 忽略空气阻力`,facts)}
      </>}
    </tbody></table></td></tr>;})}
  </tbody></table><p className="section-label">有序阶段与同时运动</p>{draft.stages.map((s,i)=>stage(s,`/stages/${i}`,s.kind==='block_plank'?[s.blockBodyId,s.plankBodyId].filter((v):v is string=>typeof v==='string'):list(s.bodyIds).filter((v):v is string=>typeof v==='string'),i))}</div>;
}
