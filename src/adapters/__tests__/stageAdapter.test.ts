import { describe, expect, it } from "vitest";
import composition from "../../../fixtures/stage-composition.reading.json";
import missingDistance from "../../../fixtures/stage-missing-distance.reading.json";
import type { StagePlanDraft } from "../../physics/stagePlan";
import type { Motion } from "../../types";
import { motionLibrary } from "../index";

const plan = composition as StagePlanDraft;

function build(reading: StagePlanDraft): Motion {
  const assembled = motionLibrary.assembleScene(reading);
  if (!assembled.ok) throw new Error(assembled.errors.map((error) => error.message).join("；"));
  const built = motionLibrary.buildMotion(assembled.scene);
  if (!built.ok) throw new Error(built.message);
  return built.motion;
}

function atDistance(distanceM: number): StagePlanDraft {
  return {
    ...plan,
    stages: plan.stages.map((stage, index) => index === 2
      ? { ...stage, end: { kind: "distance", distanceM } }
      : stage),
  };
}

describe("stage_plan → 统一播放器", () => {
  it("完整组合保留阶段下标、同刻转向与落地末帧", () => {
    const motion = build(plan);
    expect(motion.segments.map((segment) => segment.stageIndex)).toEqual([0, 2, 3]);
    expect(motion.segments.map((segment) => segment.kind)).toEqual(["incline", "horizontal", "projectile"]);
    expect(motion.stageGeometry?.horizontal?.plannedEnd?.xM).toBe(5);
    expect(motion.sampleAt(1.2 - 1e-7).velocity.x).toBeCloseTo(3 * Math.sqrt(3), 6);
    expect(motion.sampleAt(1.2 - 1e-7).velocity.y).toBeCloseTo(-3, 6);
    expect(motion.sampleAt(1.2).velocity.x).toBeCloseTo(6, 12);
    expect(motion.sampleAt(1.2).velocity.y).toBe(0);
    expect(motion.sampleAt(1.2 + 1e-7).velocity.x).toBeCloseTo(6 - 2e-7, 8);
    const end = motion.sampleAt(motion.durationSeconds);
    expect(motion.durationSeconds).toBeCloseTo(2.7, 10);
    expect(end.position).toEqual({ x: 7, y: -1.25 });
    expect(end.velocity.x).toBeCloseTo(4, 12);
    expect(end.velocity.y).toBeCloseTo(-5, 12);
    expect(motion.endReason).toBe("landed");
    expect(motion.events.map((event) => event.order)).toEqual(motion.events.map((_, index) => index));
  });

  it("提前停住：桌沿保持 10 m、真实停止点为 9 m，且无飞行输出", () => {
    const motion = build(atDistance(10));
    expect(motion.stageGeometry?.horizontal?.plannedEnd?.xM).toBe(10);
    expect(motion.stagePlan?.stages.some((stage) => stage.kind === "projectile")).toBe(true);
    expect(motion.durationSeconds).toBeCloseTo(4.2, 10);
    expect(motion.sampleAt(4.2).position.x).toBeCloseTo(9, 10);
    expect(motion.sampleAt(4.2).velocity).toEqual({ x: 0, y: 0 });
    expect(motion.sampleAt(5).velocity).toEqual({ x: 0, y: 0 });
    expect(motion.endReason).toBe("stop_before_target");
    expect(motion.segments.some((segment) => segment.kind === "projectile")).toBe(false);
    expect(motion.events.some((event) => ["leave_table", "apex", "land"].includes(event.eventKind ?? ""))).toBe(false);
    expect(motion.events[motion.events.length - 1].eventKind).toBe("stop");
  });

  it("恰停桌沿：停止优先，不生成离桌事件", () => {
    const motion = build(atDistance(9));
    expect(motion.stageGeometry?.horizontal?.plannedEnd?.xM).toBe(9);
    expect(motion.sampleAt(motion.durationSeconds).position.x).toBeCloseTo(9, 10);
    expect(motion.sampleAt(motion.durationSeconds).velocity).toEqual({ x: 0, y: 0 });
    expect(motion.endReason).toBe("stop_at_target");
    expect(motion.events.some((event) => event.eventKind === "leave_table")).toBe(false);
    expect(motion.events[motion.events.length - 1].eventKind).toBe("stop");
  });

  it("斜面前缀：1.2 s 后钳制斜向末速度，不延续水平减速", () => {
    const motion = build({ ...plan, stages: plan.stages.slice(0, 1) });
    expect(motion.durationSeconds).toBeCloseTo(1.2, 10);
    expect(motion.endReason).toBe("prefix_end");
    expect(motion.stageGeometry?.horizontal).toBeUndefined();
    expect(motion.events.some((event) => event.eventKind === "lossless_turn")).toBe(false);
    for (const time of [1.2, 1.200001, 10]) {
      expect(motion.sampleAt(time).velocity.x).toBeCloseTo(3 * Math.sqrt(3), 10);
      expect(motion.sampleAt(time).velocity.y).toBeCloseTo(-3, 10);
    }
  });

  it("缺距离返回可定位到具体阶段的 MISSING 错误", () => {
    const result = motionLibrary.assembleScene(missingDistance as StagePlanDraft);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MISSING", path: "/stages/2/end/distanceM" }),
    ]));
  });
});
