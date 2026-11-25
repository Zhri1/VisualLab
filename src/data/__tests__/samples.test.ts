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

describe("内置示例题库（多过程多模型高考压轴题 + 传送带）", () => {
  it("恰好 8 道题、id 唯一、默认示例存在且全部附带真实存在的原题图片", () => {
    expect(SAMPLES.length).toBe(8);
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
    expect(motion.events.length).toBeGreaterThanOrEqual(sample.id === "conveyor-accel" ? 3 : 4);
    expect(motion.segments.length).toBeGreaterThanOrEqual(sample.id === "pulley-ground-slack" ? 1 : 2);
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

  it("斜面·圆弧过渡·粗糙水平·弹簧回弹：四段四模型连贯并带同钟能量读数", () => {
    const motion = build(getSample("gaokao-incline-arc-horiz-spring").reading);
    expect(motion.segments.map((s) => s.kind)).toEqual(["incline", "vertical_arc", "horizontal", "spring"]);
    const kinds = motion.events.map((event) => event.eventKind);
    expect(kinds).toContain("arc_enter");
    expect(kinds).toContain("spring_contact");
    expect(kinds).toContain("max_compression");
    expect(kinds).toContain("spring_detach");
    expect(motion.energyAt?.(motion.durationSeconds)?.frictionHeatJ).toBeGreaterThan(0);
  });

  it.each(["conveyor-accel", "magnetic-deflection"] as const)("%s 为组合压轴：主模型接续平抛并落地", (id) => {
    const motion = build(getSample(id).reading);
    expect(motion.segments[motion.segments.length - 1].kind).toBe("projectile");
    const kinds = motion.events.map((event) => event.eventKind);
    expect(kinds).toContain("land");
    const exitKind = id === "conveyor-accel" ? "conveyor_exit" : "magnetic_exit";
    const exit = motion.events.find((event) => event.eventKind === exitKind);
    expect(exit).toBeTruthy();
    expect(Math.hypot(exit!.velocityAfter!.x, exit!.velocityAfter!.y)).toBeCloseTo(2, 6);
    expect(getSample(id).difficulty).toBe("压轴");
  });

  it("pulley-ground-slack 为斜面连接体压轴：共加速→绳松弛→上滑到瞬时零速边界", () => {
    const motion = build(getSample("pulley-ground-slack").reading);
    const kinds = motion.events.map((event) => event.eventKind);
    expect(kinds).toContain("string_slack");
    expect(kinds).toContain("turn_around");
    expect(motion.durationSeconds).toBeGreaterThan(1.4);
    expect(getSample("pulley-ground-slack").difficulty).toBe("压轴");
  });

  it("movable-arc-spring 为动量守恒压轴：球槽反向分离 + 弹簧双球反求 m₂ = 2 kg、Ep = 3 J", () => {
    const motion = build(getSample("movable-arc-spring").reading);
    expect(motion.segments.map((s) => s.kind)).toEqual(["movable_arc", "spring_pair"]);
    const kinds = motion.events.map((event) => event.eventKind);
    expect(kinds).toEqual(expect.arrayContaining(["movable_arc_exit", "spring_pair_contact", "spring_pair_max_compression", "spring_pair_separate"]));
    const exit = motion.events.find((event) => event.eventKind === "movable_arc_exit")!;
    expect(Math.abs(exit.velocityAfter!.x)).toBeCloseTo(3, 6);
    const sep = motion.events.find((event) => event.eventKind === "spring_pair_separate")!;
    expect(Math.abs(sep.velocityAfter!.x)).toBeCloseTo(1, 6);
    const max = motion.events.find((event) => event.eventKind === "spring_pair_max_compression")!;
    expect(Math.abs(max.velocityAfter!.x)).toBeCloseTo(1, 6);
    expect(getSample("movable-arc-spring").difficulty).toBe("压轴");
  });

  it("弹簧弹射·圆弧跳台·斜抛·切向入斜坡：五段五模型连贯且含斜抛最高点与 A~E 地标", () => {
    const motion = build(getSample("gaokao-spring-arc-proj-incline").reading);
    expect(motion.segments.map((s) => s.kind)).toEqual(["spring", "horizontal", "vertical_arc", "projectile", "incline"]);
    const kinds = motion.events.map((event) => event.eventKind);
    expect(kinds).toContain("spring_release_start");
    expect(kinds).toContain("arc_enter");
    expect(kinds).toContain("apex");
    expect(kinds).toContain("reach_bottom");
    expect(motion.stageGeometry?.landmarks?.map((l) => l.label)).toEqual(["A", "B", "C", "D", "E"]);
  });
});
