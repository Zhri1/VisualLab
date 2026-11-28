import {adaptStageMotion} from "../../adapters/stageMotionAdapter.ts";
import {forcesAt} from "../../features/forces/forceModel.ts";
import { describe, expect, it } from "vitest";
import { assembleScene, buildMotion, validateStagePlan } from "../index.ts";
const plan = (stages: any[], speed=0, mass=60) => ({kind:"stage_plan",schemaVersion:1,gravityMps2:10,massKg:mass,initial:{speedMps:speed},stages});
function run(p:any) { const a:any=assembleScene(p); if(!a.ok) throw Error(JSON.stringify(a)); const b:any=buildMotion(a.scene); if(!b.ok) throw Error(JSON.stringify(b)); return b.motion; }
const force = (d=160,t=10) => ({kind:"constant_force_1d",netForceXN:null,end:{kind:"duration",durationSeconds:t},kinematics:{displacementM:d}});
describe("通用匀变速题设反求",()=>{
  it("位移与用时反求合力并连续入弧；API 再装配及改值重算",()=>{
    const p:any=plan([force(),{kind:"vertical_arc",radiusM:160,endAngleDeg:5,side:"inside",frictionless:true}]);
    const v:any=validateStagePlan(p); expect(v.ok).toBe(true); expect(v.reading.stages[0].netForceXN).toBeCloseTo(192,10);
    const motion=run(v.reading); const at=motion.sampleAt(10); expect(at.vxMps).toBeCloseTo(32,9); expect(at.xM).toBeCloseTo(160,9); expect(at.constraint.normalForceN).toBeCloseTo(984,7);
    v.reading.stages[0].kinematics.displacementM=200;
    const edited:any=validateStagePlan(v.reading); expect(edited.ok).toBe(true); expect(edited.reading.stages[0].netForceXN).toBeCloseTo(240,9);
    expect(edited.reading.derivedCalculations[0].rule).toBe("uniform_acceleration");
  });
  it("只问入弧瞬时：不要求光滑事实或未知终点，不推演后续弧内过程",()=>{
    const p:any=plan([force(),{kind:"vertical_arc",entryOnly:true,radiusM:160,side:"inside"}]);
    const v:any=validateStagePlan(p);expect(v.ok).toBe(true);expect(v.reading.stages[1]).not.toHaveProperty("frictionless");
    const m=run(v.reading);expect(m.durationSeconds).toBe(10);expect(m.segments).toHaveLength(1);expect(m.events.at(-1).kind).toBe("arc_range_end");expect(m.sampleAt(10).constraint.normalForceN).toBeCloseTo(984,9);expect(m.sampleAt(100).vxMps).toBeCloseTo(32,9);
    const display=adaptStageMotion(m,v.reading);expect(display.segments[display.segments.length-1]?.formula).toBe("N = m(g + v²/R)");expect(forcesAt(display,10).find(f=>f.kind==="normal")?.magnitudeN).toBeCloseTo(984,9);
    delete p.stages[1].side;expect(validateStagePlan(p).ok).toBe(true);
    p.stages[1].frictionless=false;expect(validateStagePlan(p).ok).toBe(true);
    p.stages.push({kind:"projectile",dropHeightM:1});expect(validateStagePlan(p).ok).toBe(false);
  });
  it("圆弧水平投影与题给正弦反求半径，改值保留依据",()=>{
    const p=plan([force(150,6),{kind:"vertical_arc",radiusM:null,horizontalSpanM:63,endAngleDeg:12,trig:{sin:.21},side:"inside",frictionless:true}]);
    const v:any=validateStagePlan(p);expect(v.ok).toBe(true);expect(v.reading.stages[1].radiusM).toBeCloseTo(300,9);
    expect(run(v.reading).sampleAt(6).constraint.normalForceN).toBeCloseTo(1100,8);
    v.reading.stages[1].horizontalSpanM=84;const changed:any=validateStagePlan(v.reading);expect(changed.ok).toBe(true);expect(changed.reading.stages[1].radiusM).toBeCloseTo(400,9);
    v.reading.stages[1].radiusM=200;expect(validateStagePlan(v.reading).ok).toBe(false);
  });
  it("不同数值与负向镜像不硬编码",()=>{
    for (const d of [24,-24,64]) {const p=plan([force(d,4)],0,3);const v:any=validateStagePlan(p);expect(v.ok).toBe(true);expect(v.reading.stages[0].netForceXN).toBeCloseTo(3*d/8,9); const s=run(v.reading).sampleAt(4);expect(s.xM).toBeCloseTo(d,9);expect(s.vxMps).toBeCloseTo(d/2,9);}
  });
  it("带符号位移与沿运动方向的正距离一致，后段继承向左末速",()=>{
    const p=plan([{kind:"constant_force_1d",netForceXN:null,end:{kind:"distance",distanceM:8},kinematics:{displacementM:-8,finalSpeedMps:-4}},{kind:"horizontal_slide",kineticFrictionCoefficient:.2,end:{kind:"speed",speedMps:2}}],0,2);
    const v:any=validateStagePlan(p);expect(v.ok).toBe(true);expect(v.reading.stages[0].netForceXN).toBeCloseTo(-2,9);const s=run(v.reading).sampleAt(5);expect(s.xM).toBeCloseTo(-11,9);expect(s.vxMps).toBeCloseTo(-2,9);
  });
  it("起末速度与位移反求，与累计时长反求恒定阻力复用",()=>{
    const p=plan([{kind:"constant_force_1d",netForceXN:null,end:{kind:"distance",distanceM:12},kinematics:{finalSpeedMps:8}}, {kind:"lossless_turn",lossless:true}, {kind:"incline_slide",lengthM:20,angleDeg:15,trig:{sin:.26},resistanceN:null,kinematics:{elapsedSeconds:5}}],0,110);
    const v:any=validateStagePlan(p);expect(v.ok).toBe(true);expect(v.reading.stages[0].netForceXN).toBeCloseTo(880/3,9);expect(v.reading.stages[2].resistanceN).toBeCloseTo(66,8);
    const motion=run(v.reading);expect(motion.durationSeconds).toBeCloseTo(5,9);expect(motion.sampleAt(3).vyMps).toBeCloseTo(-8*Math.sin(15*Math.PI/180),9);const s=motion.sampleAt(5);expect(Math.hypot(s.vxMps,s.vyMps)).toBeCloseTo(12,9);
    expect(v.reading.stages[2]).not.toHaveProperty("kineticFrictionCoefficient");
  });
  it("题给三角近似统一计算坡底速率及水平定末速距离",()=>{
    const p=plan([{kind:"incline_slide",lengthM:4,angleDeg:24,trig:{sin:.4,cos:.9},kineticFrictionCoefficient:2/9,slidesAfterRelease:true},{kind:"lossless_turn",lossless:true},{kind:"horizontal_slide",kineticFrictionCoefficient:2/9,end:{kind:"speed",speedMps:2}}]);
    const motion=run(p);expect(motion.events.find((e:any)=>e.kind==="lossless_turn").velocityAfter.vxMps).toBeCloseTo(4,10);expect(motion.sampleAt(motion.durationSeconds).xM).toBeCloseTo(2.7,10);expect(motion.sampleAt(motion.durationSeconds).vxMps).toBeCloseTo(2,10);
    const boundary=motion.events.find((e:any)=>e.kind==="lossless_turn").timeSeconds;expect(motion.sampleAt(boundary-1e-8).xM).toBeCloseTo(motion.sampleAt(boundary+1e-8).xM,6);
  });
  it("上滑时间反求 μ 并复用明确往返，保留静摩擦冲突",()=>{
    const p:any=plan([{kind:"incline_slide",direction:"up",lengthM:null,angleDeg:37,trig:{sin:.6,cos:.8},kineticFrictionCoefficient:null,returnsToEntry:true,kinematics:{durationSeconds:2,finalSpeedMps:0}}],16,2);
    const v:any=validateStagePlan(p);expect(v.ok).toBe(true);expect(v.reading.stages[0].kineticFrictionCoefficient).toBeCloseTo(.25,10);
    const motion=run(v.reading);expect(motion.sampleAt(2).xM/Math.cos(37*Math.PI/180)).toBeCloseTo(16,9); const s=motion.sampleAt(motion.durationSeconds);expect(s.xM).toBeCloseTo(0,10);expect(Math.hypot(s.vxMps,s.vyMps)).toBeCloseTo(Math.sqrt(128),9);
    p.stages[0].staticFrictionCoefficient=1;expect(validateStagePlan(p).ok).toBe(false);
  });
  it("重复约束、互斥、不可达、负阻力与手动覆写均报错，真缺项保持缺项",()=>{
    const p:any=plan([force()]);let v:any=validateStagePlan(p);v.reading.stages[0].netForceXN=100;expect(validateStagePlan(v.reading).ok).toBe(false);
    p.stages[0].kinematics.finalSpeedMps=30;expect(validateStagePlan(p).ok).toBe(false);
    expect(validateStagePlan(plan([{kind:"incline_slide",angleDeg:30,lengthM:2,resistanceN:2,kineticFrictionCoefficient:.2,slidesAfterRelease:true}])).ok).toBe(false);
    const missing:any=validateStagePlan(plan([{kind:"constant_force_1d",netForceXN:null,end:{kind:"duration",durationSeconds:2}}]));expect(missing.missingKeys).toContain("/stages/0/netForceXN");
    for(const speed of [5,2]) expect(validateStagePlan(plan([{kind:"horizontal_slide",kineticFrictionCoefficient:0,end:{kind:"speed",speedMps:speed}}],4)).ok).toBe(false);
    const mirror=run(plan([{kind:"constant_force_1d",netForceXN:-4,end:{kind:"duration",durationSeconds:2}},{kind:"horizontal_slide",kineticFrictionCoefficient:.2,end:{kind:"speed",speedMps:2}}],0,2));expect(mirror.sampleAt(mirror.durationSeconds).vxMps).toBeCloseTo(-2,10);expect(mirror.sampleAt(mirror.durationSeconds).xM).toBeCloseTo(-7,10);
    const same=run(plan([{kind:"horizontal_slide",kineticFrictionCoefficient:0,end:{kind:"speed",speedMps:4}}],4));expect(same.durationSeconds).toBe(0);
  });
});
