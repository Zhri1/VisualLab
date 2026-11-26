/**
 * VisualLab 领域物理混合检索（Physics Hybrid RAG）统一导出入口。
 */

export type {
  RagDifficulty,
  RagHit,
  RagKnowledgeEntry,
  RagMode,
  RagReference,
  RagSearchQuery,
} from "./types.ts";

export { PHYSICS_RAG_CORPUS } from "./corpus.ts";

export {
  buildChatRagQuery,
  extractStageKindsFromContext,
  formatRagForSimilar,
  formatRagForTutor,
  formatRagForVision,
  searchPhysicsRag,
  tokenizePhysicsText,
  toRagReferences,
} from "./retriever.ts";
