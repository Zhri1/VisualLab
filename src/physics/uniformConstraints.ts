import type { DerivedCalculation } from "./gaokaoConstraints.ts";

type Obj = Record<string, any>;
const obj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const close = (a: number, b: number) => Math.abs(a-b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
export function inclineTrig(stage: { angleDeg: number; trig?: { sin?: number; cos?: number } }) {
  const rad = stage.angleDeg * Math.PI / 180;
  return { sin: stage.trig?.sin ?? Math.sin(rad), cos: stage.trig?.cos ?? Math.cos(rad) };
}

// 只对已知入口状态的直线匀变速阶段递推，不猜测其他模块的出口。
export function resolveUniformConstraints(raw: Obj) {
  const plan = { ...raw, stages: raw.stages.map((s: Obj) => ({ ...s, ...(obj(s.end) ? { end: { ...s.end } } : {}) })) };
  const errors: { path: string; code: string; message: string }[] = [];
  const calculations: DerivedCalculation[] = [];
  const prior: DerivedCalculation[] = Array.isArray(raw.derivedCalculations) ? raw.derivedCalculations : [];
  const fail = (path: string, message: string, code = "PRECONDITION_CONFLICT") => errors.push({path, code, message});
  let velocity: number | null = num(raw.initial?.speedMps) ? raw.initial.speedMps : null;
  const g = raw.gravityMps2, m = raw.massKg;
  let elapsed: number | null = 0;
  for (const [i, s] of plan.stages.entries()) {
    const path = `/stages/${i}`;
    if (s.kind === "vertical_arc" && "horizontalSpanM" in s) {
      const theta=s.endAngleDeg, span=s.horizontalSpanM;
      if (s.path != null || s.verticalDropM != null) fail(path, "水平投影反求与显式路径、竖直落差反求互斥。");
      else if (!num(theta) || theta<=0 || theta>=90 || !num(span) || span<=0) fail(path+"/horizontalSpanM", "水平投影反求需要正投影与0到90度之间的出口角。", "RANGE");
      else {
        const exactSin=Math.sin(theta*Math.PI/180), sine=s.trig?.sin ?? exactSin;
        if (!num(sine) || sine<=0 || sine>=1 || Math.abs(sine-exactSin)>.02 || s.trig != null && (!obj(s.trig) || Object.keys(s.trig).some(k=>k!=="sin"))) fail(path+"/trig", "水平投影反求仅接受题给出口角正弦近似。", "RANGE");
        else {
          const radius=span/sine, old=prior.find(c=>c.rule === "arc_radius_from_horizontal_span" && c.targetPath===path+"/radiusM");
          if (s.radiusM==null || old && num(s.radiusM) && close(s.radiusM,old.value)) {
            s.radiusM=radius;
            calculations.push({stageIndex:i,targetPath:path+"/radiusM",quantity:"arc_radius",value:radius,unit:"m",source:"derived",rule:"arc_radius_from_horizontal_span",inputPaths:[path+"/horizontalSpanM",path+"/endAngleDeg",path+"/trig"]});
          } else if (num(s.radiusM) && !close(s.radiusM,radius)) fail(path+"/radiusM", "给定半径与水平投影约束冲突。");
        }
      }
    }
    if (s.kind === "lossless_turn" && s.lossless === true) continue;
    if (!["constant_force_1d", "incline_slide", "horizontal_slide"].includes(s.kind)) { velocity = null; elapsed = null; continue; }
    const incline = s.kind === "incline_slide", force = s.kind === "constant_force_1d";
    if (incline && s.trig != null) {
      const t = s.trig, r = s.angleDeg * Math.PI / 180;
      if (!obj(t) || !Object.keys(t).length || Object.entries(t).some(([k,v])=>!["sin","cos"].includes(k) || !num(v) || v<=0 || v>=1 || Math.abs(v-(k==="sin"?Math.sin(r):Math.cos(r)))>.02) || num(t.sin) && num(t.cos) && Math.abs(t.sin*t.sin+t.cos*t.cos-1)>.05) fail(path+"/trig", "题给三角函数近似值与角度不符。", "RANGE");
    }
    if (incline && "resistanceN" in s && "kineticFrictionCoefficient" in s) fail(path, "恒定阻力与动摩擦因数互斥。");
    if (s.returnsToEntry != null && (s.returnsToEntry !== true || !incline || s.direction !== "up")) fail(path+"/returnsToEntry", "返回约束仅用于明确上滑后返回的斜面。");
    if (s.kinematics != null && (!obj(s.kinematics) || Object.entries(s.kinematics).some(([k,v])=>!["durationSeconds","displacementM","finalSpeedMps","elapsedSeconds"].includes(k) || !num(v)))) fail(path+"/kinematics", "运动约束须为有限数值的已登记字段。", "TYPE");
    if (velocity === null) continue;
    if (!force && !incline && s.kinematics != null) { fail(path+"/kinematics", "水平摩擦段请用已登记的结束条件。", "UNSUPPORTED"); continue; }
    const u = force ? velocity : Math.abs(velocity);
    const trig = incline ? inclineTrig(s) : {sin:0, cos:1};
    const kin = s.kinematics;
    const target = force ? "netForceXN" : "resistanceN" in s ? "resistanceN" : "kineticFrictionCoefficient";
    const previous = prior.find(c=>c.rule === "uniform_acceleration" && c.targetPath === path+"/"+target);
    const derived = s[target] == null || (previous && num(s[target]) && close(s[target], previous.value));
    let a: number | null = null;
    if (kin != null) {
      if (!obj(kin)) fail(path+"/kinematics", "运动约束须为对象。", "TYPE");
      else {
        for (const [k,v] of Object.entries(kin)) {
          if (!["durationSeconds", "displacementM", "finalSpeedMps", "elapsedSeconds"].includes(k) || !num(v)) fail(path+"/kinematics/"+k, "需要有限数值的已登记运动约束。", "TYPE");
          else if (((k === "durationSeconds" || k === "elapsedSeconds") && v <= 0) || (!force && v < 0)) fail(path+"/kinematics/"+k, "运动约束数值超出范围。", "RANGE");
        }
        const times = [kin.durationSeconds, num(kin.elapsedSeconds) && elapsed !== null ? kin.elapsedSeconds-elapsed : undefined, s.end?.kind === "duration" ? s.end.durationSeconds : undefined].filter(num);
        const distanceDirection = force ? Math.sign(u || s.netForceXN || kin.finalSpeedMps || kin.displacementM || 1) : 1;
        const distances = [kin.displacementM, s.end?.kind === "distance" && num(s.end.distanceM) ? distanceDirection*s.end.distanceM : undefined, incline && s.direction !== "up" ? s.lengthM : undefined].filter(num);
        if (times.some(t=>!close(times[0],t))) fail(path+"/kinematics/durationSeconds", "重复时长约束冲突。");
        if (distances.length > 1 && !close(distances[0],distances[1])) fail(path+"/kinematics/displacementM", "重复位移约束冲突。");
        const t=times[0], d=distances[0], v=kin.finalSpeedMps;
        if (num(t) && t<=0) fail(path+"/kinematics", "本段用时必须大于零。");
        if (force && s.end?.kind === "distance" && num(v) && v!==0 && Math.sign(v)!==distanceDirection) fail(path+"/kinematics/finalSpeedMps", "定距结束只到首次到达，不跨越停止折返。");
        const candidates: number[]=[];
        if (num(t) && t>0 && num(d)) candidates.push(2*(d-u*t)/(t*t));
        if (num(t) && t>0 && num(v)) candidates.push((v-u)/t);
        if (num(d) && d!==0 && num(v)) candidates.push((v*v-u*u)/(2*d));
        if (candidates.length) {
          a=candidates[0];
          if (candidates.some(x=>!close(x,a!))) fail(path+"/kinematics", "位移、速度与用时约束不一致。");
          const dt = num(t) ? t : num(v) && !close(a,0) ? (v-u)/a : num(d) && close(a,0) && u!==0 ? d/u : null;
          if (dt !== null && (dt<0 || (!force && u+a*dt < -1e-8))) fail(path+"/kinematics", "给定约束跨越停止点或不可达。");
          if (derived && (target !== "resistanceN" || num(m) && m>0) && (!force || num(m) && m>0) && (!incline || num(g) && g>0)) {
            const value = force ? m*a : target === "resistanceN" ? m*((s.direction === "up" ? -1 : 1)*g*trig.sin-a) : s.direction === "up" ? (-a/g-trig.sin)/trig.cos : (trig.sin-a/g)/trig.cos;
            if (!num(value) || (!force && value < -1e-9)) fail(path+"/"+target, "反求得到负阻力或无效物理量。");
            else {
              s[target]=Math.abs(value)<1e-12 ? 0 : value;
              calculations.push({stageIndex:i,targetPath:path+"/"+target,quantity:force ? "net_force" : target === "resistanceN" ? "resistance" : "friction_coefficient",value:s[target],unit:force || target === "resistanceN" ? "N" : "1",source:"derived",rule:"uniform_acceleration",inputPaths:["/initial",path+"/kinematics",path+"/end",path+"/lengthM",path+"/trig","/massKg","/gravityMps2"]});
            }
          }
          if (force && !s.end) {
            if (num(t) && t>0) s.end={kind:"duration",durationSeconds:t};
            else if (num(d) && d>0) s.end={kind:"distance",distanceM:d};
          }
        }
      }
    }
    let actualA: number | null = null;
    if (force && num(s.netForceXN) && num(m) && m>0) actualA=s.netForceXN/m;
    if (incline && num(g)) {
      const resistance = "resistanceN" in s ? num(s.resistanceN) && num(m) && m>0 ? s.resistanceN/m : null : num(s.kineticFrictionCoefficient) ? g*s.kineticFrictionCoefficient*trig.cos : null;
      if (resistance !== null) actualA=(s.direction === "up" ? -1 : 1)*g*trig.sin-resistance;
    }
    if (!force && !incline && num(s.kineticFrictionCoefficient)) actualA=s.kineticFrictionCoefficient===0 ? 0 : num(g) ? -g*s.kineticFrictionCoefficient : null;
    if (a !== null && actualA !== null && !close(a,actualA)) fail(path+"/kinematics", "运动约束与给定力或阻力冲突。");
    if (incline && s.returnsToEntry === true && actualA !== null && (g*trig.sin <= (s.resistanceN !== undefined ? s.resistanceN/m : g*s.kineticFrictionCoefficient*trig.cos)+1e-9 || num(s.staticFrictionCoefficient) && trig.sin <= s.staticFrictionCoefficient*trig.cos+1e-9)) fail(path+"/returnsToEntry", "给定阻力或静摩擦条件不能支持自行返回。");
    if (s.kind === "horizontal_slide" && s.end?.kind === "speed" && num(s.end.speedMps) && actualA !== null) {
      const v=s.end.speedMps;
      if (v<0 || v>u+1e-9 || (close(actualA,0) && !close(v,u))) fail(path+"/end/speedMps", "摩擦减速无法到达给定末速率。");
      velocity=Math.sign(velocity || 1)*v;
    } else if (actualA !== null) {
      const t=s.end?.kind === "duration" ? s.end.durationSeconds : null;
      const d=incline ? s.lengthM : s.end?.kind === "distance" ? s.end.distanceM : null;
      if (num(t)) velocity=u+actualA*t;
      else if (num(d) && u*u+2*actualA*d*(force ? Math.sign(u || actualA) : 1)>=0) velocity=Math.sqrt(u*u+2*actualA*d*(force ? Math.sign(u || actualA) : 1))*(force ? Math.sign(u || actualA) : 1);
      else if (s.end?.kind === "stop") velocity=0;
      else velocity=null;
      if (incline && s.direction === "up") velocity=null;
    } else velocity=null;
    if (elapsed !== null && actualA !== null && velocity !== null) {
      const dt = force && s.end?.kind === "duration" ? s.end.durationSeconds : close(actualA,0) ? (num(s.lengthM) ? s.lengthM/u : num(s.end?.distanceM) ? s.end.distanceM/u : 0) : ((force ? velocity : Math.abs(velocity))-u)/actualA;
      elapsed = num(dt) && dt>=0 ? elapsed+dt : null;
    } else elapsed=null;
  }
  return {input:plan,errors,calculations};
}
