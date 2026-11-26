import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { solveSpringPair, type SpringPairStage } from "../springPair.ts";
import { assembleScene, buildMotion } from "../index.ts";

const stage = (over: Partial<SpringPairStage> = {}): SpringPairStage => ({
  kind: "spring_pair",
  springConstantNpm: 50,
  ...over,
});
const entry = { xM: 0, yM: 0.5, vxMps: 3 };
const m1 = 1;

describe("弹簧双球：反求/给定两路与简谐接触过程", () => {
  it("m1=1,u=3,s=1 反求：m2=2、Ep=3 J、分离 vx1=-1、vx2=+2", () => {
    const sol = solveSpringPair(stage({ separationSpeedMps: 1 }), entry, m1);
    expect(sol.mass2Kg).toBeCloseTo(2, 9);
    expect(sol.maxElasticJ).toBeCloseTo(3, 9);
    expect(sol.commonVelocityMps).toBeCloseTo(1, 9);
    expect(sol.separation.vx1Mps).toBeCloseTo(-1, 9);
    expect(sol.separation.vx2Mps).toBeCloseTo(2, 9);
  });

  it("给定 m2=2 与反求等价；m2=m1 时交换速度", () => {
    const given = solveSpringPair(stage({ targetMassKg: 2 }), entry, m1);
    expect(given.separation.vx1Mps).toBeCloseTo(-1, 9);
    expect(given.separation.vx2Mps).toBeCloseTo(2, 9);
    const swap = solveSpringPair(stage({ targetMassKg: 1 }), entry, m1);
    expect(swap.separation.vx1Mps).toBeCloseTo(0, 9);
    expect(swap.separation.vx2Mps).toBeCloseTo(3, 9);
  });

  it("k 只影响时长：分离速度与 Ep 不变", () => {
    const a = solveSpringPair(stage({ springConstantNpm: 50, separationSpeedMps: 1 }), entry, m1);
    const b = solveSpringPair(stage({ springConstantNpm: 200, separationSpeedMps: 1 }), entry, m1);
    expect(b.durationSeconds).toBeLessThan(a.durationSeconds);
    expect(b.separation).toEqual(a.separation);
    expect(b.maxElasticJ).toBeCloseTo(a.maxElasticJ, 9);
    const mu = (1 * 2) / 3;
    expect(a.durationSeconds).toBeCloseTo(0.5 / 3 + Math.PI / Math.sqrt(50 / mu), 9);
  });

  it("gap 匀速段：接触前 compression=0、m2 静止、m1 匀速", () => {
    const sol = solveSpringPair(stage({ separationSpeedMps: 1 }), entry, m1);
    const tc = sol.events[0].timeSeconds;
    expect(tc).toBeCloseTo(0.5 / 3, 9);
    const s = sol.at(tc / 2);
    expect(s.x1M).toBeCloseTo(3 * (tc / 2), 9);
    expect(s.vx1Mps).toBeCloseTo(3, 9);
    expect(s.x2M).toBeCloseTo(0.5, 9);
    expect(s.vx2Mps).toBe(0);
    expect(s.compressionM).toBe(0);
  });

  it("共速时刻压缩最大且 Ep=½k x²；分离后压缩归零", () => {
    const sol = solveSpringPair(stage({ separationSpeedMps: 1 }), entry, m1);
    const tmax = sol.events[1].timeSeconds;
    const s = sol.at(tmax);
    expect(s.vx1Mps).toBeCloseTo(s.vx2Mps, 9);
    expect(s.vx1Mps).toBeCloseTo(1, 9);
    const mu = (1 * 2) / 3;
    const omega = Math.sqrt(50 / mu);
    expect(s.compressionM).toBeCloseTo(3 / omega, 9);
    expect(0.5 * 50 * s.compressionM ** 2).toBeCloseTo(sol.maxElasticJ, 9);
    const after = sol.at(sol.durationSeconds);
    expect(after.compressionM).toBe(0);
    expect(after.vx1Mps).toBeCloseTo(-1, 9);
    expect(after.vx2Mps).toBeCloseTo(2, 9);
  });

  it("采样时刻动量与能量守恒（含弹性势能）", () => {
    const sol = solveSpringPair(stage({ targetMassKg: 2 }), entry, m1);
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
      const s = sol.at(sol.durationSeconds * f);
      expect(1 * s.vx1Mps + 2 * s.vx2Mps).toBeCloseTo(3, 8);
      const e = 0.5 * 1 * s.vx1Mps ** 2 + 0.5 * 2 * s.vx2Mps ** 2 + 0.5 * 50 * s.compressionM ** 2;
      expect(e).toBeCloseTo(4.5, 7);
    }
  });

  it("事件顺序与时刻：接触 → 共速 → 分离", () => {
    const sol = solveSpringPair(stage({ separationSpeedMps: 1 }), entry, m1);
    expect(sol.events.map((e) => e.kind)).toEqual([
      "spring_pair_contact",
      "spring_pair_max_compression",
      "spring_pair_separate",
    ]);
    const mu = (1 * 2) / 3;
    const half = Math.PI / Math.sqrt(50 / mu);
    expect(sol.events[1].timeSeconds).toBeCloseTo(0.5 / 3 + half / 2, 9);
    expect(sol.events[2].timeSeconds).toBeCloseTo(sol.durationSeconds, 9);
    expect(sol.geometry.targetEntryXM).toBeCloseTo(0.5, 9);
  });

  it("入射反向时分离符号整体翻转", () => {
    const sol = solveSpringPair(stage({ separationSpeedMps: 1 }), { ...entry, vxMps: -3 }, m1);
    expect(sol.separation.vx1Mps).toBeCloseTo(1, 9);
    expect(sol.separation.vx2Mps).toBeCloseTo(-2, 9);
    expect(sol.geometry.targetEntryXM).toBeCloseTo(-0.5, 9);
  });

  it("非法输入抛 RangeError", () => {
    expect(() => solveSpringPair(stage({ springConstantNpm: 0 }), entry, m1)).toThrow(RangeError);
    expect(() => solveSpringPair(stage({ springConstantNpm: -2 }), entry, m1)).toThrow(RangeError);
    expect(() => solveSpringPair(stage(), entry, 0)).toThrow(RangeError);
    expect(() => solveSpringPair(stage(), { ...entry, vxMps: 0 }, m1)).toThrow(RangeError);
    expect(() => solveSpringPair(stage({ separationSpeedMps: 3 }), entry, m1)).toThrow(RangeError);
    expect(() => solveSpringPair(stage({ separationSpeedMps: 4 }), entry, m1)).toThrow(RangeError);
    expect(() => solveSpringPair(stage({ separationSpeedMps: -1 }), entry, m1)).toThrow(RangeError);
    expect(() => solveSpringPair(stage({ targetMassKg: 0 }), entry, m1)).toThrow(RangeError);
    expect(() => solveSpringPair(stage({ gapM: -0.1 }), entry, m1)).toThrow(RangeError);
    expect(() => solveSpringPair(stage(), entry, m1)).toThrow(RangeError);
  });

  it("第 19 题端到端核验：fixture 与缺 k + matchGrooveSpeed 均给出 v槽=1 m/s、m2=2 kg、Ep=3 J", () => {
    const fixture = JSON.parse(readFileSync(new URL("../../../fixtures/movable-arc-spring.reading.json", import.meta.url), "utf8"));
    const cases = [
      fixture,
      {
        kind: "stage_plan",
        schemaVersion: 1,
        gravityMps2: 10,
        massKg: 1,
        initial: { speedMps: 0 },
        stages: [
          { kind: "movable_arc", radiusM: 0.6, grooveMassKg: 3, exitDirection: -1 },
          { kind: "spring_pair", springConstantNpm: null, gapM: 0.5, targetMassKg: null, matchGrooveSpeed: true },
        ],
      },
    ];
    for (const plan of cases) {
      const assembled: any = assembleScene(plan);
      expect(assembled.ok).toBe(true);
      const motion: any = buildMotion(assembled.scene).motion;
      const arcExit = motion.events.find((e: any) => e.kind === "movable_arc_exit");
      expect(arcExit).toBeDefined();
      expect(Math.abs(arcExit.velocityAfter.vxMps)).toBeCloseTo(3, 6);
      expect(motion.movableArcAt(arcExit.timeSeconds).grooveVX).toBeCloseTo(1, 6);
      expect(motion.geometry.springPair.mass2Kg).toBeCloseTo(2, 6);
      const maxComp = motion.events.find((e: any) => e.kind === "spring_pair_max_compression");
      expect(maxComp).toBeDefined();
      expect(maxComp.explanation).toContain("3.0000 J");
      const sep = motion.events.find((e: any) => e.kind === "spring_pair_separate");
      expect(sep.velocityAfter.vxMps).toBeCloseTo(1, 6);
      expect(motion.springPairAt(sep.timeSeconds).vx2Mps).toBeCloseTo(-2, 6);
    }
  });
});
