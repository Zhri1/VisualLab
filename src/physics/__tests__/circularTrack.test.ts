import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {assembleScene,buildMotion,validateStagePlan,type StageMotion} from '../index';
import data from '../../../fixtures/circular-track.acceptance.json';
const read=(name='critical')=>JSON.parse(readFileSync(new URL(`../../../fixtures/${name.endsWith('.json')?name:`circular-track-${name}.reading.json`}`,import.meta.url),'utf8'));
const build=(p:unknown):StageMotion=>{const a=assembleScene(p);if(!a.ok)throw Error(JSON.stringify(a));if(!('kind'in a.scene))throw Error('需要阶段场景');return buildMotion(a.scene).motion;};
const close=(actual:number,expected:number,t=1e-10)=>expect(Math.abs(actual-expected),`${actual} / ${expected}`).toBeLessThanOrEqual(t);
const state=(a:Record<string,unknown>,b:Record<string,unknown>,t=1e-10)=>{for(const k of ['xM','yM','vxMps','vyMps'])if(typeof b[k]==='number')close(a[k] as number,b[k] as number,t);};
describe('显式圆轨公共入口',()=>{
 for(const c of data.cases)it(c.readingFile,()=>{
  const p=read(c.readingFile),v=validateStagePlan(p);expect(v.ok).toBe(true);const m=build(p);
  close(m.durationSeconds,c.durationSeconds);state(m.sampleAt(Infinity),c.final);expect(m.events.map(e=>e.kind)).toEqual(c.eventKinds);
  expect(m.endReason).toBe(c.endReason);expect(m.termination.reason).toBe(m.endReason);expect(m.motionStatus?.state).toBe('range_end');
  const T=m.events.find(e=>['arc_endpoint','arc_contact_lost','arc_range_end'].includes(e.kind))!.timeSeconds;
  close(T,c.boundary.timeSeconds);state(m.sampleAt(T),c.boundary);expect(!!m.sampleAt(T).constraint).toBe(c.hasConstraintAtBoundary);
  expect(m.sampleAt(m.durationSeconds)).toEqual(m.sampleAt(Infinity));expect(m.sampleAt(-1)).toEqual(m.sampleAt(-Infinity));
  for(const t of [0,T/2,T,m.durationSeconds])expect(m.sampleAt(t).springCompressionM).toBe(0);
  const arc=m.geometry.verticalArc!;expect(arc.center).toEqual(p.stages.find((s:{kind:string})=>s.kind==='vertical_arc').path.center);
  close(arc.actualExit.position.xM,c.boundary.xM);close(arc.actualExit.position.yM,c.boundary.yM);
 });
 it('临界顶点瞬时零力、两侧正力而约束不断，一圈末事件同刻',()=>{
  const m=build(read()),T=m.events.find(e=>e.kind==='arc_top')!.timeSeconds;
  close(T,.403781163995683);expect(m.sampleAt(T).constraint?.normalForceN).toBe(0);
  for(const dt of [-1e-7,1e-7])expect(m.sampleAt(T+dt).constraint!.normalForceN).toBeGreaterThan(0);
  expect(m.events.slice(-2).map(e=>e.kind)).toEqual(['arc_lowest','arc_range_end']);expect(m.events[m.events.length-1].timeSeconds).toBe(m.events[m.events.length-2].timeSeconds);
  const last=m.sampleAt(Infinity);close(last.vxMps,Math.sqrt(20));close(last.constraint!.normalForceN,6);expect(last.constraint?.normalDirection).toEqual({x:0,y:1});
 });
 it('实体端点前后各用轨道/重力方程，精度1e-10',()=>{
  const m=build(read('offset')),e=m.events.find(e=>e.kind==='arc_endpoint')!,T=e.timeSeconds,dt=1e-7,s=m.sampleAt(T),before=m.sampleAt(T-dt),after=m.sampleAt(T+dt);
  const phi=2*Math.PI/3,q=Math.hypot(s.vxMps,s.vyMps),ax=-10*Math.sin(phi)*Math.cos(phi)-q*q/.4*Math.sin(phi),ay=-10*Math.sin(phi)**2+q*q/.4*Math.cos(phi);
  state(before,{xM:s.xM-s.vxMps*dt+ax*dt*dt/2,yM:s.yM-s.vyMps*dt+ay*dt*dt/2,vxMps:s.vxMps-ax*dt,vyMps:s.vyMps-ay*dt});
  state(after,{xM:s.xM+s.vxMps*dt,yM:s.yM+s.vyMps*dt-5*dt*dt,vxMps:s.vxMps,vyMps:s.vyMps-10*dt});
  expect(before.constraint).toBeDefined();expect(s.constraint).toBeUndefined();expect(after.constraint).toBeUndefined();
  close(e.normalForceBeforeN!,.767949192431124);expect(e.normalForceAfterN).toBe(0);expect(m.geometry.verticalArc?.plannedEnd).toEqual(m.geometry.projectile?.launch);
 });
 it('0.8秒斜面接续保留位置、两个速度分量和同刻次序',()=>{
  const m=build(read('incline')),a=m.events.find(e=>e.kind==='reach_bottom')!,b=m.events.find(e=>e.kind==='arc_enter')!;
  close(a.timeSeconds,.8);expect(a.timeSeconds).toBe(b.timeSeconds);expect(b.order).toBe(a.order+1);expect(a.velocityAfter).toEqual(b.velocityBefore);
  const t=b.timeSeconds,dt=1e-7,s=m.sampleAt(t),before=m.sampleAt(t-dt),after=m.sampleAt(t+dt);state(s,{xM:0,yM:0,vxMps:2*Math.sqrt(3),vyMps:-2});
  state(before,{xM:-2*Math.sqrt(3)*dt+2.5*Math.cos(Math.PI/6)*dt*dt,yM:2*dt-1.25*dt*dt,vxMps:2*Math.sqrt(3)-5*Math.cos(Math.PI/6)*dt,vyMps:-2+2.5*dt});
  const N=s.constraint!.normalForceN,ax=N/.1*.5,ay=-10+N/.1*Math.sqrt(3)/2;
  state(after,{xM:s.vxMps*dt+ax*dt*dt/2,yM:s.vyMps*dt+ay*dt*dt/2,vxMps:s.vxMps+ax*dt,vyMps:s.vyMps+ay*dt});
  expect(before.constraint).toBeUndefined();expect(after.constraint).toBeDefined();
 });
 it.each([4,8])('低点u²=%s先转折后原路返回，保留反向速度/约束',u2=>{
  const p=read();p.initial.speedMps=Math.sqrt(u2);const m=build(p),turn=m.events.find(e=>e.kind==='arc_turn')!;
  expect(m.endReason).toBe('returned_to_entry');expect(m.sampleAt(turn.timeSeconds).vxMps).toBe(0);expect(m.sampleAt(turn.timeSeconds).vyMps).toBe(0);
  if(u2===8)expect(m.sampleAt(turn.timeSeconds).constraint?.normalForceN).toBe(0);
  expect(m.sampleAt(turn.timeSeconds+1e-7).constraint).toBeDefined();close(m.sampleAt(Infinity).vxMps,-Math.sqrt(u2));
  expect(m.sampleAt(Infinity).constraint).toBeDefined();expect(m.events.some(e=>e.kind==='arc_contact_lost')).toBe(false);
 });
 it('非最低点静止下坡起动与最低点平衡',()=>{
  const p=read('incline');p.stages=p.stages.slice(1,2);p.stages[0].path.end.kind='observation';const m=build(p);expect(m.durationSeconds).toBeGreaterThan(0);expect(m.sampleAt(1e-4).vxMps).toBeGreaterThan(0);
  const zero=read();zero.initial.speedMps=0;const z=build(zero);expect(z.durationSeconds).toBe(0);expect(z.endReason).toBe('stopped');expect(z.sampleAt(0).constraint?.normalForceN).toBe(1);
 });
 it('入口即脱轨：负时间仍有原约束、零时刻取最终离轨后',()=>{
  const p=read('below');p.stages[0].path.startAngleDeg=120;p.stages[0].path.end.sweepAngleDeg=60;p.initial.speedMps=Math.sqrt(2);const m=build(p);
  expect(m.events.filter(e=>e.timeSeconds===0).map(e=>e.kind)).toEqual(['release','arc_enter','arc_contact_lost','projectile_launch']);
  expect(m.sampleAt(-1).constraint).toBeDefined();expect(m.sampleAt(0).constraint).toBeUndefined();state(m.sampleAt(-1),m.sampleAt(0));
 });
 it('端点与N=0同刻：实体端点优先，观察目标则真实脱轨优先',()=>{
  for(const kind of ['physical_endpoint','observation']){const p=read('below');p.initial.speedMps=4;p.stages[0].path.end={kind,sweepAngleDeg:Math.acos(-2/3)*180/Math.PI};const m=build(p);
   expect(m.events.some(e=>e.kind==='arc_endpoint')).toBe(kind==='physical_endpoint');expect(m.events.some(e=>e.kind==='arc_contact_lost')).toBe(kind==='observation');}
 });
 it('缺叶子往返保留已知圆心、方向、后缀且不误报旧字段',()=>{
  const p=read('offset');p.stages[0].path.center.xM=null;const v=validateStagePlan(p);expect(v).toMatchObject({ok:false,missingKeys:['/stages/0/path/center/xM']});
  if(v.ok)throw Error();const draft=v.reading!;expect((draft.stages[0].path as {direction:string}).direction).toBe('positive');
  (draft.stages[0].path as {center:{xM:number}}).center.xM=2;expect(assembleScene(draft).ok).toBe(true);
 });
 it.each([['direction',true,'TYPE'],['direction','sideways','UNSUPPORTED'],['startAngleDeg',181,'RANGE'],['startAngleDeg',Infinity,'NOT_FINITE']])('非法path.%s=%s', (key,value,code)=>{
  const p=read();p.stages[0].path[key]=value;expect(validateStagePlan(p)).toMatchObject({ok:false,fieldErrors:[{path:'/stages/0/path/'+key,code}]});
 });
 it('互斥、缺块、零角程、物理整圈、初始负N与方向冲突',()=>{
  const p=read();p.stages[0].endAngleDeg=null;expect(validateStagePlan(p)).toMatchObject({ok:false,fieldErrors:[{code:'PRECONDITION_CONFLICT'}]});
  const missing=read();missing.stages[0].path=null;expect(validateStagePlan(missing)).toMatchObject({ok:false,missingKeys:['/stages/0/path']});
  for(const end of [{kind:'observation',sweepAngleDeg:0},{kind:'physical_endpoint',sweepAngleDeg:360}]){const q=read();q.stages[0].path.end=end;expect(validateStagePlan(q)).toMatchObject({ok:false,fieldErrors:[{path:'/stages/0/path/end/sweepAngleDeg',code:'RANGE'}]});}
  const negative=read();negative.stages[0].path.startAngleDeg=180;negative.initial.speedMps=0;expect(validateStagePlan(negative)).toMatchObject({ok:false,fieldErrors:[{code:'PRECONDITION_CONFLICT'}]});
  const direction=read('offset');direction.initial.speedMps=0;expect(validateStagePlan(direction)).toMatchObject({ok:false,fieldErrors:[{path:'/stages/0/path/direction',code:'PRECONDITION_CONFLICT'}]});
 });
 it('入弧位置和切向速度矛盾由装配定位，提前停不生成假入弧',()=>{
  for(const key of ['center','direction']){const p=read('incline');if(key==='center')p.stages[1].path.center.xM+=.1;else p.stages[1].path.direction='negative';expect(assembleScene(p)).toMatchObject({ok:false,fieldErrors:[{path:'/stages/1/path',code:'PRECONDITION_CONFLICT'}]});}
  const p=read('incline');p.initial.speedMps=2;p.stages[0].kineticFrictionCoefficient=1;const m=build(p);expect(m.events.map(e=>e.kind)).toEqual(['release','stop']);expect(m.geometry.verticalArc).toBeUndefined();expect(m.geometry.schematic?.verticalArc?.startAngleDeg).toBe(-30);expect(m.sampleAt(Infinity).vxMps).toBe(0);
 });
 it('不可表示的入口角加角程报具体路径，0度可表示微弧不设最小角',()=>{
  const p=read('offset');p.stages[0].path.end.sweepAngleDeg=1e-16;expect(validateStagePlan(p)).toMatchObject({ok:false,fieldErrors:[{path:'/stages/0/path/end/sweepAngleDeg',code:'RANGE'}]});
  const q=read();q.stages[0].path.end.sweepAngleDeg=1e-16;expect(build(q).durationSeconds).toBeGreaterThan(0);
 });
 it('量级溢出是可修正错误，不让Infinity吸附到临界',()=>{const p=read();p.initial.speedMps=1e200;expect(validateStagePlan(p)).toMatchObject({ok:false,fieldErrors:[{code:'RANGE'}]});});
 it('支持力向量的返回对象独立，修改一次读数不能污染事件快照',()=>{
  const m=build(read()),t=m.events.find(e=>e.kind==='arc_top')!.timeSeconds,s=m.sampleAt(t);s.constraint!.normalDirection!.y=123;
  expect(m.sampleAt(t).constraint!.normalDirection!.y).toBe(-1);
 });
 it('旧半圆负时间仍按原零时刻钳制，保留入弧约束',()=>{
  const m=build(read('vertical-arc-endpoint.reading.json'));expect(m.sampleAt(-1)).toEqual(m.sampleAt(0));close(m.sampleAt(-1).constraint!.normalForceN,6);
 });
});
