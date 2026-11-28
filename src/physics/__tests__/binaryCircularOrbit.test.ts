import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {assembleStageScene,validateStagePlan} from "../index.ts";
import {validateStagePlan as cloudValidate} from "../../../functions/stagePlan.ts";
import {adaptStageMotion} from "../../adapters/stageMotionAdapter.ts";
import {computeDefaultPace,advancePlayback} from "../../ui/components/workspace/playback.ts";
import {updateStagePlanNumber} from "../../ui/components/workspace/StagePlanEditor.tsx";
import {forcesAt} from "../../features/forces/forceModel.ts";
const fixture=()=>JSON.parse(readFileSync(new URL("../../../fixtures/binary-circular-orbit.reading.json",import.meta.url),"utf8"));
const build=(p:unknown)=>{const a=assembleStageScene(p);if(!a.ok)throw Error(JSON.stringify(a));return a.scene;};
const relativeClose=(actual:number,expected:number)=>expect(actual/expected).toBeCloseTo(1,11);
describe("孤立双星共质心圆轨道",()=>{
  it("基准与另一组质量/间距：r、速率比、间距、质心位置速度同时成立",()=>{
    for(const [m1,m2,d] of [[2e30,1e30,3e9],[4e26,1e26,2e8],[1e27,1e27,7e7]]){
      const p=fixture();Object.assign(p.stages[0],{mass1Kg:m1,mass2Kg:m2,separationM:d});
      const {motion}=build(p),g=motion.geometry.binaryCircularOrbit!,T=2*Math.PI*Math.sqrt(d**3/(6.67430e-11*(m1+m2)));
      relativeClose(g.stars[0].radiusM,d*m2/(m1+m2));relativeClose(g.stars[1].radiusM,d*m1/(m1+m2));relativeClose(g.periodSeconds,T);relativeClose(g.stars[0].speedMps/g.stars[1].speedMps,m2/m1);
      for(const f of [0,.125,.25,.5,.73,1]){
        const s=motion.sampleAt(f*T).bodies!,a=s.star1,b=s.star2;
        relativeClose(Math.hypot(b.xM-a.xM,b.yM-a.yM),d);
        expect(Math.hypot((m1*a.xM+m2*b.xM)/(m1+m2),(m1*a.yM+m2*b.yM)/(m1+m2))/d).toBeLessThan(1e-12);
        expect(Math.hypot((m1*a.vxMps+m2*b.vxMps)/(m1+m2),(m1*a.vyMps+m2*b.vyMps)/(m1+m2))/g.stars[1].speedMps).toBeLessThan(1e-12);
      }
      const half=motion.sampleAt(T/2).bodies!;expect(half.star1.xM).toBeGreaterThan(0);expect(half.star2.xM).toBeLessThan(0);
      relativeClose(motion.sampleAt(T).bodies!.star2.xM,g.stars[1].radiusM);
      expect(motion.events.map(e=>e.kind)).toEqual(["orbit_start","orbit_half","orbit_complete"]);expect(motion.events[1].bodyStatesAfter?.star2.xM).toBeLessThan(0);
    }
  });
  it("顺逆向及半周观察使用同一时钟，默认约12s一圈",()=>{
    const p=fixture();p.stages[0].direction="cw";p.stages[0].orbits=.5;
    const s=build(p),T=s.geometry.binaryCircularOrbit!.periodSeconds;
    expect(s.motion.sampleAt(0).bodies!.star2.vyMps).toBeLessThan(0);relativeClose(s.motion.durationSeconds,T/2);
    const display=adaptStageMotion(s.motion,s.reading),pace=computeDefaultPace(display);expect(T/pace).toBeGreaterThan(10);expect(T/pace).toBeLessThan(15);
    const next=advancePlayback(0,7,pace,display.durationSeconds,display.events);expect(next.pause).toBe(true);relativeClose(next.time,T/2);
    expect(s.motion.sampleAt(T).bodies).toEqual(s.motion.sampleAt(T/2).bodies);
  });
  it("周期、间距、甲乙质量比反求：API规范化回包及条件编辑后重新推导",()=>{
    const p:any={kind:"stage_plan",schemaVersion:1,stages:[{kind:"binary_circular_orbit",separationM:8e8,periodSeconds:86400,massRatioM1OverM2:4,gravitationalConstantM3KgS2:6.67e-11}]};
    const v=validateStagePlan(p);expect(v.ok).toBe(true);if(!v.ok)return;
    const expected=4*Math.PI**2*(8e8)**3/(6.67e-11*86400**2);const s:any=v.reading.stages[0];relativeClose(s.totalMassKg,expected);relativeClose(s.mass1Kg,.8*expected);relativeClose(s.mass2Kg,.2*expected);
    relativeClose(build(v.reading).geometry.binaryCircularOrbit!.periodSeconds,86400);expect(v.reading.derivedCalculations?.some(c=>c.rule==="binary_period_mass")).toBe(true);
    const edited=updateStagePlanNumber(v.reading,0,"separationM",1.6e9);const rebuilt=build(edited);relativeClose((rebuilt.reading.stages[0] as any).totalMassKg,8*expected);
    const slower=build(updateStagePlanNumber(v.reading,0,"periodSeconds",172800));relativeClose((slower.reading.stages[0] as any).totalMassKg,expected/4);relativeClose(slower.geometry.binaryCircularOrbit!.periodSeconds,172800);
    const ratioEdit=updateStagePlanNumber(rebuilt.reading,0,"massRatioM1OverM2",1);const equal=build(ratioEdit).geometry.binaryCircularOrbit!;relativeClose(equal.stars[0].radiusM,equal.stars[1].radiusM);
    const manual=updateStagePlanNumber(v.reading,0,"mass1Kg",expected);expect(validateStagePlan(manual).ok).toBe(false);
    const removed=updateStagePlanNumber(v.reading,0,"massRatioM1OverM2",null);
    const partial=validateStagePlan(removed);expect(partial.ok).toBe(false);if(partial.ok)return;
    expect(partial.reading?.stages[0].mass1Kg).toBeNull();expect(partial.missingKeys).toContain("/stages/0/massRatioM1OverM2");
    const repeated=validateStagePlan(partial.reading);expect(repeated.ok).toBe(false);if(!repeated.ok)expect(repeated.missingKeys).toContain("/stages/0/massRatioM1OverM2");
  });
  it("只给d和T时保留可确定总质量，不默认等质量；补比例后正常装配",()=>{
    const p:any={kind:"stage_plan",schemaVersion:1,stages:[{kind:"binary_circular_orbit",separationM:8e8,periodSeconds:86400}]};
    const v=validateStagePlan(p);expect(v.ok).toBe(false);if(v.ok)return;
    expect(v.missingKeys).toContain("/stages/0/massRatioM1OverM2");expect(v.reading?.stages[0].totalMassKg).toBeGreaterThan(0);expect(v.reading?.stages[0].mass1Kg).toBeUndefined();
    const next=structuredClone(v.reading!);next.stages[0].massRatioM1OverM2=2;expect(assembleStageScene(next).ok).toBe(true);
  });
  it("总质量与比例等价补全，冗余条件一致才接受，拒绝零质量/顶层入口混用",()=>{
    const p:any={kind:"stage_plan",schemaVersion:1,stages:[{kind:"binary_circular_orbit",separationM:3e9,totalMassKg:3e30,massRatioM1OverM2:2}]};
    const v=validateStagePlan(p);expect(v.ok).toBe(true);if(!v.ok)return;
    const consistent=fixture();consistent.stages[0].totalMassKg=3e30;consistent.stages[0].massRatioM1OverM2=2;consistent.stages[0].periodSeconds=build(consistent).motion.durationSeconds;expect(validateStagePlan(consistent).ok).toBe(true);
    const source=fixture();source.stages[0].totalMassKg=4e30;expect(validateStagePlan(source).ok).toBe(false);
    source.stages[0].totalMassKg=3e30;source.stages[0].periodSeconds=123;expect(validateStagePlan(source).ok).toBe(false);
    source.stages[0].mass1Kg=0;expect(validateStagePlan(source).ok).toBe(false);
    expect(validateStagePlan({...p,bodies:[]} ).ok).toBe(false);expect(validateStagePlan({...p,initial:{vxMps:5,vyMps:0}}).ok).toBe(false);
    expect(cloudValidate(p)).toEqual(v);
    const scene=build(p),display=adaptStageMotion(scene.motion,scene.reading),arrows=forcesAt(display,0);expect(arrows).toHaveLength(2);relativeClose(arrows[0].magnitudeN,arrows[1].magnitudeN);expect(arrows[0].dir.x).toBe(1);expect(arrows[1].dir.x).toBe(-1);
  });
});
