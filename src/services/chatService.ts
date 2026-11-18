/**
 * 对话服务适配层。
 *
 * 真实对话服务尚未在方案中定义，这里只给出接口形状与 Mock 实现。
 * 将来接入时实现同一签名即可，UI 不需要改动。
 */
import type { ChatIntent, ConditionKey, Motion } from "../types";

export interface ChatContext {
  motion: Motion | null;
  conditions: Record<string, number | null>;
}

export interface ChatService {
  send(text: string, ctx: ChatContext): Promise<ChatIntent>;
}

/* ------------------------------------------------------------------ */
/* Mock                                                                 */
/* ------------------------------------------------------------------ */

const KEYWORDS: { key: ConditionKey; re: RegExp }[] = [
  { key: "springConstantNpm", re: /劲度|弹簧系数|刚度|\bk\b|k\s*值/i },
  { key: "springGapM", re: /弹簧.{0,4}距离|间距|坡底.{0,6}弹簧|gap/i },
  { key: "inclineAngleDeg", re: /倾角|角度|theta|θ/i },
  { key: "inclineLengthM", re: /斜面长|坡长|长度/i },
  { key: "kineticFrictionCoefficient", re: /摩擦|mu|μ/i },
  { key: "blockMassKg", re: /质量|mass|多重/i },
  { key: "gravityMps2", re: /重力加速度|g\s*=|取\s*g/i },
];

const EVENT_WORDS: { id: string; re: RegExp }[] = [
  { id: "max_compression", re: /最大压缩|压缩最短|压缩最大|最短/ },
  { id: "contact_spring", re: /接触弹簧/ },
  { id: "reach_bottom", re: /坡底|到达底端|转向/ },
  { id: "detach_spring", re: /脱离|离开弹簧|恢复原长/ },
  { id: "release", re: /释放|起点|开始/ },
];

function findNumber(text: string): number | null {
  const m = text.match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

export const mockChatService: ChatService = {
  async send(text: string, ctx: ChatContext): Promise<ChatIntent> {
    // 上下文暂未参与规则匹配；真实服务接入后会用它判断「当前条件是哪一个」
    void ctx;
    await new Promise((r) => setTimeout(r, 520 + Math.random() * 260));
    const t = text.trim();

    // 1. 播放控制
    if (/^(播放|开始播放|继续)$|播放吧|让它动/.test(t)) return { type: "play" };
    if (/^(暂停|停一下|停下来)$|暂停一下/.test(t)) return { type: "pause" };
    if (/^(重播|重新播放|从头再来|再来一次)$|重播一遍/.test(t)) return { type: "replay" };

    // 2. 跳转
    const wantsSeek = /跳转|跳到|定位|停在|切到|到.*时刻/.test(t);
    if (wantsSeek) {
      const hit = EVENT_WORDS.find((e) => e.re.test(t));
      if (hit) return { type: "seek_event", event: hit.id };
    }

    // 3. 参数修改
    const wantsChange = /改成|改为|设为|调到|调成|换成|变成/.test(t);
    if (wantsChange) {
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
      return {
        type: "clarify",
        text: "目前可以改的条件有：倾角、斜面长度、动摩擦因数、质量、坡底到弹簧的距离、劲度系数。你想改哪一个？",
      };
    }

    // 4. 原理问答（预设，不做通用推理）
    if (/为什么|原理|解释|怎么|为何|原因/.test(t)) {
      if (/速度.{0,6}零|为零|最大压缩/.test(t)) {
        return {
          type: "answer",
          text:
            "弹簧压缩到最大时，滑块速度恰好为零——这一刻全部动能转化成了弹性势能。\n\n" +
            "压缩过程中弹力 F = kx 始终与运动方向相反，滑块持续减速；压缩量 x 越大，弹力越大，减速也越快。" +
            "当速度降到零，滑块还会继续被压缩吗？不会：此时弹力达到最大而速度为零，滑块立刻开始反弹。",
          action: { type: "seek", eventId: "max_compression", label: "查看最大压缩时刻" },
        };
      }
      if (/转向|坡底|方向/.test(t)) {
        return {
          type: "answer",
          text:
            "坡底用一段长度、高度都可忽略的光滑圆弧过渡。因为圆弧光滑且不做功，速率保持不变，只有速度方向由沿坡转为水平。\n\n" +
            "所以在动画里它被表示成一个瞬时事件：转向前后速度大小相同、方向相差 θ。",
          action: { type: "seek", eventId: "reach_bottom", label: "查看转向时刻" },
        };
      }
      if (/脱离|反弹|恢复原长/.test(t)) {
        return {
          type: "answer",
          text:
            "滑块与弹簧不连接，弹簧压缩到最短后会把它推回去。经过半个周期，弹簧恢复原长，滑块恰好脱离。\n\n" +
            "因为过程无能量损失，脱离时的速率与接触时相同，方向相反。",
          action: { type: "seek", eventId: "detach_spring", label: "查看脱离时刻" },
        };
      }
      return {
        type: "answer",
        text:
          "这段运动分三步：斜面上受重力沿坡分力与摩擦力，做匀加速；转向后水平面光滑，做匀速；接触弹簧后受线性增大的弹力，速度降到零再反向。\n\n" +
          "想知道某一步的具体数值，可以在时间轴上点对应事件，或者问我「到达坡底时速度多少」。",
      };
    }

    // 5. 数值询问
    if (/多少|多大|数值|时间|速度/.test(t) && /速度|时间|压缩|弹力/.test(t)) {
      return {
        type: "answer",
        text:
          "时间轴上每个事件都标了精确时刻，点击即可跳到那一刻。\n\n" +
          "关键数值：到达坡底约 1.99 s，接触弹簧约 2.24 s，最大压缩约 2.31 s，脱离约 2.39 s。",
        action: { type: "seek", eventId: "contact_spring", label: "跳到接触弹簧" },
      };
    }

    // 6. 兜底
    return {
      type: "answer",
      text:
        "我可以帮你三件事：解释这段运动的原理、按数值修改题目条件（比如「把劲度系数改成 100 N/m」）、或者把动画跳到某个关键时刻。",
    };
  },
};
