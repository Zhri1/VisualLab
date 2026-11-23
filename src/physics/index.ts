export { validateReading } from "./reading.ts";
export type { PhysicsFailure, Reading } from "./reading.ts";
import { assembleScene as assembleLegacyScene } from "./scene.ts";
import { buildMotion as buildLegacyMotion } from "./motion.ts";
import type { Scene } from "./scene.ts";
import type { Reading } from "./reading.ts";
import type { ResolvedStagePlan, StagePlanDraft } from "./stagePlan.ts";
import { assembleStageScene, buildStageMotion } from "./stageMotion.ts";
import type { StageScene } from "./stageMotion.ts";
export type { Scene } from "./scene.ts";
export type { Motion, MotionEvent, MotionSample } from "./motion.ts";
export { validateStagePlan } from "./stagePlan.ts";
export type { Energy, PlaybackScope } from "./stagePlan.ts";
export type { Stage, StageKind, StagePlanDraft, ResolvedStagePlan, StagePlanValidation, StagePlanFailure, StageFieldError } from "./stagePlan.ts";
export type { StageScene, StageMotion, StageGeometry, StageEvent, EndReason, EnergyReading } from "./stageMotion.ts";
export type { StageSample, ArcConstraint, VerticalArcGeometry } from "./stageMotion.ts";
export type { ExplicitArcPath } from './circularArc.ts';
export { assembleStageScene, buildStageMotion } from "./stageMotion.ts";
export { collide1D } from './collision.ts';
export { truncateStagePlan } from './truncateStagePlan.ts';
export { createPendulum } from './pendulum.ts';
export type { BodyState, BodySnapshot, BodyDefinition, StringState, MotionStatus, BodyGeometry } from './multiBodyTypes.ts';
export type { HorizontalInitial, InitialBody, HorizontalApproach, HorizontalCollision, CollisionValues } from './horizontalTypes.ts';

export function assembleScene(input: StagePlanDraft | ResolvedStagePlan): ReturnType<typeof assembleStageScene>;
export function assembleScene(input: Omit<Reading, "templateId"> & { templateId: string }): ReturnType<typeof assembleLegacyScene>;
export function assembleScene(input: unknown): ReturnType<typeof assembleLegacyScene> | ReturnType<typeof assembleStageScene>;
export function assembleScene(input: unknown) {
  const isPlan = input !== null && typeof input === "object" && "kind" in input && input.kind === "stage_plan";
  return isPlan ? assembleStageScene(input) : assembleLegacyScene(input);
}
export function buildMotion(scene: StageScene): ReturnType<typeof buildStageMotion>;
export function buildMotion(scene: Scene): ReturnType<typeof buildLegacyMotion>;
export function buildMotion(scene: Scene | StageScene): ReturnType<typeof buildLegacyMotion> | ReturnType<typeof buildStageMotion>;
export function buildMotion(scene: Scene | StageScene) {
  return "kind" in scene && scene.kind === "stage_scene" ? buildStageMotion(scene) : buildLegacyMotion(scene as Scene);
}
