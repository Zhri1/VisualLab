/**
 * 与 PROJECT_PLAN_FINAL.md 第 4 节、CONTRACTS.md 对齐的共享类型。
 * 字段名一律沿用契约原文，不在这里做重命名。
 */

import type { EndReason, StageGeometry, ArcConstraint } from "../physics/stageMotion";
export type { StageGeometry };
import type { ResolvedStagePlan, StageKind, StagePlanDraft } from "../physics/stagePlan";
import type { BodyState, StringState, MotionStatus } from '../physics/multiBodyTypes';
import type { RagReference } from "../rag/types";
export type { RagReference };

export type TemplateId = "incline_spring";

/** 题设条件。缺项用 null 表示，保留给用户补齐。 */
export interface Conditions {
  gravityMps2: number | null;
  inclineAngleDeg: number | null;
  inclineLengthM: number | null;
  kineticFrictionCoefficient: number | null;
  initialSpeedMps: number | null;
  blockMassKg: number | null;
  springGapM: number | null;
  springConstantNpm: number | null;
}

export type FactKey =
  | "slidesAfterRelease"
  | "losslessTurn"
  | "horizontalIsFrictionless"
  | "springIsUnattached";

export type Facts = Record<FactKey, boolean | null>;

/** AI 识别服务与前端共用的一份数据。 */
export interface Reading {
  templateId: TemplateId | string;
  conditions: Conditions;
  facts: Facts;
}

/** 工作台同时保留旧模板与新阶段计划；类型守卫后才读取各自字段。 */
export type WorkspaceReading = Reading | StagePlanDraft;
export function isStageReading(reading: WorkspaceReading | null | undefined): reading is StagePlanDraft {
  return reading != null && "kind" in reading && reading.kind === "stage_plan";
}

export type ConditionKey = keyof Conditions;

/** 单个条件的展示元数据，核对表按此顺序渲染。 */
export interface ConditionMeta {
  key: ConditionKey;
  label: string;
  unit: string;
  /** 精度，用于输入框和展示 */
  step?: number;
  /** 简要说明，出现在核对表第二行 */
  hint?: string;
}

export const CONDITION_META: ConditionMeta[] = [
  { key: "gravityMps2", label: "重力加速度 g", unit: "m/s²", step: 0.1, hint: "取 10 便于口算" },
  { key: "inclineAngleDeg", label: "斜面倾角 θ", unit: "°", step: 1, hint: "0° < θ < 90°" },
  { key: "inclineLengthM", label: "斜面长度 L", unit: "m", step: 0.1 },
  { key: "kineticFrictionCoefficient", label: "动摩擦因数 μ", unit: "", step: 0.05, hint: "可为 0" },
  { key: "initialSpeedMps", label: "初速度 v₀", unit: "m/s", step: 0.1, hint: "首版为静止释放" },
  { key: "blockMassKg", label: "滑块质量 m", unit: "kg", step: 0.1 },
  { key: "springGapM", label: "坡底到弹簧距离", unit: "m", step: 0.1, hint: "弹簧原长接触端" },
  { key: "springConstantNpm", label: "弹簧劲度系数 k", unit: "N/m", step: 10 },
];

export const FACT_META: { key: FactKey; label: string }[] = [
  { key: "slidesAfterRelease", label: "释放后下滑" },
  { key: "losslessTurn", label: "转向无损（保留速率）" },
  { key: "horizontalIsFrictionless", label: "水平面光滑" },
  { key: "springIsUnattached", label: "滑块与弹簧不连接" },
];

/* ---------------- 场景与运动 ---------------- */

export interface Vec2 {
  x: number;
  y: number;
}

/** 米制几何，原点在斜面底端，x 向右、y 向上。 */
export interface SceneGeometry {
  inclineTop: Vec2;
  inclineBottom: Vec2;
  horizontalEnd: Vec2;
  /** 弹簧原长时的接触端 */
  springContactX: number;
  /** 弹簧固定端 */
  springAnchorX: number;
  blockSizeM: number;
}

export interface Scene {
  geometry: SceneGeometry;
  /** 已完成校验、非空的数值条件 */
  params: ResolvedConditions;
}

/** 校验通过的数值集合（避免直接散落 null 判断） */
export interface ResolvedConditions {
  gravityMps2: number;
  inclineAngleDeg: number;
  inclineLengthM: number;
  kineticFrictionCoefficient: number;
  initialSpeedMps: number;
  blockMassKg: number;
  springGapM: number;
  springConstantNpm: number;
}

export type SegmentKind = "incline" | "horizontal" | "spring" | "projectile" | "vertical_arc" | 'pendulum' | 'movable_arc' | 'spring_pair';
export type BodyMotionSample = Omit<BodyState,'xM'|'yM'|'vxMps'|'vyMps'> & {position:Vec2;velocity:Vec2};

export interface MotionSegment {
  bodyIds?:string[]; stagePath?:string;
  kind: SegmentKind;
  /** 新阶段计划中的原始零基下标；旧模板缺省。 */
  stageIndex?: number;
  stageKind?: StageKind;
  startSeconds: number;
  endSeconds: number;
  name: string;
  summary: string;
  formula: string;
}

export type EventId =
  | "release"
  | "reach_bottom"
  | "contact_spring"
  | "max_compression"
  | "detach_spring";

export interface MotionEvent {
  collision?:import('../physics').CollisionValues;
  bodyIds?:string[]; stagePath?:string;
  bodyStatesBefore?:Record<string,BodyMotionSample>; bodyStatesAfter?:Record<string,BodyMotionSample>;
  constraintsBefore?:Record<string,StringState>; constraintsAfter?:Record<string,StringState>;
  id: EventId | string;
  /** 新计划保留原事件 kind 与执行顺序，避免同刻事件靠数组猜测。 */
  eventKind?: string;
  conveyorExitEdge?: import("../physics/conveyorBelt").ConveyorEdge;
  stageIndex?: number;
  order?: number;
  timeSeconds: number;
  label: string;
  /** 与画面同步的一句原理说明 */
  caption: string;
  segment: SegmentKind;
  velocityBefore?: Vec2;
  velocityAfter?: Vec2;
  position?: Vec2;
  normalForceBeforeN?: number;
  normalForceAfterN?: number;
  /** 供 AI 联动使用的补充数值 */
  detail?: string;
}

export interface MotionSample {
  bodies?:Record<string,BodyMotionSample>; constraints?:Record<string,StringState>;
  /** 由 stageGeometry.positionReference 指定；旧场景为滑块前下沿。 */
  position: Vec2;
  velocity: Vec2;
  springCompressionM: number;
  constraint?: ArcConstraint;
}

export interface Motion {
  primaryBodyId?:string; motionStatus?:MotionStatus;
  timing?: import("../physics").StageMotion["timing"];
  calculations?: import("../physics").StageMotion["calculations"];
  /** 旧模板几何继续保留；新计划另带完整 StageGeometry 供专用画布使用。 */
  geometry: SceneGeometry;
  stageGeometry?: StageGeometry;
  /** 当前有效原计划；提前停止时仍能识别 plannedEnd 是题设桌沿。 */
  stagePlan?: ResolvedStagePlan;
  durationSeconds: number;
  segments: MotionSegment[];
  events: MotionEvent[];
  endReason?: EndReason;
  termination?: { reason: EndReason; eventId: string; stageIndex: number };
  sampleAt(timeSeconds: number): MotionSample;
  /** 与 sampleAt 同钟的能量读数；缺条件为 null，无此能力的运动省略。 */
  energyAt?(timeSeconds: number): import("../physics").EnergyReading | null;
  /** 与 sampleAt 同钟的传送带读数（带速、相对带面位移等）。 */
  conveyorAt?(timeSeconds: number): import("../physics").ConveyorReading | null;
  movableArcAt?(timeSeconds: number): { grooveXM: number; grooveVX: number } | null;
  springPairAt?(timeSeconds: number): { x2M: number; vx2Mps: number; compressionM: number } | null;
}

/* ---------------- 错误 ---------------- */

export interface FieldError {
  code: string;
  /** 旧模板使用裸字段名；阶段计划使用 reading 根部的 JSON Pointer。 */
  field?: string;
  path?: string;
  message: string;
}

/* ---------------- 识别接口 ---------------- */

export type PlanResponse =
  | {
      status: "ok";
      reading: WorkspaceReading;
      message?: string;
      assumptions?: string[];
      /** 内置示例的完整题面；识别接口不回传该字段。 */
      problemText?: string;
      /** 内置示例的原题图片地址；识别接口不回传该字段。 */
      imageUrl?: string;
      /** 命中的内置示例 id，用于题内对照切换。 */
      sampleId?: string;
    }
  | {
      status: "needs_input";
      reading: WorkspaceReading | null;
      missingKeys: string[];
      fieldErrors?: FieldError[];
      message: string;
      /**
       * 与 ok 同形状的假设条目（0–3 条）。
       * 可选：兼容尚未透传该字段的旧服务，缺省时前端按「无假设」处理。
       */
      assumptions?: string[];
    }
  | { status: "unsupported"; message: string }
  | { status: "error"; message: string; httpStatus?: number };

/* ---------------- 对话 ---------------- */

export type ChatRole = "user" | "assistant" | "system";

export type ChatMode = "tutor" | "similar" | "socratic";
export type TutorStyle = "tutor" | "socratic";

export interface SimilarProblem {
  id?: string;
  title: string;
  tags: string[];
  difficulty?: string;
  stem: string;
  focus: string;
  hint: string;
}

export interface ConditionChange {
  key: ConditionKey | string;
  /** 阶段计划参数修改时的展示名与单位 */
  label?: string;
  unit?: string;
  /** 阶段计划中的参数路径，如 /massKg 或 /stages/0/radiusM */
  path?: string;
  from: number | null;
  to: number | null;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** 纯文本；assistant 支持极简 Markdown 子集 */
  text: string;
  pending?: boolean;
  error?: boolean;
  /** 参数修改卡片 */
  change?: {
    changes: ConditionChange[];
    applied: boolean;
    revisionId: string;
    /** 阶段计划改参前的完整 reading，用于一键撤销 */
    previousReading?: WorkspaceReading;
  };
  /** AI 回复内嵌的跳转入口 */
  action?: { type: "seek"; eventId: string; label: string };
  /** AI 这次计算采用的假设条目，来自识别回包 */
  assumptions?: string[];
  /** 相似变式题推荐列表 */
  similarProblems?: SimilarProblem[];
  /** 领域物理 RAG 命中的参考母题条目 */
  ragReferences?: RagReference[];
}

export type ChatIntent =
  | {
      type: "answer";
      text: string;
      action?: ChatMessage["action"];
      similarProblems?: SimilarProblem[];
      ragReferences?: RagReference[];
    }
  | { type: "update_conditions"; changes: Partial<Record<ConditionKey, number>>; text: string }
  | { type: "update_stage_plan"; nextReading: StagePlanDraft; changes: ConditionChange[]; text: string }
  | { type: "seek_event"; event: EventId | string; text?: string }
  | { type: "play" }
  | { type: "pause" }
  | { type: "replay" }
  | { type: "clarify"; text: string };
