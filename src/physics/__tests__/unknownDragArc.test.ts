import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateStagePlan, assembleStageScene } from "../index.ts";

describe("未知阻力圆弧段播放缺口（图4：常力水平 AB → 未知阻力半圆 BCD → 最高点 D 平抛）", () => {
  it("AB=1.25 m, F=-10 N, m=1 kg, R=0.4 m, g=10：精确播放 AB 与 D 后平抛，BD 记为示意与播放缺口", () => {
    const raw = JSON.parse(readFileSync(resolve("fixtures/constant-force-unknown-drag-arc-projectile.reading.json"), "utf8"));
    const v = validateStagePlan(raw);
    expect(v.ok).toBe(true);
    const built = assembleStageScene(raw);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const { motion, geometry } = built.scene;
    // 1) AB 段：a = -10 m/s²，s = 1.25 m -> t_AB = 0.5 s，v_B = -5 m/s，x_B = -1.25 m
    // 2) BD 段：未知阻力，耗时 0（不编造阻力规律与耗时），仅记 playbackGaps 与虚线示意圆弧
    // 3) D 后平抛：h = 2R = 0.8 m，v_D = +2 m/s -> t_flight = 0.4 s，落点距 B 为 0.8 m（x = -1.25 + 0.8 = -0.45 m）
    expect(motion.durationSeconds).toBeCloseTo(0.9, 9);
    expect(motion.segments.map((s) => s.kind)).toEqual(["constant_force_1d", "projectile"]);
    expect(motion.playbackGaps).toHaveLength(1);
    expect(motion.playbackGaps?.[0].stageIndex).toBe(1);
    expect(motion.playbackGaps?.[0].timeSeconds).toBeCloseTo(0.5, 9);
    expect(geometry.verticalArc).toBeUndefined();
    expect(geometry.schematic?.verticalArc).toBeDefined();
    expect(geometry.schematic?.verticalArc?.radiusM).toBeCloseTo(0.4, 9);

    // 数值核验：N_B = 72.5 N，v_D = 2 m/s，W_f = -2.5 J
    expect(motion.calculations?.find((c) => c.quantity === "arc_entry_normal_force")?.value).toBeCloseTo(72.5, 8);
    expect(motion.calculations?.find((c) => c.quantity === "arc_exit_speed")?.value).toBeCloseTo(2, 8);
    expect(motion.calculations?.find((c) => c.quantity === "arc_drag_work")?.value).toBeCloseTo(-2.5, 8);

    // 缺口前（t = 0.5 - 1e-6）：仍在 B 点，v_B ≈ -5 m/s
    const beforeGap = motion.sampleAt(0.5 - 1e-6);
    expect(beforeGap.xM).toBeCloseTo(-1.25, 4);
    expect(beforeGap.yM).toBeCloseTo(0, 6);
    expect(beforeGap.vxMps).toBeCloseTo(-5, 4);

    // 缺口后（t = 0.5）：从 D 点以 v_D = +2 m/s 水平抛出
    const atD = motion.sampleAt(0.5);
    expect(atD.xM).toBeCloseTo(-1.25, 9);
    expect(atD.yM).toBeCloseTo(0.8, 9);
    expect(atD.vxMps).toBeCloseTo(2, 9);
    expect(atD.vyMps).toBeCloseTo(0, 9);

    // 落点（t = 0.9 s）：距 B 点 0.8 m，y = 0
    const land = motion.sampleAt(0.9);
    expect(Math.abs(land.xM - (-1.25))).toBeCloseTo(0.8, 8);
    expect(land.yM).toBeCloseTo(0, 8);
    expect(land.vxMps).toBeCloseTo(2, 8);
    expect(land.vyMps).toBeCloseTo(-4, 8);
    expect(motion.endReason).toBe("landed");
  });

  it("拒绝 frictionless=false 却缺少 dragLaw 或 knownExit，绝不静默当成光滑圆弧", () => {
    const bareFalse = validateStagePlan({
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      massKg: 1,
      initial: { speedMps: 5 },
      stages: [{ kind: "vertical_arc", radiusM: 0.4, endAngleDeg: 180, side: "inside", frictionless: false }],
    });
    expect(bareFalse.ok).toBe(false);
    if (!bareFalse.ok) {
      expect(bareFalse.code).toBe("UNSUPPORTED");
    }

    const missingExit = validateStagePlan({
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      massKg: 1,
      initial: { speedMps: 5 },
      stages: [{ kind: "vertical_arc", radiusM: 0.4, endAngleDeg: 180, side: "inside", frictionless: false, dragLaw: "unknown" }],
    });
    expect(missingExit.ok).toBe(false);
    if (!missingExit.ok) {
      expect(missingExit.missingKeys).toContain("/stages/0/knownExit");
    }
  });

  it("按动能定理若阻力功为正（出口动能大于无阻力上限），返回前提冲突", () => {
    const impossible = assembleStageScene({
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      massKg: 1,
      initial: { speedMps: 0 },
      stages: [
        { kind: "constant_force_1d", netForceXN: 10, end: { kind: "distance", distanceM: 0.5 } },
        { kind: "vertical_arc", radiusM: 0.4, endAngleDeg: 180, side: "inside", frictionless: false, dragLaw: "unknown", knownExit: { kind: "critical_top" } },
      ],
    });
    expect(impossible.ok).toBe(false);
    if (!impossible.ok) {
      expect(impossible.code).toBe("INCONSISTENT_CONDITIONS");
    }
  });
});
