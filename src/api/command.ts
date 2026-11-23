/**
 * 修改指令解析（C · AI 接口）
 *
 * 契约：STAGE_COMPOSITION.md 第 1 节与 4.3 节。
 * - `command` 与 `text` 分流：`text` 承载题面，`command` 承载修改意图。
 * - 只做规则匹配，不调用模型，保证同样输入永远得到同样结果。
 * - 解析结果通过 `intent` 返回给 A，A 用 `throughStageIndex` 截断前缀后重新装配。
 */

export interface StageIntent {
  type: 'truncate_stages';
  /** 保留 [0..throughStageIndex] 闭区间，零基 */
  throughStageIndex: number;
}

export interface PlanStageLike {
  kind: string;
}

export type CommandResult =
  | { status: 'ok'; intent: StageIntent }
  | { status: 'needs_input'; message: string; missingKeys: string[] }
  | { status: 'unsupported'; message: string };

/** 关键词 → 阶段 kind。顺序即优先级，越具体的越靠前。 */
const KEYWORDS: Array<{ kind: string; words: string[] }> = [
  { kind:'horizontal_approach',words:['接近','碰前','碰撞前','正碰前','接触前'] },
  { kind:'vertical_arc',words:['圆轨','竖直圆弧','圆弧'] },
  { kind:'collision_1d',words:['碰撞','正碰','粘连'] },
  { kind:'pendulum_swing',words:['摆动','摆锤','单摆','轻绳','最低点'] },
  { kind: 'projectile', words: ['平抛', '抛体', '抛出', '飞出', '落地', '离桌'] },
  { kind: 'spring_contact', words: ['弹簧', '压缩', '反弹'] },
  { kind: 'lossless_turn', words: ['转向', '转弯', '圆弧', '拐弯'] },
  { kind: 'horizontal_slide', words: ['水平', '桌面', '水平面', '滑动'] },
  { kind: 'incline_slide', words: ['斜面', '下滑', '坡底', '斜坡'] },
];

/** 截断类指令的触发词，命中任意一个才按修改意图处理 */
const TRUNCATE_MARKERS = ['只看', '只算', '只播', '只显示', '截断', '截到', '为止', '停到', '到坡底', '到桌沿'];

const CN_NUMBERS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

function normalize(text: string): string {
  return text.replace(/\s+/g, '').replace(/[，。！？、；：""''（）()]/g, '');
}

/** 「前两段」「前 3 段」→ 段数 */
function readPrefixCount(text: string): number | null {
  const match = /前([一二两三四五六1-6])段/.exec(text);
  if (!match) return null;
  const raw = match[1] ?? '';
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber >= 1) return asNumber;
  const asChinese = CN_NUMBERS[raw];
  return asChinese ?? null;
}

function findStageIndex(stages: PlanStageLike[], kind: string): number {
  return stages.findIndex((stage) => stage.kind === kind);
}

/**
 * 解析一条修改指令。
 *
 * 成功返回 `intent`；指令能识别但缺少必要信息返回 `needs_input`；
 * 指令本身不在支持范围、或当前计划没有对应阶段返回 `unsupported`。
 */
export function parseCommand(command: string, plan: { stages: PlanStageLike[] }): CommandResult {
  const text = normalize(command);
  if (!text) {
    return {
      status: 'needs_input',
      message: '请输入要保留到哪一段，例如「只看斜面」',
      missingKeys: ['/intent/throughStageIndex'],
    };
  }

  const hasTruncateMarker = TRUNCATE_MARKERS.some((marker) => text.includes(marker));

  // 「前 N 段」最明确，优先处理
  const prefixCount = readPrefixCount(text);
  if (prefixCount !== null) {
    if (prefixCount > plan.stages.length) {
      return {
        status: 'unsupported',
        message: `当前计划只有 ${plan.stages.length} 段，无法保留前 ${prefixCount} 段`,
      };
    }
    return { status: 'ok', intent: { type: 'truncate_stages', throughStageIndex: prefixCount - 1 } };
  }

  if (!hasTruncateMarker) {
    return {
      status: 'unsupported',
      message: '目前只支持「只看某一段」这类截断指令',
    };
  }

  for (const { kind, words } of KEYWORDS) {
    if ((kind === 'horizontal_approach'||kind==='vertical_arc') && findStageIndex(plan.stages, kind) < 0) continue;
    if (!words.some((word) => text.includes(word))) continue;
    const index = findStageIndex(plan.stages, kind);
    if (index < 0) {
      return {
        status: 'unsupported',
        message: `当前计划里没有「${words[0]}」对应的阶段`,
      };
    }
    return { status: 'ok', intent: { type: 'truncate_stages', throughStageIndex: index } };
  }

  return {
    status: 'needs_input',
    message: '没听出要保留到哪一段，可以说「只看斜面」「只看到桌面」',
    missingKeys: ['/intent/throughStageIndex'],
  };
}
