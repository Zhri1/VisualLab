import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {assembleScene,buildMotion,validateStagePlan} from "../index.ts";
import {validateStagePlan as validateCloud} from "../../../functions/stagePlan.ts";
import {adaptStageMotion} from "../../adapters/stageMotionAdapter.ts";
const fixture=()=>JSON.parse(readFileSync(new URL("../../../fixtures/projectile-reversal.reading.json",import.meta.url),"utf8"));
function run(p:any){const a:any=assembleScene(p);if(!a.ok)throw Error(JSON.stringify(a));const b:any=buildMotion(a.scene);if(!b.ok)throw Error(JSON.stringify(b));return b.motion;}
describe("抛体明确等速反向与冲量",()=>{
  it("合成基准：两分量取反、位置连续、终帧采用碰后状态",()=>{
    const p=fixture(), m=run(p),e=m.events.find((e:any)=>e.kind==="velocity_reversal");
    expect(m.durationSeconds).toBeCloseTo(.4,12);expect(e.velocityBefore).toEqual({vxMps:6,vyMps:-4});expect(e.velocityAfter).toEqual({vxMps:-6,vyMps:4});
    expect(e.impulseNs.jxNs).toBe(-6);expect(e.impulseNs.jyNs).toBe(4);expect(e.impulseNs.magnitudeNs).toBeCloseTo(Math.sqrt(52),12);
    const before=m.sampleAt(.4-1e-9),at=m.sampleAt(.4),after=m.sampleAt(.4+1e-9);expect(before.xM).toBeCloseTo(at.xM,7);expect(before.yM).toBeCloseTo(at.yM,7);expect(at).toMatchObject({vxMps:-6,vyMps:4});expect(after).toEqual(at);
    expect(m.events.some((x:any)=>["land","ground_bounce"].includes(x.kind))).toBe(false);
    const adapted=adaptStageMotion(m,p);expect(adapted.events.find(e=>e.eventKind==="velocity_reversal")?.impulseNs).toEqual(e.impulseNs);
    expect(validateCloud(p)).toEqual(validateStagePlan(p));
  });
  it("反向后首个最高点继续使用反向水平速度，不补落地",()=>{
    const p=fixture();p.stages[0].reversal.stopAt="first_apex";const m=run(p);expect(m.durationSeconds).toBeCloseTo(.8,12);expect(m.sampleAt(.6)).toMatchObject({vxMps:-6});expect(m.sampleAt(.8).xM).toBeCloseTo(0,12);expect(m.sampleAt(.8).yM).toBeCloseTo(0,12);expect(m.sampleAt(.8).vyMps).toBe(0);expect(m.events.at(-1).kind).toBe("apex");
  });
  it("另一组数值与向左镜像，冲量等于两倍动量",()=>{
    for(const vx of [8,-8]) {const p=fixture();p.massKg=.3;p.initial.vxMps=vx;p.stages[0].dropHeightM=1.8;const m=run(p),e=m.events.at(-1);expect(m.durationSeconds).toBeCloseTo(.6,12);expect(e.velocityBefore.vxMps).toBe(vx);expect(e.velocityBefore.vyMps).toBeCloseTo(-6,12);expect(e.velocityAfter.vxMps).toBe(-vx);expect(e.impulseNs.magnitudeNs).toBeCloseTo(6,12);expect(e.impulseNs.jxNs).toBeCloseTo(-.6*vx,12);}
  });
  it("改落差与质量后重算冲量，回包不冻结旧速度",()=>{
    const v:any=validateStagePlan(fixture());v.reading.stages[0].dropHeightM=1.8;v.reading.massKg=.25;const m=run(v.reading);expect(m.events.at(-1).impulseNs.magnitudeNs).toBeCloseTo(.5*Math.sqrt(72),12);
  });
  it("互斥、缺质量、未登记条件、升向触发和非终段均拒绝",()=>{
    const p=fixture();delete p.massKg;const v:any=validateStagePlan(p);expect(v.missingKeys).toContain("/massKg");
    const both=fixture();both.stages[0].bounce={normalRestitution:1,stopAt:"first_apex"};expect(validateStagePlan(both).ok).toBe(false);
    const bad=fixture();bad.stages[0].reversal.kind="vertical_only";expect(validateStagePlan(bad).ok).toBe(false);
    const continued=fixture();continued.stages.push({kind:"incline_slide",lengthM:1,angleDeg:30,kineticFrictionCoefficient:0});expect(validateStagePlan(continued).ok).toBe(false);
    const zero=fixture();zero.stages[0].dropHeightM=0;expect(assembleScene(zero).ok).toBe(false);
  });
});
