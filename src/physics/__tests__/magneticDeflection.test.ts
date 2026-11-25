import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assembleScene, buildMotion, validateStagePlan, solveMagneticDeflection } from "../index.ts";
import type { MagneticDeflectionStage } from "../index.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"));
const build = (plan: unknown) => {
  const assembled: any = assembleScene(plan);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled));
  return buildMotion(assembled.scene).motion as any;
};
const stage = (over: Partial<MagneticDeflectionStage> = {}): MagneticDeflectionStage => ({
  kind: "magnetic_deflection", magneticTeslaB: 1, chargeC: 0.001, regionWidthM: 1, ...over,
});
const entry = { xM: 0, yM: 0, vxMps: 2, vyMps: 0 };
// 基准：m = q = B = 1e-3/1e-3/1，v = 2 → R = 2 m，ω = 1 rad/s。
const solve = (over: Partial<MagneticDeflectionStage> = {}, e = entry) => solveMagneticDeflection(stage(over), e, 0.001);

describe("匀强磁场偏转：洛伦兹力 → 匀速圆周", () => {
  it("半径公式 R = m·v/(|q|·B)，角速度 ω = |q|·B/m", () => {
    const cases = [
      { m: 0.001, q: 0.001, B: 1, v: 2 },
      { m: 0.002, q: -0.001, B: 2, v: 3 },
      { m: 0.0005, q: 0.002, B: 0.5, v: 4 },
    ];
    for (const c of cases) {
      const solved = solveMagneticDeflection(
        { kind: "magnetic_deflection", magneticTeslaB: c.B, chargeC: c.q, regionWidthM: 100 },
        { xM: 0, yM: 0, vxMps: c.v, vyMps: 0 }, c.m,
      );
      expect(solved.geometry.radiusM).toBeCloseTo(c.m * c.v / (Math.abs(c.q) * c.B), 12);
      expect(solved.angularVelocityRadps).toBeCloseTo(Math.abs(c.q) * c.B / c.m, 12);
    }
    const motion = build(read("magnetic-deflection.reading.json"));
    expect(motion.geometry.magnetic.radiusM).toBeCloseTo(2, 12);
  });

  it("旋转方向：q 正/负 × into/out 四组合，圆心在速度左侧或右侧（F = qv×B）", () => {
    // 水平向右入射：左侧 = +y，右侧 = −y。
    const combos = [
      { q: 0.001, field: "into_page", side: 1, direction: "ccw" },
      { q: -0.001, field: "into_page", side: -1, direction: "cw" },
      { q: 0.001, field: "out_of_page", side: -1, direction: "cw" },
      { q: -0.001, field: "out_of_page", side: 1, direction: "ccw" },
    ] as const;
    for (const c of combos) {
      const solved = solve({ chargeC: c.q, fieldDirection: c.field, regionWidthM: 100 });
      expect(solved.geometry.direction).toBe(c.direction);
      expect(solved.geometry.center.xM).toBeCloseTo(0, 12);
      expect(solved.geometry.center.yM).toBeCloseTo(c.side * 2, 12);
      // cross(v, center − entry) 的符号判定左/右侧。
      const cross = entry.vxMps * solved.geometry.center.yM - entry.vyMps * solved.geometry.center.xM;
      expect(Math.sign(cross)).toBe(c.side);
      // 轨迹始终在圆上，入口速度连续。
      const s0 = solved.at(0);
      expect(s0.vxMps).toBeCloseTo(2, 12);
      expect(s0.vyMps).toBeCloseTo(0, 12);
      const mid = solved.at(solved.durationSeconds / 2);
      expect(Math.hypot(mid.xM - solved.geometry.center.xM, mid.yM - solved.geometry.center.yM)).toBeCloseTo(2, 9);
    }
    // 竖直向上入射：q>0 向里时圆心在速度左侧 = −x。
    const up = solve({ regionWidthM: 100 }, { xM: 0, yM: 0, vxMps: 0, vyMps: 2 });
    expect(up.geometry.center.xM).toBeCloseTo(-2, 12);
    expect(up.geometry.center.yM).toBeCloseTo(0, 12);
    expect(up.geometry.direction).toBe("ccw");
  });

  it("基准 fixture：穿出 x = regionWidth 边界，偏转角与出射方向正确", () => {
    const motion = build(read("magnetic-deflection.reading.json"));
    const duration = Math.PI / 6; // asin(W/R) = asin(1/2)，ω = 1
    expect(motion.durationSeconds).toBeCloseTo(duration, 9);
    const end = motion.sampleAt(motion.durationSeconds);
    expect(end.xM).toBeCloseTo(1, 9); // x ≈ regionWidth
    expect(end.yM).toBeCloseTo(2 - Math.sqrt(3), 9);
    expect(end.vxMps).toBeCloseTo(Math.sqrt(3), 9);
    expect(end.vyMps).toBeCloseTo(1, 9);
    const g = motion.geometry.magnetic;
    expect(g.center).toEqual({ xM: 0, yM: 2 });
    expect(g.entry).toEqual({ xM: 0, yM: 0 });
    expect(g.exit.xM).toBeCloseTo(1, 9);
    expect(g.exit.yM).toBeCloseTo(2 - Math.sqrt(3), 9);
    expect(g.entryAngleRad).toBeCloseTo(-Math.PI / 2, 12);
    expect(g.exitAngleRad).toBeCloseTo(-Math.PI / 3, 12);
    expect(g.direction).toBe("ccw");
    expect(g.regionWidthM).toBe(1);
    expect(g.fieldDirection).toBe("into_page");
    expect(motion.geometry.magnetics).toHaveLength(1);
    expect(motion.geometry.magnetics[0]).toEqual(g);
    expect(motion.geometry.positionReference).toBe("particle");
    const solved = solve();
    expect(solved.exited).toBe(true);
    expect(solved.exitSide).toBe("region_edge");
    expect(solved.deflectionAngleRad).toBeCloseTo(Math.PI / 6, 12);
    expect(solved.exitVelocity.vxMps).toBeCloseTo(Math.sqrt(3), 9);
    expect(solved.exitVelocity.vyMps).toBeCloseTo(1, 9);
  });

  it("速率不变：|v| 恒定（1e-9），洛伦兹力不做功", () => {
    const motion = build(read("magnetic-deflection.reading.json"));
    for (let i = 0; i <= 24; i++) {
      const s = motion.sampleAt(motion.durationSeconds * i / 24);
      expect(Math.abs(Math.hypot(s.vxMps, s.vyMps) - 2)).toBeLessThan(1e-9);
    }
    const solved = solve({ regionWidthM: 100 });
    for (let i = 0; i <= 24; i++) {
      const s = solved.at(solved.durationSeconds * i / 24);
      expect(Math.abs(Math.hypot(s.vxMps, s.vyMps) - 2)).toBeLessThan(1e-9);
    }
  });

  it("半圆情形：regionWidth > 2R 时转过 π 从入口侧离开", () => {
    const solved = solve({ regionWidthM: 5 }); // 5 > 2R = 4
    expect(solved.exited).toBe(false);
    expect(solved.exitSide).toBe("entry_side");
    expect(solved.deflectionAngleRad).toBeCloseTo(Math.PI, 12);
    expect(solved.durationSeconds).toBeCloseTo(Math.PI, 9); // ω = 1
    expect(solved.geometry.exit.xM).toBeCloseTo(0, 9); // 回到入口边界
    expect(solved.geometry.exit.yM).toBeCloseTo(4, 9); // 入口上方 2R
    expect(solved.exitVelocity.vxMps).toBeCloseTo(-2, 9);
    expect(solved.exitVelocity.vyMps).toBeCloseTo(0, 9);
    const motion = build({ ...read("magnetic-deflection.reading.json"), stages: [{ ...stage(), regionWidthM: 5 }] });
    expect(motion.endReason).toBe("magnetic_exit");
    expect(motion.durationSeconds).toBeCloseTo(Math.PI, 9);
    expect(motion.sampleAt(Math.PI).xM).toBeCloseTo(0, 9);
    expect(motion.sampleAt(Math.PI).vxMps).toBeCloseTo(-2, 9);
    // 显式 exitKind: half_circle 强制半圆，即使区域很窄。
    const forced = solve({ regionWidthM: 0.5, exitKind: "half_circle" });
    expect(forced.deflectionAngleRad).toBeCloseTo(Math.PI, 12);
    expect(forced.exitSide).toBe("entry_side");
    expect(forced.geometry.exit.xM).toBeCloseTo(0, 9);
    expect(forced.geometry.exit.yM).toBeCloseTo(4, 9);
  });

  it("临界：regionWidth = R 时恰在圆的最右端切向穿出", () => {
    const solved = solve({ regionWidthM: 2 });
    expect(solved.exited).toBe(true);
    expect(solved.deflectionAngleRad).toBeCloseTo(Math.PI / 2, 12);
    expect(solved.geometry.exit.xM).toBeCloseTo(2, 9);
    expect(solved.geometry.exit.yM).toBeCloseTo(2, 9);
    expect(solved.exitVelocity.vxMps).toBeCloseTo(0, 9);
    expect(solved.exitVelocity.vyMps).toBeCloseTo(2, 9);
  });

  it("事件顺序与 endReason：magnetic_enter → magnetic_exit，终止于 magnetic_exit", () => {
    const motion = build(read("magnetic-deflection.reading.json"));
    const enter = motion.events.find((e: any) => e.kind === "magnetic_enter");
    const exit = motion.events.find((e: any) => e.kind === "magnetic_exit");
    expect(enter).toBeDefined();
    expect(exit).toBeDefined();
    expect(enter.timeSeconds).toBe(0);
    expect(exit.timeSeconds).toBeCloseTo(Math.PI / 6, 9);
    expect(enter.order).toBeLessThan(exit.order);
    expect(motion.events.map((e: any) => e.order)).toEqual(motion.events.map((_: any, i: number) => i));
    expect(exit.velocityAfter.vxMps).toBeCloseTo(Math.sqrt(3), 9);
    expect(exit.velocityAfter.vyMps).toBeCloseTo(1, 9);
    expect(motion.endReason).toBe("magnetic_exit");
    expect(motion.termination.reason).toBe("magnetic_exit");
    expect(motion.termination.eventId).toBe(exit.id);
    expect(motion.segments).toHaveLength(1);
    expect(motion.segments[0].kind).toBe("magnetic_deflection");
  });

  it("负电荷与反向磁场：全程管线给出镜像轨迹", () => {
    const negative = build({ ...read("magnetic-deflection.reading.json"), stages: [{ ...stage(), chargeC: -0.001 }] });
    expect(negative.geometry.magnetic.direction).toBe("cw");
    expect(negative.geometry.magnetic.center).toEqual({ xM: 0, yM: -2 });
    expect(negative.sampleAt(negative.durationSeconds).xM).toBeCloseTo(1, 9);
    expect(negative.sampleAt(negative.durationSeconds).yM).toBeCloseTo(Math.sqrt(3) - 2, 9);
    expect(negative.sampleAt(negative.durationSeconds).vyMps).toBeCloseTo(-1, 9);
    const outward = build({ ...read("magnetic-deflection.reading.json"), stages: [{ ...stage(), fieldDirection: "out_of_page" }] });
    expect(outward.geometry.magnetic.direction).toBe("cw");
    expect(outward.sampleAt(outward.durationSeconds).yM).toBeCloseTo(Math.sqrt(3) - 2, 9);
  });

  it("与 horizontal_slide 串联：入口位置/速度衔接前一阶段末端", () => {
    const motion = build({
      kind: "stage_plan", schemaVersion: 1, gravityMps2: 10, massKg: 0.001,
      initial: { speedMps: 2 },
      stages: [
        { kind: "horizontal_slide", kineticFrictionCoefficient: 0, end: { kind: "distance", distanceM: 1.5 } },
        { ...stage(), regionWidthM: 1 },
      ],
    });
    const g = motion.geometry.magnetic;
    expect(g.entry.xM).toBeCloseTo(1.5, 9); // 前段末端 x = 1.5
    expect(g.entry.yM).toBeCloseTo(0, 12);
    expect(g.center.xM).toBeCloseTo(1.5, 9);
    expect(g.center.yM).toBeCloseTo(2, 9);
    const enter = motion.events.find((e: any) => e.kind === "magnetic_enter");
    expect(enter.timeSeconds).toBeCloseTo(0.75, 9); // 1.5 m / 2 m/s
    expect(enter.velocityAfter.vxMps).toBeCloseTo(2, 9);
    expect(motion.sampleAt(0.75).xM).toBeCloseTo(1.5, 9);
    expect(motion.durationSeconds).toBeCloseTo(0.75 + Math.PI / 6, 9);
    expect(motion.sampleAt(motion.durationSeconds).xM).toBeCloseTo(2.5, 9); // 1.5 + regionWidth
    expect(motion.endReason).toBe("magnetic_exit");
    expect(motion.segments.map((s: any) => s.kind)).toEqual(["horizontal_slide", "magnetic_deflection"]);
  });

  it("摩擦水平段后接磁场：入口速率按摩擦折减，半径随之变化", () => {
    const motion = build({
      kind: "stage_plan", schemaVersion: 1, gravityMps2: 10, massKg: 0.001,
      initial: { speedMps: 2 },
      stages: [
        { kind: "horizontal_slide", kineticFrictionCoefficient: 0.1, end: { kind: "distance", distanceM: 0.75 } },
        { ...stage(), regionWidthM: 1 },
      ],
    });
    const vEntry = Math.sqrt(2.5); // v² = 4 − 2·μg·d = 4 − 1.5
    expect(motion.geometry.magnetic.entry.xM).toBeCloseTo(0.75, 9);
    expect(motion.geometry.magnetic.radiusM).toBeCloseTo(vEntry, 9); // R = m·v/(|q|B) = v（数值上）
    const enter = motion.events.find((e: any) => e.kind === "magnetic_enter");
    expect(Math.hypot(enter.velocityAfter.vxMps, enter.velocityAfter.vyMps)).toBeCloseTo(vEntry, 9);
    expect(motion.sampleAt(motion.durationSeconds).xM).toBeCloseTo(1.75, 9);
    const mid = motion.sampleAt(enter.timeSeconds + (motion.durationSeconds - enter.timeSeconds) / 2);
    expect(Math.abs(Math.hypot(mid.vxMps, mid.vyMps) - vEntry)).toBeLessThan(1e-9);
  });

  it("首段磁场允许 speedMps 或 vxMps/vyMps 两种初态，且不需要重力", () => {
    const scalar = build({ kind: "stage_plan", schemaVersion: 1, massKg: 0.001, initial: { speedMps: 2 }, stages: [stage()] });
    expect(scalar.durationSeconds).toBeCloseTo(Math.PI / 6, 9);
    expect(scalar.sampleAt(scalar.durationSeconds).xM).toBeCloseTo(1, 9);
    const validated: any = validateStagePlan(read("magnetic-deflection.reading.json"));
    expect(validated.ok).toBe(true);
    expect(validated.reading.gravityMps2).toBeUndefined(); // needsGravity 不含磁场
    expect(validated.reading.stages[0].fieldDirection).toBe("into_page"); // 默认值
    expect(validated.reading.stages[0].exitKind).toBe("region_edge");
    const conflict: any = validateStagePlan({ kind: "stage_plan", schemaVersion: 1, massKg: 0.001, initial: { speedMps: 2, vxMps: 2, vyMps: 0 }, stages: [stage()] });
    expect(conflict.ok).toBe(false);
    expect(conflict.fieldErrors.some((e: any) => e.path === "/initial" && e.code === "PRECONDITION_CONFLICT")).toBe(true);
  });

  it("字段校验：B 正、q 非零、宽度正、缺质量、非法枚举", () => {
    const base = () => read("magnetic-deflection.reading.json");
    const bad = (mutate: (plan: any) => void) => {
      const plan = base();
      mutate(plan);
      return validateStagePlan(plan) as any;
    };
    expect(bad((p) => { p.stages[0].chargeC = 0; }).fieldErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/stages/0/chargeC", code: "RANGE" })]),
    );
    expect(bad((p) => { p.stages[0].magneticTeslaB = -1; }).fieldErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/stages/0/magneticTeslaB", code: "RANGE" })]),
    );
    expect(bad((p) => { p.stages[0].regionWidthM = 0; }).fieldErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/stages/0/regionWidthM", code: "RANGE" })]),
    );
    const noMass = bad((p) => { delete p.massKg; });
    expect(noMass.ok).toBe(false);
    expect(noMass.code).toBe("NEEDS_INPUT");
    expect(noMass.missingKeys).toContain("/massKg");
    expect(bad((p) => { p.stages[0].fieldDirection = "sideways"; }).fieldErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/stages/0/fieldDirection", code: "UNSUPPORTED" })]),
    );
    expect(bad((p) => { p.stages[0].exitKind = "full_circle"; }).fieldErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/stages/0/exitKind", code: "UNSUPPORTED" })]),
    );
  });

  it("求解器拒绝非法输入：零速度、零质量、非正 B", () => {
    expect(() => solveMagneticDeflection(stage(), { xM: 0, yM: 0, vxMps: 0, vyMps: 0 }, 0.001)).toThrow(RangeError);
    expect(() => solveMagneticDeflection(stage(), entry, 0)).toThrow(RangeError);
    expect(() => solveMagneticDeflection(stage({ magneticTeslaB: 0 }), entry, 0.001)).toThrow(RangeError);
    expect(() => solveMagneticDeflection(stage({ chargeC: 0 }), entry, 0.001)).toThrow(RangeError);
  });
});
