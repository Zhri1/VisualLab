import type { StageMotion, StagePlanFailure } from "../physics";
import type { ResolvedStagePlan, StageKind } from "../physics/stagePlan";
import type {
  FieldError,
  Motion,
  MotionEvent,
  MotionSegment,
  SceneGeometry,
  SegmentKind,
  Vec2,
} from "../types";

const segmentText: Record<StageKind, Pick<MotionSegment, "name" | "summary" | "formula">> = {
  vertical_arc: {
    name: "竖直圆弧", summary: "光滑内轨上机械能守恒；法向力降为零时沿切线飞出，速度先降为零时沿轨回滑。",
    formula: "v² = u² − 2gR(1 − cosφ)，N = m(v²/R + gcosφ)",
  },
  incline_slide: {
    name: "斜面下滑",
    summary: "滑块沿斜面运动，重力沿坡分力与滑动摩擦共同决定加速度。",
    formula: "a = g(sinθ − μcosθ)",
  },
  lossless_turn: {
    name: "无损转向",
    summary: "位置和速率保持不变，速度方向转为水平。",
    formula: "|vₐ| = |vᵦ|",
  },
  horizontal_slide: {
    name: "水平滑动",
    summary: "滑块沿水平支撑面运动；若存在动摩擦，速度随时间线性减小。",
    formula: "v = v₀ − μgt",
  },
  spring_contact: {
    name: "压缩与反弹",
    summary: "弹簧压缩到最大后恢复原长，滑块在不连接前提下反向脱离。",
    formula: "x = (v/ω)·sin(ωt)，ω = √(k/m)",
  },
  projectile: {
    name: "抛体运动",
    summary: "离开发射点后只受重力，水平速度保持，竖直方向做匀变速运动。",
    formula: "x = vₓt，y = vᵧt − gt²/2",
  },
};

function segmentKind(kind: StageKind): SegmentKind {
  if (kind === "incline_slide") return "incline";
  if (kind === "horizontal_slide") return "horizontal";
  if (kind === "spring_contact") return "spring";
  if (kind === "projectile") return "projectile";
  if (kind === "vertical_arc") return "vertical_arc";
  return "horizontal";
}

function vec(x: number, y: number): Vec2 {
  return { x, y };
}

/** StageGeometry 之外再保留旧几何视图，供原有测试和非画布消费者继续使用。 */
function legacyGeometry(source: StageMotion): SceneGeometry {
  const g = source.geometry;
  const first = source.sampleAt(0);
  const last = source.sampleAt(source.durationSeconds);
  const inclineStart = g.incline?.start ?? { xM: first.xM, yM: first.yM };
  const inclineEnd = g.incline?.end ?? { xM: first.xM, yM: first.yM };
  const horizontalEnd = g.horizontal?.plannedEnd ?? g.spring?.contact ?? { xM: last.xM, yM: last.yM };
  return {
    inclineTop: vec(inclineStart.xM, inclineStart.yM),
    inclineBottom: vec(inclineEnd.xM, inclineEnd.yM),
    horizontalEnd: vec(horizontalEnd.xM, horizontalEnd.yM),
    springContactX: g.spring?.contact.xM ?? horizontalEnd.xM,
    springAnchorX: g.spring?.anchor.xM ?? horizontalEnd.xM + 1,
    blockSizeM: g.blockSizeM,
  };
}

export function adaptStageMotion(source: StageMotion, plan?: ResolvedStagePlan): Motion {
  const segmentByStage = new Map(source.segments.map((segment) => [segment.stageIndex, segment]));
  const events: MotionEvent[] = source.events.map((event) => {
    const owner = segmentByStage.get(event.stageIndex);
    const fallback: StageKind = event.kind === "projectile" || event.kind === "leave_table" || event.kind === "apex" || event.kind === "land"
      ? "projectile"
      : event.kind === "lossless_turn"
        ? "lossless_turn"
        : event.kind.includes("spring") || event.kind === "max_compression"
          ? "spring_contact"
          : "incline_slide";
    return {
      id: event.id,
      eventKind: event.kind,
      stageIndex: event.stageIndex,
      order: event.order,
      timeSeconds: event.timeSeconds,
      label: event.label,
      caption: event.explanation,
      detail: event.explanation,
      segment: segmentKind(owner?.kind ?? fallback),
      velocityBefore: vec(event.velocityBefore.vxMps, event.velocityBefore.vyMps),
      velocityAfter: vec(event.velocityAfter.vxMps, event.velocityAfter.vyMps),
    };
  });

  return {
    geometry: legacyGeometry(source),
    stageGeometry: source.geometry,
    stagePlan: plan,
    durationSeconds: source.durationSeconds,
    segments: source.segments.map((segment) => ({
      kind: segmentKind(segment.kind),
      stageKind: segment.kind,
      stageIndex: segment.stageIndex,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      ...segmentText[segment.kind],
    })),
    events,
    endReason: source.endReason,
    termination: source.termination,
    sampleAt(timeSeconds) {
      const sample = source.sampleAt(Number.isNaN(timeSeconds) ? 0 : timeSeconds);
      return {
        position: vec(sample.xM, sample.yM),
        velocity: vec(sample.vxMps, sample.vyMps),
        springCompressionM: sample.springCompressionM,
      };
    },
  };
}

export function stageFailureErrors(failure: StagePlanFailure): FieldError[] {
  const missing = failure.missingKeys.map((path) => ({ code: "MISSING", path, message: failure.message }));
  const invalid = failure.fieldErrors.map((error) => ({ code: error.code, path: error.path, message: error.message }));
  if (missing.length + invalid.length > 0) return [...missing, ...invalid];
  return [{ code: failure.code, message: failure.message }];
}
