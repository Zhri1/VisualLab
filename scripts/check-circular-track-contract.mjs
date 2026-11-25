// 契约独立复算：只用题设、能量/径向力、Simpson与RK4，不导入生产圆弧或摆求解器。
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>JSON.parse(readFileSync(new URL(`../fixtures/${name}`,import.meta.url),'utf8'));
const data=read('circular-track.acceptance.json');
let checks=0;
const same=(a,b)=>{assert.deepEqual(a,b);checks++;};
const close=(a,b,t=1e-10)=>{assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=t,`${a} 与 ${b} 不符，容差 ${t}`);checks++;};
const yes=x=>{assert.ok(x);checks++;};
const rad=x=>x*Math.PI/180;
const simpson=(f,a,b,n=100000)=>{let s=f(a)+f(b);for(let i=1;i<n;i++)s+=(i%2?4:2)*f(a+(b-a)*i/n);return s*(b-a)/(3*n);};
// 独立按时间解原方程，避免只用同一个能量积分同时生成及校对时长。
function rk4(phi,q,g,R,time,n=30000){
 const h=time/n;
 for(let i=0;i<n;i++){
  const a=q/R,b=-g*Math.sin(phi),c=(q+h*b/2)/R,d=-g*Math.sin(phi+h*a/2);
  const e=(q+h*d/2)/R,f=-g*Math.sin(phi+h*c/2),j=(q+h*f)/R,k=-g*Math.sin(phi+h*e);
  phi+=h*(a+2*c+2*e+j)/6;q+=h*(b+2*d+2*f+k)/6;
 }
 return{phi,q};
}
function finiteTree(value){if(typeof value==='number')yes(Number.isFinite(value));else if(value&&typeof value==='object')Object.values(value).forEach(finiteTree);}
same(data.cases.length,7);same(data.boundarySideEpsilonSeconds,1e-7);same(data.boundarySideToleranceSI,1e-10);
for(const c of data.cases){
 const input=read(c.readingFile),arcIndex=input.stages.findIndex(s=>s.kind==='vertical_arc'),s=input.stages[arcIndex],path=s.path,{xM:cx,yM:cy}=path.center;
 finiteTree(input);finiteTree(c);
 same([input.kind,input.schemaVersion],['stage_plan',1]);same([s.kind,s.side,s.frictionless],['vertical_arc','inside',true]);
 same('endAngleDeg' in s,false);yes(path.startAngleDeg>=-180&&path.startAngleDeg<=180);
 yes(path.end.sweepAngleDeg>0&&path.end.sweepAngleDeg<=360);if(path.end.kind==='physical_endpoint')yes(path.end.sweepAngleDeg<360);
 const R=s.radiusM,g=input.gravityMps2,m=input.massKg,p0=rad(path.startAngleDeg),d=path.direction==='positive'?1:-1;
 let u=input.initial.speedMps,prefix=0;
 if(arcIndex===1){const slope=input.stages[0],a=g*(Math.sin(rad(slope.angleDeg))-slope.kineticFrictionCoefficient*Math.cos(rad(slope.angleDeg)));
  u=Math.sqrt(u*u+2*a*slope.lengthM);prefix=(u-input.initial.speedMps)/a;close(prefix,c.arcEntryTimeSeconds);close(u,4);close(prefix,.8);
  close(cx+R*Math.sin(p0),0);close(cy-R*Math.cos(p0),0);close(c.entry.vxMps,u*Math.cos(rad(slope.angleDeg)));close(c.entry.vyMps,-u*Math.sin(rad(slope.angleDeg)));
 }
 const speed2=p=>u*u+2*g*R*(Math.cos(p)-Math.cos(p0));
 const state=p=>{const q=d*Math.sqrt(speed2(p));return{xM:cx+R*Math.sin(p),yM:cy-R*Math.cos(p),vxMps:q*Math.cos(p),vyMps:q*Math.sin(p),normalForceN:m*(q*q/R+g*Math.cos(p))};};
 const compare=(a,b)=>{for(const key of ['xM','yM','vxMps','vyMps','normalForceN'])close(a[key],b[key]);};
 compare(state(p0),c.entry);
 const pe=rad(c.boundary.angleDeg),planned=p0+d*rad(path.end.sweepAngleDeg),loss=c.eventKinds.includes('arc_contact_lost');
 if(loss){yes(d*(pe-p0)<d*(planned-p0));close(state(pe).normalForceN,0);yes(-3*m*g*Math.sin(pe)*d<0);same(c.top,null);}
 else close(pe,planned);
 compare(state(pe),c.boundary);
 const integral=simpson(p=>R/Math.sqrt(speed2(p)),Math.min(p0,pe),Math.max(p0,pe));close(integral+prefix,c.boundary.timeSeconds);
 const byTime=rk4(p0,d*u,g,R,c.boundary.timeSeconds-prefix);close(byTime.phi,pe);close(byTime.q,d*Math.sqrt(speed2(pe)));
 close(.5*m*u*u+m*g*c.entry.yM,.5*m*speed2(pe)+m*g*c.boundary.yM);
 if(c.top){const p=rad(c.top.angleDeg);compare(state(p),c.top);close(simpson(p=>R/Math.sqrt(speed2(p)),p0,p),c.top.timeSeconds);}
 const flight=c.flightSeconds!==null;
 if(flight){
  same(input.stages[arcIndex+1],{kind:'projectile',landingPlaneYM:0});const {xM:x,yM:y,vxMps:vx,vyMps:vy}=c.boundary;
  const air=(vy+Math.sqrt(vy*vy+2*g*y))/g;close(air,c.flightSeconds);close(c.durationSeconds,c.boundary.timeSeconds+air);
  compare({xM:x+vx*air,yM:y+vy*air-g*air*air/2,vxMps:vx,vyMps:vy-g*air,normalForceN:0},c.final);
  same(c.eventKinds.slice(-3),['projectile_launch','apex','land']);same(c.endReason,'landed');same(c.hasConstraintAtBoundary,false);
 }else{
  close(c.durationSeconds,c.boundary.timeSeconds);compare(c.final,c.boundary);same(c.hasConstraintAtBoundary,true);same(c.endReason,'prefix_end');
  same(c.eventKinds.includes('projectile_launch'),false);same(c.eventKinds.includes('land'),false);same(c.eventKinds.at(-1),'arc_range_end');
 }
 same(c.motionStatusState,'range_end');same(c.eventKinds.slice(0,arcIndex?3:2),arcIndex?['release','reach_bottom','arc_enter']:['release','arc_enter']);
}

const [critical,below,above,offset,mirror,observation]=data.cases;
const incline=data.cases[6];close(incline.boundary.timeSinceArcEntrySeconds,.157243989317621);
close(incline.boundary.timeSeconds,.957243989317621);close(incline.boundary.xM,.546410161513775);close(incline.boundary.yM,.146410161513775);
close(incline.boundary.vxMps,1.807746993478657);close(incline.boundary.vyMps,3.131109639934917);close(incline.boundary.normalForceN,3.767949192431123);
same(incline.eventKinds,['release','reach_bottom','arc_enter','arc_lowest','arc_endpoint','projectile_launch','apex','land']);
close(critical.top.timeSeconds,.403781163995683);close(critical.durationSeconds,.807562327991372);
close(critical.top.vxMps,-2);same(critical.top.normalForceN,0);close(critical.final.vxMps,Math.sqrt(20));close(critical.final.normalForceN,6);
same(critical.eventKinds,['release','arc_enter','arc_top','arc_lowest','arc_range_end']);
// 临界零力是局部最小值；两侧仍贴轨，不按“等于0”直接脱轨。
for(const dt of [-1e-7,1e-7]){const p=rk4(Math.PI,2,10,.4,dt,2);yes(p.q>0);yes((p.q*p.q/.4+10*Math.cos(p.phi))*.1>0);}
// q²=2gR到90°零速零力，反向后仍贴轨；原路同位置的q²和支持力相同。
for(const dt of [-1e-4,1e-4]){const p=rk4(Math.PI/2,0,10,.4,dt,4);yes(p.phi<Math.PI/2);yes(p.q*dt<0);yes((p.q*p.q/.4+10*Math.cos(p.phi))*.1>0);}
for(const phi of [0,.2,.5,1]){const speed2=8-8*(1-Math.cos(phi));const outward=Math.sqrt(speed2),returning=-outward;close(outward*outward,returning*returning);close(.1*(outward*outward/.4+10*Math.cos(phi)),.1*(returning*returning/.4+10*Math.cos(phi)));}
yes(below.boundary.angleDeg<180);same(below.boundary.normalForceN,0);close(above.top.normalForceN,.001);yes(above.top.normalForceN>0);
close(offset.boundary.timeSeconds,.197687524263752);
close(offset.boundary.xM-offset.entry.xM,.146410161513776);close(offset.boundary.yM-offset.entry.yM,.546410161513775);
close(offset.boundary.vxMps,-1.126032500610494);close(offset.boundary.vyMps,1.950345502031210);close(offset.boundary.normalForceN,.767949192431124);
for(const key of ['timeSeconds','yM','vyMps','normalForceN'])close(offset.boundary[key],mirror.boundary[key]);
close(offset.boundary.xM,-mirror.boundary.xM);close(offset.boundary.vxMps,-mirror.boundary.vxMps);
for(const key of ['timeSeconds','xM','yM','vxMps','vyMps','normalForceN'])close(offset.boundary[key],observation.boundary[key]);
// 同一个固定地面后缀在观察范围结束时不能被执行。
same(read(observation.readingFile).stages[1],{kind:'projectile',landingPlaneYM:0});same(observation.flightSeconds,null);
same(offset.hasConstraintAtBoundary,false);same(observation.hasConstraintAtBoundary,true);
// 从端点的真实状态独立向两侧推进，验收数据不能把两侧都当作水平/自由重力段。
const eps=data.boundarySideEpsilonSeconds,R=.4,g=10;
const p=rad(offset.boundary.angleDeg),q=Math.hypot(offset.boundary.vxMps,offset.boundary.vyMps);
const before=rk4(p,q,g,R,-eps,2),after={xM:offset.boundary.xM+offset.boundary.vxMps*eps,yM:offset.boundary.yM+offset.boundary.vyMps*eps-g*eps*eps/2};
yes(before.phi<p);yes(after.yM>offset.boundary.yM);close(Math.hypot(before.q*Math.cos(before.phi),before.q*Math.sin(before.phi)),before.q);
const nx=-Math.sin(p),ny=Math.cos(p),ax=offset.boundary.normalForceN/.1*nx,ay=-g+offset.boundary.normalForceN/.1*ny;
yes(Math.abs(ax)>1);yes(Math.abs(ay+g)>1);close(ax,-g*Math.sin(p)*Math.cos(p)-q*q/R*Math.sin(p));
close(ay,-g*Math.sin(p)**2+q*q/R*Math.cos(p));

// 原有半圆/预压输入仍是旧分支，不借此契约改写原数据或A/B/C口径。
for(const name of ['vertical-arc-endpoint.reading.json','vertical-arc-contact-loss.reading.json','vertical-arc-return.reading.json','vertical-arc-composition.reading.json']){
 const input=read(name),s=input.stages.find(s=>s.kind==='vertical_arc');same(s.endAngleDeg,180);same('path' in s,false);
}
const old=read('vertical-arc.acceptance.json');close(old.cases[0].boundary.timeSeconds,critical.top.timeSeconds);close(old.cases[0].boundary.normalForceN,critical.top.normalForceN);
console.log(`圆轨扩展契约独立复算通过：${checks}项断言（未调用生产求解器，新path运行时尚待实现）。`);
