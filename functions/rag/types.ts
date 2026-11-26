// 由 scripts/sync-functions.mjs 从 src/rag/types.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
/**
 * VisualLab 领域物理混合检索（Physics Hybrid RAG）共享类型契约。
 * 同时供本地 Node 服务、Qoder Deno 云函数（经 sync-functions 同步）与前端离线检索复用。
 */

export type RagDifficulty = "基础" | "中档" | "拔高";

export type RagMode = "vision" | "tutor" | "similar";

export interface RagKnowledgeEntry {
  /** 唯一标识，如 "gk-incline-spring-01" */
  id: string;
  /** 母题/专题标题 */
  title: string;
  /** 来源或题型归属，如 "高考经典母题 · 动量与圆弧槽综合" */
  source: string;
  /** 难度分层 */
  difficulty: RagDifficulty;
  /** 有序物理阶段签名（与 stage_plan stages[].kind 对齐，用于阶段图谱匹配） */
  stageSignature: string[];
  /** 核心考点与检索关键词 */
  tags: string[];
  /** 参数齐全、空间几何自洽的标准题干（可直接生成 VisualLab 动画） */
  stem: string;
  /** 核心规律与二级结论公式（纯文本直观符号） */
  keyFormulas: string[];
  /** 高频易错点与临界判据 */
  pitfalls: string[];
  /** 标准分步解题思路 */
  solutionOutline: string;
  /** 最小 stage_plan 拆段提示（供识图模式 Few-shot 对齐） */
  planHint: string;
}

export interface RagSearchQuery {
  /** 查询文本（题面、学生提问或考点描述） */
  text?: string | null;
  /** 当前题目的有序阶段 kind 列表 */
  stageKinds?: string[];
  /** 检索场景 */
  mode: RagMode;
  /** 返回条数，默认 3 */
  topK?: number;
}

export interface RagReference {
  id: string;
  title: string;
  source: string;
  difficulty: RagDifficulty;
  tags: string[];
  score: number;
  matchedReasons: string[];
}

export interface RagHit {
  entry: RagKnowledgeEntry;
  score: number;
  matchedReasons: string[];
}
