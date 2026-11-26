import { describe, expect, it } from 'vitest';
import { assembleScene, buildMotion, validateStagePlan } from '../index';
import type { StageMotion } from '../index';
import elastic from '../../../fixtures/pendulum-elastic.reading.json';
import sticky from '../../../fixtures/pendulum-sticky.reading.json';
import unequal from '../../../fixtures/pendulum-unequal.reading.json';
import moving from '../../../fixtures/pendulum-moving-target.reading.json';
import alone from '../../../fixtures/pendulum-alone.reading.json';
import flight from '../../../fixtures/pendulum-target-projectile.reading.json';
import slack from '../../../fixtures/pendulum-slack.reading.json';
import initialSlack from '../../../fixtures/pendulum-initial-slack.reading.json';
import follower from '../../../fixtures/pendulum-scene-end.reading.json';
import ref from '../../../fixtures/pendulum-collision.acceptance.json';

function motion(p:unknown):StageMotion {const a=assembleScene(p);if(!a.ok)throw Error(JSON.stringify(a));const b=buildMotion(a.scene);if(!b.ok)throw Error(JSON.stringify(b));if(!('stage_scene'===('kind'in a.scene?a.scene.kind:'')))throw Error('场景类型错误');return b.motion as StageMotion;}
const clone=<T,>(v:T)=>structuredClone(v);
function state(actual:Record<string,unknown>,expected:Record<string,number>){for(const[k,v]of Object.entries(expected))expect(actual[k],k).toBeCloseTo(v,8);}
describe('多物体装配、统一时钟和事件',()=>{
  it.each([['elastic',elastic,ref.elastic.durationSeconds],['sticky',sticky,ref.sticky.durationSeconds],['unequal',unequal,ref.unequal.targetStopTimeSeconds],['moving',moving,ref.elastic.durationSeconds],['alone',alone,ref.alone.durationSeconds],['target-flight',flight,ref.targetProjectile.durationSeconds],['slack',slack,ref.slack.retautTimeSeconds],['initial-slack',initialSlack,ref.initialSlack.retautTimeSeconds]] as const)('%s经正式入口计算真实时长',(_name,p,t)=>{const m=motion(p);expect(m.durationSeconds).toBeCloseTo(t,8);expect(m.termination.reason).toBe(m.endReason);expect(m.sampleAt(Infinity)).toEqual(m.sampleAt(m.durationSeconds));expect(m.sampleAt(NaN)).toEqual(m.sampleAt(0));expect(m.segments.every(s=>s.endSeconds>s.startSeconds&&s.stagePath&&s.bodyIds?.length)).toBe(true);});
  it.each([['elastic',elastic,0,Math.sqrt(10),10],['sticky',sticky,Math.sqrt(10)/2,Math.sqrt(10)/2,25],['unequal',unequal,-Math.sqrt(10)/2,Math.sqrt(10)/2,12.5],['moving',moving,-1,Math.sqrt(10),11]] as const)('%s碰撞t−ε/t/t+ε两物体原子更新',(_name,p,v1,v2,tension)=>{
    const m=motion(p),event=m.events.find(e=>e.kind==='collision')!,t=event.timeSeconds,eps=1e-7;
    const before=m.sampleAt(t-eps),at=m.sampleAt(t),after=m.sampleAt(t+eps);
    expect(before.bodies!.bob.vxMps).toBeGreaterThan(3.16);expect(at.bodies!.bob.vxMps).toBeCloseTo(v1,12);expect(at.bodies!.target.vxMps).toBeCloseTo(v2,12);
    expect(at.constraints!['string:bob'].tensionN).toBeCloseTo(tension,10);expect(after.bodies!.bob.vxMps).toBeCloseTo(v1,5);
    expect(event.bodyStatesBefore!.bob.vxMps).toBeCloseTo(Math.sqrt(10),12);expect(event.bodyStatesAfter!.target.vxMps).toBeCloseTo(v2,12);
    expect(event.constraintsBefore!['string:bob'].tensionN).toBeCloseTo(20,10);expect(event.constraintsAfter!['string:bob'].tensionN).toBeCloseTo(tension,10);
    const low=m.events.find(e=>e.kind==='pendulum_lowest')!;expect(low.timeSeconds).toBe(t);expect(low.order).toBeLessThan(event.order);
    for(const id of ['bob','target']){expect(at.bodies![id].xM).toBe(0);expect(at.bodies![id].yM).toBe(0);expect(before.bodies![id].xM).toBeCloseTo(0,5);}
  });
  it('粘连保留两个ID、同位置速度及唯一总张力',()=>{
    const m=motion(sticky),s=m.sampleAt(m.durationSeconds);expect(s.bodies!.bob.groupId).toBe('group:bob,target');
    for(const k of ['xM','yM','vxMps','vyMps']as const)expect(s.bodies!.bob[k]).toBe(s.bodies!.target[k]);
    state(s.bodies!.bob,{...ref.sticky.position,vxMps:0,vyMps:0});expect(s.bodies!.bob.status).toBe('turning');expect(s.constraints!['string:bob'].tensionN).toBeCloseTo(17.5,10);expect(Object.keys(s.constraints!)).toHaveLength(1);expect(m.motionStatus?.state).toBe('range_end');
  });
  it('目标停下而摆仍运动保留range_end及转折后的真实末态',()=>{
    const m=motion(unequal),end=m.sampleAt(m.durationSeconds),turn=m.events.find(e=>e.stageIndex===2&&e.kind==='pendulum_turn')!;
    expect(turn.timeSeconds).toBeLessThan(m.durationSeconds);state(end.bodies!.bob,ref.unequal.bobAtTargetStop);expect(end.bodies!.target.status).toBe('resting');expect(end.bodies!.bob.status).toBe('moving');expect(m.endReason).toBe('prefix_end');expect(m.motionStatus?.state).toBe('range_end');expect(m.events[m.events.length-1]?.kind).toBe('stop');
  });
  it('目标飞行期间摆继续反向、落地精确状态标landed',()=>{
    const m=motion(flight),end=m.sampleAt(m.durationSeconds);state(end.bodies!.target,ref.targetProjectile.targetFinal);state(end.bodies!.bob,ref.targetProjectile.bobAtLanding);expect(end.bodies!.target.status).toBe('landed');expect(end.bodies!.bob.status).toBe('moving');expect(m.endReason).toBe('landed');expect(m.motionStatus?.state).toBe('range_end');
    const launch=m.events.find(e=>e.kind==='leave_table')!;expect(launch.stagePath).toBe('/stages/2/tracks/1/stages/1');expect(m.sampleAt(launch.timeSeconds+1e-7).bodies!.target.yM).toBeLessThan(0);
  });
  it('仅明确要求首转折才提前结束整个并行范围',()=>{const p=clone(unequal);p.stages[2].end={kind:'pendulum_turn',bodyId:'bob'} as typeof p.stages[2]['end'];const m=motion(p);expect(m.durationSeconds).toBeCloseTo(ref.unequal.bobTurnTimeSeconds,8);expect(m.sampleAt(Infinity).bodies!.target.vxMps).toBeGreaterThan(0);expect(m.events.some(e=>e.kind==='stop')).toBe(false);});
  it.each([-1,1])('目标落地与摆锤首转折相差几个浮点单位时保留两项 (%s)',offset=>{
    const base=motion(follower),collision=base.events.find(e=>e.kind==='collision')!;
    const age=base.durationSeconds-collision.timeSeconds;
    const p={...follower,stages:[...follower.stages.slice(0,2),{
      ...follower.stages[2],tracks:[follower.stages[2].tracks![0],{
        bodyIds:['target'],stages:[{kind:'projectile',landingPlaneYM:-5*age**2*(1+offset*4*Number.EPSILON)}],
      }],
    }]};
    const m=motion(p);
    expect(m.events.filter(e=>e.timeSeconds===m.durationSeconds).map(e=>e.kind)).toEqual(['pendulum_turn','land']);
    expect(m.sampleAt(Infinity).bodies!.target.status).toBe('landed');
    expect(m.sampleAt(Infinity).bodies!.bob.status).toBe('turning');
  });
  it('目标预碰位置来自真实带符号匀速前提，物体表次序不改变绑定',()=>{const p=clone(moving);p.bodies.reverse();const m=motion(p);expect(m.sampleAt(0).bodies!.target.xM).toBeCloseTo(ref.movingTarget.initialXM,10);expect(m.sampleAt(0).bodies!.target.vxMps).toBe(-1);expect(m.sampleAt(m.events.find(e=>e.kind==='collision')!.timeSeconds).bodies!.target.vxMps).toBeCloseTo(Math.sqrt(10),10);});
  it('切换主物体只改变兼容投影，不交换ID和物理状态',()=>{const p=clone(unequal);p.primaryBodyId='target';const a=motion(unequal),b=motion(p),t=.8;expect(a.sampleAt(t).bodies).toEqual(b.sampleAt(t).bodies);expect(b.sampleAt(t).xM).toBe(b.sampleAt(t).bodies!.target.xM);});
  it('松绳事件后无圆周约束力，无地面时不造land',()=>{const m=motion(slack),loss=m.events.find(e=>e.kind==='string_slack')!,t=loss.timeSeconds;expect(m.sampleAt(t-1e-7).constraints!['string:bob'].state).toBe('taut');expect(m.sampleAt(t).constraints!['string:bob'].state).toBe('slack');expect(loss.constraintsBefore!['string:bob'].state).toBe('taut');expect(loss.constraintsAfter!['string:bob'].tensionN).toBe(0);expect(m.geometry.bodyTracks?.find(t=>t.projectile)?.projectile?.landingPlane).toBeUndefined();expect(m.events.some(e=>e.kind==='land')).toBe(false);expect(m.sampleAt(Infinity).bodies!.bob.status).toBe('model_boundary');expect(m.motionStatus?.state).toBe('model_limit');});
  it('初始松绳没有入摆事件或张紧运动段',()=>{const m=motion(initialSlack);expect(m.events.map(e=>e.kind)).toEqual(['release','string_slack','projectile_launch','string_retaut_boundary']);expect(m.segments.every(s=>s.kind==='projectile')).toBe(true);expect(m.sampleAt(0).bodies!.bob.status).toBe('moving');});
  it('碰后松绳模型边界截断两物体真实范围，不生成未来目标停止',()=>{const p=clone(elastic) as any;p.stages[1].targetApproach.velocityXMps=-Math.sqrt(30);p.stages[2].tracks[0].stages[0].slackContinuation={kind:'free_flight_until_retaut'};const m=motion(p);expect(m.durationSeconds).toBeCloseTo(ref.collisionTimeSeconds+ref.slack.retautTimeSeconds,8);expect(m.events.some(e=>e.kind==='stop')).toBe(false);expect(m.sampleAt(Infinity).bodies!.target.vxMps).toBeGreaterThan(0);expect(m.motionStatus?.state).toBe('model_limit');});
  it('未给碰后轨道时只返回碰撞前缀，仍保留双方碰后速度',()=>{const p={...elastic,stages:elastic.stages.slice(0,2)},m=motion(p);expect(m.endReason).toBe('collision_complete');expect(m.sampleAt(Infinity).bodies!.target.vxMps).toBeCloseTo(Math.sqrt(10),10);expect(m.events[m.events.length-1]?.kind).toBe('collision');});
  it('粘连返回最低点前缀保留反向速度及正确范围原因',()=>{const p=clone(sticky);p.stages[2].end!.kind='first_return_lowest';const m=motion(p);expect(m.events[m.events.length-1].kind).toBe('pendulum_lowest');expect(m.sampleAt(Infinity).vxMps).toBeLessThan(0);expect(m.endReason).toBe('prefix_end');expect(m.motionStatus?.state).toBe('range_end');});
});

describe('多物体共享校验与可补草稿',()=>{
  it('只缺目标质量只补该路径即可通过，未猜质量',()=>{const p=clone(elastic) as unknown as Record<string,any>;p.bodies[1].massKg=null;const r=validateStagePlan(p);expect(r.ok).toBe(false);if(r.ok)throw Error();expect(r.missingKeys).toEqual(['/bodies/1/massKg']);expect(r.reading!.bodies![1].massKg).toBeNull();r.reading!.bodies![1].massKg=1;expect(validateStagePlan(r.reading).ok).toBe(true);});
  it.each([['empty tracks',(p:any)=>p.stages[2].tracks=[]],['swapped IDs',(p:any)=>{p.stages[2].tracks[0].bodyIds=['target'];p.stages[2].tracks[1].bodyIds=['bob'];}],['wrong turn ID',(p:any)=>p.stages[2].end={kind:'pendulum_turn',bodyId:'target'}],['negative initial tension',(p:any)=>{p.stages[0].initialAngleDeg=120;}],['nonclosing',(p:any)=>p.stages[1].targetApproach.velocityXMps=Math.sqrt(10)],['wrong target initial',(p:any)=>p.stages[1].targetApproach.initialXM=1],['duplicate body ID',(p:any)=>p.bodies[1].bodyId='bob']])('%s不放行',(_name,change)=>{const p=clone(elastic);change(p);expect(validateStagePlan(p).ok).toBe(false);});
  it('前段运动/同步事实确实缺失时定位待补',()=>{const p=clone(moving) as any;p.stages[1].targetApproach.kind=null;p.stages[1].targetApproach.endsAtContact=null;const r=validateStagePlan(p);if(r.ok)throw Error();expect(r.missingKeys).toEqual(expect.arrayContaining(['/stages/1/targetApproach/kind','/stages/1/targetApproach/endsAtContact']));});
  it('未知kind不吞掉其他质量缺项和已知数值错误',()=>{const p=clone(elastic) as any;p.bodies[1].massKg=null;p.stages[1].kind=null;p.stages[0].lengthM=Infinity;const r=validateStagePlan(p);if(r.ok)throw Error();expect(r.missingKeys).toEqual(expect.arrayContaining(['/bodies/1/massKg','/stages/1/kind']));expect(r.fieldErrors.some(e=>e.path==='/stages/0/lengthM'&&e.code==='NOT_FINITE')).toBe(true);expect(r.reading!.stages[0].lengthM).toBeNull();});
  it('非有限/类型/非整数引用分别定位；不把坏类型当unsupported',()=>{for(const v of [{schemaVersion:{}},{schemaVersion:2}]){const r=validateStagePlan({...elastic,...v});if(r.ok)throw Error();expect(r.code).toBe(typeof v.schemaVersion==='number'?'UNSUPPORTED':'INVALID_READING');}const p=clone(sticky);p.stages[2].inheritFromStageIndex=.5;const r=validateStagePlan(p);if(r.ok)throw Error();expect(r.fieldErrors.some(e=>e.path==='/stages/2/inheritFromStageIndex'&&e.code==='RANGE')).toBe(true);});
});
