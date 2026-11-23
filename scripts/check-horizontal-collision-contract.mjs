// 独立解析锚点复算；不导入生产碰撞或运动模块。
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=n=>JSON.parse(readFileSync(new URL('../fixtures/'+n,import.meta.url),'utf8'));
const data=read('horizontal-collision.acceptance.json');let count=0;
const near=(a,b)=>{assert.ok(Number.isFinite(a)&&Math.abs(a-b)<1e-10,`${a} != ${b}`);count++;};
const same=(a,b)=>{assert.deepEqual(a,b);count++;};
for(const c of data.cases){
 const p=read(`horizontal-collision-${c.name}.reading.json`),[a,b]=p.initial.bodies,[m1,m2]=p.bodies.map(x=>x.massKg),[f1,f2]=p.stages[0].tracks.map(x=>x.kineticFrictionCoefficient*p.gravityMps2);
 const at=(s,f,t)=>{const q=f?Math.min(t,Math.abs(s.vxMps)/f):t;return{x:s.xM+s.vxMps*q-Math.sign(s.vxMps)*f*q*q/2,v:s.vxMps-Math.sign(s.vxMps)*f*q};};
 same(p.bodies.map(x=>x.bodyId),['one','two']);same(p.stages[1].contact,{kind:'horizontal_meeting',approachStageIndex:0});
 if(c.contactSeconds===null){near(at(a,f1,c.durationSeconds).x,c.final[0].xM);near(at(b,f2,c.durationSeconds).x,c.final[1].xM);near(at(a,f1,99).v,0);near(at(b,f2,99).v,0);assert.ok(c.final[0].xM<c.final[1].xM);count++;continue;}
 const u1=at(a,f1,c.contactSeconds),u2=at(b,f2,c.contactSeconds);near(u1.x,c.contactXM);near(u2.x,c.contactXM);near(u1.v,c.before[0]);near(u2.v,c.before[1]);
 const total=m1+m2,v1=p.stages[1].mode==='elastic'?((m1-m2)*u1.v+2*m2*u2.v)/total:(m1*u1.v+m2*u2.v)/total,v2=p.stages[1].mode==='elastic'?(2*m1*u1.v+(m2-m1)*u2.v)/total:v1;
 near(v1,c.after[0]);near(v2,c.after[1]);near(m1*u1.v+m2*u2.v,m1*v1+m2*v2);
 if(c.energyBeforeJ!=null){near((m1*u1.v**2+m2*u2.v**2)/2,c.energyBeforeJ);near((m1*v1**2+m2*v2**2)/2,c.energyAfterJ);near(c.energyBeforeJ-c.energyAfterJ,c.energyLostJ);near(m1*u1.v+m2*u2.v,c.momentum);}
 if(c.stopBeforeContact){near(b.vxMps/f2,c.stopBeforeContact.timeSeconds);near(at(b,f2,99).x,c.stopBeforeContact.xM);assert.ok(c.stopBeforeContact.timeSeconds<c.contactSeconds);count++;}
 if(c.name==='slides')for(const[i,v]of[v1,v2].entries()){const t=Math.abs(v)/2;near(c.contactXM+v*t-Math.sign(v)*t*t,c.final[i].xM);}
 if(c.name==='flight'){const t=c.durationSeconds-c.contactSeconds;near(c.contactXM+v1*t,c.final[0].xM);near(v1,c.final[0].vxMps);near(c.contactXM+v2*t,c.final[1].xM);near(-5*t*t,c.final[1].yM);near(-10*t,c.final[1].vyMps);same(p.stages[2].tracks[1].stages[0].supportBoundary,{edgeXM:5,supportedSide:'left'});same(a.xM<=5&&b.xM<=5&&v1<0&&v2>0,true);}
 if(c.name==='pendulum'){near(Math.acos(1-v2*v2/20)*180/Math.PI,c.turnAngleDeg);near(m2*(v2*v2+10),c.tensionAfterN);}
}
console.log(`水平正碰契约独立复算通过：${count}项断言（未调用生产求解器）。`);
