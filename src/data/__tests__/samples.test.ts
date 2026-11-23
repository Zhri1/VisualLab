import { describe, expect, it } from "vitest";
import { motionLibrary } from "../../adapters";
import type { StagePlanDraft } from "../../physics";
import { SAMPLES, getSample } from "../samples";

function build(input: unknown) {
  const assembled = motionLibrary.assembleScene(input as StagePlanDraft);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.errors));
  const built = motionLibrary.buildMotion(assembled.scene);
  if (!built.ok) throw new Error(built.message);
  return built.motion;
}

describe("内置示例题库", () => {
  it("id 唯一且默认示例存在", () => {
    const ids = SAMPLES.map((sample) => sample.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getSample("missing-id").id).toBe(SAMPLES[0].id);
  });

  it.each(SAMPLES)("$title 能装配并生成可播放动画", (sample) => {
    const motion = build(sample.reading);
    expect(motion.durationSeconds).toBeGreaterThan(0.5);
    expect(motion.events.length).toBeGreaterThanOrEqual(2);
    expect(motion.segments.length).toBeGreaterThanOrEqual(1);
    expect(sample.problemText.length).toBeGreaterThan(40);
    expect(sample.message.length).toBeGreaterThan(0);
  });

  it("临界示例保留反求出的弹性势能", () => {
    const motion = build(getSample("spring-critical-arc").reading);
    const energy = motion.calculations?.find((item) => item.quantity === "initial_elastic_energy");
    expect(energy?.value).toBeCloseTo(1.8, 2);
  });

  it("重球撞轻球是双体并行运动", () => {
    const motion = build(getSample("heavy-hits-light").reading);
    expect(motion.primaryBodyId).toBeTruthy();
    expect(motion.stageGeometry?.bodies?.length).toBe(2);
    expect(motion.segments.map((segment) => segment.kind)).toContain("pendulum");
    expect(motion.events.some((event) => event.eventKind === "collision")).toBe(true);
  });
});