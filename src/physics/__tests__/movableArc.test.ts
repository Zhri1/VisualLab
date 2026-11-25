import { describe, expect, it } from "vitest";
import { solveMovableArc, type MovableArcStage } from "../movableArc.ts";

const stage = (over: Partial<MovableArcStage> = {}): MovableArcStage => ({
  kind: "movable_arc",
  radiusM: 0.6,
  grooveMassKg: 3,
  ...over,
});
const entry = { xM: 2, yM: 1.6 };
const m = 1;
const g = 10;

describe("可动圆弧槽：解析出口与守恒律", () => {
  it("m=1,M=3,R=0.6,g=10：出口球速 3 m/s、槽速 1 m/s（误差<1e-6）", () => {
    const sol = solveMovableArc(stage(), entry, m, g);
    expect(Math.abs(sol.exit.vxMps)).toBeCloseTo(3, 6);
    expect(Math.abs(sol.exit.grooveVX)).toBeCloseTo(1, 6);
    expect(sol.exit.vyMps).toBeCloseTo(0, 9);
    expect(sol.maxSpeedMps).toBeCloseTo(3, 9);
    expect(sol.durationSeconds).toBeGreaterThan(0);
    expect(sol.exit.yM).toBeCloseTo(entry.yM - 0.6, 9);
  });

  it("默认 exitDirection=-1：球向左、槽向右；=1 时反向", () => {
    const left = solveMovableArc(stage(), entry, m, g);
    expect(left.exit.vxMps).toBeCloseTo(-3, 6);
    expect(left.exit.grooveVX).toBeCloseTo(1, 6);
    const right = solveMovableArc(stage({ exitDirection: 1 }), entry, m, g);
    expect(right.exit.vxMps).toBeCloseTo(3, 6);
    expect(right.exit.grooveVX).toBeCloseTo(-1, 6);
    expect(right.geometry.exitDirection).toBe(1);
  });

  it("初态：球在 entry 静止、槽心在 entry+(sR,0)", () => {
    const sol = solveMovableArc(stage(), entry, m, g);
    const s0 = sol.at(0);
    expect(s0.xM).toBeCloseTo(entry.xM, 9);
    expect(s0.yM).toBeCloseTo(entry.yM, 9);
    expect(s0.vxMps).toBeCloseTo(0, 9);
    expect(s0.vyMps).toBeCloseTo(0, 9);
    expect(s0.grooveXM).toBeCloseTo(entry.xM - 0.6, 9);
    expect(s0.grooveVX).toBeCloseTo(0, 9);
  });

  it("采样时刻水平动量守恒 m·vx + M·Vg ≈ 0", () => {
    const sol = solveMovableArc(stage(), entry, m, g);
    for (const f of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1]) {
      const s = sol.at(sol.durationSeconds * f);
      expect(m * s.vxMps + 3 * s.grooveVX).toBeCloseTo(0, 8);
    }
  });

  it("采样时刻机械能守恒：动能 + 相对槽底势能 ≈ m g R", () => {
    const sol = solveMovableArc(stage(), entry, m, g);
    const bottomY = entry.yM - 0.6;
    for (const f of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1]) {
      const s = sol.at(sol.durationSeconds * f);
      const ke = 0.5 * m * (s.vxMps ** 2 + s.vyMps ** 2) + 0.5 * 3 * s.grooveVX ** 2;
      expect(ke + m * g * (s.yM - bottomY)).toBeCloseTo(m * g * 0.6, 6);
    }
  });

  it("过程单调：球下降、槽向出口反方向移动；出口事件唯一且时刻=时长", () => {
    const sol = solveMovableArc(stage(), entry, m, g);
    let prevY = Infinity;
    let prevGroove = -Infinity;
    for (let i = 0; i <= 20; i += 1) {
      const s = sol.at((sol.durationSeconds * i) / 20);
      expect(s.yM).toBeLessThanOrEqual(prevY + 1e-9);
      expect(s.grooveXM).toBeGreaterThanOrEqual(prevGroove - 1e-9);
      prevY = s.yM;
      prevGroove = s.grooveXM;
    }
    expect(sol.events).toHaveLength(1);
    expect(sol.events[0].kind).toBe("movable_arc_exit");
    expect(sol.events[0].timeSeconds).toBeCloseTo(sol.durationSeconds, 9);
    expect(sol.events[0].vxMps).toBeCloseTo(-3, 6);
  });

  it("at(t) 端点钳制与几何字段", () => {
    const sol = solveMovableArc(stage(), entry, m, g);
    expect(sol.at(-1).xM).toBeCloseTo(sol.at(0).xM, 9);
    expect(sol.at(sol.durationSeconds + 5).vxMps).toBeCloseTo(sol.exit.vxMps, 6);
    expect(sol.geometry).toMatchObject({ radiusM: 0.6, grooveMassKg: 3, exitDirection: -1, entryXM: 2, entryYM: 1.6 });
  });

  it("非法输入抛 RangeError", () => {
    expect(() => solveMovableArc(stage({ radiusM: 0 }), entry, m, g)).toThrow(RangeError);
    expect(() => solveMovableArc(stage({ radiusM: -1 }), entry, m, g)).toThrow(RangeError);
    expect(() => solveMovableArc(stage({ grooveMassKg: 0 }), entry, m, g)).toThrow(RangeError);
    expect(() => solveMovableArc(stage(), entry, 0, g)).toThrow(RangeError);
    expect(() => solveMovableArc(stage(), entry, m, 0)).toThrow(RangeError);
    expect(() => solveMovableArc(stage({ exitDirection: 2 as -1 }), entry, m, g)).toThrow(RangeError);
    expect(() => solveMovableArc(stage(), { xM: NaN, yM: 0 }, m, g)).toThrow(RangeError);
  });
});
