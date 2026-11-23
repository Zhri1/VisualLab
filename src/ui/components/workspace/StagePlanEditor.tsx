import type { StageKind, StagePlanDraft } from "../../../physics/stagePlan";
import type { FieldError } from "../../../types";
import { MultiBodyPlanEditor } from './MultiBodyPlanEditor';

const STAGE_LABELS: Record<StageKind, string> = {
  horizontal_approach: '水平接近', pendulum_swing:'轻绳摆', collision_1d:'水平正碰', parallel_motion:'同步运动',
  spring_release: "预压弹簧释放",
  vertical_arc: "竖直圆弧",
  incline_slide: "斜面下滑",
  lossless_turn: "无损转向",
  horizontal_slide: "水平滑动",
  spring_contact: "弹簧接触",
  projectile: "抛体运动",
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
    { key: "lengthM", label: "斜面长度 L", unit: "m", step: 0.1 },
    { key: "angleDeg", label: "斜面倾角 θ", unit: "°", step: 1, hint: "0° < θ < 90°" },
    { key: "kineticFrictionCoefficient", label: "斜面动摩擦因数 μ", unit: "", step: 0.05 },
  ],
  horizontal_slide: [
    { key: "kineticFrictionCoefficient", label: "水平动摩擦因数 μ", unit: "", step: 0.05 },
  ],
  spring_contact: [{ key: "springConstantNpm", label: "弹簧劲度系数 k", unit: "N/m", step: 10 }],
  vertical_arc: [
    { key: "radiusM", label: "圆弧半径 R", unit: "m", step: 0.05, hint: "质点轨迹半径，大于 0" },
    { key: "endAngleDeg", label: "圆弧端点角 φ", unit: "°", step: 1, hint: "从最低点量起，0° < φ ≤ 180°" },
  ],
};

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
  const components = firstKind === "projectile" || "vxMps" in initial || "vyMps" in initial;
  const showMass = "massKg" in draft || flagged("/massKg") || draft.stages.some((stage) => stage.kind === "spring_release" || stage.kind === "spring_contact" || stage.kind === "vertical_arc");

  return (
    <div className="stage-plan-editor" data-testid="stage-plan-editor">
      <p className="section-label">共享条件</p>
      <table className="cond-table">
        <tbody>
          {numberRow({ key: "gravityMps2", label: "重力加速度 g", unit: "m/s²", step: 0.1,
            path: "/gravityMps2", value: draft.gravityMps2, onChange: (raw) => setTopNumber("gravityMps2", raw) })}
          {showMass && numberRow({ key: "massKg", label: "滑块质量 m", unit: "kg", step: 0.1,
            path: "/massKg", value: draft.massKg, onChange: (raw) => setTopNumber("massKg", raw) })}
          {components ? (
            <>
              {numberRow({ key: "vxMps", label: "水平初速度 vₓ", unit: "m/s", step: 0.1,
                path: "/initial/vxMps", value: "vxMps" in initial ? initial.vxMps : null, onChange: (raw) => setInitialNumber("vxMps", raw) })}
              {numberRow({ key: "vyMps", label: "竖直初速度 vᵧ", unit: "m/s", step: 0.1,
                path: "/initial/vyMps", value: "vyMps" in initial ? initial.vyMps : null, onChange: (raw) => setInitialNumber("vyMps", raw) })}
            </>
          ) : numberRow({ key: "speedMps", label: "初始速率 v₀", unit: "m/s", step: 0.1,
            path: "/initial/speedMps", value: "speedMps" in initial ? initial.speedMps : null, onChange: (raw) => setInitialNumber("speedMps", raw) })}
        </tbody>
      </table>

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
                  {(NUMBER_FIELDS[kind] ?? []).map((meta) => numberRow({
                    ...meta,
                    path: `/stages/${index}/${meta.key}`,
                    value: stage[meta.key],
                    onChange: (raw) => setStageNumber(index, meta.key, raw),
                  }))}
                  {kind === "incline_slide" && ("slidesAfterRelease" in stage || missingKeys.includes(`/stages/${index}/slidesAfterRelease`)
                    || ("speedMps" in initial && initial.speedMps === 0)) && factRow(index, "slidesAfterRelease", "释放后下滑")}
                  {kind === "lossless_turn" && factRow(index, "lossless", "无损转向")}
                  {kind === "spring_release" && <>{factRow(index, "unattached", "滑块与弹簧不连接")}{factRow(index, "slidesAfterRelease", "释放后开始滑动")}</>}
                  {kind === "vertical_arc" && (
                    <>
                      <tr data-field-path={`/stages/${index}/side`}>
                        <td className="name">圆轨道接触侧</td>
                        <td className="val"><select className={"stage-select" + (flagged(`/stages/${index}/side`) ? " invalid" : "")}
                          aria-label={`阶段 ${index + 1} 圆轨道接触侧`} aria-invalid={flagged(`/stages/${index}/side`)}
                          value={typeof stage.side === "string" ? stage.side : ""}
                          onChange={(event) => setStage(index, { ...stage, side: event.target.value || null })}>
                          <option value="">待确认</option><option value="inside">内侧</option><option value="outside">外侧（暂不支持）</option>
                        </select></td><td />
                      </tr>
                      {factRow(index, "frictionless", "圆轨道光滑")}
                    </>
                  )}
                  {kind === "projectile" && (() => {
                    const fromIncline = draft.stages[index - 1]?.kind === "incline_slide";
                    const fixed = "landingPlaneYM" in stage || (!("dropHeightM" in stage) && draft.stages[index - 1]?.kind === "vertical_arc");
                    const key = fixed ? "landingPlaneYM" : "dropHeightM";
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
                  {kind === "spring_contact" && factRow(index, "frictionless", "接触面光滑")}
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
