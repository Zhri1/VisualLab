import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  solveMovableArc,
  solveMovableArcBottom,
  movableArcCriticalEntrySpeed,
  validateStagePlan,
  assembleStageScene,
  type MovableArcStage,
} from "../index.ts";
import { buildPlanResponse } from "../../api/validate.ts";

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

  it("顶入模式校验：独立 movable_arc 拒绝非零 initial.speedMps（PRECONDITION_CONFLICT），保留 0 初速", () => {
    const bad = validateStagePlan({
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      massKg: 1,
      initial: { speedMps: 5 },
      stages: [{ kind: "movable_arc", radiusM: 0.6, grooveMassKg: 3 }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.code).toBe("INCONSISTENT_CONDITIONS");
      expect(bad.fieldErrors.some((e) => e.path === "/initial/speedMps" && e.code === "PRECONDITION_CONFLICT")).toBe(true);
    }

    const ok = validateStagePlan({
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      massKg: 1,
      initial: { speedMps: 0 },
      stages: [{ kind: "movable_arc", radiusM: 0.6, grooveMassKg: 3 }],
    });
    expect(ok.ok).toBe(true);
    const scene = assembleStageScene({
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      massKg: 1,
      initial: { speedMps: 0 },
      stages: [{ kind: "movable_arc", radiusM: 0.6, grooveMassKg: 3 }],
    });
    expect(scene.ok).toBe(true);
    if (scene.ok) {
      expect(scene.scene.motion.sampleAt(0).vxMps).toBe(0);
      expect(scene.scene.motion.sampleAt(1e-6).vxMps).toBeCloseTo(0, 3);
    }
  });
});

describe("底入可动四分之一圆弧槽与多体弹性碰撞接续", () => {
  it("底入临界到顶相对静止（m=1, M=4, R=0.8, g=10）：守恒律、对称返回与槽底压力 3.5mg", () => {
    const mB = 1;
    const mC = 4;
    const R = 0.8;
    const grav = 10;
    const vCrit = movableArcCriticalEntrySpeed(R, mB, mC, grav);
    expect(vCrit).toBeCloseTo(Math.sqrt(20), 10);

    const sol = solveMovableArcBottom(
      { kind: "movable_arc", entryMode: "bottom", radiusM: R, grooveMassKg: mC, entryDirection: 1, criticalTopRelativeRest: true },
      { xM: 0, yM: 0 },
      vCrit,
      mB,
      grav,
    );
    expect(sol.outcome).toBe("critical_top_return");
    expect(sol.events.map((e) => e.kind)).toEqual(["movable_arc_top", "movable_arc_return_exit"]);

    // 到顶时刻：高度 = R，球槽共速 = m/(m+M) v0 = 0.2 v0
    const topEv = sol.events[0];
    expect(topEv.yM).toBeCloseTo(R, 9);
    expect(topEv.vxMps).toBeCloseTo(0.2 * vCrit, 9);
    expect(topEv.vyMps).toBeCloseTo(0, 9);

    // 返回槽底分离：vB2 = -3/5 v0，vC2 = 2/5 v0，槽底支持力 N = mg + m v0²/R = 3.5 mg = 35 N
    expect(sol.exit.vxMps).toBeCloseTo((-3 / 5) * vCrit, 9);
    expect(sol.exit.grooveVX).toBeCloseTo((2 / 5) * vCrit, 9);
    expect(sol.exit.vyMps).toBeCloseTo(0, 9);
    expect(sol.bottomReturnNormalForceN).toBeCloseTo(3.5 * mB * grav, 9);

    // 全程动量守恒与机械能守恒
    const p0 = mB * vCrit;
    const e0 = 0.5 * mB * vCrit * vCrit;
    for (const f of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const s = sol.at(sol.durationSeconds * f);
      expect(mB * s.vxMps + mC * s.grooveVX).toBeCloseTo(p0, 8);
      const ke = 0.5 * mB * (s.vxMps ** 2 + s.vyMps ** 2) + 0.5 * mC * s.grooveVX ** 2;
      expect(ke + mB * grav * s.yM).toBeCloseTo(e0, 7);
    }
  });

  it("多体组合样例（图3：A:B:C = 2:1:4，未知弹簧 k/压缩量/间距）：反求 Ep=45/32 mgR、suffix 模式与同钟同步", () => {
    const raw = JSON.parse(readFileSync(resolve("fixtures/spring-collision-movable-arc.reading.json"), "utf8"));
    const v = validateStagePlan(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.playback?.mode).toBe("suffix");
    expect(v.playback?.unresolvedKeys.length).toBeGreaterThan(0);

    const built = assembleStageScene(raw);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { motion } = built.scene;
    expect(motion.timing?.mode).toBe("suffix");
    expect(motion.endReason).toBe("movable_arc_return_exit");

    const vB1 = Math.sqrt(20);
    const vA0 = (3 / 4) * vB1;
    const ep = (45 / 32) * 1 * 10 * 0.8; // 11.25 J
    expect(motion.calculations?.find((c) => c.quantity === "initial_elastic_energy")?.value).toBeCloseTo(ep, 8);
    expect(motion.calculations?.find((c) => c.quantity === "movable_arc_bottom_normal_force")?.value).toBeCloseTo(35, 8);

    // 碰撞瞬间前后位置连续、冲量更新正确
    const pre = motion.sampleAt(-1e-6);
    const post = motion.sampleAt(0);
    expect(pre.bodies?.A.vxMps).toBeCloseTo(vA0, 8);
    expect(pre.bodies?.B.vxMps).toBeCloseTo(0, 8);
    expect(post.bodies?.A.xM).toBeCloseTo(0, 9);
    expect(post.bodies?.B.xM).toBeCloseTo(0, 9);
    expect(post.bodies?.A.vxMps).toBeCloseTo(0.25 * vB1, 8);
    expect(post.bodies?.B.vxMps).toBeCloseTo(vB1, 8);

    // 末态：B 首次分离槽底，槽 C 读数同步；因碰撞点到槽底间距未知，输出显式缺口且 A 仅保留确定速度而不编造相对槽坐标
    expect(motion.playbackGaps).toHaveLength(1);
    expect(motion.events.some((e) => e.kind === "movable_arc_gap")).toBe(true);
    expect(motion.timing?.anchor.label).toBe("槽底入口");
    const end = motion.sampleAt(motion.durationSeconds);
    const grooveEnd = motion.movableArcAt?.(motion.durationSeconds);
    expect(end.bodies?.B.vxMps).toBeCloseTo((-3 / 5) * vB1, 8);
    expect(grooveEnd?.grooveVX).toBeCloseTo((2 / 5) * vB1, 8);
    expect(end.bodies?.A.vxMps).toBeCloseTo(0.25 * vB1, 8);
    expect(end.bodies?.A.positionUndetermined).toBe(true);

    // API 规范化回包（buildPlanResponse → assembleStageScene）再次装配后，缺口、后缀说明与物理量不丢失
    const apiRes = buildPlanResponse(raw);
    expect(apiRes.status).toBe("ok");
    if (apiRes.status === "ok") {
      const rebuilt = assembleStageScene(apiRes.reading);
      expect(rebuilt.ok).toBe(true);
      if (rebuilt.ok) {
        expect(rebuilt.scene.motion.timing?.mode).toBe("suffix");
        expect(rebuilt.scene.motion.playbackGaps).toHaveLength(1);
        expect(rebuilt.scene.motion.events.some((e) => e.kind === "movable_arc_gap")).toBe(true);
        expect(rebuilt.scene.motion.calculations?.find((c) => c.quantity === "initial_elastic_energy")?.value).toBeCloseTo(ep, 8);
        expect(rebuilt.scene.motion.calculations?.find((c) => c.quantity === "movable_arc_bottom_normal_force")?.value).toBeCloseTo(35, 8);
        expect(rebuilt.scene.motion.sampleAt(rebuilt.scene.motion.durationSeconds).bodies?.A.positionUndetermined).toBe(true);
      }
    }
  });

  it("显式 entryGapM = 0 表示碰撞恰在槽底：无播放缺口，两物体同钟精确位置", () => {
    const vB1 = movableArcCriticalEntrySpeed(0.8, 1, 4, 10);
    const vA0 = (3 / 4) * vB1;
    const plan = {
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      bodies: [
        { bodyId: "A", massKg: 2 },
        { bodyId: "B", massKg: 1 },
      ],
      primaryBodyId: "B",
      initial: {
        bodies: [
          { bodyId: "A", xM: 0, vxMps: vA0 },
          { bodyId: "B", xM: 0, vxMps: 0 },
        ],
      },
      stages: [
        {
          kind: "horizontal_approach",
          tracks: [
            { bodyId: "A", kineticFrictionCoefficient: 0 },
            { bodyId: "B", kineticFrictionCoefficient: 0 },
          ],
          end: { kind: "contact_or_rest" },
        },
        {
          kind: "collision_1d",
          bodyIds: ["A", "B"],
          mode: "elastic",
          normalXM: 1,
          contact: { kind: "horizontal_meeting", approachStageIndex: 0 },
          externalImpulseNegligible: true,
        },
        {
          kind: "parallel_motion",
          tracks: [
            { bodyIds: ["A"], stages: [{ kind: "horizontal_slide", kineticFrictionCoefficient: 0, end: { kind: "scene_end" } }] },
            { bodyIds: ["B"], stages: [{ kind: "movable_arc", entryMode: "bottom", radiusM: 0.8, grooveMassKg: 4, entryGapM: 0 }] },
          ],
          end: { kind: "all_finite_tracks" },
        },
      ],
    };
    const built = assembleStageScene(plan);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.scene.motion.playbackGaps).toBeUndefined();
    expect(built.scene.motion.events.some((e) => e.kind === "movable_arc_gap")).toBe(false);
    const end = built.scene.motion.sampleAt(built.scene.motion.durationSeconds);
    expect(end.bodies?.A.positionUndetermined).toBeUndefined();
    expect(end.bodies?.A.xM).toBeCloseTo(0.25 * vB1 * built.scene.motion.durationSeconds, 7);
  });

  it("第二组参数验证（A:B:C = 3:2:5，R=1.2 m，g=9.8 m/s²，显式初位与入槽间距）", () => {
    const mA = 3;
    const mB = 2;
    const mC = 5;
    const R = 1.2;
    const grav = 9.8;
    const vB1 = movableArcCriticalEntrySpeed(R, mB, mC, grav);
    const vA0 = ((mA + mB) / (2 * mA)) * vB1;
    const plan = {
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: grav,
      bodies: [
        { bodyId: "A", massKg: mA },
        { bodyId: "B", massKg: mB },
      ],
      primaryBodyId: "B",
      initial: {
        bodies: [
          { bodyId: "A", xM: 0, vxMps: vA0 },
          { bodyId: "B", xM: 1, vxMps: 0 },
        ],
      },
      stages: [
        {
          kind: "horizontal_approach",
          tracks: [
            { bodyId: "A", kineticFrictionCoefficient: 0 },
            { bodyId: "B", kineticFrictionCoefficient: 0 },
          ],
          end: { kind: "contact_or_rest" },
        },
        {
          kind: "collision_1d",
          bodyIds: ["A", "B"],
          mode: "elastic",
          contact: { kind: "horizontal_meeting", approachStageIndex: 0 },
          externalImpulseNegligible: true,
        },
        {
          kind: "parallel_motion",
          tracks: [
            { bodyIds: ["A"], stages: [{ kind: "horizontal_slide", kineticFrictionCoefficient: 0, end: { kind: "scene_end" } }] },
            { bodyIds: ["B"], stages: [{ kind: "movable_arc", entryMode: "bottom", radiusM: R, grooveMassKg: mC, entryGapM: 0.5 }] },
          ],
          end: { kind: "all_finite_tracks" },
        },
      ],
    };
    const built = assembleStageScene(plan);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { motion } = built.scene;
    expect(motion.timing).toBeUndefined(); // 完整已知参数，非 suffix
    const end = motion.sampleAt(motion.durationSeconds);
    const grooveEnd = motion.movableArcAt?.(motion.durationSeconds);
    expect(end.bodies?.B.vxMps).toBeCloseTo(((mB - mC) / (mB + mC)) * vB1, 7);
    expect(grooveEnd?.grooveVX).toBeCloseTo(((2 * mB) / (mB + mC)) * vB1, 7);
    expect(motion.calculations?.find((c) => c.quantity === "movable_arc_bottom_normal_force")?.value).toBeCloseTo(mB * (grav + (vB1 * vB1) / R), 7);
  });
});
