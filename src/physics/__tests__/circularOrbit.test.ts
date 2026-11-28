import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { solveCircularOrbit, validateStagePlan, assembleStageScene } from "../index.ts";

describe("圆周轨道运动基础模块（circular_orbit）", () => {
  it("LEO 样例（GM=3.986e14, R=6.371e6, h=4.0e5）：精确计算 r、v、T 并完整播放一周", () => {
    const raw = JSON.parse(readFileSync(resolve("fixtures/circular-orbit.reading.json"), "utf8"));
    const v = validateStagePlan(raw);
    expect(v.ok).toBe(true);
    const built = assembleStageScene(raw);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const { motion, geometry } = built.scene;
    const r = 6.371e6 + 4.0e5; // 6.771e6 m
    const expectedV = Math.sqrt(3.986e14 / r);
    const expectedT = 2 * Math.PI * Math.sqrt((r ** 3) / 3.986e14);

    expect(geometry.circularOrbit?.orbitalRadiusM).toBeCloseTo(r, 2);
    expect(motion.durationSeconds).toBeCloseTo(expectedT, 4);
    expect(motion.endReason).toBe("orbit_complete");
    expect(motion.calculations?.find((c) => c.quantity === "orbital_speed")?.value).toBeCloseTo(expectedV, 4);
    expect(motion.calculations?.find((c) => c.quantity === "orbital_period")?.value).toBeCloseTo(expectedT, 4);

    // 任意时刻半径恒为 r、速率恒为 v、速度与位矢垂直
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const s = motion.sampleAt(motion.durationSeconds * f);
      expect(Math.hypot(s.xM, s.yM)).toBeCloseTo(r, 1);
      expect(Math.hypot(s.vxMps, s.vyMps)).toBeCloseTo(expectedV, 4);
      expect(s.xM * s.vxMps + s.yM * s.vyMps).toBeCloseTo(0, 1);
    }
    // 逆时针：t = T/4 在 (0, +r)，速度向左 (-v, 0)
    const q1 = motion.sampleAt(expectedT / 4);
    expect(q1.xM).toBeCloseTo(0, 1);
    expect(q1.yM).toBeCloseTo(r, 1);
    expect(q1.vxMps).toBeCloseTo(-expectedV, 4);
    expect(q1.vyMps).toBeCloseTo(0, 4);
  });

  it("改变 GM、直接给轨道半径 r 与顺时针方向（cw）：v、T、方向与位置均同步变化", () => {
    const mu = 1e12;
    const r = 1e6;
    const sol = solveCircularOrbit({
      kind: "circular_orbit",
      gravitationalParameterM3s2: mu,
      orbitalRadiusM: r,
      direction: "cw",
      orbits: 1,
    });
    expect(sol.orbitalSpeedMps).toBeCloseTo(1000, 8);
    expect(sol.periodSeconds).toBeCloseTo(2000 * Math.PI, 6);
    // 顺时针：t = T/4 在 (0, -r)，速度向左 (-v, 0)
    const q1 = sol.at(sol.periodSeconds / 4);
    expect(q1.xM).toBeCloseTo(0, 4);
    expect(q1.yM).toBeCloseTo(-r, 4);
    expect(q1.vxMps).toBeCloseTo(-1000, 4);
    expect(q1.vyMps).toBeCloseTo(0, 4);
  });

  it("仅给离地高度 altitudeM 而缺中心天体半径 centralBodyRadiusM 时，返回 NEEDS_INPUT", () => {
    const res = validateStagePlan({
      kind: "stage_plan",
      schemaVersion: 1,
      initial: { speedMps: 0 },
      stages: [
        {
          kind: "circular_orbit",
          gravitationalParameterM3s2: 3.986e14,
          altitudeM: 4e5,
        },
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("NEEDS_INPUT");
      expect(res.missingKeys).toContain("/stages/0/centralBodyRadiusM");
    }
  });
});
