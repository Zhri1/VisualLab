/**
 * VisualLab 领域物理混合检索引擎（Physics Hybrid RAG）
 *
 * 纯 TypeScript、零外部依赖，可在 Node、Qoder Deno 云函数与浏览器离线环境共用。
 * 三通道融合：
 * - 通道 A：物理阶段图谱结构相似度（有序 LCS + 阶段集合重合 + 首阶段加分）
 * - 通道 B：高中物理领域词典（正向最大匹配）+ 中文 2-gram 加权 BM25
 * - 通道 C：场景化重排（vision / tutor / similar 差异权重 + 雷同降权 + MMR 多样性优选）
 */

import { PHYSICS_RAG_CORPUS } from "./corpus.ts";
import type {
  RagHit,
  RagKnowledgeEntry,
  RagMode,
  RagReference,
  RagSearchQuery,
} from "./types.ts";

/** 高中物理核心领域词表（用于正向最大匹配切词与考点识别） */
const PHYSICS_LEXICON: readonly string[] = [
  "完全非弹性碰撞",
  "水平动量守恒",
  "牛顿第二定律",
  "可移动圆弧槽",
  "可动圆弧槽",
  "最大弹性势能",
  "机械能守恒",
  "最大压缩量",
  "倾斜传送带",
  "水平传送带",
  "完全非弹性",
  "一维弹性碰撞",
  "非弹性碰撞",
  "动量守恒",
  "能量守恒",
  "动能定理",
  "摩擦生热",
  "人船模型",
  "弹簧双球",
  "自由弹簧",
  "弹性碰撞",
  "弹性正碰",
  "竖直圆弧",
  "半圆轨道",
  "粗糙斜面",
  "光滑斜面",
  "无损转向",
  "板块模型",
  "定滑轮",
  "阿特伍德",
  "匀强磁场",
  "洛伦兹力",
  "带电粒子",
  "最小初速度",
  "临界条件",
  "速度交换",
  "相对位移",
  "滑动摩擦",
  "弹簧压缩",
  "轻质弹簧",
  "预压弹簧",
  "圆弧轨道",
  "传送带",
  "圆弧槽",
  "长木板",
  "连接体",
  "圆轨道",
  "最高点",
  "最低点",
  "不拴接",
  "静摩擦",
  "动摩擦",
  "摩擦力",
  "向心力",
  "支持力",
  "水平面",
  "轻弹簧",
  "匀加速",
  "匀减速",
  "抛体",
  "斜面",
  "上滑",
  "下滑",
  "折返",
  "往返",
  "共速",
  "划痕",
  "平抛",
  "斜抛",
  "切入",
  "圆弧",
  "轻杆",
  "双轨",
  "内轨",
  "脱轨",
  "临界",
  "弹簧",
  "预压",
  "压缩",
  "回弹",
  "脱离",
  "原长",
  "反冲",
  "粘连",
  "正碰",
  "碰撞",
  "单摆",
  "轻绳",
  "松绳",
  "滑块",
  "滑轮",
  "磁场",
  "偏转",
  "张力",
  "压力",
  "恒力",
  "反求",
  "桌沿",
  "平台",
].sort((a, b) => b.length - a.length);

const MAX_LEXICON_LEN = PHYSICS_LEXICON.reduce((max, w) => Math.max(max, w.length), 1);
const PHYSICS_TERM_SET = new Set<string>(PHYSICS_LEXICON);

const CJK_STOP_CHARS = new Set([
  "的", "了", "在", "与", "和", "为", "是", "有", "从", "到", "求", "问",
  "这", "那", "个", "中", "后", "时", "将", "把", "被", "以", "由", "其",
  "于", "则", "若", "并", "且", "或", "而", "之", "可", "能", "请", "吗",
  "呢", "吧", "啊", "呀", "么", "很", "更", "最", "都", "也", "就", "一",
]);

const ASCII_STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "were",
  "null", "true", "false", "kind", "stage", "stages",
]);

const CJK_SEGMENT_RE = /[\u4e00-\u9fff]+/g;
const ASCII_TOKEN_RE = /[a-z][a-z0-9_]{1,31}/g;

const LEGACY_INCLINE_SPRING_STAGES = [
  "incline_slide",
  "lossless_turn",
  "horizontal_slide",
  "spring_contact",
];

function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (ch) => String(ch.charCodeAt(0) - 0x2080))
    .replace(/\s+/g, " ")
    .trim();
}

interface TokenizedText {
  tokens: string[];
  domainTerms: Set<string>;
}

/** 正向最大匹配（FMM）+ 中文 2-gram + 英文/阶段标识分词 */
export function tokenizePhysicsText(raw: string): TokenizedText {
  const text = normalizeText(raw);
  if (!text) return { tokens: [], domainTerms: new Set() };

  const tokens: string[] = [];
  const domainTerms = new Set<string>();

  // 1. 英文与阶段标识（如 movable_arc, spring_pair, conveyor_belt）
  const asciiMatches = text.match(ASCII_TOKEN_RE) ?? [];
  for (const tok of asciiMatches) {
    if (ASCII_STOP_WORDS.has(tok)) continue;
    tokens.push(tok);
    if (tok.includes("_")) {
      domainTerms.add(tok);
    }
  }

  // 2. 中文段落：领域词典正向最大匹配 + 2-gram 补充
  const cjkSegments = text.match(CJK_SEGMENT_RE) ?? [];
  for (const seg of cjkSegments) {
    // 2a. 正向最大匹配
    let i = 0;
    while (i < seg.length) {
      let matched = "";
      const maxLen = Math.min(MAX_LEXICON_LEN, seg.length - i);
      for (let len = maxLen; len >= 2; len -= 1) {
        const cand = seg.slice(i, i + len);
        if (PHYSICS_TERM_SET.has(cand)) {
          matched = cand;
          break;
        }
      }
      if (matched) {
        tokens.push(matched);
        domainTerms.add(matched);
        // 长复合词内部再提取其包含的短领域词，提升召回（如"可移动圆弧槽"同时召回"圆弧槽"）
        if (matched.length >= 4) {
          for (let subLen = matched.length - 1; subLen >= 2; subLen -= 1) {
            for (let start = 0; start <= matched.length - subLen; start += 1) {
              const sub = matched.slice(start, start + subLen);
              if (PHYSICS_TERM_SET.has(sub)) {
                tokens.push(sub);
                domainTerms.add(sub);
              }
            }
          }
        }
        i += matched.length;
      } else {
        i += 1;
      }
    }

    // 2b. 中文 2-gram 补充（过滤两端均为停用字的弱二元组）
    for (let j = 0; j < seg.length - 1; j += 1) {
      const c1 = seg[j];
      const c2 = seg[j + 1];
      if (CJK_STOP_CHARS.has(c1) && CJK_STOP_CHARS.has(c2)) continue;
      tokens.push(c1 + c2);
    }
  }

  return { tokens, domainTerms };
}

/** 字符 2-gram 集合，用于相似题去重（Jaccard > 0.85 降权） */
function charBigrams(raw: string): Set<string> {
  const cleaned = normalizeText(raw).replace(/[^\u4e00-\u9fffa-z0-9]/g, "");
  const set = new Set<string>();
  if (cleaned.length < 2) {
    if (cleaned.length === 1) set.add(cleaned);
    return set;
  }
  for (let i = 0; i < cleaned.length - 1; i += 1) {
    set.add(cleaned.slice(i, i + 2));
  }
  return set;
}

function jaccardSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) {
    if (large.has(item)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

/* ============================ 通道 A：物理阶段图谱结构相似度 ============================ */

function lcsLength(a: readonly string[], b: readonly string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  const prev = new Array<number>(n + 1).fill(0);
  const curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    for (let j = 0; j <= n; j += 1) {
      prev[j] = curr[j];
      curr[j] = 0;
    }
  }
  return prev[n];
}

function computeStageSimilarity(queryStages: readonly string[], entryStages: readonly string[]): number {
  if (queryStages.length === 0 || entryStages.length === 0) return 0;
  const lcs = lcsLength(queryStages, entryStages);
  const lcsRatio = (2 * lcs) / (queryStages.length + entryStages.length);
  const setOverlap = jaccardSet(new Set(queryStages), new Set(entryStages));
  if (lcs === 0 && setOverlap === 0) return 0;
  const firstBonus = queryStages[0] === entryStages[0] ? 0.1 : 0;
  return Math.min(1, 0.65 * lcsRatio + 0.35 * setOverlap + firstBonus);
}

/* ============================ 通道 B：字段加权 BM25 索引 ============================ */

type FieldName = "title" | "tags" | "stem" | "pitfalls" | "keyFormulas" | "source" | "planHint";

const FIELD_NAMES: readonly FieldName[] = [
  "title",
  "tags",
  "stem",
  "pitfalls",
  "keyFormulas",
  "source",
  "planHint",
];

const MODE_FIELD_WEIGHTS: Record<RagMode, Record<FieldName, number>> = {
  vision: {
    title: 2.8,
    tags: 3.4,
    stem: 2.2,
    pitfalls: 0.7,
    keyFormulas: 0.6,
    source: 1.0,
    planHint: 1.4,
  },
  tutor: {
    title: 3.0,
    tags: 3.2,
    stem: 1.4,
    pitfalls: 1.3,
    keyFormulas: 1.3,
    source: 1.1,
    planHint: 0.8,
  },
  similar: {
    title: 2.8,
    tags: 3.2,
    stem: 1.8,
    pitfalls: 1.0,
    keyFormulas: 1.0,
    source: 1.2,
    planHint: 0.8,
  },
};

interface IndexedEntry {
  entry: RagKnowledgeEntry;
  fieldTf: Record<FieldName, Map<string, number>>;
  fieldLen: Record<FieldName, number>;
  allTerms: Set<string>;
  normalizedTags: string[];
  tagSet: Set<string>;
  stageSet: Set<string>;
  stemBigrams: Set<string>;
}

interface CorpusIndex {
  docs: IndexedEntry[];
  df: Map<string, number>;
  avgFieldLen: Record<FieldName, number>;
}

const INDEX_CACHE = new WeakMap<readonly RagKnowledgeEntry[], CorpusIndex>();

function countTf(tokens: readonly string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const tok of tokens) {
    tf.set(tok, (tf.get(tok) ?? 0) + 1);
  }
  return tf;
}

function buildCorpusIndex(corpus: readonly RagKnowledgeEntry[]): CorpusIndex {
  const cached = INDEX_CACHE.get(corpus);
  if (cached) return cached;

  const df = new Map<string, number>();
  const totalFieldLen: Record<FieldName, number> = {
    title: 0,
    tags: 0,
    stem: 0,
    pitfalls: 0,
    keyFormulas: 0,
    source: 0,
    planHint: 0,
  };

  const docs: IndexedEntry[] = corpus.map((entry) => {
    const rawFields: Record<FieldName, string> = {
      title: entry.title,
      tags: entry.tags.join(" "),
      stem: entry.stem,
      pitfalls: entry.pitfalls.join(" "),
      keyFormulas: entry.keyFormulas.join(" "),
      source: entry.source,
      planHint: entry.planHint,
    };

    const fieldTf = {} as Record<FieldName, Map<string, number>>;
    const fieldLen = {} as Record<FieldName, number>;
    const allTerms = new Set<string>();

    for (const field of FIELD_NAMES) {
      const { tokens } = tokenizePhysicsText(rawFields[field]);
      const tf = countTf(tokens);
      fieldTf[field] = tf;
      fieldLen[field] = tokens.length;
      totalFieldLen[field] += tokens.length;
      for (const term of tf.keys()) {
        allTerms.add(term);
      }
    }

    for (const term of allTerms) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }

    return {
      entry,
      fieldTf,
      fieldLen,
      allTerms,
      normalizedTags: entry.tags.map((t) => normalizeText(t)).filter(Boolean),
      tagSet: new Set(entry.tags.map((t) => normalizeText(t)).filter(Boolean)),
      stageSet: new Set(entry.stageSignature.map((s) => s.trim()).filter(Boolean)),
      stemBigrams: charBigrams(entry.stem),
    };
  });

  const n = Math.max(1, docs.length);
  const avgFieldLen = {} as Record<FieldName, number>;
  for (const field of FIELD_NAMES) {
    avgFieldLen[field] = Math.max(1, totalFieldLen[field] / n);
  }

  const index: CorpusIndex = { docs, df, avgFieldLen };
  INDEX_CACHE.set(corpus, index);
  return index;
}

interface LexicalMatchResult {
  score: number;
  matchedTags: string[];
  matchedDomainTerms: string[];
  matchedAnyField: boolean;
}

const BM25_K1 = 1.2;
const BM25_B = 0.75;

function computeLexicalMatch(
  normalizedQuery: string,
  queryTokens: readonly string[],
  queryDomainTerms: ReadonlySet<string>,
  doc: IndexedEntry,
  index: CorpusIndex,
  mode: RagMode,
): LexicalMatchResult {
  if (!normalizedQuery || queryTokens.length === 0) {
    return { score: 0, matchedTags: [], matchedDomainTerms: [], matchedAnyField: false };
  }

  const n = Math.max(1, index.docs.length);
  const weights = MODE_FIELD_WEIGHTS[mode];

  // 查询词去重并统计查询词权重（领域词优先）
  const uniqueTerms = new Map<string, number>();
  for (const tok of queryTokens) {
    const prev = uniqueTerms.get(tok) ?? 0;
    const boost = PHYSICS_TERM_SET.has(tok) || queryDomainTerms.has(tok) ? 1.8 : 1.0;
    uniqueTerms.set(tok, Math.max(prev, boost));
  }

  let rawBm25 = 0;
  let totalQueryWeight = 0;
  let matchedQueryWeight = 0;
  const matchedDomainTerms: string[] = [];

  for (const [term, termBoost] of uniqueTerms.entries()) {
    const docFreq = index.df.get(term) ?? 0;
    // Lucene/BM25+ 平滑 IDF，小语料库下恒为正，区分度稳定
    const idf = Math.log(1 + (n - docFreq + 0.5) / (docFreq + 0.5));
    const weightedIdf = idf * termBoost;
    totalQueryWeight += weightedIdf;

    if (!doc.allTerms.has(term)) continue;

    let termScore = 0;
    for (const field of FIELD_NAMES) {
      const tf = doc.fieldTf[field].get(term) ?? 0;
      if (tf === 0) continue;
      const dl = doc.fieldLen[field];
      const avgdl = index.avgFieldLen[field];
      const normTf = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl)));
      termScore += weights[field] * normTf;
    }

    if (termScore > 0) {
      rawBm25 += weightedIdf * termScore;
      matchedQueryWeight += weightedIdf;
      if (PHYSICS_TERM_SET.has(term) || queryDomainTerms.has(term)) {
        matchedDomainTerms.push(term);
      }
    }
  }

  // 直接标签子串命中检查（保留原中文标签名，用于可解释性）
  const matchedTags: string[] = [];
  for (let i = 0; i < doc.normalizedTags.length; i += 1) {
    const normTag = doc.normalizedTags[i];
    if (normTag.length >= 2 && normalizedQuery.includes(normTag)) {
      matchedTags.push(doc.entry.tags[i]);
    }
  }

  if (rawBm25 <= 0 && matchedTags.length === 0) {
    return { score: 0, matchedTags: [], matchedDomainTerms: [], matchedAnyField: false };
  }

  const coverage = totalQueryWeight > 0 ? matchedQueryWeight / totalQueryWeight : 0;
  const normConst = Math.max(4.0, totalQueryWeight * 1.5);
  const saturatedBm25 = rawBm25 / (rawBm25 + normConst);
  const tagDirectBonus = Math.min(0.28, matchedTags.length * 0.14);
  const score = Math.min(1, 0.58 * saturatedBm25 + 0.34 * coverage + tagDirectBonus);

  return {
    score,
    matchedTags,
    matchedDomainTerms,
    matchedAnyField: rawBm25 > 0 || matchedTags.length > 0,
  };
}

/* ============================ 通道 C：场景化融合、去重与 MMR 重排 ============================ */

interface ScoredCandidate {
  doc: IndexedEntry;
  score: number;
  stageScore: number;
  lexScore: number;
  matchedReasons: string[];
}

function interEntrySimilarity(a: IndexedEntry, b: IndexedEntry): number {
  const tagSim = jaccardSet(a.tagSet, b.tagSet);
  const stageSim = jaccardSet(a.stageSet, b.stageSet);
  const diffSim = a.entry.difficulty === b.entry.difficulty ? 1 : 0;
  return 0.45 * tagSim + 0.25 * stageSim + 0.30 * diffSim;
}

function selectWithMmr(candidates: ScoredCandidate[], topK: number, lambda = 0.72): ScoredCandidate[] {
  if (candidates.length <= 1 || topK <= 1) return candidates.slice(0, topK);

  const remaining = [...candidates];
  const selected: ScoredCandidate[] = [];

  // 第一名直接取相关性最高者
  selected.push(remaining.shift()!);

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = 0;
    let bestMmr = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const cand = remaining[i];
      let maxSim = 0;
      for (const picked of selected) {
        const sim = interEntrySimilarity(cand.doc, picked.doc);
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = lambda * cand.score - (1 - lambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }
    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
}

function buildMatchedReasons(
  stageScore: number,
  lex: LexicalMatchResult,
): string[] {
  const reasons: string[] = [];
  if (stageScore > 0) {
    reasons.push(`阶段链匹配 ${Math.round(stageScore * 100)}%`);
  }

  const concepts: string[] = [];
  const seen = new Set<string>();
  for (const tag of lex.matchedTags) {
    const key = normalizeText(tag);
    if (!seen.has(key)) {
      seen.add(key);
      concepts.push(tag);
    }
  }
  // 领域词按长度降序优先展示，避免用短词遮蔽复合考点
  const sortedTerms = [...lex.matchedDomainTerms].sort((a, b) => b.length - a.length);
  for (const term of sortedTerms) {
    const key = normalizeText(term);
    if (seen.has(key)) continue;
    // 若已被更长的已选考点包含则跳过
    if (concepts.some((existing) => normalizeText(existing).includes(key))) continue;
    seen.add(key);
    concepts.push(term);
  }

  if (concepts.length > 0) {
    reasons.push(`命中考点：${concepts.slice(0, 4).join("、")}`);
  } else if (lex.score >= 0.15) {
    reasons.push("题干与物理模型相关");
  }

  return reasons;
}

const MIN_SCORE_THRESHOLD = 0.12;
const NEAR_DUPLICATE_JACCARD = 0.85;
const NEAR_DUPLICATE_PENALTY = 0.35;

/**
 * 物理混合检索主入口。
 *
 * - 支持传入自定义 `corpus` 便于单元测试或扩展题库；默认使用内置 `PHYSICS_RAG_CORPUS`。
 * - 返回按相关度（similar 模式经 MMR 多样性重排）排序的命中列表，score ∈ (0, 1]（保留 3 位小数）。
 */
export function searchPhysicsRag(
  query: RagSearchQuery,
  corpus: readonly RagKnowledgeEntry[] = PHYSICS_RAG_CORPUS,
): RagHit[] {
  const topK = query.topK === undefined ? 3 : Math.max(0, Math.floor(query.topK));
  if (topK === 0 || corpus.length === 0) return [];

  const mode: RagMode = query.mode ?? "tutor";
  const rawText = typeof query.text === "string" ? query.text.trim() : "";
  const normalizedQuery = normalizeText(rawText);
  const { tokens: queryTokens, domainTerms: queryDomainTerms } = tokenizePhysicsText(rawText);
  const queryBigrams = mode === "similar" && rawText ? charBigrams(rawText) : null;

  const queryStages = Array.isArray(query.stageKinds)
    ? query.stageKinds.map((s) => String(s ?? "").trim()).filter(Boolean)
    : [];

  const hasText = queryTokens.length > 0;
  const hasStages = queryStages.length > 0;
  if (!hasText && !hasStages) return [];

  const index = buildCorpusIndex(corpus);
  const candidates: ScoredCandidate[] = [];

  for (const doc of index.docs) {
    const stageScore = hasStages ? computeStageSimilarity(queryStages, doc.entry.stageSignature) : 0;
    const lex = hasText
      ? computeLexicalMatch(normalizedQuery, queryTokens, queryDomainTerms, doc, index, mode)
      : { score: 0, matchedTags: [], matchedDomainTerms: [], matchedAnyField: false };

    let combined = 0;
    if (mode === "vision") {
      combined = hasStages && hasText
        ? 0.25 * stageScore + 0.75 * lex.score
        : hasText
          ? lex.score
          : stageScore;
    } else if (mode === "similar") {
      combined = hasStages && hasText
        ? 0.55 * stageScore + 0.45 * lex.score
        : hasStages
          ? stageScore
          : lex.score;
      if (queryBigrams && queryBigrams.size >= 8) {
        const stemJaccard = jaccardSet(queryBigrams, doc.stemBigrams);
        if (stemJaccard > NEAR_DUPLICATE_JACCARD) {
          combined *= NEAR_DUPLICATE_PENALTY;
        }
      }
    } else {
      // tutor 模式：阶段链 0.50 + 词法 0.50
      combined = hasStages && hasText
        ? 0.50 * stageScore + 0.50 * lex.score
        : hasStages
          ? stageScore
          : lex.score;
    }

    if (combined < MIN_SCORE_THRESHOLD) continue;

    const clampedScore = Math.round(Math.min(1, Math.max(0.001, combined)) * 1000) / 1000;
    const matchedReasons = buildMatchedReasons(stageScore, lex);
    candidates.push({
      doc,
      score: clampedScore,
      stageScore,
      lexScore: lex.score,
      matchedReasons,
    });
  }

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => b.score - a.score || a.doc.entry.id.localeCompare(b.doc.entry.id));

  const picked =
    mode === "similar"
      ? selectWithMmr(candidates.slice(0, Math.max(topK * 3, 8)), topK)
      : candidates.slice(0, topK);

  return picked.map((item) => ({
    entry: item.doc.entry,
    score: item.score,
    matchedReasons: item.matchedReasons,
  }));
}

/* ============================ Prompt 格式化与引用转换 ============================ */

/**
 * 识图模式 RAG 提示：输出 Top-2 母题标题与 `planHint` 拆段骨架（严格 ≤ 600 字）。
 */
export function formatRagForVision(hits: RagHit[]): string {
  if (!hits.length) return "";
  const header = "【母题拆段参考（仅作 stage_plan 结构对齐，数值必须严格以当前题图/文字为准）】";
  const lines = hits.slice(0, 2).map((hit, idx) => {
    const stages = hit.entry.stageSignature.join(" -> ");
    return `${idx + 1}. ${hit.entry.title}（${stages}）\n   拆段骨架：${hit.entry.planHint}`;
  });
  const full = `${header}\n${lines.join("\n")}`;
  if (full.length <= 600) return full;
  return `${full.slice(0, 597)}...`;
}

/**
 * 助教模式 RAG 提示：输出 Top-3 母题标题、二级结论、高频易错点与解题思路。
 */
export function formatRagForTutor(hits: RagHit[]): string {
  if (!hits.length) return "";
  const blocks = hits.slice(0, 3).map((hit, idx) => {
    const { entry, matchedReasons } = hit;
    const parts = [
      `${idx + 1}. ${entry.title}（${entry.source} · ${entry.difficulty}）`,
      matchedReasons.length > 0 ? `   匹配依据：${matchedReasons.join("；")}` : "",
      entry.keyFormulas.length > 0 ? `   核心规律/二级结论：${entry.keyFormulas.join("；")}` : "",
      entry.pitfalls.length > 0 ? `   高频易错与临界判据：${entry.pitfalls.join("；")}` : "",
      entry.solutionOutline ? `   标准解题思路：${entry.solutionOutline}` : "",
    ].filter(Boolean);
    return parts.join("\n");
  });
  return [
    "【参考高考物理母题知识库（请结合当前物理引擎实算数据融合讲解，切勿覆盖当前题目的真实数值）】",
    ...blocks,
  ].join("\n");
}

/**
 * 相似变式题模式 RAG 提示：输出 Top-3 高考经典母题题干与考点作改编参考。
 */
export function formatRagForSimilar(hits: RagHit[]): string {
  if (!hits.length) return "";
  const blocks = hits.slice(0, 3).map((hit, idx) => {
    const { entry } = hit;
    const parts = [
      `${idx + 1}. ${entry.title}（${entry.source} · ${entry.difficulty}）`,
      `   阶段链：${entry.stageSignature.join(" -> ")} | 考点：${entry.tags.join("、")}`,
      `   母题题干参考：${entry.stem}`,
      entry.keyFormulas.length > 0 ? `   核心方程：${entry.keyFormulas.join("；")}` : "",
    ].filter(Boolean);
    return parts.join("\n");
  });
  return [
    "【参考高考经典母题库（可借鉴其物理模型、参数尺度与设问方式进行合规变式改编，避免逐字照抄）】",
    ...blocks,
  ].join("\n");
}

/** 转为前端展示与接口回包的轻量可观测引用数组 */
export function toRagReferences(hits: RagHit[]): RagReference[] {
  return hits.map(({ entry, score, matchedReasons }) => ({
    id: entry.id,
    title: entry.title,
    source: entry.source,
    difficulty: entry.difficulty,
    tags: [...entry.tags],
    score,
    matchedReasons: [...matchedReasons],
  }));
}

/** 从 chatContext 中提取有序阶段 kind 列表（同时兼容 stage_plan 与旧 incline_spring 模板） */
export function extractStageKindsFromContext(context?: Record<string, unknown> | null): string[] {
  if (!context || typeof context !== "object") return [];
  const reading = context.reading;
  if (!reading || typeof reading !== "object" || Array.isArray(reading)) return [];
  const rec = reading as Record<string, unknown>;
  if (Array.isArray(rec.stages)) {
    return rec.stages
      .map((s) => (s && typeof s === "object" && typeof (s as { kind?: unknown }).kind === "string"
        ? (s as { kind: string }).kind.trim()
        : ""))
      .filter(Boolean);
  }
  if (rec.templateId === "incline_spring") {
    return [...LEGACY_INCLINE_SPRING_STAGES];
  }
  return [];
}

/** 从 chatMessage 与 chatContext 构建统一 RAG 检索参数（Node 与 Qoder 云函数同源复用） */
export function buildChatRagQuery(
  chatMessage: string,
  context: Record<string, unknown> | null | undefined,
  mode: "tutor" | "similar",
): RagSearchQuery {
  const stageKinds = extractStageKindsFromContext(context);
  const problemText =
    context && typeof context.problemText === "string" ? context.problemText.trim() : "";
  const textParts = [problemText, chatMessage.trim()].filter(Boolean);
  return {
    text: textParts.join("\n"),
    stageKinds,
    mode,
    topK: 3,
  };
}
