import { assembleScene as assemblePhysicsScene, buildMotion as buildPhysicsMotion, validateReading } from "../physics";
import type { Motion as PhysicsMotion, PhysicsFailure, StageScene } from "../physics";
import { isStageReading, type FieldError, type Motion, type MotionEvent, type Reading, type Scene, type SceneGeometry, type WorkspaceReading } from "../types";
import type { AdaptedScene, AssembleResult, BuildMotionResult, MotionLibrary } from "./contract";
import { adaptStageMotion, stageFailureErrors } from "./stageMotionAdapter";

// 场景为本地对象，装配时保留一次求解结果，供下一步构建播放器数据。
const physicsMotion = Symbol("physicsMotion");
type LegacyAdaptedScene = Scene & { [physicsMotion]: PhysicsMotion };
const isStageScene = (scene: AdaptedScene): scene is StageScene =>
  "kind" in scene && scene.kind === "stage_scene";

const segmentText = {
  incline: {
    name: "斜面滑动",
    summary: "滑块沿斜面加速下滑，受重力沿坡分力与滑动摩擦力共同作用。",
    formula: "a = g(sinθ − μcosθ)",
  },
  horizontal: {
    name: "水平匀速",
    summary: "转向后水平面光滑，滑块保持速率匀速前进，直到接触弹簧。",
    formula: "v = 常数 = √(2aL)",
  },
  spring: {
    name: "压缩与反弹",
    summary: "弹簧弹力随压缩量线性增大，四分之一周期达到最大压缩，随后反弹脱离。",
    formula: "x = (v/ω)·sin(ωt)，ω = √(k/m)",
  },
};

const eventMapping = {
  release: { id: "release", segment: "incline" },
  turn: { id: "reach_bottom", segment: "horizontal" },
  spring_contact: { id: "contact_spring", segment: "spring" },
  max_compression: { id: "max_compression", segment: "spring" },
  spring_detach: { id: "detach_spring", segment: "spring" },
} as const;

function fieldErrors(failure: PhysicsFailure, reading: Reading): FieldError[] {
  const fields = failure.fields.length ? failure.fields : [undefined];
  return fields.map((field) => {
    let code: FieldError["code"];
    switch (failure.code) {
      case "NEEDS_INPUT": code = "MISSING"; break;
      case "INCONSISTENT_CONDITIONS": code = "PRECONDITION_CONFLICT"; break;
      case "UNSUPPORTED":
        code = field === "templateId" ? "UNSUPPORTED_TEMPLATE" : "PRECONDITION_CONFLICT";
        break;
      default: {
        const value = reading.conditions?.[field as keyof Reading["conditions"]];
        code = typeof value === "number" && !Number.isFinite(value) ? "NOT_FINITE" : "RANGE";
      }
    }
    return { code, field, message: failure.message };
  });
}

function mapGeometry(motion: PhysicsMotion): SceneGeometry {
  const { incline, horizontal, spring } = motion.geometry;
  return {
    inclineTop: { x: incline.start.xM, y: incline.start.yM },
    inclineBottom: { x: incline.end.xM, y: incline.end.yM },
    horizontalEnd: { x: horizontal.end.xM, y: horizontal.end.yM },
    springContactX: spring.contact.xM,
    springAnchorX: spring.anchor.xM,
    blockSizeM: 0.3,
  };
}

export function assembleScene(reading: WorkspaceReading): AssembleResult {
  if (isStageReading(reading)) {
    const assembled = assemblePhysicsScene(reading);
    if (!assembled.ok) return { ok: false, errors: stageFailureErrors(assembled) };
    return { ok: true, scene: assembled.scene };
  }

  const assembled = assemblePhysicsScene(reading);
  if (!assembled.ok) return { ok: false, errors: fieldErrors(assembled, reading) };
  const built = buildPhysicsMotion(assembled.scene);
  if (!built.ok) return { ok: false, errors: fieldErrors(built, reading) };
  const validation = validateReading(reading);
  if (!validation.ok) return { ok: false, errors: fieldErrors(validation, reading) };
  const scene: LegacyAdaptedScene = {
    geometry: mapGeometry(built.motion),
    params: validation.reading.conditions,
    [physicsMotion]: built.motion,
  };
  return { ok: true, scene };
}

export function buildMotion(scene: AdaptedScene): BuildMotionResult {
  if (isStageScene(scene)) {
    const built = buildPhysicsMotion(scene);
    return { ok: true, motion: adaptStageMotion(built.motion, scene.reading) };
  }

  // 兼容调用方按共享 Scene 类型构造的对象，仍由纯计算层校验与求解。
  if (!(physicsMotion in scene)) {
    const assembled = assembleScene({
      templateId: "incline_spring",
      conditions: scene.params,
      facts: { slidesAfterRelease: true, losslessTurn: true, horizontalIsFrictionless: true, springIsUnattached: true },
    });
    if (!assembled.ok) return { ok: false, code: assembled.errors[0].code, message: assembled.errors.map((error) => error.message).join("；") };
    return buildMotion(assembled.scene);
  }
  const source = (scene as LegacyAdaptedScene)[physicsMotion];
  const events: MotionEvent[] = source.events.map((event) => ({
    ...eventMapping[event.id],
    timeSeconds: event.timeSeconds,
    label: event.label,
    caption: event.explanation,
    detail: event.explanation,
    ...(event.id === "turn" ? {
      velocityBefore: { x: event.beforeVelocity.vxMps, y: event.beforeVelocity.vyMps },
      velocityAfter: { x: event.afterVelocity.vxMps, y: event.afterVelocity.vyMps },
    } : {}),
  }));
  const motion: Motion = {
    geometry: mapGeometry(source),
    durationSeconds: source.durationSeconds,
    segments: source.segments.map((segment) => ({
      kind: segment.id,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      ...segmentText[segment.id],
    })),
    events,
    sampleAt(timeSeconds) {
      const sample = source.sampleAt(Number.isNaN(timeSeconds) ? 0 : timeSeconds);
      return {
        position: { x: sample.xM, y: sample.yM },
        velocity: { x: sample.vxMps, y: sample.vyMps },
        springCompressionM: sample.springCompressionM,
      };
    },
  };
  return { ok: true, motion };
}

export const physicsMotionLibrary: MotionLibrary = { assembleScene, buildMotion };
