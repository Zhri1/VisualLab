import { solveBinaryCircularOrbit, type BinaryCircularOrbitStage } from "./binaryCircularOrbit.ts";
import type { BodyState } from "./multiBodyTypes.ts";
import type { StageMotion, StageEvent } from "./stageMotion.ts";
import type { DerivedCalculation } from "./gaokaoConstraints.ts";
export type BinaryCircularOrbitGeometry = {
  center:{xM:number;yM:number};separationM:number;periodSeconds:number;direction:"cw"|"ccw";
  stars:{bodyId:string;radiusM:number;speedMps:number;massKg:number}[];
};
export function computeBinaryCircularOrbitMotion(stage:BinaryCircularOrbitStage,derived:DerivedCalculation[]=[]):StageMotion {
  const solved=solveBinaryCircularOrbit(stage),ids=["star1","star2"],masses=[stage.mass1Kg,stage.mass2Kg];
  const bodies=ids.map((bodyId,i)=>({bodyId,massKg:masses[i]}));
  const sampleAt=(time:number)=>{
    const states=solved.at(time);
    const snapshot=Object.fromEntries(states.map((state,i):[string,BodyState]=>[ids[i],{...bodies[i],...state,springCompressionM:0,status:"moving"}]));
    return {...snapshot.star1,bodies:snapshot,constraints:{}};
  };
  const fmt=(v:number)=>v.toPrecision(6);
  const events:StageEvent[]=solved.relative.events.map((e,index)=>{
    const snapshot=sampleAt(e.timeSeconds);
    return {id:`0:${e.kind}:${index}`,stageIndex:0,kind:e.kind,timeSeconds:e.timeSeconds,order:index,bodyIds:ids,
      label:e.kind==="orbit_start"?"双星圆轨起点":e.label,
      explanation:`两星绕固定质心${stage.direction==="cw"?"顺时针":"逆时针"}同步运行；d=${fmt(stage.separationM)} m，r₁=${fmt(solved.radii[0])} m，r₂=${fmt(solved.radii[1])} m，v₁=${fmt(solved.speeds[0])} m/s，v₂=${fmt(solved.speeds[1])} m/s，共同周期T=${fmt(solved.periodSeconds)} s。`,
      velocityBefore:{vxMps:snapshot.vxMps,vyMps:snapshot.vyMps},velocityAfter:{vxMps:snapshot.vxMps,vyMps:snapshot.vyMps},bodyStatesBefore:snapshot.bodies,bodyStatesAfter:snapshot.bodies};
  });
  const last=events[events.length-1];
  return {primaryBodyId:"star1",durationSeconds:solved.durationSeconds,geometry:{blockSizeM:0.3,positionReference:"particle",bodies,binaryCircularOrbit:{center:{xM:0,yM:0},separationM:stage.separationM,periodSeconds:solved.periodSeconds,direction:stage.direction,stars:bodies.map((b,i)=>({...b,radiusM:solved.radii[i],speedMps:solved.speeds[i]}))}},
    segments:[{stageIndex:0,kind:"binary_circular_orbit",bodyIds:ids,startSeconds:0,endSeconds:solved.durationSeconds}],events,
    termination:{reason:"orbit_complete",eventId:last.id,stageIndex:0},endReason:"orbit_complete",
    motionStatus:{state:"range_end",reason:"orbit_complete",message:"完成指定圈数观察，两星仍保持圆轨道运动。",bodyIds:ids},
    calculations:[...derived.map(c=>({...c})),{quantity:"binary_period",value:solved.periodSeconds,unit:"s",source:"derived",rule:"relative_circular_orbit",inputPaths:["/stages/0"]}],sampleAt};
}
