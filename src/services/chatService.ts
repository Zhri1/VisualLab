/**
 * 对话服务适配层：
 * - 播放/暂停/重播、按当前真实事件跳转、旧模板与新版 stage_plan 的自然语言改参走本地瞬时响应；
 * - 所有物理原理讲解、受力分析、数值推导、相似题推荐走真实 AI 助教接口（复用同域 ENDPOINT）；
 * - 离线/Mock 环境或接口异常时，依据当前真实 reading/motion 动态兜底，绝不输出 NULL。
 */
import { ENDPOINT, USE_MOCK_API } from "./imageRecognition";
import { isStageReading } from "../types";
import type {
  ChatIntent,
  ConditionChange,
  ConditionKey,
  Motion,
  RagReference,
  SimilarProblem,
  WorkspaceReading,
} from "../types";
import type { StagePlanDraft } from "../physics/stagePlan";
import { searchPhysicsRag, toRagReferences, type RagHit } from "../rag";

export interface ChatContext {
  motion: Motion | null;
  reading?: WorkspaceReading | null;
  problemText?: string | null;
  currentTime?: number;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  conditions: Record<string, number | null>;
  mode?: "tutor" | "similar";
}

export interface ChatService {
  send(text: string, ctx: ChatContext): Promise<ChatIntent>;
  recommendSimilar(ctx: ChatContext, prompt?: string): Promise<ChatIntent>;
}

export interface QuickParamSuggestion {
  label: string;
  command: string;
}

const NULLISH_REPLY_RE = /^(?:null|none|undefined|nil|nan|n\/a|\{\}|\[\]|""|'')$/i;
const QUESTION_SEMANTIC_RE = /为什么|怎么|多少|求|是否|吗|呢|什么|哪些|推导|解析|讲解|分析|会怎样|变化|？|\?/;
const WANTS_CHANGE_RE = /改成|改为|设为|调到|调成|换成|变成|改到|调整为|改回|改一下|修改|调整/;
const SIMILAR_REQUEST_RE = /推荐.{0,6}(?:相似|类似|变式)|(?:相似|类似|变式).{0,4}题|举一反三|来几道.{0,4}题/;

const LEGACY_KEYWORDS: { key: ConditionKey; label: string; unit: string; re: RegExp }[] = [
  { key: "springConstantNpm", label: "弹簧劲度系数 k", unit: "N/m", re: /劲度|弹簧系数|刚度|\bk\b|k\s*值/i },
  { key: "springGapM", label: "坡底到弹簧距离", unit: "m", re: /弹簧.{0,4}距离|间距|坡底.{0,6}弹簧|gap/i },
  { key: "inclineAngleDeg", label: "斜面倾角 θ", unit: "°", re: /倾角|角度|theta|θ/i },
  { key: "inclineLengthM", label: "斜面长度 L", unit: "m", re: /斜面长|坡长|长度/i },
  { key: "kineticFrictionCoefficient", label: "动摩擦因数 μ", unit: "", re: /摩擦|mu|μ/i },
  { key: "blockMassKg", label: "滑块质量 m", unit: "kg", re: /质量|mass|多重/i },
  { key: "gravityMps2", label: "重力加速度 g", unit: "m/s²", re: /重力加速度|\bg\b\s*(?:=|改|设|取)|取\s*g/i },
];

function isUsableReply(text: unknown): text is string {
  return typeof text === "string" && text.trim().length > 0 && !NULLISH_REPLY_RE.test(text.trim());
}

function findNumber(text: string): number | null {
  const m = text.match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 递归清理对象中的 null / undefined 冗余字段，避免向模型传递大量 null 噪音。 */
function pruneNullish(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const cleaned = value.map(pruneNullish).filter((item) => item !== undefined);
    return cleaned.length > 0 ? cleaned : undefined;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = pruneNullish(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return value;
}

/** 按当前真实运动事件匹配跳转目标（兼容全部新旧场景，不写死 5 个旧事件名）。 */
function matchEventId(text: string, motion: Motion | null): string | null {
  if (!motion?.events.length) return null;
  for (const ev of motion.events) {
    if (ev.label && text.includes(ev.label)) return ev.id;
  }
  const aliases: Array<{ match: RegExp; kinds: string[]; labelRe?: RegExp }> = [
    { match: /最高点|过顶/, kinds: ["arc_top", "apex"], labelRe: /最高点/ },
    { match: /最低点/, kinds: ["arc_lowest"], labelRe: /最低点/ },
    { match: /最大压缩|压缩最短/, kinds: ["max_compression", "spring_pair_max_compression"], labelRe: /最大压缩|压缩最短/ },
    { match: /接触弹簧/, kinds: ["spring_contact", "contact_spring", "spring_pair_contact"], labelRe: /接触弹簧/ },
    { match: /脱离|恢复原长|分离/, kinds: ["spring_detach", "detach_spring", "spring_release_end", "spring_pair_separate"], labelRe: /脱离|恢复原长|分离/ },
    { match: /碰撞|正碰/, kinds: ["collision"], labelRe: /碰/ },
    { match: /落地|着地/, kinds: ["land", "body2_ground_hit"], labelRe: /落地|着地/ },
    { match: /坡底|转向/, kinds: ["reach_bottom", "lossless_turn"], labelRe: /坡底|转向/ },
    { match: /入弧|进入圆弧/, kinds: ["arc_enter"], labelRe: /进入圆弧/ },
    { match: /松绳/, kinds: ["string_slack"], labelRe: /松绳/ },
    { match: /释放|起点|开始/, kinds: ["release"], labelRe: /释放|初态/ },
  ];
  for (const rule of aliases) {
    if (!rule.match.test(text)) continue;
    const hit = motion.events.find(
      (ev) =>
        rule.kinds.includes(ev.id) ||
        (ev.eventKind && rule.kinds.includes(ev.eventKind)) ||
        (rule.labelRe && rule.labelRe.test(ev.label)),
    );
    if (hit) return hit.id;
  }
  return null;
}

/** 构造发给 AI 助教的精简真实物理上下文，自动剔除 null / undefined 冗余字段。 */
export function buildTutorPayload(ctx: ChatContext): Record<string, unknown> {
  const m = ctx.motion;
  const currentTime = ctx.currentTime ?? 0;
  const sample = m ? m.sampleAt(currentTime) : null;
  const energy = m?.energyAt?.(currentTime) ?? null;

  const raw: Record<string, unknown> = {
    problemText: ctx.problemText?.trim() || undefined,
    currentTimeSeconds: Number(currentTime.toFixed(4)),
    durationSeconds: m ? Number(m.durationSeconds.toFixed(4)) : undefined,
    endReason: m?.endReason ?? undefined,
    reading: ctx.reading ?? undefined,
    derivedCalculations: m?.calculations?.length ? m.calculations : undefined,
    currentSnapshot: sample
      ? {
          positionM: { x: Number(sample.position.x.toFixed(4)), y: Number(sample.position.y.toFixed(4)) },
          velocityMps: {
            vx: Number(sample.velocity.x.toFixed(4)),
            vy: Number(sample.velocity.y.toFixed(4)),
            speed: Number(Math.hypot(sample.velocity.x, sample.velocity.y).toFixed(4)),
          },
          constraint: sample.constraint ?? undefined,
          bodies: sample.bodies ?? undefined,
          constraints: sample.constraints ?? undefined,
        }
      : undefined,
    currentEnergyJ: energy ?? undefined,
    events: (m?.events ?? []).map((ev) => ({
      timeSeconds: Number(ev.timeSeconds.toFixed(4)),
      label: ev.label,
      explanation: ev.caption,
      velocityAfter: ev.velocityAfter
        ? { vx: Number(ev.velocityAfter.x.toFixed(4)), vy: Number(ev.velocityAfter.y.toFixed(4)) }
        : undefined,
      normalForceAfterN: ev.normalForceAfterN != null ? Number(ev.normalForceAfterN.toFixed(3)) : undefined,
    })),
    history: (ctx.history ?? []).slice(-8),
  };

  return (pruneNullish(raw) as Record<string, unknown>) ?? {};
}

/* ==================== stage_plan 自然语言改参 ==================== */

interface StageParamMatch {
  key: string;
  label: string;
  unit: string;
  path: string;
  from: number | null;
  apply: (draft: StagePlanDraft, value: number) => void;
}

function findStageParamTarget(text: string, reading: StagePlanDraft): StageParamMatch | null {
  const stages = Array.isArray(reading.stages) ? reading.stages : [];

  // 1. 重力加速度
  if (/重力加速度|\bg\b\s*(?:=|改成|改为|设为|调|取)|取\s*g/i.test(text)) {
    return {
      key: "gravityMps2",
      label: "重力加速度 g",
      unit: "m/s²",
      path: "/gravityMps2",
      from: typeof reading.gravityMps2 === "number" ? reading.gravityMps2 : null,
      apply: (draft, value) => {
        draft.gravityMps2 = value;
      },
    };
  }

  // 2. 圆弧槽质量 / 大槽质量（movable_arc）
  if (/(?:圆弧)?槽.{0,3}质量|slotMass|grooveMass/i.test(text)) {
    const idx = stages.findIndex((s) => s.kind === "movable_arc" || "grooveMassKg" in s);
    if (idx !== -1) {
      const prev = typeof stages[idx].grooveMassKg === "number" ? (stages[idx].grooveMassKg as number) : null;
      return {
        key: "grooveMassKg",
        label: "圆弧槽质量 M",
        unit: "kg",
        path: `/stages/${idx}/grooveMassKg`,
        from: prev,
        apply: (draft, value) => {
          draft.stages[idx].grooveMassKg = value;
        },
      };
    }
  }

  // 3. 第二物体 / 目标球 / 木板质量
  if (/(?:第二|目标|B|乙|木板|平板|大物块|球\s*2|m2|m₂).{0,4}质量|secondMass|targetMass/i.test(text)) {
    const spIdx = stages.findIndex((s) => s.kind === "spring_pair" || "targetMassKg" in s);
    if (spIdx !== -1) {
      const prev = typeof stages[spIdx].targetMassKg === "number" ? (stages[spIdx].targetMassKg as number) : null;
      return {
        key: "targetMassKg",
        label: "目标球质量 m₂",
        unit: "kg",
        path: `/stages/${spIdx}/targetMassKg`,
        from: prev,
        apply: (draft, value) => {
          draft.stages[spIdx].targetMassKg = value;
        },
      };
    }
    const grooveIdx = stages.findIndex((s) => s.kind === "movable_arc" || "grooveMassKg" in s);
    if (grooveIdx !== -1) {
      const prev = typeof stages[grooveIdx].grooveMassKg === "number" ? (stages[grooveIdx].grooveMassKg as number) : null;
      return {
        key: "grooveMassKg",
        label: "圆弧槽质量 M",
        unit: "kg",
        path: `/stages/${grooveIdx}/grooveMassKg`,
        from: prev,
        apply: (draft, value) => {
          draft.stages[grooveIdx].grooveMassKg = value;
        },
      };
    }
    if (Array.isArray(reading.bodies) && reading.bodies.length > 1) {
      const prev = typeof reading.bodies[1].massKg === "number" ? reading.bodies[1].massKg : null;
      return {
        key: "secondMassKg",
        label: `物体 ${reading.bodies[1].bodyId || "2"} 质量`,
        unit: "kg",
        path: "/bodies/1/massKg",
        from: prev,
        apply: (draft, value) => {
          if (draft.bodies?.[1]) draft.bodies[1].massKg = value;
        },
      };
    }
  }

  // 4. 物体质量（massKg 或多体 bodies[0].massKg）
  if (/质量|mass|多重/i.test(text)) {
    if (typeof reading.massKg === "number" || reading.massKg === null || !Array.isArray(reading.bodies)) {
      return {
        key: "massKg",
        label: "物体质量 m",
        unit: "kg",
        path: "/massKg",
        from: typeof reading.massKg === "number" ? reading.massKg : null,
        apply: (draft, value) => {
          draft.massKg = value;
        },
      };
    }
    if (Array.isArray(reading.bodies) && reading.bodies.length > 0) {
      const prev = typeof reading.bodies[0].massKg === "number" ? reading.bodies[0].massKg : null;
      return {
        key: "massKg",
        label: `物体 ${reading.bodies[0].bodyId || "1"} 质量`,
        unit: "kg",
        path: "/bodies/0/massKg",
        from: prev,
        apply: (draft, value) => {
          if (draft.bodies?.[0]) draft.bodies[0].massKg = value;
        },
      };
    }
  }

  // 5. 弹簧劲度系数
  if (/劲度|弹簧系数|刚度|\bk\b|k\s*值/i.test(text)) {
    const idx = stages.findIndex(
      (s) => s.kind === "spring_contact" || s.kind === "spring_release" || s.kind === "spring_pair" || "springConstantNpm" in s,
    );
    if (idx !== -1) {
      const prev = typeof stages[idx].springConstantNpm === "number" ? (stages[idx].springConstantNpm as number) : null;
      return {
        key: "springConstantNpm",
        label: "弹簧劲度系数 k",
        unit: "N/m",
        path: `/stages/${idx}/springConstantNpm`,
        from: prev,
        apply: (draft, value) => {
          draft.stages[idx].springConstantNpm = value;
        },
      };
    }
  }

  // 6. 圆弧半径
  if (/半径|\bR\b/i.test(text)) {
    const idx = stages.findIndex((s) => s.kind === "vertical_arc" || s.kind === "movable_arc" || "radiusM" in s);
    if (idx !== -1) {
      const prev = typeof stages[idx].radiusM === "number" ? (stages[idx].radiusM as number) : null;
      return {
        key: "radiusM",
        label: "圆弧半径 R",
        unit: "m",
        path: `/stages/${idx}/radiusM`,
        from: prev,
        apply: (draft, value) => {
          draft.stages[idx].radiusM = value;
        },
      };
    }
  }

  // 7. 动摩擦因数
  if (/摩擦|mu|μ/i.test(text)) {
    const idx = stages.findIndex((s) => "kineticFrictionCoefficient" in s);
    if (idx !== -1) {
      const prev =
        typeof stages[idx].kineticFrictionCoefficient === "number"
          ? (stages[idx].kineticFrictionCoefficient as number)
          : null;
      return {
        key: "kineticFrictionCoefficient",
        label: "动摩擦因数 μ",
        unit: "",
        path: `/stages/${idx}/kineticFrictionCoefficient`,
        from: prev,
        apply: (draft, value) => {
          draft.stages[idx].kineticFrictionCoefficient = value;
        },
      };
    }
  }

  // 8. 倾角 / 角度
  if (/倾角|角度|夹角|theta|θ/i.test(text)) {
    const idx = stages.findIndex((s) => "angleDeg" in s || "initialAngleDeg" in s || "endAngleDeg" in s);
    if (idx !== -1) {
      const field = "angleDeg" in stages[idx] ? "angleDeg" : "initialAngleDeg" in stages[idx] ? "initialAngleDeg" : "endAngleDeg";
      const prev = typeof stages[idx][field] === "number" ? (stages[idx][field] as number) : null;
      return {
        key: field,
        label: field === "angleDeg" ? "斜面倾角 θ" : "角度 θ",
        unit: "°",
        path: `/stages/${idx}/${field}`,
        from: prev,
        apply: (draft, value) => {
          draft.stages[idx][field] = value;
        },
      };
    }
  }

  // 9. 长度（斜面长 / 摆长 / 传送带长 / 木板长）
  if (/斜面长|坡长|摆长|绳长|传送带长|木板长|长度|\bL\b/i.test(text)) {
    const idx = stages.findIndex((s) => "lengthM" in s || "beltLengthM" in s || "plankLengthM" in s);
    if (idx !== -1) {
      const field = "lengthM" in stages[idx] ? "lengthM" : "beltLengthM" in stages[idx] ? "beltLengthM" : "plankLengthM";
      const prev = typeof stages[idx][field] === "number" ? (stages[idx][field] as number) : null;
      const label =
        field === "beltLengthM" ? "传送带长度 L" : field === "plankLengthM" ? "木板长度 L" : "长度 L";
      return {
        key: field,
        label,
        unit: "m",
        path: `/stages/${idx}/${field}`,
        from: prev,
        apply: (draft, value) => {
          draft.stages[idx][field] = value;
        },
      };
    }
  }

  // 10. 水平距离 / 弹簧间距
  if (/距离|间距|滑行距离|水平距离|gap/i.test(text)) {
    const hIdx = stages.findIndex(
      (s) => s.kind === "horizontal_slide" && isRecord(s.end) && "distanceM" in s.end,
    );
    if (hIdx !== -1) {
      const endObj = stages[hIdx].end as Record<string, unknown>;
      const prev = typeof endObj.distanceM === "number" ? endObj.distanceM : null;
      return {
        key: "distanceM",
        label: "水平距离",
        unit: "m",
        path: `/stages/${hIdx}/end/distanceM`,
        from: prev,
        apply: (draft, value) => {
          if (isRecord(draft.stages[hIdx].end)) {
            (draft.stages[hIdx].end as Record<string, unknown>).distanceM = value;
          }
        },
      };
    }
    const gIdx = stages.findIndex((s) => "gapM" in s);
    if (gIdx !== -1) {
      const prev = typeof stages[gIdx].gapM === "number" ? (stages[gIdx].gapM as number) : null;
      return {
        key: "gapM",
        label: "弹簧间距",
        unit: "m",
        path: `/stages/${gIdx}/gapM`,
        from: prev,
        apply: (draft, value) => {
          draft.stages[gIdx].gapM = value;
        },
      };
    }
  }

  // 11. 下落高度
  if (/下落高度|落差|高度|\bh\b/i.test(text)) {
    const idx = stages.findIndex((s) => "dropHeightM" in s);
    if (idx !== -1) {
      const prev = typeof stages[idx].dropHeightM === "number" ? (stages[idx].dropHeightM as number) : null;
      return {
        key: "dropHeightM",
        label: "下落高度 h",
        unit: "m",
        path: `/stages/${idx}/dropHeightM`,
        from: prev,
        apply: (draft, value) => {
          draft.stages[idx].dropHeightM = value;
        },
      };
    }
  }

  // 12. 传送带速度
  if (/传送带.{0,3}速度|带速/i.test(text)) {
    const idx = stages.findIndex((s) => s.kind === "conveyor_belt" || "initialBeltSpeedMps" in s);
    if (idx !== -1) {
      const prev =
        typeof stages[idx].initialBeltSpeedMps === "number" ? (stages[idx].initialBeltSpeedMps as number) : null;
      return {
        key: "initialBeltSpeedMps",
        label: "传送带初速度",
        unit: "m/s",
        path: `/stages/${idx}/initialBeltSpeedMps`,
        from: prev,
        apply: (draft, value) => {
          draft.stages[idx].initialBeltSpeedMps = value;
        },
      };
    }
  }

  // 13. 初速度（speedMps / vxMps / tangentialSpeedMps）
  if (/初速|初始速度|发射速度|平抛速度|入射速度|速度|\bv0\b|\bv₀\b/i.test(text)) {
    const init = reading.initial as Record<string, unknown> | undefined;
    if (init && typeof init === "object") {
      for (const field of ["speedMps", "vxMps", "tangentialSpeedMps"] as const) {
        if (field in init) {
          const prev = typeof init[field] === "number" ? (init[field] as number) : null;
          return {
            key: field,
            label: "初速度 v₀",
            unit: "m/s",
            path: `/initial/${field}`,
            from: prev,
            apply: (draft, value) => {
              (draft.initial as Record<string, unknown>)[field] = value;
            },
          };
        }
      }
    }
  }

  return null;
}

export function tryParseStagePlanUpdate(text: string, reading: StagePlanDraft): ChatIntent | null {
  if (!WANTS_CHANGE_RE.test(text) || QUESTION_SEMANTIC_RE.test(text)) return null;
  const target = findStageParamTarget(text, reading);
  if (!target) return null;
  const value = findNumber(text);
  if (value === null) {
    return { type: "clarify", text: `想把「${target.label}」改成多少？给我一个具体数值，我直接重算动画。` };
  }
  const nextReading = JSON.parse(JSON.stringify(reading)) as StagePlanDraft;
  target.apply(nextReading, value);
  const change: ConditionChange = {
    key: target.key,
    label: target.label,
    unit: target.unit,
    path: target.path,
    from: target.from,
    to: value,
  };
  const unitSuffix = target.unit ? ` ${target.unit}` : "";
  return {
    type: "update_stage_plan",
    nextReading,
    changes: [change],
    text: `已将「${target.label}」从 ${target.from ?? "—"} 改为 ${value}${unitSuffix}。`,
  };
}

/** 动态提取当前题目的 2~3 个典型改参快捷建议，保证目标值与当前值不同。 */
export function getQuickParamSuggestions(reading: WorkspaceReading | null | undefined): QuickParamSuggestion[] {
  if (!reading) {
    return [
      { label: "把质量改为 2 kg", command: "把质量改为 2 kg" },
      { label: "把摩擦因数改为 0.2", command: "把摩擦因数改为 0.2" },
      { label: "把重力加速度改为 9.8 m/s²", command: "把重力加速度改为 9.8 m/s²" },
    ];
  }

  const suggestions: QuickParamSuggestion[] = [];
  const push = (label: string, command: string) => {
    if (suggestions.length < 3 && !suggestions.some((s) => s.command === command)) {
      suggestions.push({ label, command });
    }
  };

  if (!isStageReading(reading)) {
    const c = reading.conditions;
    const nextK = c.springConstantNpm === 100 ? 200 : 100;
    push(`把劲度系数改为 ${nextK} N/m`, `把劲度系数改为 ${nextK} N/m`);
    const nextMu = c.kineticFrictionCoefficient === 0.2 ? 0.1 : 0.2;
    push(`把摩擦因数改为 ${nextMu}`, `把摩擦因数改为 ${nextMu}`);
    const nextMass = c.blockMassKg === 2 ? 1 : 2;
    push(`把质量改为 ${nextMass} kg`, `把质量改为 ${nextMass} kg`);
    return suggestions;
  }

  const stages = Array.isArray(reading.stages) ? reading.stages : [];
  for (const s of stages) {
    if (s.kind === "vertical_arc" || s.kind === "movable_arc") {
      const curR = typeof s.radiusM === "number" ? s.radiusM : 1;
      const nextR = Math.abs(curR - 1) < 1e-6 ? 1.5 : 1;
      push(`把半径改为 ${nextR} m`, `把半径改为 ${nextR} m`);
    }
    if (s.kind === "movable_arc") {
      const curM = typeof s.grooveMassKg === "number" ? s.grooveMassKg : 3;
      const nextM = Math.abs(curM - 4) < 1e-6 ? 2 : 4;
      push(`把圆弧槽质量改为 ${nextM} kg`, `把圆弧槽质量改为 ${nextM} kg`);
    }
    if (s.kind === "spring_contact" || s.kind === "spring_release" || s.kind === "spring_pair") {
      const curK = typeof s.springConstantNpm === "number" ? s.springConstantNpm : 100;
      const nextK = Math.abs(curK - 100) < 1e-6 ? 200 : 100;
      push(`把劲度系数改为 ${nextK} N/m`, `把劲度系数改为 ${nextK} N/m`);
    }
    if ("kineticFrictionCoefficient" in s) {
      const curMu = typeof s.kineticFrictionCoefficient === "number" ? s.kineticFrictionCoefficient : 0.2;
      const nextMu = Math.abs(curMu - 0.2) < 1e-6 ? 0.1 : 0.2;
      push(`把摩擦因数改为 ${nextMu}`, `把摩擦因数改为 ${nextMu}`);
    }
    if ("angleDeg" in s) {
      const curA = typeof s.angleDeg === "number" ? s.angleDeg : 30;
      const nextA = Math.abs(curA - 37) < 1e-6 ? 30 : 37;
      push(`把倾角改为 ${nextA}°`, `把倾角改为 ${nextA}°`);
    }
  }

  if (typeof reading.massKg === "number") {
    const nextMass = Math.abs(reading.massKg - 2) < 1e-6 ? 1 : 2;
    push(`把质量改为 ${nextMass} kg`, `把质量改为 ${nextMass} kg`);
  }
  const init = reading.initial as Record<string, unknown> | undefined;
  if (init && typeof init.speedMps === "number" && init.speedMps > 0) {
    const nextV = Math.abs(init.speedMps - 6) < 1e-6 ? 4 : 6;
    push(`把初速度改为 ${nextV} m/s`, `把初速度改为 ${nextV} m/s`);
  } else if (init && typeof init.vxMps === "number" && init.vxMps > 0) {
    const nextV = Math.abs(init.vxMps - 5) < 1e-6 ? 3 : 5;
    push(`把初速度改为 ${nextV} m/s`, `把初速度改为 ${nextV} m/s`);
  }
  if (typeof reading.gravityMps2 === "number") {
    const nextG = Math.abs(reading.gravityMps2 - 9.8) < 1e-6 ? 10 : 9.8;
    push(`把重力加速度改为 ${nextG} m/s²`, `把重力加速度改为 ${nextG} m/s²`);
  }

  return suggestions.slice(0, 3);
}

/* ==================== 相似变式题本地精选兜底题库 ==================== */

const SIMILAR_BANK: Record<string, SimilarProblem[]> = {
  movable_arc: [
    {
      title: "可动圆弧槽反冲与水平滑行组合",
      tags: ["动量守恒", "机械能守恒", "可动圆弧槽"],
      difficulty: "中档",
      stem: "光滑水平面上静置一质量为 M = 3 kg、半径为 R = 0.8 m 的光滑四分之一圆弧槽，质量为 m = 1 kg 的小球从槽顶由静止释放。重力加速度 g = 10 m/s²，求小球离开圆弧槽底端时的速度大小及圆弧槽的速度大小。",
      focus: "改变球与槽的质量比（M/m = 3），观察反冲速度分配与「人船模型」水平位移反比规律。",
      hint: "1. 系统水平方向不受外力，水平动量守恒：mv₁ - Mv₂ = 0。\n2. 光滑无摩擦，机械能守恒：mgR = ½mv₁² + ½Mv₂²。\n3. 联立解得 v₁ = √(2gRM/(M+m)) = √12 ≈ 3.46 m/s，v₂ = (m/M)v₁ ≈ 1.15 m/s。",
    },
    {
      title: "可动圆弧槽接自由弹簧双球碰撞",
      tags: ["动量守恒", "弹簧弹性碰撞", "多阶段综合"],
      difficulty: "拔高",
      stem: "光滑水平面上有一质量 M = 2 kg、半径 R = 0.9 m 的光滑四分之一圆弧槽，质量 m₁ = 1 kg 的小球从槽顶由静止滑下后，在光滑水平面上向右滑行 0.6 m 压缩前方质量 m₂ = 2 kg 静止小球所连的轻质自由弹簧（劲度系数 k = 200 N/m），g = 10 m/s²。求弹簧的最大弹性势能及两球分离后的速度。",
      focus: "在可动圆弧槽出射后衔接自由弹簧双球相互作用，完整串联两段动量与能量守恒。",
      hint: "1. 槽段：v₁ = √(2gRM/(M+m₁)) = √12 m/s。\n2. 弹簧共速时弹性势能最大：v共 = m₁v₁/(m₁+m₂)，Ep_max = ½m₁v₁² - ½(m₁+m₂)v共²。\n3. 分离时相当于一维弹性正碰：v₁' = (m₁-m₂)/(m₁+m₂)·v₁，v₂' = 2m₁/(m₁+m₂)·v₁。",
    },
  ],
  spring_pair: [
    {
      title: "自由弹簧双球共速与最大压缩量",
      tags: ["动量守恒", "简谐相对运动", "最大弹性势能"],
      difficulty: "中档",
      stem: "光滑水平面上，质量 m₁ = 1 kg 的小球以初速度 v₀ = 6 m/s 向右运动 0.5 m 后，与静止的质量 m₂ = 2 kg、左端连有劲度系数 k = 150 N/m 轻质弹簧的小球接触并压缩弹簧，全程无能量损失，g = 10 m/s²。求两球共速时的速度及弹簧的最大弹性势能。",
      focus: "经典自由弹簧双球模型：压缩到共速时弹性势能最大，恢复原长时完成弹性动量交换。",
      hint: "1. 水平方向合外力为零，动量守恒：m₁v₀ = (m₁+m₂)v共，得 v共 = 2 m/s。\n2. 机械能守恒：Ep_max = ½m₁v₀² - ½(m₁+m₂)v共² = 18 - 6 = 12 J。\n3. 最大压缩量 x_max = √(2Ep_max/k) = 0.4 m。",
    },
    {
      title: "等质量弹簧双球速度完全交换",
      tags: ["弹性碰撞", "动量守恒", "弹簧接触"],
      difficulty: "基础",
      stem: "光滑水平面上，质量 m₁ = 2 kg 的滑块以初速度 v₀ = 4 m/s 向右运动 0.4 m 后接触静止的同质量滑块 m₂ = 2 kg 所连的自由轻弹簧（劲度系数 k = 200 N/m），g = 10 m/s²。观察弹簧压缩到分离全过程的速度变化。",
      focus: "当 m₁ = m₂ 时，分离后两球实现速度完全交换，便于直观对比不同质量比下的反弹行为。",
      hint: "1. 共速时刻 v共 = v₀/2 = 2 m/s，弹簧弹性势能达到初动能的一半（8 J）。\n2. 恢复原长分离时，v₁' = 0，v₂' = 4 m/s，动能与动量全部传递给 m₂。",
    },
  ],
  vertical_arc: [
    {
      title: "平抛切入光滑圆弧与最高点临界压力",
      tags: ["平抛运动", "竖直圆弧", "临界条件"],
      difficulty: "拔高",
      stem: "质量 m = 1 kg 的小球从 A 点以水平初速度 v₀ = 4 m/s 抛出，下落高度 h = 0.8 m 后恰好沿切线从 B 点进入半径 R = 0.5 m 的光滑竖直圆弧轨道内侧（B 点与圆心连线和竖直向下方向夹角为 45°，轨道经最低点 C 延伸至最高点 D，对应圆心角 225°），g = 10 m/s²。求小球到达最高点 D 时的速度及轨道对小球的压力。",
      focus: "考查平抛末速度方向与圆弧切线衔接，以及圆轨道最高点向心力方程 N + mg = mv²/R。",
      hint: "1. 平抛段：vy = √(2gh) = 4 m/s，合速度 vB = √(v₀² + vy²) = 4√2 m/s，方向与水平成 45° 恰沿 B 点切线入弧。\n2. 圆弧段机械能守恒：B 到 D 上升 Δh = R(1 + cos45°) ≈ 0.854 m，vD = √(vB² - 2gΔh) ≈ 3.86 m/s。\n3. 最高点受力：N = mvD²/R - mg ≈ 19.9 N，安全过顶。",
    },
    {
      title: "斜面加速接竖直半圆轨道过顶实验",
      tags: ["动能定理", "竖直圆弧", "向心力"],
      difficulty: "中档",
      stem: "质量 m = 1 kg 的滑块从倾角 37°、长 L = 4 m 的光滑斜面顶端由静止滑下，经底端无损转向后进入半径 R = 0.8 m 的光滑竖直半圆轨道内侧，g = 10 m/s²。判断滑块能否通过半圆轨道最高点并求最高点处轨道压力。",
      focus: "将斜面加速与竖直圆弧串联，可通过修改斜面长度或圆弧半径直接观察是否脱轨。",
      hint: "1. 下滑高度 H = L·sin37° = 2.4 m，由动能定理得底端速度 v底 = √(2gH) = √48 m/s。\n2. 过顶需满足 H ≥ 2.5R = 2.0 m，本题 2.4 m > 2.0 m 可以安全通过。\n3. 最高点 v顶² = 2g(H - 2R) = 16，N = mv顶²/R - mg = 10 N。",
    },
  ],
  projectile: [
    {
      title: "粗糙水平减速后平台飞出平抛",
      tags: ["动能定理", "平抛运动", "水平射程"],
      difficulty: "基础",
      stem: "质量 m = 1 kg 的物块以初速度 v₀ = 6 m/s 在动摩擦因数 μ = 0.2 的水平桌面上滑行 d = 5 m 后从桌沿水平飞出，桌面距地面高度 h = 1.25 m，g = 10 m/s²。求物块离开桌沿时的速度及平抛水平射程。",
      focus: "将水平匀减速与平抛串联，练习用动能定理衔接两阶段边界速度。",
      hint: "1. 桌面段：v₁² = v₀² - 2μgd = 36 - 20 = 16，得 v₁ = 4 m/s。\n2. 平抛段：t = √(2h/g) = 0.5 s，水平射程 x = v₁t = 2.0 m。",
    },
    {
      title: "斜面下滑经水平平台后平抛落地",
      tags: ["斜面运动", "平抛运动", "机械能"],
      difficulty: "中档",
      stem: "质量 m = 2 kg 的滑块从倾角 30°、长 L = 3.2 m、动摩擦因数 μ = 0.2 的斜面顶端由静止下滑，底端经光滑圆弧无损转向进入光滑水平平台，滑行 d = 1.0 m 后从高 h = 1.8 m 的平台边缘水平飞出，g = 10 m/s²。求滑块落地点距平台边缘的水平距离。",
      focus: "结合斜面摩擦力做功、光滑平台衔接与平抛落地时间，适合改变倾角或摩擦因数对比落点变化。",
      hint: "1. 斜面加速度 a = g(sin30° - μcos30°) ≈ 3.27 m/s²，底端速度 v = √(2aL) ≈ 4.57 m/s，经光滑水平平台速度不变。\n2. 平抛时间 t = √(2h/g) = 0.6 s，水平射程 x = vt ≈ 2.74 m。",
    },
  ],
  incline_slide: [
    {
      title: "粗糙斜面下滑接弹簧压缩与反弹",
      tags: ["动能定理", "弹簧弹性势能", "牛顿第二定律"],
      difficulty: "中档",
      stem: "质量 m = 1 kg 的滑块从倾角 37°、长 L = 2.5 m、动摩擦因数 μ = 0.25 的斜面顶端由静止下滑，底端无损转向进入光滑水平面，滑行 1.0 m 后压缩劲度系数 k = 200 N/m 的轻质弹簧（滑块与弹簧不连接），g = 10 m/s²。求弹簧最大压缩量。",
      focus: "经典斜面-水平-弹簧三段综合题，可在动画中直接修改劲度系数 k 与摩擦因数 μ 做对照。",
      hint: "1. 斜面加速度 a = g(sin37° - μcos37°) = 4 m/s²，底端速度 v = √(2aL) = √20 ≈ 4.47 m/s。\n2. 水平面光滑，滑块动能全部转化为弹簧弹性势能：½mv² = ½kx²。\n3. 解得最大压缩量 x = √(mv²/k) = √0.1 ≈ 0.316 m。",
    },
    {
      title: "斜面下滑后在粗糙水平面匀减速停止",
      tags: ["牛顿第二定律", "动能定理", "摩擦力做功"],
      difficulty: "基础",
      stem: "质量 m = 2 kg 的滑块从倾角 30°、长 L = 4 m 的光滑斜面顶端由静止滑下，经底端无损转向后进入动摩擦因数 μ = 0.25 的粗糙水平面直至停下，g = 10 m/s²。求滑块在水平面上滑行的总距离与总时间。",
      focus: "去掉弹簧改为粗糙水平面减速至静止，突出全过程重力做功等于摩擦力做功的整体法。",
      hint: "1. 全程动能定理：mgL·sin30° - μmgs = 0，直接得水平滑行距离 s = L·sin30°/μ = 8 m。\n2. 斜面末速度 v = √(2gL·sin30°) = √40 ≈ 6.32 m/s，水平减速时间 t₂ = v/(μg) ≈ 2.53 s。",
    },
  ],
  block_plank: [
    {
      title: "滑块冲上光滑地面长木板求共速与划痕",
      tags: ["板块模型", "动量守恒", "摩擦生热"],
      difficulty: "中档",
      stem: "光滑水平面上静置一质量 M = 2 kg、长 L = 3 m 的长木板，质量 m = 1 kg 的滑块以初速度 v₀ = 6 m/s 从左端滑上木板，滑块与木板间动摩擦因数 μ = 0.3，g = 10 m/s²。求二者共速时的速度以及滑块相对木板滑行的距离。",
      focus: "典型板块相对运动：用动量守恒求共速，用能量守恒求相对位移（划痕长度）。",
      hint: "1. 动量守恒：mv₀ = (m+M)v共，得 v共 = 2 m/s。\n2. 摩擦生热：μmg·Δx = ½mv₀² - ½(m+M)v共² = 12 J，解得 Δx = 4 m > 3 m，滑块会从右端滑离。",
    },
    {
      title: "板块模型不滑离的最小初速度边界",
      tags: ["板块模型", "临界条件", "能量守恒"],
      difficulty: "拔高",
      stem: "光滑水平面上静置一质量 M = 3 kg、长 L = 2 m 的长木板，质量 m = 1 kg 的滑块以初速度 v₀ = 4 m/s 从左端滑上木板，滑块与木板间动摩擦因数 μ = 0.3，g = 10 m/s²。判断滑块能否停在木板上，并求最终共同速度。",
      focus: "将滑块初速度降到临界值附近，观察共速点恰好落在木板内部时的相对位移关系。",
      hint: "1. 共速 v共 = mv₀/(m+M) = 1 m/s。\n2. 相对位移 Δx = Mv₀² / [2μg(m+M)] = 2.0 m，恰好停在木板右端边缘。",
    },
  ],
  conveyor_belt: [
    {
      title: "水平传送带由静止放物块的加速与共速",
      tags: ["传送带模型", "滑动摩擦力", "相对位移"],
      difficulty: "基础",
      stem: "水平传送带以恒定速度 v = 4 m/s 向右匀速运行，总长 L = 6 m。将质量 m = 1 kg 的物块轻放在传送带左端（初速度为 0），物块与传送带间的动摩擦因数 μ = 0.2，g = 10 m/s²。求物块到达右端的时间以及在带上留下的划痕长度。",
      focus: "掌握先匀加速后匀速两段运动判别，区分物块对地位移与相对传送带的划痕位移。",
      hint: "1. 加速加速度 a = μg = 2 m/s²，达到共速需 t₁ = v/a = 2 s，位移 x₁ = ½at₁² = 4 m < 6 m。\n2. 剩余 2 m 匀速需 t₂ = 0.5 s，总时间 2.5 s；划痕长度 Δx = vt₁ - x₁ = 4 m。",
    },
    {
      title: "高速物块滑上传送带的减速共速与右端平抛",
      tags: ["传送带模型", "牛顿定律", "平抛运动"],
      difficulty: "中档",
      stem: "水平传送带以恒定速度 v = 3 m/s 向右匀速运行，总长 L = 8 m，右端距地面高度 h = 1.25 m。质量 m = 1 kg 的滑块以初速度 v₀ = 5 m/s 从左端向右冲上传送带，动摩擦因数 μ = 0.2，g = 10 m/s²。求滑块在传送带上减速至共速的时间及从右端平抛落地的水平射程。",
      focus: "考查初速度大于带速时的匀减速共速过程，并衔接右端悬空平抛运动。",
      hint: "1. 减速加速度大小 a = μg = 2 m/s²，减至共速 3 m/s 用时 t₁ = 1 s，位移 x₁ = 4 m < 8 m。\n2. 剩余 4 m 以 3 m/s 匀速到达右端，随后平抛时间 t₂ = √(2h/g) = 0.5 s，水平射程 x = 3 × 0.5 = 1.5 m。",
    },
  ],
  pulley_system: [
    {
      title: "定滑轮连接体匀加速与绳子张力",
      tags: ["滑轮连接体", "牛顿第二定律", "整体法隔离法"],
      difficulty: "基础",
      stem: "理想光滑定滑轮两侧用轻质不可伸长细绳悬挂质量分别为 m₁ = 2 kg 和 m₂ = 3 kg 的两物体，m₂ 距地面高度 h = 1.6 m，系统由静止释放，不计空气阻力，g = 10 m/s²。求系统加速度、绳子张力以及 m₂ 落地时的速度。",
      focus: "经典阿特伍德机模型，强化整体法求加速度与隔离法求内力（张力）。",
      hint: "1. 整体法：a = (m₂ - m₁)g / (m₁ + m₂) = 2 m/s²。\n2. 隔离 m₁：T - m₁g = m₁a，得张力 T = 24 N。\n3. m₂ 落地速度 v = √(2ah) = √6.4 ≈ 2.53 m/s。",
    },
    {
      title: "桌面滑块与悬挂重物滑轮连接体",
      tags: ["滑轮连接体", "摩擦力", "多体动力学"],
      difficulty: "中档",
      stem: "水平桌面上放有质量 m₁ = 2 kg 的滑块（与桌面间动摩擦因数 μ = 0.2，静摩擦因数 μs = 0.2），通过轻质不可伸长细绳跨过桌边理想光滑定滑轮与悬挂的质量 m₂ = 1 kg 的重物相连，重物距地 h = 1.2 m，由静止释放后开始加速滑动，g = 10 m/s²。求释放后的加速度与绳子张力。",
      focus: "将桌面摩擦与竖直重物耦合，对比光滑与粗糙桌面下加速度与张力的变化。",
      hint: "1. 整体法：m₂g - μm₁g = (m₁ + m₂)a，代入得 (10 - 4) = 3a，a = 2 m/s²。\n2. 隔离 m₂：m₂g - T = m₂a，得绳子张力 T = 8 N。",
    },
  ],
  collision_1d: [
    {
      title: "单摆下摆后与水平滑块一维弹性碰撞",
      tags: ["单摆", "一维弹性碰撞", "动量与能量守恒"],
      difficulty: "拔高",
      stem: "长 L = 0.8 m 的轻质不可伸长细绳悬挂质量 m₁ = 1 kg 的小球（悬点固定，不计空气阻力），将小球拉至左侧与竖直方向成 60° 角绷紧后由静止释放，摆至最低点时与静止在最低点、质量 m₂ = 2 kg 的滑块发生一维弹性正碰，碰后滑块沿动摩擦因数 μ = 0.2 的粗糙水平面滑行直至停止，g = 10 m/s²。求碰后两物体的速度及滑块滑行的距离。",
      focus: "结合单摆机械能守恒与弹性正碰速度公式，观察小质量撞大质量时的反弹现象与粗糙面滑行。",
      hint: "1. 摆球最低点速度 v₁ = √(2gL(1 - cos60°)) = √8 ≈ 2.83 m/s。\n2. 弹性正碰：v₁' = (m₁-m₂)/(m₁+m₂)·v₁ = -v₁/3，v₂' = 2m₁/(m₁+m₂)·v₁ = 2v₁/3。\n3. 滑块滑行距离 s = v₂'²/(2μg) = (32/9)/4 ≈ 0.89 m。",
    },
    {
      title: "完全非弹性碰撞与动能损失计算",
      tags: ["完全非弹性碰撞", "动量守恒", "能量损失"],
      difficulty: "基础",
      stem: "光滑水平面上，质量 m₁ = 2 kg 的滑块位于 x = 0 处以 v₁ = 6 m/s 向右运动，与前方 x = 6 m 处静止的质量 m₂ = 1 kg 的滑块发生完全非弹性正碰（只观察到碰撞后粘连瞬间，不计空气阻力），g = 10 m/s²。求碰后共同速度及碰撞损失的机械能。",
      focus: "对比弹性碰撞与完全非弹性碰撞的能量损失差异。",
      hint: "1. 动量守恒：m₁v₁ = (m₁+m₂)v共，得 v共 = 4 m/s。\n2. 损失机械能 ΔE = ½m₁v₁² - ½(m₁+m₂)v共² = 36 - 24 = 12 J。",
    },
  ],
  default: [
    {
      title: "斜面下滑接弹簧压缩经典组合",
      tags: ["斜面运动", "弹簧弹性势能", "动能定理"],
      difficulty: "中档",
      stem: "质量 m = 1 kg 的滑块从倾角 37°、长 L = 2.5 m、动摩擦因数 μ = 0.25 的斜面顶端由静止下滑，底端无损转向进入光滑水平面，滑行 1.0 m 后压缩劲度系数 k = 200 N/m 的轻质弹簧（滑块与弹簧不连接），g = 10 m/s²。求滑块到达坡底的速度及弹簧最大压缩量。",
      focus: "涵盖斜面加速、无损转向与弹簧简谐压缩三个经典力学阶段。",
      hint: "1. 斜面加速度 a = g(sin37° - μcos37°) = 4 m/s²，坡底速度 v = √(2aL) ≈ 4.47 m/s。\n2. 弹簧最大压缩时动能全部转为弹性势能：½mv² = ½kx²，x ≈ 0.316 m。",
    },
    {
      title: "粗糙水平减速后平抛落地",
      tags: ["动能定理", "平抛运动", "边界速度"],
      difficulty: "基础",
      stem: "质量 m = 1 kg 的物块以初速度 v₀ = 6 m/s 在动摩擦因数 μ = 0.2 的水平桌面上滑行 d = 5 m 后从桌沿水平飞出，桌面高 h = 1.25 m，g = 10 m/s²。求物块飞离桌沿的速度和落地点水平距离。",
      focus: "练习分段运动衔接，观察摩擦因数与初速度对平抛轨迹的影响。",
      hint: "1. 桌面段：v₁ = √(v₀² - 2μgd) = 4 m/s。\n2. 平抛段：t = √(2h/g) = 0.5 s，水平射程 x = v₁t = 2.0 m。",
    },
  ],
};

export function getLocalSimilarProblems(reading: WorkspaceReading | null | undefined): SimilarProblem[] {
  if (!reading) return SIMILAR_BANK.default;
  if (!isStageReading(reading)) return SIMILAR_BANK.incline_slide;

  const kinds = (reading.stages ?? [])
    .map((s) => String(s.kind ?? ""))
    .filter(Boolean);

  const priority = [
    "movable_arc",
    "spring_pair",
    "block_plank",
    "conveyor_belt",
    "pulley_system",
    "collision_1d",
    "vertical_arc",
    "projectile",
    "incline_slide",
  ];
  for (const key of priority) {
    if (kinds.includes(key) && SIMILAR_BANK[key]) {
      return SIMILAR_BANK[key];
    }
  }
  if (kinds.includes("pendulum_swing")) return SIMILAR_BANK.collision_1d;
  return SIMILAR_BANK.default;
}

function normalizeClientSimilarProblems(raw: unknown): SimilarProblem[] {
  if (!Array.isArray(raw)) return [];
  const out: SimilarProblem[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const stem = typeof item.stem === "string" ? item.stem.trim() : "";
    if (!isUsableReply(title) || !isUsableReply(stem)) continue;
    const tags = Array.isArray(item.tags)
      ? item.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim())
      : [];
    const difficulty = typeof item.difficulty === "string" && item.difficulty.trim() ? item.difficulty.trim() : undefined;
    const focus = typeof item.focus === "string" && isUsableReply(item.focus) ? item.focus.trim() : "保留核心力学模型，变换约束或参数深化理解。";
    const hint = typeof item.hint === "string" && isUsableReply(item.hint) ? item.hint.trim() : "按阶段拆分运动，分别列出受力与能量/动量守恒方程。";
    out.push({ title, tags, difficulty, stem, focus, hint });
  }
  return out;
}

function extractStageKinds(reading: WorkspaceReading | null | undefined): string[] {
  if (!reading) return [];
  if (isStageReading(reading)) {
    return (reading.stages ?? [])
      .map((s) => String(s.kind ?? "").trim())
      .filter(Boolean);
  }
  return ["incline_slide", "lossless_turn", "horizontal_slide", "spring_contact"];
}

function normalizeClientRagReferences(raw: unknown): RagReference[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: RagReference[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const source = typeof item.source === "string" ? item.source.trim() : "";
    if (!id || !title) continue;
    const rawDiff = typeof item.difficulty === "string" ? item.difficulty.trim() : "";
    const difficulty: RagReference["difficulty"] =
      rawDiff === "基础" || rawDiff === "中档" || rawDiff === "拔高" ? rawDiff : "中档";
    const tags = Array.isArray(item.tags)
      ? item.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim())
      : [];
    const score = typeof item.score === "number" && Number.isFinite(item.score) ? item.score : 0;
    const matchedReasons = Array.isArray(item.matchedReasons)
      ? item.matchedReasons
          .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
          .map((r) => r.trim())
      : [];
    out.push({ id, title, source, difficulty, tags, score, matchedReasons });
  }
  return out.length > 0 ? out : undefined;
}

function ragHitsToSimilarProblems(hits: RagHit[]): SimilarProblem[] {
  return hits.map(({ entry }) => ({
    title: entry.title,
    tags: [...entry.tags],
    difficulty: entry.difficulty,
    stem: entry.stem,
    focus: entry.pitfalls[0] || entry.source,
    hint: [entry.solutionOutline, ...entry.keyFormulas].filter(Boolean).join("\n"),
  }));
}

/** 离线或服务异常时，根据当前真实 motion 与本地物理知识库动态生成可读摘要，绝不返回 NULL。 */
function buildDynamicFallback(ctx: ChatContext, reason?: string, ragHits: RagHit[] = []): string {
  const m = ctx.motion;
  const topHit = ragHits[0];
  const ragTip = topHit
    ? `\n\n【母题知识库提示 · ${topHit.entry.title}】\n` +
      [
        topHit.entry.keyFormulas.length ? `核心公式：${topHit.entry.keyFormulas.join("；")}` : "",
        topHit.entry.pitfalls.length ? `易错临界：${topHit.entry.pitfalls.join("；")}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  if (!m) {
    const base = reason
      ? `${reason}。当前尚未加载有效动画，请先上传题目或选择内置示例。`
      : "请先上传物理题或选择内置示例，我再结合具体过程为你讲解。";
    return `${base}${ragTip}`;
  }
  const lines = m.events
    .slice(0, 8)
    .map((ev) => `• ${ev.timeSeconds.toFixed(2)} s「${ev.label}」：${ev.caption}`);
  const prefix = reason ? `（实时 AI 助教暂不可用：${reason}；以下为当前物理引擎实算摘要）\n\n` : "";
  return `${prefix}当前动画总时长 ${m.durationSeconds.toFixed(2)} s，关键过程如下：\n${lines.join("\n")}${ragTip}\n\n你可以点时间轴上的任意事件查看该时刻的速度与受力，或直接对我说「把质量改成 2 kg」做对比实验。`;
}

export const chatService: ChatService = {
  async recommendSimilar(ctx: ChatContext, prompt = "请基于当前题目推荐 2~3 道高中力学相似变式题"): Promise<ChatIntent> {
    if (!USE_MOCK_API) {
      try {
        const form = new FormData();
        form.append("chatMessage", prompt);
        form.append("chatMode", "similar");
        form.append("chatContext", JSON.stringify(buildTutorPayload(ctx)));
        const res = await fetch(ENDPOINT, { method: "POST", body: form });
        const data = (await res.json().catch(() => null)) as
          | { status?: string; reply?: string; similarProblems?: unknown; ragReferences?: unknown; message?: string }
          | null;
        if (res.ok && data?.status === "ok") {
          const parsed = normalizeClientSimilarProblems(data.similarProblems);
          const ragReferences = normalizeClientRagReferences(data.ragReferences);
          if (parsed.length > 0) {
            return {
              type: "answer",
              text: isUsableReply(data.reply)
                ? data.reply.trim()
                : `为你精选了 ${parsed.length} 道相似变式题，点击「生成动画试做」可直接加载运行：`,
              similarProblems: parsed,
              ragReferences,
            };
          }
        }
      } catch {
        // 网络或服务不可用时无缝走本地物理知识库与精选相似题库兜底
      }
    } else {
      await new Promise((r) => setTimeout(r, 220));
    }

    const ragHits = searchPhysicsRag({
      text: [ctx.problemText?.trim(), prompt.trim()].filter(Boolean).join("\n"),
      stageKinds: extractStageKinds(ctx.reading),
      mode: "similar",
      topK: 3,
    });
    const ragProblems = ragHitsToSimilarProblems(ragHits);
    const localBank = getLocalSimilarProblems(ctx.reading);
    const merged: SimilarProblem[] = [];
    const seenTitles = new Set<string>();
    for (const item of [...ragProblems, ...localBank]) {
      if (seenTitles.has(item.title)) continue;
      seenTitles.add(item.title);
      merged.push(item);
      if (merged.length >= 3) break;
    }
    const ragReferences = ragHits.length > 0 ? toRagReferences(ragHits) : undefined;
    return {
      type: "answer",
      text: `结合当前题目的物理模型，为你精选了 ${merged.length} 道相似变式题，点击「生成动画试做」可直接加载运行：`,
      similarProblems: merged,
      ragReferences,
    };
  },

  async send(text: string, ctx: ChatContext): Promise<ChatIntent> {
    const t = text.trim();

    if (ctx.mode === "similar" || SIMILAR_REQUEST_RE.test(t)) {
      return chatService.recommendSimilar(ctx, t);
    }

    // 1. 播放控制（本地瞬时响应）
    if (/^(播放|开始播放|继续)$|播放吧|让它动/.test(t)) return { type: "play" };
    if (/^(暂停|停一下|停下来)$|暂停一下/.test(t)) return { type: "pause" };
    if (/^(重播|重新播放|从头再来|再来一次)$|重播一遍/.test(t)) return { type: "replay" };

    // 2. 按当前真实事件跳转（本地瞬时响应）
    if (/跳转|跳到|定位|停在|切到|到.*时刻|看.*时刻/.test(t)) {
      const eventId = matchEventId(t, ctx.motion);
      if (eventId) return { type: "seek_event", event: eventId };
    }

    // 3. 新版 stage_plan 自然语言改参
    if (isStageReading(ctx.reading)) {
      const stageUpdate = tryParseStagePlanUpdate(t, ctx.reading);
      if (stageUpdate) return stageUpdate;
    }

    // 4. 旧单模板数值直接修改
    const hasLegacyConditions = Object.keys(ctx.conditions).length > 0;
    if (hasLegacyConditions && WANTS_CHANGE_RE.test(t) && !QUESTION_SEMANTIC_RE.test(t)) {
      const target = LEGACY_KEYWORDS.find((k) => k.re.test(t));
      const value = findNumber(t);
      if (target && value !== null) {
        const changes: Partial<Record<ConditionKey, number>> = {};
        changes[target.key] = value;
        const unitSuffix = target.unit ? ` ${target.unit}` : "";
        return {
          type: "update_conditions",
          changes,
          text: `已把「${target.label}」改为 ${value}${unitSuffix}。`,
        };
      }
      if (target && value === null) {
        return { type: "clarify", text: `想把「${target.label}」改成多少？给我一个数值，我直接重新计算动画。` };
      }
    }

    const runLocalTutorRag = () =>
      searchPhysicsRag({
        text: [ctx.problemText?.trim(), t].filter(Boolean).join("\n"),
        stageKinds: extractStageKinds(ctx.reading),
        mode: "tutor",
        topK: 3,
      });

    // 5. 真实 AI 物理助教对话（非 Mock 模式，复用同域 ENDPOINT）
    if (!USE_MOCK_API) {
      try {
        const form = new FormData();
        form.append("chatMessage", t);
        form.append("chatContext", JSON.stringify(buildTutorPayload(ctx)));
        const res = await fetch(ENDPOINT, { method: "POST", body: form });
        const data = (await res.json().catch(() => null)) as
          | { status?: string; reply?: string; ragReferences?: unknown; message?: string }
          | null;
        if (res.ok && data?.status === "ok" && isUsableReply(data.reply)) {
          return {
            type: "answer",
            text: data.reply.trim(),
            ragReferences: normalizeClientRagReferences(data.ragReferences),
          };
        }
        const localHits = runLocalTutorRag();
        return {
          type: "answer",
          text: buildDynamicFallback(
            ctx,
            data?.message || (res.ok ? "助教返回了空内容" : `服务返回 ${res.status}`),
            localHits,
          ),
          ragReferences: localHits.length > 0 ? toRagReferences(localHits) : undefined,
        };
      } catch {
        const localHits = runLocalTutorRag();
        return {
          type: "answer",
          text: buildDynamicFallback(ctx, "网络请求失败", localHits),
          ragReferences: localHits.length > 0 ? toRagReferences(localHits) : undefined,
        };
      }
    }

    // 6. 离线 Mock 模式：动态基于当前 motion 摘要与本地物理 RAG 知识库回答
    await new Promise((r) => setTimeout(r, 260));
    const localHits = runLocalTutorRag();
    return {
      type: "answer",
      text: buildDynamicFallback(ctx, undefined, localHits),
      ragReferences: localHits.length > 0 ? toRagReferences(localHits) : undefined,
    };
  },
};

/** 兼容旧导出名 */
export const mockChatService: ChatService = chatService;
