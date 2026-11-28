import { describe, expect, it } from "vitest";
import { solveFieldScene, computeFieldSceneMotion, type FieldSceneStage, type FieldSceneMotion } from "../fieldScene.ts";
import { assembleScene } from "../index.ts";
import type { StageMotion } from "../stageMotion.ts";

// 编译期断言：云镜像用的本地结构类型与主管线 StageMotion 兼容。
const _compat: StageMotion = computeFieldSceneMotion({
  kind: "field_scene",
  particles: [{ id: "a", massKg: 1, chargeC: -1, xM: 0, yM: 0, vxMps: 1, vyMps: 0 }],
  regions: [{ id: "I", xMinM: 0, xMaxM: 1, magneticTeslaB: -0.6 }],
});
void _compat;
type _Assert<T extends true> = T;
type _Assignable = _Assert<FieldSceneMotion extends StageMotion ? true : false>;
void (null as unknown as _Assignable);

// 原题（14 题）：负电粒子 a/b 以等大初速沿 +x/+y 从 O 入射；I 区（0<x<d）向里、II 区（x>d）向外。
// 闭式解：r1 = 5d/3、r2 = 5d/2 → B1:B2 = 3:2；b 首过虚线 y = √21d/3、返回 P(d, 4√21d/3)；
// a 首次回 x 轴 x = (15+5√5)d/6。归一化 d=1, v0=1, m=1, q=−1 → B1=0.6, B2=0.4。
const SQ21 = Math.sqrt(21);
const A_AXIS_X = (15 + 5 * Math.sqrt(5)) / 6;

function originalScene(d = 1): FieldSceneStage {
  const b1 = 3 / (5 * d);
  const b2 = 2 / (5 * d);
  return {
    kind: "field_scene",
    particles: [
      { id: "a", massKg: 1, chargeC: -1, xM: 0, yM: 0, vxMps: 1, vyMps: 0 },
      { id: "b", massKg: 1, chargeC: -1, xM: 0, yM: 0, vxMps: 0, vyMps: 1 },
    ],
    regions: [
      { id: "I", xMinM: 0, xMaxM: d, magneticTeslaB: -b1 },
      { id: "II", xMinM: d, magneticTeslaB: b2 },
    ],
    observers: [
      { id: "b_first", particleId: "b", kind: "cross_x", atM: d, direction: 1, label: "b 首次过虚线" },
      { id: "b_return", particleId: "b", kind: "cross_x", atM: d, direction: -1, label: "b 返回 I 区" },
      { id: "a_axis", particleId: "a", kind: "cross_y", atM: 0, direction: 1, label: "a 首次回 x 轴" },
    ],
  };
}

describe("field_scene 组合接口 · 原题", () => {
  const sol = solveFieldScene(originalScene());
  const fired = (id: string) => sol.fired.find((f) => f.id === id)!;

  it("b 首过虚线：cosθ=2/5，y=√21d/3", () => {
    const f = fired("b_first");
    expect(f.xM).toBeCloseTo(1, 9);
    expect(f.yM).toBeCloseTo(SQ21 / 3, 9);
    const speed = Math.hypot(f.vxMps, f.vyMps);
    expect(f.vyMps / speed).toBeCloseTo(0.4, 9);
    expect(f.vxMps / speed).toBeCloseTo(SQ21 / 5, 9);
  });

  it("b 经 II 区偏转后从 P(d, 4√21d/3) 返回 I 区", () => {
    const f = fired("b_return");
    expect(f.xM).toBeCloseTo(1, 9);
    expect(f.yM).toBeCloseTo((4 * SQ21) / 3, 9);
    expect(f.timeSeconds).toBeGreaterThan(fired("b_first").timeSeconds);
  });

  it("a 首次回 x 轴距离 = (15+5√5)d/6", () => {
    const f = fired("a_axis");
    expect(f.yM).toBeCloseTo(0, 9);
    expect(f.xM).toBeCloseTo(A_AXIS_X, 9);
  });

  it("过界换场位置与速度连续", () => {
    for (const b of sol.boundaryEvents) {
      const before = sol.at(b.timeSeconds - 1e-6, b.particleId);
      const after = sol.at(b.timeSeconds + 1e-6, b.particleId);
      expect(Math.hypot(before.xM - after.xM, before.yM - after.yM)).toBeLessThan(1e-4);
      expect(Math.hypot(before.vxMps - after.vxMps, before.vyMps - after.vyMps)).toBeLessThan(1e-4);
      expect(Math.hypot(after.vxMps, after.vyMps)).toBeCloseTo(1, 9);
    }
    expect(sol.boundaryEvents.length).toBeGreaterThanOrEqual(3);
  });

  it("a 在 I 区与 x 轴相切、于 (d, −d/3) 过界", () => {
    const cross = sol.boundaryEvents.find((b) => b.particleId === "a")!;
    expect(cross.xM).toBeCloseTo(1, 9);
    expect(cross.yM).toBeCloseTo(-1 / 3, 9);
  });

  it("装配为共钟 StageMotion：bodies 双粒子 + 事件 + 读数", () => {
    const motion = computeFieldSceneMotion(originalScene());
    expect(motion.durationSeconds).toBeGreaterThan(fired("a_axis").timeSeconds);
    const mid = motion.sampleAt(motion.durationSeconds / 2);
    expect(Object.keys(mid.bodies ?? {}).sort()).toEqual(["a", "b"]);
    expect(motion.fieldSceneAt?.(motion.durationSeconds).fired.map((f) => f.id).sort()).toEqual(["a_axis", "b_first", "b_return"]);
    expect(motion.events.some((e) => e.kind === "field_boundary")).toBe(true);
    expect(motion.endReason).toBe("field_scene_complete");
  });

  it("走 assembleScene 管线（stage_plan 单段）", () => {
    const res = assembleScene({ kind: "stage_plan", schemaVersion: 1, scaleMode: "normalized", stages: [originalScene()] } as never);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.scene.motion.durationSeconds).toBeGreaterThan(0);
  });
});

describe("field_scene 反求 B（同类题复用）", () => {
  it("由 cosθ 与 P 点返回坐标反求 B1=0.6、B2=0.4（比值 3:2）", () => {
    const scene = originalScene();
    scene.regions[0].magneticTeslaB = null;
    scene.regions[0].fieldDirection = "into_page";
    scene.regions[1].magneticTeslaB = null;
    scene.regions[1].fieldDirection = "out_of_page";
    scene.constraints = [
      { solveRegionId: "I", observerId: "b_first", kind: "velocity_cos_y", targetCos: 0.4 },
      { solveRegionId: "II", observerId: "b_return", kind: "position_y", targetM: (4 * SQ21) / 3 },
    ];
    const sol = solveFieldScene(scene);
    expect(sol.solved).toHaveLength(2);
    expect(sol.solved[0].magneticTeslaB).toBeCloseTo(-0.6, 6);
    expect(sol.solved[1].magneticTeslaB).toBeCloseTo(0.4, 6);
    expect(Math.abs(sol.solved[0].magneticTeslaB / sol.solved[1].magneticTeslaB)).toBeCloseTo(1.5, 6);
    expect(sol.fired.find((f) => f.id === "a_axis")!.xM).toBeCloseTo(A_AXIS_X, 6);
  });
});

describe("field_scene 组合性：只改场景参数即跑通", () => {
  it("变体 1：边界 d→1.4（B 同比缩放），闭式解整体缩放", () => {
    const d = 1.4;
    const sol = solveFieldScene(originalScene(d));
    expect(sol.fired.find((f) => f.id === "b_first")!.yM).toBeCloseTo((SQ21 / 3) * d, 8);
    expect(sol.fired.find((f) => f.id === "b_return")!.yM).toBeCloseTo(((4 * SQ21) / 3) * d, 8);
    expect(sol.fired.find((f) => f.id === "a_axis")!.xM).toBeCloseTo(A_AXIS_X * d, 8);
  });

  it("变体 2：加第三颗粒子（45° 入射），共钟执行且速率守恒", () => {
    const scene = originalScene();
    scene.particles.push({ id: "c", massKg: 1, chargeC: -1, xM: 0, yM: 0, vxMps: Math.SQRT1_2, vyMps: Math.SQRT1_2 });
    const sol = solveFieldScene(scene);
    expect(sol.boundaryEvents.some((b) => b.particleId === "c")).toBe(true);
    for (let i = 0; i <= 40; i += 1) {
      const st = sol.at((sol.durationSeconds * i) / 40, "c");
      expect(Math.hypot(st.vxMps, st.vyMps)).toBeCloseTo(1, 8);
    }
  });

  it("变体 3：a 反向入射（−x），无场区匀速直线", () => {
    const scene = originalScene();
    scene.particles[0].vxMps = -1;
    const sol = solveFieldScene(scene);
    const st = sol.at(0.7, "a");
    expect(st.xM).toBeCloseTo(-0.7, 9);
    expect(st.yM).toBeCloseTo(0, 9);
    expect(st.vxMps).toBeCloseTo(-1, 9);
  });

  it("校验：反求区域 B 非 null / 观察引用不存在粒子 时报错带路径", () => {
    const bad = originalScene();
    bad.constraints = [{ solveRegionId: "I", observerId: "b_first", kind: "velocity_cos_y", targetCos: 0.4 }];
    expect(() => solveFieldScene(bad)).toThrow(/null/);
    const bad2 = originalScene();
    bad2.observers![0].particleId = "zzz";
    expect(() => solveFieldScene(bad2)).toThrow(/粒子/);
  });
});
