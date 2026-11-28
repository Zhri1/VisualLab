// 由 scripts/sync-functions.mjs 从 src/physics/fieldScene.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
// 开放组合接口：AI 只描述场景（多粒子初态 + 分区磁场 + 观察事件 + 未知量反求），物理库共钟执行。
// 三个可组合基础能力：
//   1) 匀强磁场中带电粒子的匀速圆周运动（复用 magneticDeflection 的解析磁圆）；
//   2) 过界换场：穿越区域边界时位置与速度连续，换用新区的 B 继续解析推进；
//   3) 指定位置/方向的精确观察事件：解析求首次穿越时刻（三角方程闭式解，不用数值步进猜）。
// 反求：constraints 声明「某观察量的目标值」+ 待求区域，引擎对 |B| 扫描+二分求根，同类题复用。
// 坐标约定 x 向右、y 向上；magneticTeslaB 为带符号 B（+ 垂直纸面向外，− 向里）；null 表示无场（匀速直线）。
// 忽略重力与粒子间相互作用（题设）。

import { createMagneticOrbit } from "./magneticDeflection.ts";
import type { MagneticEntry, MagneticState } from "./magneticDeflection.ts";
import type { StageSample } from "./arcTypes.ts";
import type { BodyState } from "./multiBodyTypes.ts";

// 本地结构类型：与 stageMotion 的 StageMotion/StageEvent 结构兼容（src 侧有编译期断言），
// 使云镜像 functions/fieldScene.ts 不必依赖未同步的 stageMotion/verticalArc。
export type FieldSceneEvent = {
  id: string; stageIndex: number; kind: string; timeSeconds: number; order: number;
  bodyIds?: string[]; stagePath?: string; label: string; explanation: string;
  position?: { xM: number; yM: number };
  velocityBefore: { vxMps: number; vyMps: number };
  velocityAfter: { vxMps: number; vyMps: number };
};
export type FieldSceneMotion = {
  primaryBodyId?: string;
  geometry: { blockSizeM: number; positionReference: "particle"; scaleMode?: "normalized" | "si"; fieldScene: FieldSceneGeometry };
  durationSeconds: number;
  segments: { stageIndex: number; kind: "field_scene"; startSeconds: number; endSeconds: number; bodyIds?: string[]; stagePath?: string }[];
  events: FieldSceneEvent[];
  calculations?: { quantity: string; value: number; unit: string; source: "given" | "user" | "derived"; rule?: string; inputPaths: string[] }[];
  termination: { reason: "field_scene_complete"; eventId: string; stageIndex: number };
  readonly endReason: "field_scene_complete";
  sampleAt(timeSeconds: number): StageSample & { bodies?: Record<string, BodyState> };
  fieldSceneAt?(timeSeconds: number): FieldSceneReading;
};

const TAU = Math.PI * 2;
const EPS = 1e-9;

export type SceneParticle = {
  id: string;
  massKg: number;
  /** 电荷量（C），可负；0 视为不受磁力（匀速直线）。 */
  chargeC: number;
  xM: number;
  yM: number;
  vxMps: number;
  vyMps: number;
};

export type FieldRegion = {
  id: string;
  /** 边界（m）；null/缺省 = 该方向无界。区域按声明顺序优先匹配。 */
  xMinM?: number | null;
  xMaxM?: number | null;
  yMinM?: number | null;
  yMaxM?: number | null;
  /** 带符号 B（T）：+ 向外、− 向里；null = 待反求（配合 constraints）或无场。 */
  magneticTeslaB?: number | null;
  /** magneticTeslaB 为 null 且待反求时的方向约定。 */
  fieldDirection?: "into_page" | "out_of_page";
};

export type SceneObserver = {
  id: string;
  particleId: string;
  kind: "cross_x" | "cross_y" | "enter_region" | "leave_region";
  /** cross_x/cross_y 的目标坐标（m）。 */
  atM?: number;
  /** 穿越方向：+1 沿轴正向、−1 负向；缺省 = 任意方向的首次穿越。 */
  direction?: 1 | -1;
  /** enter_region/leave_region 的区域 id。 */
  regionId?: string;
  label?: string;
};

export type SceneConstraint = {
  /** 待求区域 id（其 magneticTeslaB 须为 null）。 */
  solveRegionId: string;
  observerId: string;
  kind: "position_x" | "position_y" | "velocity_cos_x" | "velocity_cos_y";
  targetM?: number;
  targetCos?: number;
};

export type FieldSceneStage = {
  kind: "field_scene";
  particles: SceneParticle[];
  regions: FieldRegion[];
  observers?: SceneObserver[];
  constraints?: SceneConstraint[];
  /** 播放总时长（s）；缺省 = 各粒子观察事件齐备后再走一小段收尾。 */
  durationSeconds?: number | null;
  /** 安全上限（s），默认 60。 */
  maxSeconds?: number | null;
};

export type FieldSceneSegment = {
  particleId: string;
  startSeconds: number;
  endSeconds: number;
  regionId: string | null;
  mode: "arc" | "line";
  /** arc：磁圆参数；line：匀速直线参数。 */
  center?: { xM: number; yM: number };
  radiusM?: number;
  omega?: number;
  spin?: 1 | -1;
  entryAngleRad?: number;
  entry: MagneticState;
};

export type FiredObserver = {
  id: string;
  particleId: string;
  timeSeconds: number;
  xM: number;
  yM: number;
  vxMps: number;
  vyMps: number;
  label: string;
};

export type FieldSceneGeometry = {
  regions: FieldRegion[];
  particles: { id: string; chargeC: number; massKg: number; trail: { xM: number; yM: number }[] }[];
  observers: { id: string; particleId: string; xM: number; yM: number; timeSeconds: number; label: string }[];
  bounds: { minXM: number; maxXM: number; minYM: number; maxYM: number };
};

export type FieldSceneReading = {
  particles: { id: string; regionId: string | null; xM: number; yM: number; vxMps: number; vyMps: number }[];
  fired: FiredObserver[];
};

export type FieldSceneSolution = {
  stage: FieldSceneStage;
  durationSeconds: number;
  segments: FieldSceneSegment[];
  fired: FiredObserver[];
  boundaryEvents: { particleId: string; timeSeconds: number; fromRegionId: string | null; toRegionId: string | null; xM: number; yM: number; vxMps: number; vyMps: number }[];
  geometry: FieldSceneGeometry;
  solved: { regionId: string; magneticTeslaB: number; observerId: string; residual: number }[];
  at(timeSeconds: number, particleId: string): MagneticState;
  readingAt(timeSeconds: number): FieldSceneReading;
};

function fail(message: string, field: string): never {
  throw Object.assign(new RangeError(message), { field });
}

function contains(region: FieldRegion, x: number, y: number): boolean {
  if (region.xMinM != null && x < region.xMinM - EPS) return false;
  if (region.xMaxM != null && x > region.xMaxM + EPS) return false;
  if (region.yMinM != null && y < region.yMinM - EPS) return false;
  if (region.yMaxM != null && y > region.yMaxM + EPS) return false;
  return true;
}

/** 沿速度方向探一点，避免恰在边界上时匹配到刚离开的区域。 */
function regionAt(regions: FieldRegion[], p: MagneticState): FieldRegion | null {
  const speed = Math.hypot(p.vxMps, p.vyMps) || 1;
  const probe = { x: p.xM + (p.vxMps / speed) * 1e-7, y: p.yM + (p.vyMps / speed) * 1e-7 };
  return regions.find((r) => contains(r, probe.x, probe.y)) ?? null;
}

function signedB(region: FieldRegion | null): number {
  if (!region || region.magneticTeslaB == null) return 0;
  return region.magneticTeslaB;
}

/** 磁圆上首次以 outward 方向穿越竖直线的时刻；不可达返回 Infinity。 */
function crossX(orbit: ReturnType<typeof createMagneticOrbit>, entry: MagneticState, targetX: number, outward: 1 | -1): number {
  let ratio = (targetX - orbit.center.xM) / orbit.radiusM;
  const tol = 32 * Number.EPSILON * Math.max(1, Math.abs(ratio));
  if (ratio > 1 + tol || ratio < -1 - tol) return Infinity;
  ratio = Math.min(1, Math.max(-1, ratio));
  const alpha = Math.acos(ratio);
  // vx = −spin·v·sinθ → sign(sinθ) = −spin·outward
  const base = -orbit.spin * outward > 0 ? alpha : -alpha;
  return sweepTime(orbit, entry, base, targetX, "x", outward);
}

/** 磁圆上首次以 outward 方向穿越水平线的时刻。 */
function crossY(orbit: ReturnType<typeof createMagneticOrbit>, entry: MagneticState, targetY: number, outward: 1 | -1): number {
  let ratio = (targetY - orbit.center.yM) / orbit.radiusM;
  const tol = 32 * Number.EPSILON * Math.max(1, Math.abs(ratio));
  if (ratio > 1 + tol || ratio < -1 - tol) return Infinity;
  ratio = Math.min(1, Math.max(-1, ratio));
  const alpha = Math.asin(ratio);
  // vy = spin·v·cosθ → sign(cosθ) = spin·outward
  const bases = [alpha, Math.PI - alpha];
  let best = Infinity;
  for (const base of bases) {
    if (Math.sign(Math.cos(base)) !== orbit.spin * outward && Math.abs(Math.cos(base)) > 1e-12) continue;
    best = Math.min(best, sweepTime(orbit, entry, base, targetY, "y", outward));
  }
  return best;
}

function sweepTime(orbit: ReturnType<typeof createMagneticOrbit>, entry: MagneticState, base: number, target: number, axis: "x" | "y", outward: 1 | -1): number {
  let sweep = orbit.spin * (base - orbit.entryAngle);
  sweep = ((sweep % TAU) + TAU) % TAU;
  if (sweep <= 1e-12) {
    const onLine = axis === "x" ? Math.abs(entry.xM - target) <= 1e-9 : Math.abs(entry.yM - target) <= 1e-9;
    const entryOutward = axis === "x" ? Math.sign(entry.vxMps) : Math.sign(entry.vyMps);
    if (onLine && entryOutward === outward) return 0;
    sweep += TAU;
  }
  return sweep / orbit.omega;
}

function lineCross(p: MagneticState, axis: "x" | "y", target: number, outward: 1 | -1): number {
  const pos = axis === "x" ? p.xM : p.yM;
  const vel = axis === "x" ? p.vxMps : p.vyMps;
  if (Math.sign(vel) !== outward || vel === 0) return Infinity;
  const t = (target - pos) / vel;
  return t > 1e-12 ? t : Infinity;
}

type Candidate = { t: number; kind: "boundary" | "observer"; observer?: SceneObserver; axis?: "x" | "y"; outward?: 1 | -1 };

export function validateFieldScene(stage: FieldSceneStage): void {
  if (!Array.isArray(stage.particles) || stage.particles.length === 0) fail("field_scene 至少需要一颗粒子。", "/stages/0/particles");
  const ids = new Set<string>();
  stage.particles.forEach((p, i) => {
    const base = `/stages/0/particles/${i}`;
    if (!p.id || ids.has(p.id)) fail("粒子 id 须唯一且非空。", `${base}/id`);
    ids.add(p.id);
    if (!(Number.isFinite(p.massKg) && p.massKg > 0)) fail("粒子质量须为正有限数。", `${base}/massKg`);
    if (!Number.isFinite(p.chargeC)) fail("电荷量须为有限数。", `${base}/chargeC`);
    for (const k of ["xM", "yM", "vxMps", "vyMps"] as const) {
      if (!Number.isFinite(p[k])) fail("粒子初态须为有限数。", `${base}/${k}`);
    }
    if (Math.hypot(p.vxMps, p.vyMps) <= 0) fail("粒子初速不能为零。", `${base}/vxMps`);
  });
  if (!Array.isArray(stage.regions)) fail("regions 须为数组（可为空 = 全程无场）。", "/stages/0/regions");
  const rids = new Set<string>();
  stage.regions.forEach((r, i) => {
    const base = `/stages/0/regions/${i}`;
    if (!r.id || rids.has(r.id)) fail("区域 id 须唯一且非空。", `${base}/id`);
    rids.add(r.id);
    if (r.magneticTeslaB != null && !Number.isFinite(r.magneticTeslaB)) fail("B 须为有限数或 null。", `${base}/magneticTeslaB`);
    for (const k of ["xMinM", "xMaxM", "yMinM", "yMaxM"] as const) {
      if (r[k] != null && !Number.isFinite(r[k] as number)) fail("区域边界须为有限数或 null。", `${base}/${k}`);
    }
    if (r.xMinM != null && r.xMaxM != null && r.xMinM >= r.xMaxM) fail("xMinM 须小于 xMaxM。", `${base}/xMinM`);
    if (r.yMinM != null && r.yMaxM != null && r.yMinM >= r.yMaxM) fail("yMinM 须小于 yMaxM。", `${base}/yMinM`);
  });
  (stage.observers ?? []).forEach((o, i) => {
    const base = `/stages/0/observers/${i}`;
    if (!ids.has(o.particleId)) fail("观察事件引用了不存在的粒子。", `${base}/particleId`);
    if ((o.kind === "cross_x" || o.kind === "cross_y") && !Number.isFinite(o.atM)) fail("穿越观察须给 atM。", `${base}/atM`);
    if ((o.kind === "enter_region" || o.kind === "leave_region") && !rids.has(o.regionId ?? "")) fail("区域观察引用了不存在的区域。", `${base}/regionId`);
  });
  (stage.constraints ?? []).forEach((c, i) => {
    const base = `/stages/0/constraints/${i}`;
    const region = stage.regions.find((r) => r.id === c.solveRegionId);
    if (!region) fail("反求引用了不存在的区域。", `${base}/solveRegionId`);
    if (region.magneticTeslaB != null) fail("反求区域的 B 须为 null。", `${base}/solveRegionId`);
    if (!(stage.observers ?? []).some((o) => o.id === c.observerId)) fail("反求引用了不存在的观察事件。", `${base}/observerId`);
  });
}

/** 单粒子推进：共钟、过界换场、解析事件。 */
function runParticle(stage: FieldSceneStage, particle: SceneParticle, maxSeconds: number) {
  const observers = (stage.observers ?? []).filter((o) => o.particleId === particle.id);
  const fired: FiredObserver[] = [];
  const boundaries: FieldSceneSolution["boundaryEvents"] = [];
  const segments: FieldSceneSegment[] = [];
  const firedIds = new Set<string>();
  let p: MagneticState = { xM: particle.xM, yM: particle.yM, vxMps: particle.vxMps, vyMps: particle.vyMps };
  let t = 0;
  let deadline = Infinity;
  let guard = 0;
  const fire = (o: SceneObserver, state: MagneticState, time: number) => {
    if (firedIds.has(o.id)) return;
    firedIds.add(o.id);
    fired.push({ id: o.id, particleId: particle.id, timeSeconds: time, xM: state.xM, yM: state.yM, vxMps: state.vxMps, vyMps: state.vyMps, label: o.label ?? o.id });
  };
  while (t < maxSeconds && t < deadline && guard++ < 600) {
    const region = regionAt(stage.regions, p);
    const B = signedB(region);
    const omega = B !== 0 ? (Math.abs(particle.chargeC) * Math.abs(B)) / particle.massKg : 0;
    const spin: 1 | -1 = (particle.chargeC > 0) === (B < 0) ? 1 : -1;
    const orbit = omega > 0 ? createMagneticOrbit(p, omega, spin) : null;
    const candidates: Candidate[] = [];
    const pushLine = (axis: "x" | "y", target: number, outward: 1 | -1, kind: Candidate["kind"], observer?: SceneObserver) => {
      const time = orbit
        ? (axis === "x" ? crossX(orbit, p, target, outward) : crossY(orbit, p, target, outward))
        : lineCross(p, axis, target, outward);
      if (Number.isFinite(time) && time > 1e-12) candidates.push({ t: time, kind, observer, axis, outward });
    };
    if (region) {
      if (region.xMaxM != null) pushLine("x", region.xMaxM, 1, "boundary");
      if (region.xMinM != null) pushLine("x", region.xMinM, -1, "boundary");
      if (region.yMaxM != null) pushLine("y", region.yMaxM, 1, "boundary");
      if (region.yMinM != null) pushLine("y", region.yMinM, -1, "boundary");
    }
    for (const o of observers) {
      if (firedIds.has(o.id)) continue;
      if (o.kind === "cross_x" || o.kind === "cross_y") {
        const axis = o.kind === "cross_x" ? "x" : "y";
        const dirs: (1 | -1)[] = o.direction ? [o.direction] : [1, -1];
        for (const d of dirs) pushLine(axis, o.atM!, d, "observer", o);
      }
    }
    const limit = Math.min(maxSeconds - t, deadline - t);
    const next = candidates.filter((c) => c.t <= limit + 1e-12).sort((a, b) => a.t - b.t)[0];
    const step = next ? next.t : limit;
    if (!(step > 1e-12)) {
      // 无更多事件：直线外推收尾或停在期限。
      const end = Math.min(maxSeconds, deadline);
      if (end > t) {
        segments.push({ particleId: particle.id, startSeconds: t, endSeconds: end, regionId: region?.id ?? null, mode: orbit ? "arc" : "line", entry: { ...p }, ...(orbit ? { center: orbit.center, radiusM: orbit.radiusM, omega: orbit.omega, spin: orbit.spin, entryAngleRad: orbit.entryAngle } : {}) });
        p = orbit ? orbit.at(end - t) : { xM: p.xM + p.vxMps * (end - t), yM: p.yM + p.vyMps * (end - t), vxMps: p.vxMps, vyMps: p.vyMps };
        t = end;
      }
      break;
    }
    const local = step;
    const after = orbit ? orbit.at(local) : { xM: p.xM + p.vxMps * local, yM: p.yM + p.vyMps * local, vxMps: p.vxMps, vyMps: p.vyMps };
    segments.push({ particleId: particle.id, startSeconds: t, endSeconds: t + local, regionId: region?.id ?? null, mode: orbit ? "arc" : "line", entry: { ...p }, ...(orbit ? { center: orbit.center, radiusM: orbit.radiusM, omega: orbit.omega, spin: orbit.spin, entryAngleRad: orbit.entryAngle } : {}) });
    const abs = t + local;
    // 观察穿越与换界同刻发生时（如「首次过虚线」就是边界），两者都要记录。
    for (const c of candidates) {
      if (c.kind === "observer" && c.observer && Math.abs(c.t - step) <= 1e-9) fire(c.observer, after, abs);
    }
    if (next?.kind === "boundary") {
      const newRegion = regionAt(stage.regions, after);
      boundaries.push({ particleId: particle.id, timeSeconds: abs, fromRegionId: region?.id ?? null, toRegionId: newRegion?.id ?? null, xM: after.xM, yM: after.yM, vxMps: after.vxMps, vyMps: after.vyMps });
      for (const o of observers) {
        if (o.kind === "enter_region" && newRegion?.id === o.regionId) fire(o, after, abs);
        if (o.kind === "leave_region" && region?.id === o.regionId) fire(o, after, abs);
      }
    }
    p = after;
    t = abs;
    if (firedIds.size >= observers.length && observers.length > 0 && deadline === Infinity) {
      // 观察齐备后收尾：场内再走 0.3 圈、场外再走 0.8 s，保证画面完整。
      deadline = t + (omega > 0 ? (0.3 * TAU) / omega : 0.8);
    }
    if (observers.length === 0 && deadline === Infinity) deadline = Math.min(maxSeconds, t + (omega > 0 ? (0.3 * TAU) / omega : 0.8));
  }
  return { segments, fired, boundaries, end: t, last: p };
}

function observerValue(fired: FiredObserver | undefined, kind: SceneConstraint["kind"]): number | null {
  if (!fired) return null;
  const speed = Math.hypot(fired.vxMps, fired.vyMps) || 1;
  switch (kind) {
    case "position_x": return fired.xM;
    case "position_y": return fired.yM;
    case "velocity_cos_x": return fired.vxMps / speed;
    case "velocity_cos_y": return fired.vyMps / speed;
  }
}

/** 反求：按声明顺序对每个待求区域的 |B| 扫描+二分，使观察量命中目标。 */
function solveConstraints(stage: FieldSceneStage): { stage: FieldSceneStage; solved: FieldSceneSolution["solved"] } {
  const working: FieldSceneStage = { ...stage, regions: stage.regions.map((r) => ({ ...r })) };
  const solved: FieldSceneSolution["solved"] = [];
  for (const c of stage.constraints ?? []) {
    const region = working.regions.find((r) => r.id === c.solveRegionId)!;
    const sign = region.fieldDirection === "out_of_page" ? 1 : -1;
    const target = c.kind === "position_x" || c.kind === "position_y" ? c.targetM! : c.targetCos!;
    const valueAt = (magnitude: number): number | null => {
      region.magneticTeslaB = sign * magnitude;
      const run = simulate({ ...working, constraints: [] });
      return observerValue(run.fired.find((f) => f.id === c.observerId), c.kind);
    };
    const f = (x: number): number | null => {
      const v = valueAt(x);
      return v == null ? null : v - target;
    };
    // 对数扫描找变号括号。
    let bracket: [number, number] | null = null;
    let prevX = 1e-4;
    let prevF = f(prevX);
    for (let i = 1; i <= 60; i += 1) {
      const x = 1e-4 * Math.pow(10, i / 6);
      const fx = f(x);
      if (prevF != null && fx != null && prevF * fx <= 0) { bracket = [prevX, x]; break; }
      prevX = x; prevF = fx;
    }
    if (!bracket) fail(`反求 ${c.solveRegionId} 的 B 在 1e-4…1e6 内无解（观察量未命中目标）。`, `/stages/0/constraints`);
    let [lo, hi] = bracket;
    let flo = f(lo)!;
    for (let i = 0; i < 80; i += 1) {
      const mid = (lo + hi) / 2;
      const fm = f(mid);
      if (fm == null) { hi = mid; continue; }
      if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
    }
    const magnitude = (lo + hi) / 2;
    region.magneticTeslaB = sign * magnitude;
    const residual = f(magnitude) ?? NaN;
    solved.push({ regionId: region.id, magneticTeslaB: sign * magnitude, observerId: c.observerId, residual });
  }
  return { stage: working, solved };
}

function simulate(stage: FieldSceneStage): FieldSceneSolution {
  validateFieldScene(stage);
  const maxSeconds = stage.maxSeconds ?? 60;
  const runs = stage.particles.map((p) => runParticle(stage, p, maxSeconds));
  const duration = stage.durationSeconds ?? Math.max(...runs.map((r) => r.end));
  const segments = runs.flatMap((r) => r.segments).filter((s) => s.startSeconds < duration).map((s) => ({ ...s, endSeconds: Math.min(s.endSeconds, duration) }));
  const fired = runs.flatMap((r) => r.fired).filter((f) => f.timeSeconds <= duration + 1e-9).sort((a, b) => a.timeSeconds - b.timeSeconds);
  const boundaryEvents = runs.flatMap((r) => r.boundaries).filter((b) => b.timeSeconds <= duration + 1e-9).sort((a, b) => a.timeSeconds - b.timeSeconds);
  const at = (time: number, particleId: string): MagneticState => {
    const t = Math.min(duration, Math.max(0, Number.isNaN(time) ? 0 : time));
    const mine = segments.filter((s) => s.particleId === particleId);
    const seg = mine.find((s) => t >= s.startSeconds - 1e-12 && t <= s.endSeconds + 1e-12) ?? mine[mine.length - 1];
    if (!seg) {
      const p = stage.particles.find((x) => x.id === particleId)!;
      return { xM: p.xM, yM: p.yM, vxMps: p.vxMps, vyMps: p.vyMps };
    }
    const local = Math.min(seg.endSeconds - seg.startSeconds, Math.max(0, t - seg.startSeconds));
    if (seg.mode === "line") return { xM: seg.entry.xM + seg.entry.vxMps * local, yM: seg.entry.yM + seg.entry.vyMps * local, vxMps: seg.entry.vxMps, vyMps: seg.entry.vyMps };
    const orbit = createMagneticOrbit(seg.entry, seg.omega!, seg.spin!);
    return orbit.at(local);
  };
  const trailOf = (id: string) => {
    const pts: { xM: number; yM: number }[] = [];
    for (const s of segments.filter((x) => x.particleId === id)) {
      const n = 24;
      for (let i = 0; i <= n; i += 1) {
        const st = at(s.startSeconds + ((s.endSeconds - s.startSeconds) * i) / n, id);
        pts.push({ xM: st.xM, yM: st.yM });
      }
    }
    return pts;
  };
  const allPts = stage.particles.flatMap((p) => trailOf(p.id));
  const xs = allPts.map((p) => p.xM); const ys = allPts.map((p) => p.yM);
  const regionXs = stage.regions.flatMap((r) => [r.xMinM, r.xMaxM].filter((v): v is number => v != null));
  const regionYs = stage.regions.flatMap((r) => [r.yMinM, r.yMaxM].filter((v): v is number => v != null));
  const geometry: FieldSceneGeometry = {
    regions: stage.regions,
    particles: stage.particles.map((p) => ({ id: p.id, chargeC: p.chargeC, massKg: p.massKg, trail: trailOf(p.id) })),
    observers: fired.map((f) => ({ id: f.id, particleId: f.particleId, xM: f.xM, yM: f.yM, timeSeconds: f.timeSeconds, label: f.label })),
    bounds: {
      minXM: Math.min(...xs, ...regionXs, 0), maxXM: Math.max(...xs, ...regionXs, 0),
      minYM: Math.min(...ys, ...regionYs, 0), maxYM: Math.max(...ys, ...regionYs, 0),
    },
  };
  const readingAt = (time: number): FieldSceneReading => ({
    particles: stage.particles.map((p) => {
      const st = at(time, p.id);
      return { id: p.id, regionId: regionAt(stage.regions, st)?.id ?? null, xM: st.xM, yM: st.yM, vxMps: st.vxMps, vyMps: st.vyMps };
    }),
    fired: fired.filter((f) => f.timeSeconds <= time + 1e-9),
  });
  return { stage, durationSeconds: duration, segments, fired, boundaryEvents, geometry, solved: [], at, readingAt };
}

/** 组合场景求解入口：含反求时先求未知 B 再正演。 */
export function solveFieldScene(input: FieldSceneStage): FieldSceneSolution {
  validateFieldScene(input);
  const { stage, solved } = (input.constraints ?? []).length > 0 ? solveConstraints(input) : { stage: input, solved: [] };
  const solution = simulate({ ...stage, constraints: [] });
  return { ...solution, solved };
}

/** 装配为共钟 StageMotion：主粒子 = particles[0]，其余进 bodies；事件/段/读数齐全。 */
export function computeFieldSceneMotion(stage: FieldSceneStage, stageIndex = 0): FieldSceneMotion {
  const sol = solveFieldScene(stage);
  const primary = stage.particles[0].id;
  const events: FieldSceneEvent[] = [];
  let order = 0;
  const push = (kind: string, time: number, particleId: string, state: MagneticState, label: string, explanation: string) => {
    events.push({
      id: `${stageIndex}:${kind}:${order}`, stageIndex, stagePath: `/stages/${stageIndex}`, kind, timeSeconds: time, order: order++,
      bodyIds: [particleId], label, explanation,
      position: { xM: state.xM, yM: state.yM },
      velocityBefore: { vxMps: state.vxMps, vyMps: state.vyMps }, velocityAfter: { vxMps: state.vxMps, vyMps: state.vyMps },
    });
  };
  for (const p of stage.particles) push("field_start", 0, p.id, { xM: p.xM, yM: p.yM, vxMps: p.vxMps, vyMps: p.vyMps }, `${p.id} 入射`, `粒子 ${p.id}（q = ${p.chargeC} C，m = ${p.massKg} kg）以 (${p.vxMps}, ${p.vyMps}) m/s 从 (${p.xM}, ${p.yM}) m 入射；忽略重力与粒子间作用。`);
  for (const b of sol.boundaryEvents) push("field_boundary", b.timeSeconds, b.particleId, b, `过界换场 ${b.fromRegionId ?? "无场"} → ${b.toRegionId ?? "无场"}`, `t = ${b.timeSeconds.toFixed(4)} s 穿越边界，位置与速度连续：(${b.xM.toFixed(4)}, ${b.yM.toFixed(4)}) m，v = (${b.vxMps.toFixed(4)}, ${b.vyMps.toFixed(4)}) m/s；换用新区磁场继续解析推进。`);
  for (const f of sol.fired) push("field_observer", f.timeSeconds, f.particleId, f, f.label, `观察事件 ${f.id} 精确命中：t = ${f.timeSeconds.toFixed(4)} s，位置 (${f.xM.toFixed(4)}, ${f.yM.toFixed(4)}) m，v = (${f.vxMps.toFixed(4)}, ${f.vyMps.toFixed(4)}) m/s。`);
  events.sort((a, b) => a.timeSeconds - b.timeSeconds || a.order - b.order);
  const geometry: FieldSceneMotion["geometry"] = {
    blockSizeM: 0.3, positionReference: "particle", scaleMode: "normalized",
    fieldScene: sol.geometry,
  };
  const calculations: NonNullable<FieldSceneMotion["calculations"]> = [];
  for (const s of sol.solved) calculations.push({ quantity: `反求 B(${s.regionId})`, value: s.magneticTeslaB, unit: "T", source: "derived", rule: "观察量命中目标的二分求根", inputPaths: [`/stages/${stageIndex}/constraints`] });
  for (const f of sol.fired) {
    calculations.push({ quantity: `${f.id} 的 x 坐标`, value: f.xM, unit: "m", source: "derived", rule: "解析穿越时刻", inputPaths: [`/stages/${stageIndex}/observers`] });
    calculations.push({ quantity: `${f.id} 的 y 坐标`, value: f.yM, unit: "m", source: "derived", rule: "解析穿越时刻", inputPaths: [`/stages/${stageIndex}/observers`] });
  }
  const lastEvent = events[events.length - 1];
  const termination = { reason: "field_scene_complete" as const, eventId: lastEvent.id, stageIndex };
  const sampleAt = (time: number): StageSample & { bodies?: Record<string, BodyState> } => {
    const bodies: Record<string, BodyState> = {};
    for (const p of stage.particles) {
      const st = sol.at(time, p.id);
      bodies[p.id] = { bodyId: p.id, massKg: p.massKg, xM: st.xM, yM: st.yM, vxMps: st.vxMps, vyMps: st.vyMps, springCompressionM: 0, status: "moving" };
    }
    const main = bodies[primary];
    return { xM: main.xM, yM: main.yM, vxMps: main.vxMps, vyMps: main.vyMps, springCompressionM: 0, bodies };
  };
  return {
    primaryBodyId: primary,
    geometry,
    durationSeconds: sol.durationSeconds,
    segments: [{ stageIndex, kind: "field_scene", startSeconds: 0, endSeconds: sol.durationSeconds, bodyIds: stage.particles.map((p) => p.id), stagePath: `/stages/${stageIndex}` }],
    events,
    calculations,
    termination,
    get endReason() { return termination.reason; },
    sampleAt,
    fieldSceneAt: (time: number) => sol.readingAt(time),
  };
}
