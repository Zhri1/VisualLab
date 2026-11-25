/**
 * 对话服务适配层：
 * - 播放/暂停/重播、按当前真实事件跳转、旧模板数值修改走本地瞬时响应；
 * - 所有物理原理讲解、受力分析、数值推导、假设探讨走真实 AI 助教接口（复用同域 PLAN_ENDPOINT）；
 * - 离线/Mock 环境下依据当前真实 motion 数据动态兜底，不再硬背斜面弹簧旧台词。
 */
import { ENDPOINT, USE_MOCK_API } from "./imageRecognition";
import type { ChatIntent, ConditionKey, Motion, WorkspaceReading } from "../types";

export interface ChatContext {
  motion: Motion | null;
  reading?: WorkspaceReading | null;
  problemText?: string | null;
  currentTime?: number;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  conditions: Record<string, number | null>;
}

export interface ChatService {
  send(text: string, ctx: ChatContext): Promise<ChatIntent>;
}

const KEYWORDS: { key: ConditionKey; re: RegExp }[] = [
  { key: "springConstantNpm", re: /劲度|弹簧系数|刚度|\bk\b|k\s*值/i },
  { key: "springGapM", re: /弹簧.{0,4}距离|间距|坡底.{0,6}弹簧|gap/i },
  { key: "inclineAngleDeg", re: /倾角|角度|theta|θ/i },
  { key: "inclineLengthM", re: /斜面长|坡长|长度/i },
  { key: "kineticFrictionCoefficient", re: /摩擦|mu|μ/i },
  { key: "blockMassKg", re: /质量|mass|多重/i },
  { key: "gravityMps2", re: /重力加速度|g\s*=|取\s*g/i },
];

function findNumber(text: string): number | null {
  const m = text.match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
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
    { match: /最大压缩|压缩最短/, kinds: ["max_compression"], labelRe: /最大压缩|压缩最短/ },
    { match: /接触弹簧/, kinds: ["spring_contact", "contact_spring"], labelRe: /接触弹簧/ },
    { match: /脱离|恢复原长/, kinds: ["spring_detach", "detach_spring", "spring_release_end"], labelRe: /脱离|恢复原长/ },
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

/** 构造发给 AI 助教的精简真实物理上下文，防止模型编造数值。 */
function buildTutorPayload(ctx: ChatContext): Record<string, unknown> {
  const m = ctx.motion;
  const currentTime = ctx.currentTime ?? 0;
  const sample = m ? m.sampleAt(currentTime) : null;
  const energy = m?.energyAt?.(currentTime) ?? null;

  return {
    problemText: ctx.problemText ?? null,
    currentTimeSeconds: Number(currentTime.toFixed(4)),
    durationSeconds: m ? Number(m.durationSeconds.toFixed(4)) : null,
    endReason: m?.endReason ?? null,
    reading: ctx.reading ?? null,
    derivedCalculations: m?.calculations ?? [],
    currentSnapshot: sample
      ? {
          positionM: { x: Number(sample.position.x.toFixed(4)), y: Number(sample.position.y.toFixed(4)) },
          velocityMps: {
            vx: Number(sample.velocity.x.toFixed(4)),
            vy: Number(sample.velocity.y.toFixed(4)),
            speed: Number(Math.hypot(sample.velocity.x, sample.velocity.y).toFixed(4)),
          },
          constraint: sample.constraint ?? null,
          bodies: sample.bodies ?? null,
          constraints: sample.constraints ?? null,
        }
      : null,
    currentEnergyJ: energy,
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
}

/** 离线或服务异常时，根据当前真实 motion 动态生成可读摘要，不再复读旧斜面弹簧台词。 */
function buildDynamicFallback(ctx: ChatContext, reason?: string): string {
  const m = ctx.motion;
  if (!m) {
    return reason
      ? `${reason}。当前尚未加载有效动画，请先上传题目或选择内置示例。`
      : "请先上传物理题或选择内置示例，我再结合具体过程为你讲解。";
  }
  const lines = m.events
    .slice(0, 8)
    .map((ev) => `• ${ev.timeSeconds.toFixed(2)} s「${ev.label}」：${ev.caption}`);
  const prefix = reason ? `（实时 AI 助教暂不可用：${reason}；以下为当前物理引擎实算摘要）\n\n` : "";
  return `${prefix}当前动画总时长 ${m.durationSeconds.toFixed(2)} s，关键过程如下：\n${lines.join("\n")}\n\n你可以点时间轴上的任意事件查看该时刻的速度与受力，或在右上角「查看原题」里修改参数观察变化。`;
}

export const chatService: ChatService = {
  async send(text: string, ctx: ChatContext): Promise<ChatIntent> {
    const t = text.trim();

    // 1. 播放控制（本地瞬时响应）
    if (/^(播放|开始播放|继续)$|播放吧|让它动/.test(t)) return { type: "play" };
    if (/^(暂停|停一下|停下来)$|暂停一下/.test(t)) return { type: "pause" };
    if (/^(重播|重新播放|从头再来|再来一次)$|重播一遍/.test(t)) return { type: "replay" };

    // 2. 按当前真实事件跳转（本地瞬时响应）
    if (/跳转|跳到|定位|停在|切到|到.*时刻|看.*时刻/.test(t)) {
      const eventId = matchEventId(t, ctx.motion);
      if (eventId) return { type: "seek_event", event: eventId };
    }

    // 3. 旧单模板数值直接修改（仅当存在对应旧模板 conditions 字段时拦截；stage_plan 的提问交给真 AI 助教）
    const hasLegacyConditions = Object.keys(ctx.conditions).length > 0;
    const wantsChange = /改成|改为|设为|调到|调成|换成|变成/.test(t);
    if (hasLegacyConditions && wantsChange) {
      const target = KEYWORDS.find((k) => k.re.test(t));
      const value = findNumber(t);
      if (target && value !== null) {
        const changes: Partial<Record<ConditionKey, number>> = {};
        changes[target.key] = value;
        return {
          type: "update_conditions",
          changes,
          text: `已把「${target.key}」改为 ${value}。`,
        };
      }
      if (target && value === null) {
        return { type: "clarify", text: "想改成多少？给我一个数值，我直接重新计算动画。" };
      }
    }

    // 4. 真实 AI 物理助教对话（非 Mock 模式，复用同域 PLAN_ENDPOINT）
    if (!USE_MOCK_API) {
      try {
        const form = new FormData();
        form.append("chatMessage", t);
        form.append("chatContext", JSON.stringify(buildTutorPayload(ctx)));
        const res = await fetch(ENDPOINT, { method: "POST", body: form });
        const data = (await res.json().catch(() => null)) as
          | { status?: string; reply?: string; message?: string }
          | null;
        if (res.ok && data?.status === "ok" && typeof data.reply === "string" && data.reply.trim()) {
          return { type: "answer", text: data.reply.trim() };
        }
        return {
          type: "answer",
          text: buildDynamicFallback(ctx, data?.message || `服务返回 ${res.status}`),
        };
      } catch {
        return {
          type: "answer",
          text: buildDynamicFallback(ctx, "网络请求失败"),
        };
      }
    }

    // 5. 离线 Mock 模式：动态基于当前 motion 摘要回答，不再复读固定斜面弹簧话术
    await new Promise((r) => setTimeout(r, 260));
    return { type: "answer", text: buildDynamicFallback(ctx) };
  },
};

/** 兼容旧导出名 */
export const mockChatService: ChatService = chatService;
