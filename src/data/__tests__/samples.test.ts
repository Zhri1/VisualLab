import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { motionLibrary } from "../../adapters";
import type { StagePlanDraft } from "../../physics";
import { SAMPLES, getSample } from "../samples";

const PUBLIC_DIR = resolve(__dirname, "../../../public");

function build(input: unknown) {
  const assembled = motionLibrary.assembleScene(input as StagePlanDraft);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.errors));
  const built = motionLibrary.buildMotion(assembled.scene);
  if (!built.ok) throw new Error(built.message);
  return built.motion;
}

describe("内置示例题库（4 道高考压轴综合题）", () => {
  it("恰好 4 道题、id 唯一、默认示例存在且全部附带真实存在的原题图片", () => {
    expect(SAMPLES.length).toBe(4);
    const ids = SAMPLES.map((sample) => sample.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getSample("missing-id").id).toBe(SAMPLES[0].id);
    for (const sample of SAMPLES) {
      expect(sample.imageUrl).toMatch(/^\/samples\/.+\.(jpg|png|svg)$/);
      const diskPath = resolve(PUBLIC_DIR, sample.imageUrl.replace(/^\//, ""));
      expect(existsSync(diskPath)).toBe(true);
    }
  });

  it.each(SAMPLES)("$title 能装配并生成可播放动画", (sample) => {
    const motion = build(sample.reading);
    expect(motion.durationSeconds).toBeGreaterThan(0.5);
    expect(motion.events.length).toBeGreaterThanOrEqual(2);
    expect(motion.segments.length).toBeGreaterThanOrEqual(1);
    expect(sample.problemText.length).toBeGreaterThan(40);
    expect(sample.message.length).toBeGreaterThan(0);
    expect(sample.assumptions.length).toBe(3);
  });

  it("平抛入弧·粗糙水平·临界整圆：四段连贯且保留 3 条声明式反求与 A~E 地标", () => {
    const motion = build(getSample("gaokao-proj-arc-horiz-loop").reading);
    expect(motion.segments.map((s) => s.kind)).toEqual(["projectile", "vertical_arc", "horizontal", "vertical_arc"]);
    expect(motion.stageGeometry?.verticalArcs?.length).toBe(2);
    expect(motion.stageGeometry?.landmarks?.map((l) => l.label)).toEqual(["A", "B", "C", "D", "E"]);
    expect(motion.events.some((e) => e.eventKind === "arc_top")).toBe(true);
  });

  it("碰后飞出桌沿并落地（双体并行）", () => {
    const motion = build(getSample("collision-flight").reading);
    const kinds = motion.events.map((event) => event.eventKind);
    expect(kinds).toContain("collision");
    expect(kinds).toContain("projectile_launch");
    expect(kinds).toContain("land");
  });

  it("变速传送带：先共速，3 s 后突破静摩擦上限重新相对滑动", () => {
    const motion = build(getSample("gaokao-conveyor-reslide").reading);
    const kinds = motion.events.map((event) => event.eventKind);
    expect(kinds).toContain("conveyor_common_velocity");
    expect(kinds).toContain("conveyor_reslide");
    expect(motion.conveyorAt?.(4)?.relativeDisplacementM).toBeCloseTo(-2.5, 4);
  });

  it("定滑轮连接体：重物 0.8 s 着地松绳，桌面滑块继续减速至停", () => {
    const motion = build(getSample("gaokao-pulley-ground-slack").reading);
    const kinds = motion.events.map((event) => event.eventKind);
    expect(kinds).toContain("body2_ground_hit");
    expect(kinds).toContain("string_slack");
    expect(kinds).toContain("stop");
    expect(motion.durationSeconds).toBeCloseTo(2.4, 4);
  });
});
