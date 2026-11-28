// 由 scripts/sync-functions.mjs 从 src/physics/binaryCircularOrbit.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
import { solveCircularOrbit } from "./circularOrbit.ts";
import type { DerivedCalculation } from "./gaokaoConstraints.ts";
import type { StagePlanValidation, StagePlanDraft, ResolvedStagePlan, StageFieldError } from "./stagePlan.ts";

export const DEFAULT_GRAVITATIONAL_CONSTANT = 6.67430e-11;
export type BinaryCircularOrbitStage = {
  kind: "binary_circular_orbit";
  separationM: number;
  mass1Kg: number;
  mass2Kg: number;
  totalMassKg: number;
  massRatioM1OverM2?: number | null;
  periodSeconds?: number | null;
  gravitationalConstantM3KgS2: number;
  direction: "ccw" | "cw";
  initialAngleDeg: number;
  orbits: number;
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const close = (a: number, b: number) => Math.abs(a-b) <= 1e-6 * Math.max(Math.abs(a),Math.abs(b));
const path = "/stages/0";

export function validateBinaryCircularOrbitPlan(raw: Record<string, unknown>): StagePlanValidation {
  const errors: StageFieldError[] = [], missing: string[] = [], calculations: DerivedCalculation[] = [];
  const issue = (at: string, code: string, message: string) => errors.push({path:at,code,message});
  const stages = raw.stages as unknown[];
  const source = stages.find(s=>record(s) && s.kind === "binary_circular_orbit") as Record<string,unknown>;
  const stage = {...source};
  const draft: StagePlanDraft = {kind:"stage_plan",schemaVersion:1,initial:{speedMps:0},stages:[stage]};
  if (raw.kind !== "stage_plan" || raw.schemaVersion !== 1) issue("/schemaVersion","UNSUPPORTED","需要阶段计划版本1。");
  if (stages.length !== 1) issue("/stages","UNSUPPORTED","双星圆轨道仅支持独立单阶段。");
  for (const key of ["bodies","primaryBodyId","massKg","gravityMps2","scaleMode","energy","constraints"]) if (raw[key] != null) issue("/"+key,"PRECONDITION_CONFLICT","双星题设应写在双星阶段中，不能混用其他模型入口。");
  if (raw.initial != null && (!record(raw.initial) || Object.keys(raw.initial).some(k=>k!=="speedMps") || raw.initial.speedMps != null && raw.initial.speedMps!==0)) issue("/initial","PRECONDITION_CONFLICT","双星速度由轨道确定，initial只能省略或为speedMps:0占位。");
  const prior = Array.isArray(raw.derivedCalculations) ? raw.derivedCalculations.filter(record) : [];
  const numbers: Record<string,number|null> = {};
  const keys = ["separationM","mass1Kg","mass2Kg","totalMassKg","massRatioM1OverM2","periodSeconds","gravitationalConstantM3KgS2"];
  for (const key of keys) {
    const value=source[key];
    if (value == null) {numbers[key]=null;continue;}
    if (!finite(value)) {issue(path+"/"+key,typeof value === "number" ? "NOT_FINITE" : "TYPE","需要有限数值。");numbers[key]=null;continue;}
    if (value<=0) issue(path+"/"+key,"RANGE","数值必须大于0。");
    const old=prior.find(c=>c.targetPath === path+"/"+key && ["binary_period_mass","binary_mass_distribution","binary_mass_sum"].includes(String(c.rule)));
    // 只有未被手工改写的旧派生值可重新推导。
    const recompute=old && finite(old.value) && value===old.value;
    numbers[key]=recompute ? null : value;
    if (recompute) stage[key]=null;
  }
  const g=numbers.gravitationalConstantM3KgS2 ?? DEFAULT_GRAVITATIONAL_CONSTANT;
  stage.gravitationalConstantM3KgS2=g;
  const d=numbers.separationM, period=numbers.periodSeconds, ratio=numbers.massRatioM1OverM2;
  if (d===null) missing.push(path+"/separationM");
  const candidates: {value:number;rule:DerivedCalculation["rule"];paths:string[]}[]=[];
  if (numbers.totalMassKg!==null) candidates.push({value:numbers.totalMassKg,rule:"binary_mass_sum",paths:[path+"/totalMassKg"]});
  if (numbers.mass1Kg!==null && numbers.mass2Kg!==null) candidates.push({value:numbers.mass1Kg+numbers.mass2Kg,rule:"binary_mass_sum",paths:[path+"/mass1Kg",path+"/mass2Kg"]});
  if (d!==null && period!==null && d>0 && period>0) candidates.push({value:4*Math.PI*Math.PI*(d/period)*(d/period)*d/g,rule:"binary_period_mass",paths:[path+"/separationM",path+"/periodSeconds",path+"/gravitationalConstantM3KgS2"]});
  const total=candidates[0]?.value ?? null;
  if (total!==null && (!Number.isFinite(total) || total<=0)) issue(path+"/totalMassKg","RANGE","反求总质量超出有限正数范围。");
  if (total!==null && candidates.some(c=>!close(c.value,total))) issue(path+"/totalMassKg","PRECONDITION_CONFLICT","题给质量、星间距与共同周期互相矛盾。");
  const put = (key:string,value:number,rule:DerivedCalculation["rule"],inputs:string[]) => {
    if (!Number.isFinite(value) || value<=0) {issue(path+"/"+key,"RANGE","反求质量必须为有限正数。");return;}
    if (numbers[key]!==null && !close(numbers[key]!,value)) issue(path+"/"+key,"PRECONDITION_CONFLICT","质量分配与总质量或质量比不一致。");
    else if (numbers[key]===null) calculations.push({stageIndex:0,targetPath:path+"/"+key,quantity:key==="totalMassKg" ? "binary_total_mass" : "binary_star_mass",value,unit:"kg",source:"derived",rule,inputPaths:inputs});
    stage[key]=value;
  };
  if (total!==null && Number.isFinite(total) && total>0) {
    put("totalMassKg",total,candidates[0].rule,candidates[0].paths);
    let m1=numbers.mass1Kg, m2=numbers.mass2Kg;
    if (ratio!==null && ratio>0) {
      // 避免先计算 M*ratio 造成不必要的溢出。
      m1=total*(ratio>=1 ? 1/(1+1/ratio) : ratio/(1+ratio));
      m2=total/(1+ratio);
      put("mass1Kg",m1,"binary_mass_distribution",[path+"/totalMassKg",path+"/massRatioM1OverM2"]);
      put("mass2Kg",m2,"binary_mass_distribution",[path+"/totalMassKg",path+"/massRatioM1OverM2"]);
    } else if (m1!==null || m2!==null) {
      if(m1===null)m1=total-m2!;if(m2===null)m2=total-m1;
      put("mass1Kg",m1,"binary_mass_distribution",[path+"/totalMassKg",path+"/mass2Kg"]);
      put("mass2Kg",m2,"binary_mass_distribution",[path+"/totalMassKg",path+"/mass1Kg"]);
    } else missing.push(path+"/massRatioM1OverM2");
  } else if (ratio!==null) missing.push(path+"/totalMassKg");
  else {if(numbers.mass1Kg===null)missing.push(path+"/mass1Kg");if(numbers.mass2Kg===null)missing.push(path+"/mass2Kg");}
  if (source.direction == null) stage.direction="ccw";
  else if (!["ccw","cw"].includes(String(source.direction))) issue(path+"/direction","UNSUPPORTED","方向仅支持ccw或cw。");
  for (const [key,fallback] of [["initialAngleDeg",0],["orbits",1]] as const) {
    const value=source[key] ?? fallback;stage[key]=value;
    if (!finite(value) || key==="orbits" && value<=0) issue(path+"/"+key,"RANGE","角度须有限，观察圈数须为有限正数。");
  }
  if (calculations.length) draft.derivedCalculations=calculations;
  if (!missing.length && !errors.length) {
    try {solveBinaryCircularOrbit(stage as BinaryCircularOrbitStage);} catch(e) {issue(path,"RANGE",(e as Error).message);}
  }
  if (errors.length || missing.length) return {ok:false,code:errors.some(e=>e.code==="TYPE")?"INVALID_READING":errors.some(e=>e.code==="UNSUPPORTED")?"UNSUPPORTED":errors.length?"INCONSISTENT_CONDITIONS":"NEEDS_INPUT",message:errors.length?"请修正标记的双星条件。":"请补齐双星轨道所需的质量或质量比；已确定的总质量已保留。",reading:draft,missingKeys:missing,fieldErrors:errors};
  return {ok:true,reading:draft as ResolvedStagePlan};
}

export function solveBinaryCircularOrbit(stage: BinaryCircularOrbitStage) {
  const total=stage.mass1Kg+stage.mass2Kg;
  const relative=solveCircularOrbit({kind:"circular_orbit",gravitationalParameterM3s2:stage.gravitationalConstantM3KgS2*total,orbitalRadiusM:stage.separationM,direction:stage.direction,initialAngleDeg:stage.initialAngleDeg,orbits:stage.orbits});
  const fraction1=stage.mass2Kg/total, fraction2=stage.mass1Kg/total;
  const radii=[fraction1*stage.separationM,fraction2*stage.separationM];
  const speeds=[fraction1*relative.orbitalSpeedMps,fraction2*relative.orbitalSpeedMps];
  if (![total,...radii,...speeds].every(v=>Number.isFinite(v)&&v>0)) throw new RangeError("双星质量、轨道半径或速率超出有限正数范围。");
  const at=(time:number)=>{
    const r=relative.at(Number.isNaN(time)?0:time);
    const map=(factor:number)=>({xM:factor*r.xM,yM:factor*r.yM,vxMps:factor*r.vxMps,vyMps:factor*r.vyMps});
    return [map(-fraction1),map(fraction2)] as const;
  };
  return {relative,radii,speeds,periodSeconds:relative.periodSeconds,durationSeconds:relative.durationSeconds,at};
}
