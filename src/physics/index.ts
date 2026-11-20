import { validateReading as validateInclineReading } from "./reading.ts";
import type { Reading as InclineReading } from "./reading.ts";
import { assembleScene as assembleInclineScene } from "./scene.ts";
import type { Scene as InclineScene } from "./scene.ts";
import { buildMotion as buildInclineMotion } from "./motion.ts";
import { isBatchTemplate, validateBatchReading } from "./batchReading.ts";
import type { BatchReading } from "./batchReading.ts";
import { assembleBatchScene, buildBatchMotion } from "./batchMotion.ts";
import type { BatchScene } from "./batchMotion.ts";

export type Reading = InclineReading | BatchReading;
export type Scene = InclineScene | BatchScene;
export type { PhysicsFailure, Reading as InclineSpringReading } from "./reading.ts";
export type { Scene as InclineSpringScene } from "./scene.ts";
// 首题旧 Motion 类型继续可用；新增模板的结果通过函数重载推断。
export type { Motion, MotionEvent, MotionSample } from "./motion.ts";
export type { BatchReading, HorizontalSpringReading, InclineToStopReading, TableEdgeProjectileReading, ProjectileReading } from "./batchReading.ts";
export type { BatchScene, BatchGeometry, BatchMotion, BatchEvent } from "./batchMotion.ts";

type LegacyInput = Omit<InclineReading, "templateId"> & { templateId: string };
function templateOf(input: unknown): unknown {
  return input !== null && typeof input === "object" ? (input as { templateId?: unknown }).templateId : undefined;
}

export function validateReading(input: BatchReading): ReturnType<typeof validateBatchReading>;
export function validateReading(input: LegacyInput): ReturnType<typeof validateInclineReading>;
export function validateReading(input: unknown): ReturnType<typeof validateInclineReading> | ReturnType<typeof validateBatchReading>;
export function validateReading(input: unknown) {
  return isBatchTemplate(templateOf(input)) ? validateBatchReading(input) : validateInclineReading(input);
}

export function assembleScene(input: BatchReading): ReturnType<typeof assembleBatchScene>;
export function assembleScene(input: LegacyInput): ReturnType<typeof assembleInclineScene>;
export function assembleScene(input: unknown): ReturnType<typeof assembleInclineScene> | ReturnType<typeof assembleBatchScene>;
export function assembleScene(input: unknown) {
  return isBatchTemplate(templateOf(input)) ? assembleBatchScene(input) : assembleInclineScene(input);
}

export function buildMotion(scene: InclineScene): ReturnType<typeof buildInclineMotion>;
export function buildMotion(scene: BatchScene): ReturnType<typeof buildBatchMotion>;
export function buildMotion(scene: Scene): ReturnType<typeof buildInclineMotion> | ReturnType<typeof buildBatchMotion>;
export function buildMotion(scene: Scene) {
  return isNewScene(scene) ? buildBatchMotion(scene) : buildInclineMotion(scene);
}

function isNewScene(scene: Scene): scene is BatchScene {
  return isBatchTemplate(scene.templateId);
}
