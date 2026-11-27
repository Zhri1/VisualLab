import type { StageKind, StagePlanDraft } from "../../../physics/stagePlan";
import type { FieldError } from "../../../types";
import { MultiBodyPlanEditor } from './MultiBodyPlanEditor';

const STAGE_LABELS: Record<StageKind, string> = {
  horizontal_approach: '水平接近', pendulum_swing:'轻绳摆', collision_1d:'水平正碰', parallel_motion:'同步运动', block_plank:'滑块与木板', pulley_system:'轻绳与定滑轮',
  spring_release: "预压弹簧释放",
  vertical_arc: "竖直圆弧",
  incline_slide: "斜面下滑",
  lossless_turn: "无损转向",
  horizontal_slide: "水平滑动",
  constant_force_1d: "常力匀变速",
  conveyor_belt: "传送带与滑块",
  spring_contact: "弹簧接触",
  projectile: "抛体运动",
  magnetic_deflection: "匀强磁场偏转",
  switchable_em_collision: "分区电磁场与正碰",
  movable_arc: "可移动圆弧槽",
  movable_semicircle: "可平动半圆轨道",
  spring_pair: "自由弹簧双球",
};

const STAGE_KINDS = Object.keys(STAGE_LABELS) as StageKind[];

export function updateStagePlanNumber(draft: StagePlanDraft, index: number | null, key: string, value: number | null): StagePlanDraft {
  const old = index === null ? (draft as unknown as Record<string, unknown>)[key] : draft.stages[index][key];
  const stages = draft.stages.map((stage, i) => i === index ? { ...stage, [key]: value } : { ...stage });
  const changedUpstream = (index === null || key === "kineticFrictionCoefficient") && typeof old === "number" && Number.isFinite(old) && old !== value;
  if (changedUpstream && stages[0]?.kind === "spring_release" && (stages[0].springConstantNpm == null || stages[0].initialCompressionM == null)) stages[0] = { ...stages[0], slidesAfterRelease: null, releaseCompleteByM: null };
  return { ...draft, ...(index === null ? { [key]: value } : {}), stages };
}

type NumberMeta = { key: string; label: string; unit: string; step?: number; hint?: string };
const NUMBER_FIELDS: Partial<Record<StageKind, NumberMeta[]>> = {
  spring_release: [
    { key: "springConstantNpm", label: "弹簧劲度系数 k", unit: "N/m", step: 1, hint: "可补一项以求全程" },
    { key: "initialCompressionM", label: "初始压缩量 c", unit: "m", step: .01 },
    { key: "kineticFrictionCoefficient", label: "释放区动摩擦因数 μ", unit: "", step: .05 },
    { key: "releaseCompleteByM", label: "释放完成位移上界", unit: "m", step: .1, hint: "题设确认c不超过此值；不是实际压缩量" },
  ],
  incline_slide: [
    { key: "lengthM", label: "斜面长度 L", unit: "m", step: 0.1, hint: "上滑留空表示斜面足够长" },
    { key: "angleDeg", label: "斜面倾角 θ", unit: "°", step: 1, hint: "0° < θ < 90°" },
    { key: "kineticFrictionCoefficient", label: "斜面动摩擦因数 μ", unit: "", step: 0.05 },
    { key: "staticFrictionCoefficient", label: "斜面静摩擦因数 μₛ（可选）", unit: "", step: 0.05, hint: "上滑最高点判断用，留空默认等于 μ" },
  ],
  horizontal_slide: [
    { key: "kineticFrictionCoefficient", label: "水平动摩擦因数 μ", unit: "", step: 0.05 },
  ],
  constant_force_1d: [
    { key: "netForceXN", label: "水平恒定合力 F", unit: "N", step: 0.5, hint: "向右为正，向左为负，0 为匀速" },
  ],
  conveyor_belt: [
    { key: "initialBeltSpeedMps", label: "带面初速度 v带₀", unit: "m/s", step: 0.5, hint: "沿带正方向为正" },
    { key: "kineticFrictionCoefficient", label: "动摩擦因数 μₖ", unit: "", step: 0.05 },
    { key: "staticFrictionCoefficient", label: "静摩擦因数 μₛ", unit: "", step: 0.05, hint: "加速带必填；倾斜匀速带留空默认等于 μₖ" },
    { key: "beltLengthM", label: "带长 L（可选）", unit: "m", step: 0.5 },
    { key: "angleDeg", label: "带面倾角 θ（可选）", unit: "°", step: 1, hint: "0° 为水平，0° < θ < 90° 为倾斜传送带" },
  ],
  spring_contact: [{ key: "springConstantNpm", label: "弹簧劲度系数 k", unit: "N/m", step: 10 }],
  movable_arc: [
    { key: "radiusM", label: "圆弧槽半径 R", unit: "m", step: 0.05 },
    { key: "grooveMassKg", label: "槽质量 M", unit: "kg", step: 0.5, hint: "地面光滑，槽可自由滑动" },
  ],
  movable_semicircle: [
    { key: "radiusM", label: "半圆轨道半径 R", unit: "m", step: 0.02 },
    { key: "grooveMassKg", label: "轨道质量 M", unit: "kg", step: 0.1, hint: "置光滑水平面，可自由水平平动" },
  ],
  switchable_em_collision: [
    { key: "massScaleKg", label: "基准质量 m", unit: "kg", step: 0.1, hint: "归一化模式下默认 1" },
    { key: "chargeScaleC", label: "基准电荷 q", unit: "C", step: 0.1, hint: "归一化模式下默认 1" },
    { key: "lengthScaleM", label: "基准长度 L", unit: "m", step: 0.1, hint: "归一化模式下默认 1" },
    { key: "speedScaleMps", label: "基准初速 v₀", unit: "m/s", step: 0.1, hint: "归一化模式下默认 1" },
  ],
  spring_pair: [
    { key: "springConstantNpm", label: "弹簧劲度系数 k（可选）", unit: "N/m", step: 10, hint: "题未给默认 100，仅影响过程时长" },
    { key: "targetMassKg", label: "靶球质量 m₂（可空）", unit: "kg", step: 0.5, hint: "留空时由分离速度反求" },
    { key: "separationSpeedMps", label: "分离后入射球速率", unit: "m/s", step: 0.5, hint: "临界条件：等于槽速即恰好不再滑上" },
    { key: "gapM", label: "接触前间距", unit: "m", step: 0.1 },
  ],
  vertical_arc: [
    { key: "radiusM", label: "圆弧半径 R", unit: "m", step: 0.05, hint: "质点轨迹半径，大于 0" },
    { key: "endAngleDeg", label: "圆弧端点角 φ", unit: "°", step: 1, hint: "从最低点量起，0° < φ ≤ 180°" },
  ],
};

const ROUGH_SPRING_FIELDS: NumberMeta[] = [
  { key: "kineticFrictionCoefficient", label: "接触面动摩擦因数 μₖ", unit: "", step: 0.05 },
  { key: "staticFrictionCoefficient", label: "静摩擦因数 μₛ（上限）", unit: "", step: 0.05, hint: "与下方回弹事实至少补一项；不默认等于 μₖ" },
];
const isRoughSpring = (stage: Record<string, unknown>) => Object.prototype.hasOwnProperty.call(stage, "kineticFrictionCoefficient");
/** 光滑 ↔ 粗糙弹簧接触切换：互斥字段整体替换，已填的弹簧劲度系数保留。 */
export function updateSpringContactMode(draft: StagePlanDraft, index: number, rough: boolean): StagePlanDraft {
  const next = structuredClone(draft), stage = next.stages[index];
  if (rough) { delete stage.frictionless; stage.kineticFrictionCoefficient = null; stage.staticFrictionCoefficient = null; stage.reboundAtMaxCompression = null; }
  else { delete stage.kineticFrictionCoefficient; delete stage.staticFrictionCoefficient; delete stage.reboundAtMaxCompression; stage.frictionless = null; }
  return next;
}

interface Props {
  draft: StagePlanDraft;
  onChange: (next: StagePlanDraft) => void;
  missingKeys: string[];
  fieldErrors: FieldError[];
}

function asNumber(raw: string): number | null {
  if (!raw.trim()) return null;
  const value = Number(raw);
  return Number.isNaN(value) ? null : value;
}

function displayNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function blankStage(kind: StageKind): Record<string, unknown> {
  if (kind === "spring_release") return { kind, springConstantNpm: null, initialCompressionM: null, kineticFrictionCoefficient: null, unattached: null, slidesAfterRelease: null };
  if (kind === "incline_slide") {
    return { kind, lengthM: null, angleDeg: null, kineticFrictionCoefficient: null, slidesAfterRelease: null };
  }
  if (kind === "lossless_turn") return { kind, lossless: null };
  if (kind === "horizontal_slide") {
    return { kind, kineticFrictionCoefficient: null, end: { kind: "distance", distanceM: null } };
  }
  if (kind === "constant_force_1d") {
    return { kind, netForceXN: null, end: { kind: "duration", durationSeconds: null } };
  }
  if (kind === "conveyor_belt") {
    return { kind, initialBeltSpeedMps: null, segments: [{ accelerationMps2: 0, durationSeconds: null }], kineticFrictionCoefficient: null, staticFrictionCoefficient: null, angleDeg: null, inclineDirection: "up" };
  }
  if (kind === "movable_arc") return { kind, radiusM: null, grooveMassKg: null, exitDirection: -1 };
  if (kind === "movable_semicircle") return { kind, radiusM: null, grooveMassKg: null, direction: "right", frictionless: true, groundFrictionless: true };
  if (kind === "switchable_em_collision") return { kind, scaleMode: "normalized", targetMassRatio: null, targetChargeRatio: null, entryXOverLength: null, collisionXOverLength: null, collisionYOverLength: null, switchOffXOverLength: null, fieldDirection: "out_of_page", gravityAndMutualForcesNegligible: true };
  if (kind === "spring_pair") return { kind, springConstantNpm: 100, targetMassKg: null, separationSpeedMps: null, gapM: 0.5 };
  if (kind === "spring_contact") return { kind, springConstantNpm: null, frictionless: null, unattached: null };
  if (kind === "vertical_arc") return { kind, radiusM: null, endAngleDeg: null, side: null, frictionless: null };
  return { kind, dropHeightM: null };
}

export function updateStagePlanKind(draft: StagePlanDraft, index: number, kind: StageKind): StagePlanDraft {
  const stages = [...draft.stages];
  stages[index] = kind === "projectile" && draft.stages[index - 1]?.kind === "vertical_arc"
    ? { kind, landingPlaneYM: null } : blankStage(kind);
  const next = { ...draft, stages };
  // 明确换掉释放首段时，移除已不适用于新计划的能量和临界条件。
  if (index === 0 && draft.stages[0]?.kind === "spring_release" && kind !== "spring_release") {
    delete next.energy;
    delete next.constraints;
  }
  return next;
}

export function updateCircularField(draft:StagePlanDraft,index:number,keys:string[],value:unknown):StagePlanDraft{
  const next=structuredClone(draft),stage=next.stages[index];let object=stage;
  for(const key of ['path',...keys.slice(0,-1)]){if(!object[key]||typeof object[key]!=='object')object[key]={};object=object[key] as Record<string,unknown>;}
  object[keys[keys.length-1]]=value;return next;
}
export function updateCircularMode(draft:StagePlanDraft,index:number,explicit:boolean):StagePlanDraft{
  const next=structuredClone(draft),stage=next.stages[index];
  if(explicit){delete stage.endAngleDeg;if(!stage.path)stage.path={center:{xM:null,yM:null},startAngleDeg:null,direction:null,end:{kind:null,sweepAngleDeg:null}};}
  else{delete stage.path;stage.endAngleDeg=null;}
  return next;
}

export function StagePlanEditor({ draft, onChange, missingKeys, fieldErrors }: Props) {
  if(draft.bodies||draft.stages.some(s=>s.kind==='pendulum_swing'))return <MultiBodyPlanEditor draft={draft} onChange={onChange} missingKeys={missingKeys} fieldErrors={fieldErrors}/>;
  const errorMap = new Map(fieldErrors.filter((error) => error.path).map((error) => [error.path!, error.message]));
  const flagged = (path: string) =>
    errorMap.has(path) || missingKeys.some((key) => key === path || key.startsWith(path + "/") || path.startsWith(key + "/"));

  const setTopNumber = (key: "gravityMps2" | "massKg", raw: string) => {
    onChange(updateStagePlanNumber(draft, null, key, asNumber(raw)));
  };
  const setInitialNumber = (key: "speedMps" | "vxMps" | "vyMps", raw: string) => {
    onChange({ ...draft, initial: { ...draft.initial, [key]: asNumber(raw) } as StagePlanDraft["initial"] });
  };
  const setStage = (index: number, stage: Record<string, unknown>) => {
    const stages = [...draft.stages];
    stages[index] = stage;
    onChange({ ...draft, stages });
  };
  const setStageNumber = (index: number, key: string, raw: string) => {
    onChange(updateStagePlanNumber(draft, index, key, asNumber(raw)));
  };
  const setStageFact = (index: number, key: string, raw: string) => {
    const value = raw === "" ? null : raw === "true";
    setStage(index, { ...draft.stages[index], [key]: value });
  };
  const setEndKind = (index: number, raw: string) => {
    const stage = draft.stages[index];
    if (!raw) {
      setStage(index, { ...stage, end: null });
      return;
    }
    const oldEnd = stage.end && typeof stage.end === "object" ? stage.end as Record<string, unknown> : {};
    setStage(index, {
      ...stage,
      end: raw === "distance_from_stage_start" ? { kind: raw, stageIndex: index - 1, distanceM: oldEnd.distanceM ?? null } : raw === "distance" ? { kind: "distance", distanceM: oldEnd.distanceM ?? null } : { kind: "stop" },
    });
  };
  const setDistance = (index: number, raw: string) => {
    const stage = draft.stages[index];
    const end = stage.end && typeof stage.end === "object" ? stage.end as Record<string, unknown> : { kind: "distance" };
    setStage(index, { ...stage, end: { ...end, kind: end.kind ?? "distance", distanceM: asNumber(raw) } });
  };

  const numberRow = (
    meta: NumberMeta & { path: string; value: unknown; onChange: (raw: string) => void },
  ) => {
    const error = errorMap.get(meta.path);
    const missing = meta.value == null || missingKeys.includes(meta.path);
    const invalid = flagged(meta.path);
    return (
      <tr key={meta.path} data-field-path={meta.path}>
        <td className="name">
          {meta.label}
          {meta.hint && <span className="hint">{meta.hint}</span>}
        </td>
        <td className="val">
          <input
            className={"num-input" + (invalid ? " invalid" : "")}
            type="number"
            step={meta.step ?? 0.1}
            inputMode="decimal"
            value={displayNumber(meta.value)}
            placeholder="待补"
            aria-label={meta.label}
            aria-invalid={invalid}
            data-field-path={meta.path}
            onChange={(event) => meta.onChange(event.target.value)}
          />
          <span className="unit-tag">{meta.unit || "—"}</span>
        </td>
        <td style={{ fontSize: 12, color: error ? "#8a4b4b" : "var(--text-tertiary)" }}>
          {error ? "需修正" : missing ? "缺失" : ""}
        </td>
      </tr>
    );
  };

  const factRow = (stageIndex: number, key: string, label: string) => {
    const path = `/stages/${stageIndex}/${key}`;
    const value = draft.stages[stageIndex][key];
    return (
      <tr key={path} data-field-path={path}>
        <td className="name">{label}</td>
        <td className="val">
          <select
            className={"stage-select" + (flagged(path) ? " invalid" : "")}
            value={value === true ? "true" : value === false ? "false" : ""}
            aria-label={label}
            aria-invalid={flagged(path)}
            data-field-path={path}
            onChange={(event) => setStageFact(stageIndex, key, event.target.value)}
          >
            <option value="">待确认</option>
            <option value="true">是</option>
            <option value="false">否</option>
          </select>
        </td>
        <td style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{value == null ? "缺失" : ""}</td>
      </tr>
    );
  };

  const initial = draft.initial ?? { speedMps: null };
  const firstKind = draft.stages[0]?.kind;
  const isSwitchableEM = firstKind === "switchable_em_collision";
  const components = firstKind === "projectile" || "vxMps" in initial || "vyMps" in initial;
  const conveyorInit = firstKind === "conveyor_belt";
  const showMass = !isSwitchableEM && ("massKg" in draft || flagged("/massKg") || draft.stages.some((stage) => stage.kind === "spring_release" || stage.kind === "spring_contact" || stage.kind === "vertical_arc" || stage.kind === "constant_force_1d" || stage.kind === "movable_arc" || stage.kind === "movable_semicircle" || stage.kind === "spring_pair"));

  return (
    <div className="stage-plan-editor" data-testid="stage-plan-editor">
      {!isSwitchableEM && (
        <>
          <p className="section-label">共享条件</p>
          {draft.scaleMode === "normalized" && (
            <p className="hint" style={{ marginBottom: 6 }}>符号归一化演示模式：未给数值的符号基准默认按 1 演示，可填入具体 SI 数值重算。</p>
          )}
          <table className="cond-table">
            <tbody>
              {numberRow({ key: "gravityMps2", label: "重力加速度 g", unit: "m/s²", step: 0.1,
                path: "/gravityMps2", value: draft.gravityMps2, onChange: (raw) => setTopNumber("gravityMps2", raw) })}
              {showMass && numberRow({ key: "massKg", label: "滑块质量 m", unit: "kg", step: 0.1,
                path: "/massKg", value: draft.massKg, onChange: (raw) => setTopNumber("massKg", raw) })}
              {components || conveyorInit ? (
                <>
                  {numberRow({ key: "vxMps", label: conveyorInit ? "滑块对地初速 v₀" : "水平初速度 vₓ", unit: "m/s", step: 0.1,
                    path: "/initial/vxMps", value: "vxMps" in initial ? initial.vxMps : null, onChange: (raw) => setInitialNumber("vxMps", raw) })}
                  {!conveyorInit && numberRow({ key: "vyMps", label: "竖直初速度 vᵧ", unit: "m/s", step: 0.1,
                    path: "/initial/vyMps", value: "vyMps" in initial ? initial.vyMps : null, onChange: (raw) => setInitialNumber("vyMps", raw) })}
                </>
              ) : numberRow({ key: "speedMps", label: "初始速率 v₀", unit: "m/s", step: 0.1,
                path: "/initial/speedMps", value: "speedMps" in initial ? initial.speedMps : null, onChange: (raw) => setInitialNumber("speedMps", raw) })}
            </tbody>
          </table>
        </>
      )}

      <p className="section-label">有序运动阶段</p>
      {draft.stages.length === 0 && <p className="placeholder">未识别出运动阶段，请重新上传或补充题面。</p>}
      {draft.stages.map((stage, index) => {
        const kind = typeof stage.kind === "string" ? stage.kind as StageKind : null;
        const kindPath = `/stages/${index}/kind`;
        const known = kind != null && STAGE_KINDS.includes(kind);
        return (
          <section className="stage-editor-card" data-stage-index={index} data-stage-kind={kind ?? ""} key={index}>
            <div className="stage-editor-head">
              <span className="stage-number">阶段 {index + 1}</span>
              <select
                className={"stage-select" + (flagged(kindPath) ? " invalid" : "")}
                value={kind ?? ""}
                aria-label={`阶段 ${index + 1} 类型`}
                aria-invalid={flagged(kindPath)}
                data-field-path={kindPath}
                onChange={(event) => onChange(updateStagePlanKind(draft, index, event.target.value as StageKind))}
              >
                <option value="" disabled>选择阶段类型</option>
                {known || !kind ? null : <option value={kind}>未登记：{kind}</option>}
                {STAGE_KINDS.map((item) => <option value={item} key={item}>{STAGE_LABELS[item]}</option>)}
              </select>
            </div>
            {known && (
              <table className="cond-table">
                <tbody>
                  {[...(NUMBER_FIELDS[kind] ?? []), ...(kind === "spring_contact" && isRoughSpring(stage) ? ROUGH_SPRING_FIELDS : [])]
                    .filter((meta) => !(kind === "vertical_arc" && meta.key === "endAngleDeg" && Object.prototype.hasOwnProperty.call(stage, "path")))
                    .filter((meta) => !(kind === "incline_slide" && meta.key === "staticFrictionCoefficient" && stage.direction !== "up" && !("staticFrictionCoefficient" in stage)))
                    .map((meta) => numberRow({
                    ...meta,
                    path: `/stages/${index}/${meta.key}`,
                    value: stage[meta.key],
                    onChange: (raw) => setStageNumber(index, meta.key, raw),
                  }))}
                  {kind === "incline_slide" && (
                    <tr data-field-path={`/stages/${index}/direction`}>
                      <td className="name">斜面运动方向</td>
                      <td className="val">
                        <select
                          className={"stage-select" + (flagged(`/stages/${index}/direction`) ? " invalid" : "")}
                          aria-label={`阶段 ${index + 1} 斜面运动方向`}
                          value={stage.direction === "up" ? "up" : "down"}
                          onChange={(event) => setStage(index, { ...stage, direction: event.target.value })}
                        >
                          <option value="down">沿斜面向下（从顶到底）</option>
                          <option value="up">沿斜面向上（冲上斜面）</option>
                        </select>
                      </td>
                      <td />
                    </tr>
                  )}
                  {kind === "incline_slide" && stage.direction !== "up" && ("slidesAfterRelease" in stage || missingKeys.includes(`/stages/${index}/slidesAfterRelease`)
                    || ("speedMps" in initial && initial.speedMps === 0)) && factRow(index, "slidesAfterRelease", "释放后下滑")}
                  {kind === "lossless_turn" && factRow(index, "lossless", "无损转向")}
                  {kind === "spring_release" && <>{factRow(index, "unattached", "滑块与弹簧不连接")}{factRow(index, "slidesAfterRelease", "释放后开始滑动")}</>}
                  {kind === "vertical_arc" && (
                    <>
                      <tr><td className="name">圆轨几何模式</td><td className="val"><select className="stage-select" aria-label={`阶段 ${index+1} 圆轨几何模式`} value={Object.prototype.hasOwnProperty.call(stage,'path')?'explicit':'legacy'} onChange={e=>onChange(updateCircularMode(draft,index,e.target.value==='explicit'))}>
                        <option value="legacy">最低点右侧半圆</option><option value="explicit">显式圆心与入射弧段</option>
                      </select></td><td/></tr>
                      {Object.prototype.hasOwnProperty.call(stage,'path')&&(()=>{
                        const p=(stage.path??{}) as Record<string,unknown>,center=(p.center??{}) as Record<string,unknown>,end=(p.end??{}) as Record<string,unknown>;
                        const rows=[{key:'xM',keys:['center','xM'],label:'圆心 x',unit:'m',value:center.xM},{key:'yM',keys:['center','yM'],label:'圆心 y',unit:'m',value:center.yM},
                          {key:'startAngleDeg',keys:['startAngleDeg'],label:'入口角 φ₀',unit:'°',value:p.startAngleDeg},{key:'sweepAngleDeg',keys:['end','sweepAngleDeg'],label:'计划角程',unit:'°',value:end.sweepAngleDeg}];
                        const select=(keys:string[],label:string,value:unknown,options:[string,string][])=>{const path=`/stages/${index}/path/${keys.join('/')}`;return<tr key={path} data-field-path={path}><td className="name">{label}</td><td className="val"><select className={'stage-select'+(flagged(path)?' invalid':'')} aria-label={`阶段 ${index+1} ${label}`} aria-invalid={flagged(path)} value={typeof value==='string'?value:''} onChange={e=>onChange(updateCircularField(draft,index,keys,e.target.value||null))}><option value="">待确认</option>{options.map(([v,text])=><option key={v} value={v}>{text}</option>)}</select></td><td/></tr>;};
                        return<>{rows.map(row=>numberRow({...row,label:`阶段 ${index+1} ${row.label}`,path:`/stages/${index}/path/${row.keys.join('/')}`,onChange:raw=>onChange(updateCircularField(draft,index,row.keys,asNumber(raw)))}))}
                          {select(['direction'],'行进方向',p.direction,[['positive','角度增大'],['negative','角度减小']])}
                          {select(['end','kind'],'圆轨结束方式',end.kind,[['physical_endpoint','实体端点，正速离轨'],['observation','仅观察，轨道仍延续']])}
                          <tr><td colSpan={3} className="hint">角从最低点量起；观察终点保留速度与支持力。圆心使用固定世界坐标。</td></tr>
                          {'endAngleDeg'in stage&&<tr><td colSpan={3}><button type="button" className="link" onClick={()=>onChange(updateCircularMode(draft,index,true))}>保留显式路径，移除旧端点角</button></td></tr>}
                        </>;
                      })()}
                      <tr data-field-path={`/stages/${index}/side`}>
                        <td className="name">圆轨道接触侧</td>
                        <td className="val"><select className={"stage-select" + (flagged(`/stages/${index}/side`) ? " invalid" : "")}
                          aria-label={`阶段 ${index + 1} 圆轨道接触侧`} aria-invalid={flagged(`/stages/${index}/side`)}
                          value={typeof stage.side === "string" ? stage.side : ""}
                          onChange={(event) => setStage(index, { ...stage, side: event.target.value || null })}>
                          <option value="">待确认</option><option value="inside">内侧（单轨）</option><option value="rod">轻杆 / 双轨</option><option value="outside">外侧（暂不支持）</option>
                        </select></td><td />
                      </tr>
                      {factRow(index, "frictionless", "圆轨道光滑")}
                    </>
                  )}
                  {kind === "projectile" && (() => {
                    const fromIncline = draft.stages[index - 1]?.kind === "incline_slide";
                    const fixed = "landingPlaneYM" in stage || (!("dropHeightM" in stage) && draft.stages[index - 1]?.kind === "vertical_arc");
                    const key = fixed ? "landingPlaneYM" : "dropHeightM";
                    const bounce = stage.bounce && typeof stage.bounce === "object" ? stage.bounce as Record<string, unknown> : null;
                    const setBounceNumber = (bKey: string, raw: string) => {
                      setStage(index, { ...stage, bounce: { ...(bounce ?? { stopAt: "first_apex" }), [bKey]: asNumber(raw) } });
                    };
                    return <>
                      <tr data-field-path={`/stages/${index}`}><td className="name">落地基准</td><td className="val">
                        <select className="stage-select" aria-label={`阶段 ${index + 1} 落地基准`} value={fixed ? "plane" : "drop"}
                          onChange={(event) => {
                            const next = { ...stage }; delete next.dropHeightM; delete next.landingPlaneYM;
                            next[event.target.value === "plane" ? "landingPlaneYM" : "dropHeightM"] = null; setStage(index, next);
                          }}>
                          <option value="drop">相对发射点的落差</option><option value="plane">固定世界高度</option>
                        </select></td><td /></tr>
                      {numberRow({ key, label: fixed ? "落地平面高度 y" : fromIncline ? "檐口到地面高度 h" : "落地平面落差 h", unit: "m", step: .05,
                        hint: fromIncline ? fixed ? "以檐口为(0,0)，地面y≤0" : "从檐口量到地面，不从坡顶量高度" : fixed ? "与场景共用坐标原点；圆弧后必须固定地面" : "非负落差，圆弧后请切换为固定高度",
                        path: `/stages/${index}/${key}`, value: stage[key], onChange: raw => setStageNumber(index, key, raw) })}
                      {bounce && (
                        <>
                          {numberRow({ key: "normalRestitution", label: "竖直恢复系数 e", unit: "", step: 0.05, hint: "0 ≤ e ≤ 1，vy+ = −e·vy−",
                            path: `/stages/${index}/bounce/normalRestitution`, value: bounce.normalRestitution, onChange: (raw) => setBounceNumber("normalRestitution", raw) })}
                          {"apexHeightM" in bounce && numberRow({ key: "apexHeightM", label: "首次反弹最高高度 h", unit: "m", step: 0.1, hint: "未给落差时由 H = h/e² 反求",
                            path: `/stages/${index}/bounce/apexHeightM`, value: bounce.apexHeightM, onChange: (raw) => setBounceNumber("apexHeightM", raw) })}
                        </>
                      )}
                    </>;
                  })()}
                  {kind === "horizontal_slide" && (
                    <>
                      <tr data-field-path={`/stages/${index}/end`}>
                        <td className="name">水平段结束条件</td>
                        <td className="val">
                          <select
                            className={"stage-select" + (flagged(`/stages/${index}/end`) ? " invalid" : "")}
                            value={stage.end && typeof stage.end === "object" && "kind" in stage.end ? String(stage.end.kind ?? "") : ""}
                            aria-label={`阶段 ${index + 1} 结束条件`}
                            data-field-path={`/stages/${index}/end/kind`}
                            onChange={(event) => setEndKind(index, event.target.value)}
                          >
                            <option value="">待确认</option>
                            <option value="distance">指定距离</option>
                            {draft.stages[index - 1]?.kind === "spring_release" && <option value="distance_from_stage_start">从释放点A量总距离AB</option>}
                            <option value="stop">减速至停止</option>
                          </select>
                        </td>
                        <td />
                      </tr>
                      {(!stage.end || (typeof stage.end === "object" && "kind" in stage.end && (stage.end.kind === "distance" || stage.end.kind === "distance_from_stage_start"))
                        || missingKeys.includes(`/stages/${index}/end/distanceM`)) && numberRow({
                        key: "distanceM", label: "计划距离 / 桌沿位置", unit: "m", step: 0.1,
                        path: `/stages/${index}/end/distanceM`,
                        value: stage.end && typeof stage.end === "object" && "distanceM" in stage.end ? stage.end.distanceM : null,
                        onChange: (raw) => setDistance(index, raw),
                      })}
                    </>
                  )}
                  {kind === "conveyor_belt" && (
                    <>
                      {factRow(index, "lengthSufficientForCommonSpeed", "带足够长（未给带长，仅计至共速）")}
                      <tr data-field-path={`/stages/${index}/inclineDirection`}>
                        <td className="name">倾斜正方向 +s</td>
                        <td className="val">
                          <select
                            className={"stage-select" + (flagged(`/stages/${index}/inclineDirection`) ? " invalid" : "")}
                            aria-label={`阶段 ${index + 1} 倾斜正方向`}
                            value={typeof stage.inclineDirection === "string" ? stage.inclineDirection : "up"}
                            onChange={(event) => setStage(index, { ...stage, inclineDirection: event.target.value })}
                          >
                            <option value="up">沿斜面向上（从底到顶）</option>
                            <option value="down">沿斜面向下（从顶到底）</option>
                          </select>
                        </td>
                        <td />
                      </tr>
                    </>
                  )}
                  {kind === "movable_semicircle" && (
                    <>
                      <tr data-field-path={`/stages/${index}/direction`}>
                        <td className="name">轨道朝向</td>
                        <td className="val">
                          <select
                            className={"stage-select" + (flagged(`/stages/${index}/direction`) ? " invalid" : "")}
                            aria-label={`阶段 ${index + 1} 轨道朝向`}
                            aria-invalid={flagged(`/stages/${index}/direction`)}
                            value={typeof stage.direction === "string" ? stage.direction : ""}
                            onChange={(event) => setStage(index, { ...stage, direction: event.target.value || null })}
                          >
                            <option value="">待确认</option>
                            <option value="right">向右（从底部向右入轨）</option>
                            <option value="left">向左（从底部向左入轨）</option>
                          </select>
                        </td>
                        <td />
                      </tr>
                      {factRow(index, "frictionless", "半圆轨道内壁光滑")}
                      {factRow(index, "groundFrictionless", "水平地面光滑（轨道可自由平动）")}
                    </>
                  )}
                  {kind === "switchable_em_collision" && (() => {
                    const ratioNum = (v: unknown) => typeof v === "number" ? v : v && typeof v === "object" && "coefficient" in v && "radicand" in v ? Number((v as { coefficient: number }).coefficient) * Math.sqrt(Number((v as { radicand: number }).radicand)) : null;
                    const ratioRows = [
                      { key: "targetMassRatio", label: "乙/甲质量比 m₂/m₁" },
                      { key: "targetChargeRatio", label: "乙/甲电荷比 q₂/q₁" },
                      { key: "entryXOverLength", label: "入磁点 x/L" },
                      { key: "collisionXOverLength", label: "碰撞点 x/L" },
                      { key: "collisionYOverLength", label: "碰撞点 y/L（< 0）" },
                      { key: "switchOffXOverLength", label: "撤场竖线 x/L" },
                    ];
                    return (
                      <>
                        <tr data-field-path={`/stages/${index}/scaleMode`}>
                          <td className="name">标度模式</td>
                          <td className="val">
                            <select
                              className={"stage-select" + (flagged(`/stages/${index}/scaleMode`) ? " invalid" : "")}
                              aria-label={`阶段 ${index + 1} 标度模式`}
                              value={typeof stage.scaleMode === "string" ? stage.scaleMode : ""}
                              onChange={(event) => setStage(index, { ...stage, scaleMode: event.target.value || null })}
                            >
                              <option value="">待确认</option>
                              <option value="normalized">归一化标度（m=q=L=v₀=1）</option>
                              <option value="si">国际单位数值（SI）</option>
                            </select>
                          </td>
                          <td />
                        </tr>
                        {stage.scaleMode === "normalized" && (
                          <tr><td colSpan={3} className="hint">符号题设：未输入数值时默认取 m = q = L = v₀ = 1 演示，可改上方基准值重算。</td></tr>
                        )}
                        {ratioRows.map((meta) => numberRow({
                          key: meta.key, label: meta.label, unit: "", step: 0.1,
                          path: `/stages/${index}/${meta.key}`,
                          value: ratioNum(stage[meta.key]),
                          onChange: (raw) => setStageNumber(index, meta.key, raw),
                        }))}
                        <tr data-field-path={`/stages/${index}/fieldDirection`}>
                          <td className="name">磁场方向（y &lt; 0）</td>
                          <td className="val">
                            <select
                              className={"stage-select" + (flagged(`/stages/${index}/fieldDirection`) ? " invalid" : "")}
                              aria-label={`阶段 ${index + 1} 磁场方向`}
                              value={typeof stage.fieldDirection === "string" ? stage.fieldDirection : ""}
                              onChange={(event) => setStage(index, { ...stage, fieldDirection: event.target.value || null })}
                            >
                              <option value="">待确认</option>
                              <option value="into_page">垂直纸面向里（⊗）</option>
                              <option value="out_of_page">垂直纸面向外（⊙）</option>
                            </select>
                          </td>
                          <td />
                        </tr>
                        {factRow(index, "gravityAndMutualForcesNegligible", "忽略重力与碰撞外粒子相互作用")}
                      </>
                    );
                  })()}
                  {kind === "conveyor_belt" && (
                    [
                      { key: "entryEdge", label: "入带端" },
                      { key: "continuationExitEdge", label: "接续端" },
                    ].map(({ key, label }) => (
                      <tr key={key} data-field-path={`/stages/${index}/${key}`}>
                        <td className="name">{label}</td>
                        <td className="val">
                          <select
                            className={"stage-select" + (flagged(`/stages/${index}/${key}`) ? " invalid" : "")}
                            aria-label={`阶段 ${index + 1} ${label}`}
                            value={typeof stage[key] === "string" ? stage[key] : ""}
                            onChange={(event) => setStage(index, { ...stage, [key]: event.target.value || null })}
                          >
                            <option value="">按实际运动</option>
                            <option value="start">起端（水平带左端）</option>
                            <option value="end">末端（水平带右端）</option>
                          </select>
                        </td>
                        <td />
                      </tr>
                    ))
                  )}
                  {kind === "conveyor_belt" && Array.isArray(stage.segments) && stage.segments.map((seg, j) => {
                    const sObj = (seg && typeof seg === "object" ? seg : {}) as Record<string, unknown>;
                    const updateSeg = (field: string, raw: string) => {
                      const nextSegs = (stage.segments as Record<string, unknown>[]).map((item, k) => k === j ? { ...item, [field]: asNumber(raw) } : item);
                      setStage(index, { ...stage, segments: nextSegs });
                    };
                    return (
                      <tr key={`conv-${j}`}><td colSpan={3}><table className="cond-table"><tbody>
                        {numberRow({ key: `a-${j}`, label: `带速段 ${j + 1} 加速度 a带`, unit: "m/s²", step: 0.5, path: `/stages/${index}/segments/${j}/accelerationMps2`, value: sObj.accelerationMps2, onChange: (raw) => updateSeg("accelerationMps2", raw) })}
                        {numberRow({ key: `t-${j}`, label: `带速段 ${j + 1} 时长`, unit: "s", step: 0.5, hint: "定长匀速时留空，算至实际离带或静止", path: `/stages/${index}/segments/${j}/durationSeconds`, value: sObj.durationSeconds, onChange: (raw) => updateSeg("durationSeconds", raw) })}
                      </tbody></table></td></tr>
                    );
                  })}
                  {kind === "constant_force_1d" && (
                    <>
                      <tr data-field-path={`/stages/${index}/end`}>
                        <td className="name">常力段结束条件</td>
                        <td className="val">
                          <select
                            className={"stage-select" + (flagged(`/stages/${index}/end`) ? " invalid" : "")}
                            value={stage.end && typeof stage.end === "object" && "kind" in stage.end ? String(stage.end.kind ?? "") : ""}
                            aria-label={`阶段 ${index + 1} 常力段结束条件`}
                            data-field-path={`/stages/${index}/end/kind`}
                            onChange={(event) => {
                              const raw = event.target.value;
                              if (!raw) setStage(index, { ...stage, end: null });
                              else if (raw === "stop") setStage(index, { ...stage, end: { kind: "stop" } });
                              else setStage(index, { ...stage, end: { kind: "duration", durationSeconds: stage.end && typeof stage.end === "object" && "durationSeconds" in stage.end ? stage.end.durationSeconds : null } });
                            }}
                          >
                            <option value="">待确认</option>
                            <option value="duration">指定作用时间</option>
                            <option value="stop">减速至静止</option>
                          </select>
                        </td>
                        <td />
                      </tr>
                      {((stage.end && typeof stage.end === "object" && "kind" in stage.end && stage.end.kind === "duration")
                        || missingKeys.includes(`/stages/${index}/end/durationSeconds`)) && numberRow({
                        key: "durationSeconds", label: "作用时长 t", unit: "s", step: 0.1,
                        path: `/stages/${index}/end/durationSeconds`,
                        value: stage.end && typeof stage.end === "object" && "durationSeconds" in stage.end ? stage.end.durationSeconds : null,
                        onChange: (raw) => setStage(index, { ...stage, end: { kind: "duration", durationSeconds: asNumber(raw) } }),
                      })}
                    </>
                  )}
                  {kind === "spring_contact" && (
                    <tr data-field-path={`/stages/${index}`}>
                      <td className="name">接触面</td>
                      <td className="val">
                        <select className="stage-select" aria-label={`阶段 ${index + 1} 弹簧接触面`} value={isRoughSpring(stage) ? "rough" : "smooth"}
                          onChange={(event) => onChange(updateSpringContactMode(draft, index, event.target.value === "rough"))}>
                          <option value="smooth">光滑</option><option value="rough">粗糙（计动摩擦）</option>
                        </select>
                      </td><td />
                    </tr>
                  )}
                  {kind === "spring_contact" && !isRoughSpring(stage) && factRow(index, "frictionless", "接触面光滑")}
                  {kind === "spring_contact" && isRoughSpring(stage) && factRow(index, "reboundAtMaxCompression", "最大压缩处能回弹（题给事实）")}
                  {kind === "spring_contact" && factRow(index, "unattached", "滑块与弹簧不连接")}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
