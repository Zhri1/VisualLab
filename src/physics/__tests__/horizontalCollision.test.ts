import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {assembleStageScene,buildStageMotion,validateStagePlan,truncateStagePlan,assembleScene,buildMotion} from '../index';
import type {StagePlanDraft} from '../index';
import reference from '../../../fixtures/horizontal-collision.acceptance.json';
const read=(name:string)=>JSON.parse(readFileSync(new URL(`../../../fixtures/horizontal-collision-${name}.reading.json`,import.meta.url),'utf8'));
const run=(p:unknown)=>{const a=assembleStageScene(p);if(!a.ok)throw Error(JSON.stringify(a));return buildStageMotion(a.scene).motion;};
const close=(a:number,b:number)=>expect(Math.abs(a-b)).toBeLessThanOrEqual(1e-10);
describe('独立水平正碰公开入口',()=>{
 it.each(reference.cases.map(c=>[c.name,c] as const))('%s共享锚点、状态与碰前后守恒', (name,r)=>{
  const p=read(name),m=run(p);expect(m.primaryBodyId).toBe('one');
  const contact=m.events.find(e=>e.kind==='contact'),collision=m.events.find(e=>e.kind==='collision');
  if(r.contactSeconds===null){expect(contact).toBeUndefined();expect(collision).toBeUndefined();expect(m.motionStatus?.state).toBe('complete');expect(m.endReason).toBe('no_collision');}
  else{close(contact!.timeSeconds,r.contactSeconds);close(contact!.position!.xM,r.contactXM!);expect(collision).toBeDefined();
   for(const [i,id]of ['one','two'].entries()){close(collision!.bodyStatesBefore![id].vxMps,r.before![i]);close(collision!.bodyStatesAfter![id].vxMps,r.after![i]);close(collision!.bodyStatesBefore![id].xM,collision!.bodyStatesAfter![id].xM);}
   const c=collision!.collision!;close(c.momentumBeforeKgMps,c.momentumAfterKgMps);if(name!=='sticky')close(c.energyBeforeJ,c.energyAfterJ);
  }
  if(r.durationSeconds!=null)close(m.durationSeconds,r.durationSeconds);
  if(r.final)for(const expected of r.final){const actual=m.sampleAt(Infinity).bodies![expected.bodyId];close(actual.xM,expected.xM);close(actual.vxMps,expected.vxMps);if('yM'in expected)close(actual.yM,expected.yM!);if('vyMps'in expected)close(actual.vyMps,expected.vyMps!);}
  if(r.motionStatus)expect(m.motionStatus?.state).toBe(r.motionStatus);
  if(name==='pendulum'){close(m.events.find(e=>e.kind==='collision')!.constraintsAfter!['string:two'].tensionN,33);close(m.sampleAt(Infinity).constraints!['string:two'].angleDeg!,r.turnAngleDeg!);expect(m.geometry.pendulums![0].pivot).toEqual({xM:1,yM:1});}
 });
 it('粘连保留两ID、共速度及准确能量损失',()=>{const m=run(read('sticky')),e=m.events.find(e=>e.kind==='collision')!;close(e.collision!.energyLostJ,13.5);close(e.collision!.energyAfterJ,.5);const s=m.sampleAt(1);expect(s.bodies!.one.groupId).toBe(s.bodies!.two.groupId);expect(s.bodies!.one.xM).toBe(s.bodies!.two.xM);expect(m.motionStatus?.state).toBe('range_end');});
 it('首段截断保留两体题给初态，到碰前状态而不碰撞',()=>{const p=truncateStagePlan(read('elastic') as StagePlanDraft,0),m=run(p);expect(m.events.map(e=>e.kind)).toEqual(['release','contact']);expect(m.endReason).toBe('prefix_end');close(m.sampleAt(Infinity).bodies!.one.vxMps,5);expect(p.initial).toEqual(read('elastic').initial);});
 it('t=0碰撞的负时间回碰前，精确0同时返回两体碰后',()=>{const p=read('elastic');p.initial.bodies[1].xM=0;p.stages[1].normalXM=1;const m=run(p);for(const t of [-1,-1e-7,-Infinity]){close(m.sampleAt(t).bodies!.one.vxMps,5);close(m.sampleAt(t).bodies!.two.vxMps,-1);}for(const t of [0,1,Infinity]){close(m.sampleAt(t).bodies!.one.vxMps,-4);close(m.sampleAt(t).bodies!.two.vxMps,2);}});
 it('碰撞近邻逐体位置连续、速度原子更新',()=>{const p=read('slides'),m=run(p),e=1e-7;
  const a=m.sampleAt(1-e).bodies!,b=m.sampleAt(1).bodies!,c=m.sampleAt(1+e).bodies!;
  close(a.one.xM,5-4*e-e*e);close(a.one.vxMps,4+2*e);close(a.two.xM,5+e+e*e);close(a.two.vxMps,-1-2*e);
  close(b.one.vxMps,-3.5);close(b.two.vxMps,1.5);close(c.one.xM,5-3.5*e+e*e);close(c.two.xM,5+1.5*e-e*e);
 });
 it.each([.1,.2,1.25])('高度%s保留精确局部落地边界及入射末态',h=>{const p=read('flight');p.stages[2].tracks[1].stages[0].landingPlaneYM=-h;const m=run(p),last=m.events[m.events.length-1];expect(last.kind).toBe('land');expect(last.timeSeconds).toBe(m.durationSeconds);expect(m.sampleAt(m.durationSeconds).bodies!.two.status).toBe('landed');close(m.sampleAt(Infinity).bodies!.two.yM,-h);close(m.sampleAt(Infinity).bodies!.two.vyMps,-Math.sqrt(20*h));});
 it('名义同时到达的水平目标和落地保留两个末点事件',()=>{
  const p=read('scene-end');
  p.stages[2].tracks[0].stages[0].end={kind:'distance',distanceM:1.4-Number.EPSILON};
  const m=run(p);
  expect(m.events.filter(e=>e.timeSeconds===m.durationSeconds).map(e=>e.kind)).toEqual(['reach_target','land']);
  expect(m.sampleAt(Infinity).bodies!.two.status).toBe('landed');
 });
 it('水平跟随段只允许光滑、碰后并行末段',()=>{
  const p=read('scene-end');
  const follower=p.stages[2].tracks[0].stages[0];
  const leaf='/stages/2/tracks/0/stages/0';
  expect(validateStagePlan({kind:'stage_plan',schemaVersion:1,initial:{speedMps:1},stages:[follower]})).toMatchObject({ok:false,fieldErrors:expect.arrayContaining([expect.objectContaining({path:'/stages/0/end/kind',code:'UNSUPPORTED'})])});
  follower.kineticFrictionCoefficient=0.2;
  expect(validateStagePlan(p)).toMatchObject({ok:false,fieldErrors:expect.arrayContaining([expect.objectContaining({path:leaf+'/kineticFrictionCoefficient',code:'PRECONDITION_CONFLICT'})])});
  follower.kineticFrictionCoefficient=0;
  p.stages[2].tracks[0].stages.push({kind:'projectile',landingPlaneYM:-1.25});
  expect(validateStagePlan(p)).toMatchObject({ok:false,fieldErrors:expect.arrayContaining([expect.objectContaining({path:leaf+'/end/kind',code:'PRECONDITION_CONFLICT'})])});
 });
 it('tracks重排保持按ID寻址的停止事件和几何路径',()=>{const p=read('catch-after-stop');p.stages[0].tracks.reverse();const m=run(p);expect(m.events.find(e=>e.kind==='stop')!.stagePath).toBe('/stages/0/tracks/0');expect(m.geometry.bodyTracks!.find(t=>t.bodyIds[0]==='two')!.stagePath).toBe('/stages/0/tracks/0');close(m.events.find(e=>e.kind==='collision')!.timeSeconds,.8125);});
 it('无冲击接触只产生contact，保留共速2且不宣称静止',()=>{const p=read('elastic');p.initial.bodies=[{bodyId:'one',xM:0,vxMps:4},{bodyId:'two',xM:1,vxMps:2}];p.stages[0].tracks[0].kineticFrictionCoefficient=.2;const m=run(p);expect(m.endReason).toBe('contact_without_impact');expect(m.events.map(e=>e.kind)).toEqual(['release','contact']);close(m.durationSeconds,1);close(m.sampleAt(Infinity).bodies!.two.vxMps,2);expect(m.motionStatus?.state).toBe('range_end');});
 it('4.375s再次追及只交付入射状态，不执行第二次撞击',()=>{const p=read('slides');p.bodies[0].massKg=3;p.bodies[1].massKg=1;p.initial.bodies=[{bodyId:'one',xM:0,vxMps:3},{bodyId:'two',xM:3,vxMps:0}];p.stages[0].tracks[0].kineticFrictionCoefficient=0;p.stages[2].tracks[0].stages[0]={kind:'horizontal_slide',kineticFrictionCoefficient:0,end:{kind:'distance',distanceM:7}};const m=run(p);close(m.durationSeconds,4.375);expect(m.endReason).toBe('second_contact_boundary');expect(m.motionStatus?.state).toBe('model_limit');expect(m.events.filter(e=>e.kind==='collision')).toHaveLength(1);close(m.sampleAt(Infinity).bodies!.one.xM,8.0625);close(m.sampleAt(Infinity).bodies!.one.vxMps,1.5);close(m.sampleAt(Infinity).bodies!.two.vxMps,0);});
 it('观察范围先到不造假碰撞，两个入口一致',()=>{const p=read('elastic');p.stages[0].end={kind:'time_limit',durationSeconds:.5};const m=run(p);expect(m.endReason).toBe('approach_range_end');expect(m.events.some(e=>e.kind==='collision')).toBe(false);const a=assembleScene(p as StagePlanDraft);if(!a.ok)throw Error();expect(buildMotion(a.scene).motion.sampleAt(Infinity)).toEqual(m.sampleAt(Infinity));});
 it('光滑不接触且无有限观察范围只待补end',()=>{const p=read('elastic');p.initial.bodies[0].vxMps=-1;p.initial.bodies[1].vxMps=1;expect(validateStagePlan(p)).toMatchObject({ok:false,missingKeys:['/stages/0/end']});});
 it('已有张紧绳不能通过直接抛体丢弃约束',()=>{const p=read('pendulum');p.stages[2].tracks[1].stages=[{kind:'projectile',landingPlaneYM:-1.25,supportAbsentAtStart:true,supportBoundary:{edgeXM:1,supportedSide:'left'}}];p.stages[2].end={kind:'all_finite_tracks'};const r=validateStagePlan(p);expect(r).toMatchObject({ok:false,fieldErrors:expect.arrayContaining([expect.objectContaining({path:'/stages/2/tracks/1/stages/0/kind',code:'PRECONDITION_CONFLICT'})])});});
 it('共同桌沿的水平轨道不能继续进入无支撑侧',()=>{const p=read('flight');p.bodies[0].massKg=3;p.bodies[1].massKg=1;expect(validateStagePlan(p)).toMatchObject({ok:false,fieldErrors:expect.arrayContaining([expect.objectContaining({path:'/stages/2/tracks/0/stages/0',code:'PRECONDITION_CONFLICT'})])});expect(run(read('flight')).endReason).toBe('landed');});
 it('粘连继承一根已有绳，组合质量只计算一份张力',()=>{const p=read('pendulum');p.stages[1].mode='perfectly_inelastic';p.stages[2].tracks=[{bodyIds:['one','two'],stages:[{kind:'pendulum_swing',inheritFromBodyId:'two',end:{kind:'scene_end'}}]}];const m=run(p),s=m.sampleAt(.5);expect(Object.keys(s.constraints!)).toEqual(['string:two']);close(s.constraints!['string:two'].tensionN,41);expect(s.bodies!.one.constraintId).toBe(s.bodies!.two.constraintId);close(s.bodies!.one.vxMps,.5);close(s.bodies!.two.vxMps,.5);});
 it('初态已有绳时重力必需；光滑无约束的独立碰撞可省g',()=>{const p=read('pendulum');delete p.gravityMps2;expect(validateStagePlan(p)).toMatchObject({ok:false,missingKeys:['/gravityMps2']});const a=read('elastic');delete a.gravityMps2;expect(run(a).endReason).toBe('collision_complete');});
 it('同刻停止先于接触，无冲击快照仍保留双方ID',()=>{const p=read('elastic');p.initial.bodies=[{bodyId:'one',xM:0,vxMps:2},{bodyId:'two',xM:1,vxMps:0}];p.stages[0].tracks[0].kineticFrictionCoefficient=.2;const m=run(p);expect(m.events.map(e=>e.kind)).toEqual(['release','stop','contact']);expect(m.endReason).toBe('contact_without_impact');expect(m.events[1].timeSeconds).toBe(m.events[2].timeSeconds);expect(Object.keys(m.events[2].bodyStatesAfter!)).toEqual(['one','two']);});
 it.each([['/initial/bodies/1/xM',['initial','bodies','1','xM']],['/stages/0/tracks/1/kineticFrictionCoefficient',['stages','0','tracks','1','kineticFrictionCoefficient']],['/bodies/1/massKg',['bodies','1','massKg']]] as const)('缺项%s保留草稿并只补该项', (path,keys)=>{const p=read('elastic');let cur=p;for(const k of keys.slice(0,-1))cur=cur[k];const key=keys[keys.length-1],value=cur[key];cur[key]=null;const r=validateStagePlan(p);expect(r).toMatchObject({ok:false,missingKeys:[path]});if(r.ok)throw Error();let fixed:any=r.reading;for(const k of keys.slice(0,-1))fixed=fixed[k];fixed[key]=value;expect(run(r.reading).events.some(e=>e.kind==='collision')).toBe(true);});
});
