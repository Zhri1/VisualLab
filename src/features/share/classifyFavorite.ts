/**
 * 错题本纯本地自动分类与难度估计器：
 * - 以真实结构化 reading 的模板与运动阶段为主，复用内置样例元数据；
 * - 全程本地计算，不请求 AI；
 * - 单纯接缝转向（lossless_turn）不单独计入有效阶段或增加难度；
 * - 信息不足时返回空标签（显示「未分类」）与「未定级」；
 * - 自动难度仅为可解释的本地估计，不等同于官方评级。
 */
import { SAMPLES } from "../../data/samples";

export const FAVORITE_CATEGORIES = [
  "斜面与滑动",
  "抛体",
  "弹簧",
  "圆周与摆",
  "碰撞与动量",
  "传送带与连接体",
  "电磁场",
] as const;

export type FavoriteCategory = (typeof FAVORITE_CATEGORIES)[number];

export const FAVORITE_DIFFICULTIES = ["基础", "中档", "拔高", "未定级"] as const;

export type FavoriteDifficulty = (typeof FAVORITE_DIFFICULTIES)[number];

export interface AutoClassification {
  categories: FavoriteCategory[];
  difficulty: FavoriteDifficulty;
  /** 难度来源：built_in（复用样例评级）、estimated（本地规则估计）或 none（信息不足）。 */
  difficultyOrigin: "built_in" | "estimated" | "none";
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

const STAGE_TO_CATEGORIES: Record<string, FavoriteCategory[]> = {
  incline_slide: ["斜面与滑动"],
  horizontal_slide: ["斜面与滑动"],
  constant_force_1d: ["斜面与滑动"],
  projectile: ["抛体"],
  spring_contact: ["弹簧"],
  spring_release: ["弹簧"],
  spring_pair: ["弹簧", "碰撞与动量"],
  vertical_arc: ["圆周与摆"],
  pendulum_swing: ["圆周与摆"],
  movable_arc: ["圆周与摆", "碰撞与动量"],
  movable_semicircle: ["圆周与摆", "碰撞与动量"],
  collision_1d: ["碰撞与动量"],
  horizontal_approach: ["碰撞与动量"],
  block_plank: ["碰撞与动量", "传送带与连接体"],
  conveyor_belt: ["传送带与连接体"],
  pulley_system: ["传送带与连接体"],
  magnetic_deflection: ["电磁场"],
  emf_rail: ["电磁场"],
  switchable_em_collision: ["碰撞与动量", "电磁场"],
  magnetic_reencounter: ["碰撞与动量", "电磁场"],
};

const MULTI_BODY_KINDS = new Set([
  "parallel_motion",
  "block_plank",
  "pulley_system",
  "horizontal_approach",
  "switchable_em_collision",
  "magnetic_reencounter",
  "movable_arc",
  "movable_semicircle",
  "spring_pair",
]);

const COLLISION_KINDS = new Set([
  "collision_1d",
  "switchable_em_collision",
  "magnetic_reencounter",
]);

const EM_KINDS = new Set([
  "magnetic_deflection",
  "emf_rail",
  "switchable_em_collision",
  "magnetic_reencounter",
]);

function orderedCategories(set: Set<FavoriteCategory>): FavoriteCategory[] {
  return FAVORITE_CATEGORIES.filter((cat) => set.has(cat));
}

function mapSampleDifficulty(diff: "基础" | "中档" | "压轴"): FavoriteDifficulty {
  if (diff === "压轴") return "拔高";
  return diff;
}

/** 递归提取所有有效运动阶段（跳过单纯接缝 lossless_turn 与外层容器 parallel_motion）。 */
function collectEffectiveStages(stages: unknown[]): Obj[] {
  const out: Obj[] = [];
  for (const item of stages) {
    if (!isObj(item) || typeof item.kind !== "string") continue;
    if (item.kind === "lossless_turn") continue;
    if (item.kind === "parallel_motion" && Array.isArray(item.tracks)) {
      for (const track of item.tracks) {
        if (isObj(track) && Array.isArray(track.stages)) {
          out.push(...collectEffectiveStages(track.stages));
        }
      }
      continue;
    }
    out.push(item);
  }
  return out;
}

function hasConstraintOrInverse(reading: Obj, effectiveStages: Obj[]): boolean {
  if (Array.isArray(reading.constraints) && reading.constraints.length > 0) return true;
  if (isObj(reading.energy)) return true;
  if (reading.scaleMode === "normalized") return true;
  for (const st of effectiveStages) {
    if (st.kind === "switchable_em_collision" || st.kind === "magnetic_reencounter") return true;
    if (isObj(st.bounce) && typeof st.bounce.apexHeightM === "number") return true;
    if (isObj(st.peg) && st.peg.criticalTopNonSlack === true) return true;
    if (st.kind === "spring_release" && (st.springConstantNpm == null || st.initialCompressionM == null)) return true;
  }
  return false;
}

/** 从内置样例 tags 兜底映射分类（仅在缺少 reading 时使用）。 */
function categoriesFromSampleTags(tags: string[]): FavoriteCategory[] {
  const set = new Set<FavoriteCategory>();
  for (const t of tags) {
    if (/斜面|水平|摩擦|滑动/.test(t)) set.add("斜面与滑动");
    if (/抛/.test(t)) set.add("抛体");
    if (/弹簧/.test(t)) set.add("弹簧");
    if (/圆弧|圆轨|整圆|摆/.test(t)) set.add("圆周与摆");
    if (/碰|动量|木板/.test(t)) set.add("碰撞与动量");
    if (/传送带|滑轮|连接体|木板/.test(t)) set.add("传送带与连接体");
    if (/磁|电/.test(t)) set.add("电磁场");
  }
  return orderedCategories(set);
}

/** 对收藏条目执行纯本地自动分类与难度估计。 */
export function classifyFavorite(input: { sampleId?: string; reading?: unknown }): AutoClassification {
  const matchedSample = input.sampleId ? SAMPLES.find((s) => s.id === input.sampleId) : undefined;
  const reading = input.reading ?? matchedSample?.reading;

  if (isObj(reading)) {
    // 1. 阶段组合计划 stage_plan
    if (reading.kind === "stage_plan" && Array.isArray(reading.stages)) {
      const effective = collectEffectiveStages(reading.stages);
      const catSet = new Set<FavoriteCategory>();
      let hasMultiBody = Array.isArray(reading.bodies) && reading.bodies.length > 1;
      let hasCollision = false;
      let hasEM = false;

      for (const rawStage of reading.stages) {
        if (isObj(rawStage) && typeof rawStage.kind === "string" && MULTI_BODY_KINDS.has(rawStage.kind)) {
          hasMultiBody = true;
        }
      }
      for (const st of effective) {
        const kind = String(st.kind);
        const mapped = STAGE_TO_CATEGORIES[kind];
        if (mapped) mapped.forEach((c) => catSet.add(c));
        if (MULTI_BODY_KINDS.has(kind)) hasMultiBody = true;
        if (COLLISION_KINDS.has(kind)) hasCollision = true;
        if (EM_KINDS.has(kind)) hasEM = true;
      }

      const categories = orderedCategories(catSet);
      if (categories.length === 0) {
        return {
          categories: matchedSample ? categoriesFromSampleTags(matchedSample.tags) : [],
          difficulty: matchedSample ? mapSampleDifficulty(matchedSample.difficulty) : "未定级",
          difficultyOrigin: matchedSample ? "built_in" : "none",
        };
      }

      if (matchedSample) {
        return {
          categories,
          difficulty: mapSampleDifficulty(matchedSample.difficulty),
          difficultyOrigin: "built_in",
        };
      }

      const hasInverse = hasConstraintOrInverse(reading, effective);
      const count = effective.length;
      let difficulty: FavoriteDifficulty;
      if (
        count >= 3 ||
        (hasCollision && (hasMultiBody || hasEM)) ||
        (hasMultiBody && hasInverse) ||
        categories.length >= 3
      ) {
        difficulty = "拔高";
      } else if (
        count === 2 ||
        hasMultiBody ||
        hasCollision ||
        hasInverse ||
        hasEM ||
        categories.length === 2
      ) {
        difficulty = "中档";
      } else {
        difficulty = "基础";
      }
      return { categories, difficulty, difficultyOrigin: "estimated" };
    }

    // 2. 首版整题模板 incline_spring
    if (reading.templateId === "incline_spring") {
      return {
        categories: ["斜面与滑动", "弹簧"],
        difficulty: matchedSample ? mapSampleDifficulty(matchedSample.difficulty) : "中档",
        difficultyOrigin: matchedSample ? "built_in" : "estimated",
      };
    }
  }

  // 3. 仅有内置 sampleId（如旧收藏缺少 reading）
  if (matchedSample) {
    return {
      categories: categoriesFromSampleTags(matchedSample.tags),
      difficulty: mapSampleDifficulty(matchedSample.difficulty),
      difficultyOrigin: "built_in",
    };
  }

  return { categories: [], difficulty: "未定级", difficultyOrigin: "none" };
}
