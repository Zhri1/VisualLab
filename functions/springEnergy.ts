// 由 scripts/sync-functions.mjs 从 src/physics/springEnergy.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
import type { StagePlanDraft, PlaybackScope, Energy } from "./stagePlan.ts";
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const positive = (v: number) => v > 0;
const near = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 64 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));

// 校验与能量规范化同源供浏览器、Node及云函数使用；不依赖场景或轨迹求解。
export function resolveSpringEnergy(input: Obj, draft: StagePlanDraft, missing: string[], issue: (path: string, code: string, message: string) => void,
  numberField: (source: Obj, target: Obj, key: string, path: string, rule: (v: number) => boolean, required?: boolean) => void): PlaybackScope | undefined {
  const s = draft.stages[0];
  if (s.kind !== "spring_release") {
    if (input.energy != null) issue("/energy", "PRECONDITION_CONFLICT", "能量条件需要预压释放首段。");
    return;
  }
  const h = draft.stages[1], end = object(h?.end) ? h.end : undefined;
  const L = end?.kind === "distance_from_stage_start" ? end.distanceM as number : undefined;
  const m = draft.massKg as number, g = draft.gravityMps2 ?? 0;
  const mu = s.kineticFrictionCoefficient as number, muh = h?.kineticFrictionCoefficient as number;
  let k = s.springConstantNpm as number | null, c = s.initialCompressionM as number | null;
  let energy: Energy | undefined;
  if (input.energy != null) {
    if (!object(input.energy)) issue("/energy", "TYPE", "能量记录须为对象。");
    else {
      const raw = input.energy, target: Obj = { origin: raw.origin };
      numberField(raw, target, "stageIndex", "/energy/stageIndex", v => v === 0);
      if (draft.scaleMode === "normalized" && raw.origin === "given" && raw.elasticEnergyJ == null) {
        target.elasticEnergyJ = 1;
      } else {
        numberField(raw, target, "elasticEnergyJ", "/energy/elasticEnergyJ", positive);
      }
      if (raw.origin == null) missing.push("/energy/origin");
      else if (typeof raw.origin !== "string") issue("/energy/origin", "TYPE", "能量来源须为字符串。");
      else if (!["given", "user", "spring_parameters", "critical_arc_top"].includes(raw.origin)) issue("/energy/origin", "UNSUPPORTED", "未登记的能量来源。");
      if (raw.origin === "critical_arc_top" || raw.origin === "spring_parameters") {
        if (raw.basis == null) missing.push("/energy/basis");
        else if (!object(raw.basis)) issue("/energy/basis", "TYPE", "来源快照须为对象。");
        else {
          const b: Obj = {}; target.basis = b;
          const keys = raw.origin === "spring_parameters" ? ["springConstantNpm", "initialCompressionM"] : ["massKg", "gravityMps2", "radiusM", "distanceM", "releaseCompleteByM", "arcStageIndex", "springKineticFrictionCoefficient", "horizontalKineticFrictionCoefficient"];
          for (const key of keys) numberField(raw.basis, b, key, "/energy/basis/" + key, key === "arcStageIndex" ? v => Number.isInteger(v) && v >= 0 : key.includes("Friction") ? v => v >= 0 : positive);
          if (raw.origin === "critical_arc_top") {
            const delta = (b.springKineticFrictionCoefficient as number) - (b.horizontalKineticFrictionCoefficient as number);
            if (delta !== 0) numberField(raw.basis, b, "initialCompressionM", "/energy/basis/initialCompressionM", positive);
            const value = 2.5 * Number(b.massKg) * Number(b.gravityMps2) * Number(b.radiusM)
              + Number(b.massKg) * Number(b.gravityMps2) * (Number(b.horizontalKineticFrictionCoefficient) * Number(b.distanceM) + delta * (Number(b.initialCompressionM) || 0));
            if (Number.isFinite(value) && !near(value, Number(target.elasticEnergyJ))) issue("/energy/elasticEnergyJ", "PRECONDITION_CONFLICT", "能量与原临界来源快照不符。");
          }
        }
      }
      energy = target as Energy;
    }
  }
  let condition: Obj | undefined;
  if (input.constraints != null) {
    draft.constraints = input.constraints;
    if (!Array.isArray(input.constraints)) issue("/constraints", "TYPE", "条件须为数组。");
    else if (input.constraints.length > 1) issue("/constraints", "UNSUPPORTED", "本批仅支持一个活动临界条件。");
    else if (input.constraints.length) {
      const raw = input.constraints[0];
      if (!object(raw)) issue("/constraints/0", "TYPE", "条件须为对象。");
      else {
        const target: Obj = {};
        numberField(raw, target, "stageIndex", "/constraints/0/stageIndex", v => Number.isInteger(v) && v >= 0 && v < draft.stages.length);
        draft.constraints = [{ kind: raw.kind ?? null, ...target }];
        if (raw.kind == null) missing.push("/constraints/0/kind");
        else if (typeof raw.kind !== "string") issue("/constraints/0/kind", "TYPE", "条件类型须为字符串。");
        else if (raw.kind !== "critical_arc_top") issue("/constraints/0/kind", "UNSUPPORTED", "未登记的条件。");
        else condition = target;
      }
    }
  }
  if (!(m > 0) || !(mu >= 0) || (mu > 0 && !(g > 0))) return;
  if (condition) {
    const a = draft.stages[Number(condition.stageIndex)];
    if(a?.kind==='vertical_arc'&&a.path)issue('/constraints/0/stageIndex','UNSUPPORTED','活动临界过顶条件暂不用于显式圆轨path。');
    else if (!a || a.kind !== "vertical_arc" || a.endAngleDeg !== 180 || condition.stageIndex !== 2 || !Number.isFinite(L)) issue("/constraints/0/stageIndex", "PRECONDITION_CONFLICT", "临界条件须指向引用A的水平段后的180度内轨。");
    else {
      // 已识别临界条件保留在草稿中；缺可补前提时不把其可推导量再列成独立缺项。
      if (!(typeof a.radiusM === "number" && a.radiusM > 0 && Number.isFinite(a.radiusM)) || !(muh >= 0) || !(g > 0)) return;
      const base = 2.5 * m * g * Number(a.radiusM) + muh * m * g * L!;
      if (c == null && k != null && Number.isFinite(base)) {
        const delta = (mu - muh) * m * g, root = Math.sqrt(delta * delta + 2 * k * base);
        c = delta < 0 ? 2 * base / (root - delta) : (delta + root) / k;
      }
      if (c == null && !(Number(s.releaseCompleteByM) > 0)) { missing.push("/stages/0/releaseCompleteByM"); return; }
      if (mu !== muh && c == null) missing.push("/stages/0/initialCompressionM");
      else if (Number.isFinite(base) && g > 0 && Number(a.radiusM) > 0 && muh >= 0) {
        const value = base + (mu - muh) * m * g * (c ?? 0);
        if (energy && energy.origin !== "spring_parameters" && !near(energy.elasticEnergyJ, value)) issue("/constraints/0", "PRECONDITION_CONFLICT", "活动条件与已固定能量不符。");
        else energy = { stageIndex: 0, elasticEnergyJ: value, origin: "critical_arc_top", basis: {
          massKg: m, gravityMps2: g, radiusM: Number(a.radiusM), distanceM: L!, releaseCompleteByM: c ?? Number(s.releaseCompleteByM), arcStageIndex: 2,
          springKineticFrictionCoefficient: mu, horizontalKineticFrictionCoefficient: muh, ...(mu !== muh ? { initialCompressionM: c! } : {}),
        } };
      }
    }
  }
  if (energy && energy.origin !== "spring_parameters") {
    if (k == null && c != null) k = 2 * energy.elasticEnergyJ / (c * c);
    if (c == null && k != null) c = Math.sqrt(2 * energy.elasticEnergyJ / k);
    if (k != null && c != null && !near(.5 * k * c * c, energy.elasticEnergyJ)) issue("/stages/0", "PRECONDITION_CONFLICT", "弹簧参数与固定能量不符。");
  }
  s.springConstantNpm = k ?? null; s.initialCompressionM = c ?? null;
  for (const [key, value] of [["springConstantNpm", k], ["initialCompressionM", c]] as const) {
    if (value != null && (!Number.isFinite(value) || value <= 0)) { s[key] = null; issue("/stages/0/" + key, "RANGE", "推导参数超出可表示范围。"); return; }
  }
  if (k != null && c != null) {
    if (!energy || energy.origin === "spring_parameters") energy = { stageIndex: 0, elasticEnergyJ: .5 * k * c * c, origin: "spring_parameters", basis: { springConstantNpm: k, initialCompressionM: c } };
    if (!Number.isFinite(energy.elasticEnergyJ) || energy.elasticEnergyJ <= 0) { issue("/energy/elasticEnergyJ", "RANGE", "弹性势能超出可表示范围。"); return; }
    if (L !== undefined && c > L && !near(c, L)) issue("/stages/1/end/distanceM", "PRECONDITION_CONFLICT", "AB不能小于已用释放位移。");
    if (typeof s.releaseCompleteByM === "number" && c > s.releaseCompleteByM && !near(c, s.releaseCompleteByM)) issue("/stages/0/releaseCompleteByM", "PRECONDITION_CONFLICT", "释放上界小于真实压缩量。");
    if (s.slidesAfterRelease && k * c <= mu * m * g) issue("/stages/0", "PRECONDITION_CONFLICT", "弹力不足以支持题设的正向起动。");
    if (condition && (s.slidesAfterRelease === false || c <= 2 * mu * m * g / k)) issue("/constraints/0", "PRECONDITION_CONFLICT", "释放未正速完成，不能到达临界最高点。");
    draft.energy = energy;
    return { mode: "full", startStageIndex: 0, unresolvedKeys: [], reason: "从A点释放开始精确播放全程。" };
  }
  if (!energy && draft.scaleMode === "normalized" && k == null && c == null && s.kineticFrictionCoefficient === 0 && draft.stages[1]?.kind === "projectile") {
    energy = { stageIndex: 0, elasticEnergyJ: 1, origin: "given" };
  }
  if (energy) draft.energy = energy;
  if (s.slidesAfterRelease === false) {
    if (condition) issue("/stages/0/slidesAfterRelease", "PRECONDITION_CONFLICT", "静止前提与到达最高点冲突。");
    if (c == null) missing.push("/stages/0/initialCompressionM");
    return { mode: "full", startStageIndex: 0, unresolvedKeys: [], reason: "题设明确A处保持静止。" };
  }
  const unresolvedKeys = ["/stages/0/springConstantNpm", "/stages/0/initialCompressionM"];
  // 光滑桌面弹簧释放直连平抛：球脱离后即以能量唯一确定的水平速率离桌，无需索要 releaseCompleteByM 或桌面长度。
  if (energy && s.kineticFrictionCoefficient === 0 && s.unattached === true && s.slidesAfterRelease === true && draft.stages[1]?.kind === "projectile") {
    const vxMps = Math.sqrt(2 * energy.elasticEnergyJ / m);
    return {
      mode: "suffix",
      startStageIndex: 1,
      unresolvedKeys,
      xM: 0,
      vxMps,
      stopReason: "prefix_end",
      reason: "弹簧劲度系数、压缩量与桌面滑行距离未给出；光滑桌面与弹簧脱离后速度由能量确定，动画从桌缘起算并标注未计时前段。",
    };
  }
  if (!energy || !Number.isFinite(L) || mu !== muh || !(typeof s.releaseCompleteByM === "number" && s.releaseCompleteByM > 0)) {
    if (!energy) missing.push(...unresolvedKeys);
    else if (s.releaseCompleteByM == null) missing.push("/stages/0/releaseCompleteByM");
    else missing.push("/stages/0/initialCompressionM");
    return;
  }
  const f = mu * m * g, stoppingDistance = f > 0 ? energy.elasticEnergyJ / f : Infinity;
  if (Math.min(L!, stoppingDistance) < s.releaseCompleteByM && !near(Math.min(L!, stoppingDistance), s.releaseCompleteByM)) {
    missing.push("/stages/0/initialCompressionM"); return;
  }
  if (L! >= stoppingDistance || near(L!, stoppingDistance)) return { mode: "state_only", startStageIndex: 1, unresolvedKeys,
    xM: stoppingDistance, vxMps: 0, stopReason: near(L!, stoppingDistance) ? "stop_at_target" : "stop_before_target", reason: "只能确定静止位置，前段用时未知；此处0秒仅为状态显示锚点。" };
  const vxMps = Math.sqrt(2 * (energy.elasticEnergyJ - f * L!) / m);
  return { mode: draft.stages.length > 2 ? "suffix" : "state_only", startStageIndex: draft.stages.length > 2 ? 2 : 1, unresolvedKeys, xM: L!, vxMps,
    stopReason: "prefix_end", reason: draft.stages.length > 2 ? "前段参数不足，仅从B点开始精确计时；A到B为未计时示意。" : "仅能确定B点状态，前段用时未知。" };
}
