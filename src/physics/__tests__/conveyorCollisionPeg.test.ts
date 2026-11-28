import { describe, it, expect } from "vitest";
import { validateStagePlan } from "../stagePlan";
import { computeMultiBodyMotion } from "../multiBodyMotion";
import { validateStagePlan as validateQoder } from "../../../functions/stagePlan";
import { motionLibrary } from "../../adapters";
import { drawMultiBodyScene } from "../../ui/components/workspace/MultiBodyPhysicsCanvas";
import hubeiFixture from "../../../fixtures/conveyor-collision-peg-critical.reading.json";

const computeStageMotion = computeMultiBodyMotion;

describe("水平传送带入碰 + 题给碰后速度 + 同高侧向钉子变支点", () => {
  it("原题验收（2024 湖北物理第14题）：临界反求最小 OP=0.20 m、碰撞 1.22 s、能量损失 0.30 J、碰钉连续与顶点临界零张力", () => {
    const vNode = validateStagePlan(hubeiFixture);
    const vQoder = validateQoder(hubeiFixture);
    expect(vNode.ok).toBe(true);
    expect(vQoder.ok).toBe(true);
    if (!vNode.ok) return;

    const motion = computeStageMotion(vNode.reading);
    expect("ok" in motion).toBe(false);
    if ("ok" in motion) return;

    // 1. 传送带共速与首次碰撞
    const common = motion.events.find((e) => e.kind === "conveyor_common_velocity");
    expect(common?.timeSeconds).toBeCloseTo(1.0, 9);
    expect(common?.bodyStatesAfter?.block.xM).toBeCloseTo(2.5, 9);

    const coll = motion.events.find((e) => e.kind === "collision");
    expect(coll).toBeDefined();
    expect(coll!.timeSeconds).toBeCloseTo(1.22, 9);
    expect(coll!.bodyStatesBefore?.block.vxMps).toBeCloseTo(5.0, 9);
    expect(coll!.bodyStatesBefore?.bob.vxMps).toBeCloseTo(0, 9);
    expect(coll!.bodyStatesAfter?.block.vxMps).toBeCloseTo(-1.0, 9);
    expect(coll!.bodyStatesAfter?.bob.vxMps).toBeCloseTo(3.0, 9);
    expect(coll!.collision?.energyLostJ).toBeCloseTo(0.30, 9);

    // 2. 碰钉时刻：绳水平，位置与速度连续，支点从 O(3.6, 0.3) 切换至 P(3.8, 0.3)，半径从 0.3 缩为 0.1
    const pegEv = motion.events.find((e) => e.kind === "peg_contact");
    expect(pegEv).toBeDefined();
    expect(pegEv!.bodyStatesBefore?.bob.xM).toBeCloseTo(3.9, 9);
    expect(pegEv!.bodyStatesBefore?.bob.yM).toBeCloseTo(0.3, 9);
    expect(pegEv!.bodyStatesAfter?.bob.xM).toBeCloseTo(3.9, 9);
    expect(pegEv!.bodyStatesAfter?.bob.yM).toBeCloseTo(0.3, 9);
    expect(pegEv!.bodyStatesBefore?.bob.vxMps).toBeCloseTo(0, 9);
    expect(pegEv!.bodyStatesBefore?.bob.vyMps).toBeCloseTo(Math.sqrt(3), 9);
    expect(pegEv!.bodyStatesAfter?.bob.vxMps).toBeCloseTo(0, 9);
    expect(pegEv!.bodyStatesAfter?.bob.vyMps).toBeCloseTo(Math.sqrt(3), 9);
    expect(pegEv!.constraintsBefore?.["string:bob"].pivot.xM).toBeCloseTo(3.6, 9);
    expect(pegEv!.constraintsBefore?.["string:bob"].lengthM).toBeCloseTo(0.3, 9);
    expect(pegEv!.constraintsBefore?.["string:bob"].tensionN).toBeCloseTo(2.0, 9);
    expect(pegEv!.constraintsAfter?.["string:bob"].pivot.xM).toBeCloseTo(3.8, 9);
    expect(pegEv!.constraintsAfter?.["string:bob"].lengthM).toBeCloseTo(0.1, 9);
    expect(pegEv!.constraintsAfter?.["string:bob"].tensionN).toBeCloseTo(6.0, 9);

    // 3. 钉子正上方最高点：v = 1.0 m/s，T = 0 N
    const topEv = motion.events.find((e) => e.kind === "pendulum_top");
    expect(topEv).toBeDefined();
    expect(topEv!.bodyStatesAfter?.bob.xM).toBeCloseTo(3.8, 9);
    expect(topEv!.bodyStatesAfter?.bob.yM).toBeCloseTo(0.4, 9);
    expect(topEv!.bodyStatesAfter?.bob.vxMps).toBeCloseTo(-1.0, 9);
    expect(topEv!.bodyStatesAfter?.bob.vyMps).toBeCloseTo(0, 9);
    expect(topEv!.constraintsAfter?.["string:bob"].tensionN).toBeCloseTo(0, 9);
    expect(motion.endReason).toBe("pendulum_peg_top");

    // 4. 派生计算表包含最小 OP = 0.20 m、新半径 0.10 m、顶点速度 1.0 m/s、碰钉速度 √3
    const calc = (q: string) => motion.calculations?.find((c) => c.quantity === q)?.value;
    expect(calc("collision_energy_lost")).toBeCloseTo(0.30, 9);
    expect(calc("post_collision_speed")).toBeCloseTo(3.0, 9);
    expect(calc("peg_contact_speed")).toBeCloseTo(Math.sqrt(3), 9);
    expect(calc("peg_min_offset")).toBeCloseTo(0.20, 9);
    expect(calc("peg_effective_radius")).toBeCloseTo(0.10, 9);
    expect(calc("peg_top_speed")).toBeCloseTo(1.0, 9);
    expect(calc("peg_top_tension")).toBeCloseTo(0, 9);

    // 5. 物块反弹后受带面摩擦，在 t = 1.42 s 折返，与摆共用同一时钟，且绝不生成虚构落地
    const turnEv = motion.events.find((e) => e.kind === "turn_around");
    expect(turnEv).toBeDefined();
    expect(turnEv!.timeSeconds).toBeCloseTo(1.42, 9);
    expect(turnEv!.bodyStatesAfter?.block.xM).toBeCloseTo(3.5, 9);
    expect(turnEv!.bodyStatesAfter?.block.vxMps).toBeCloseTo(0, 9);
    expect(motion.events.some((e) => e.kind === "land")).toBe(false);

    // 6. 适配器与双体画布可无异常绘制
    const assembled = motionLibrary.assembleScene(vNode.reading);
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    const built = motionLibrary.buildMotion(assembled.scene);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const ctx = new Proxy({}, { get: (_t, key) => (key === "measureText" ? () => ({ width: 50 }) : () => {}) }) as CanvasRenderingContext2D;
    expect(() => drawMultiBodyScene(ctx, 640, 360, built.motion, 0)).not.toThrow();
    expect(() => drawMultiBodyScene(ctx, 640, 360, built.motion, pegEv!.timeSeconds)).not.toThrow();
    expect(() => drawMultiBodyScene(ctx, 640, 360, built.motion, built.motion.durationSeconds)).not.toThrow();
  });

  it("显式钉距大于临界值（OP = 0.22 m）：新半径 0.08 m，顺利过顶点且 T_top > 0", () => {
    const variant = structuredClone(hubeiFixture) as Record<string, unknown>;
    const stages = variant.stages as Record<string, unknown>[];
    const tracks = stages[2].tracks as { bodyIds: string[]; stages: Record<string, unknown>[] }[];
    tracks[1].stages[0].peg = { side: "right", offsetXM: 0.22 };

    const vNode = validateStagePlan(variant);
    const vQoder = validateQoder(variant);
    expect(vNode.ok).toBe(true);
    expect(vQoder.ok).toBe(true);
    if (!vNode.ok) return;

    const motion = computeStageMotion(vNode.reading);
    if ("ok" in motion) throw new Error(motion.message);
    const topEv = motion.events.find((e) => e.kind === "pendulum_top");
    expect(topEv).toBeDefined();
    // r = 0.08, v_top = sqrt(3 - 2*10*0.08) = sqrt(1.4), T_top = 0.2*(1.4/0.08 - 10) = 1.5 N
    expect(Math.abs(topEv!.bodyStatesAfter!.bob.vxMps)).toBeCloseTo(Math.sqrt(1.4), 8);
    expect(topEv!.constraintsAfter?.["string:bob"].tensionN).toBeCloseTo(1.5, 8);
    expect(motion.endReason).toBe("pendulum_peg_top");
  });

  it("显式钉距小于临界值（OP = 0.15 m < 0.20 m）：如实提前松绳（string_slack），绝不画到顶点", () => {
    const variant = structuredClone(hubeiFixture) as Record<string, unknown>;
    const stages = variant.stages as Record<string, unknown>[];
    const tracks = stages[2].tracks as { bodyIds: string[]; stages: Record<string, unknown>[] }[];
    tracks[1].stages[0].peg = { side: "right", offsetXM: 0.15 };

    const vNode = validateStagePlan(variant);
    const vQoder = validateQoder(variant);
    expect(vNode.ok).toBe(true);
    expect(vQoder.ok).toBe(true);
    if (!vNode.ok) return;

    const motion = computeStageMotion(vNode.reading);
    if ("ok" in motion) throw new Error(motion.message);

    expect(motion.events.some((e) => e.kind === "peg_contact")).toBe(true);
    expect(motion.events.some((e) => e.kind === "pendulum_top")).toBe(false);
    const slackEv = motion.events.find((e) => e.kind === "string_slack");
    expect(slackEv).toBeDefined();
    expect(motion.endReason).toBe("string_slack");
    // r = 0.15, rho = 3/(10*0.15) = 2.0, sin(u_slack) = 2/3, y_slack = 0.3 + 0.15*(2/3) = 0.40 m < 0.45 m (顶点高度)
    expect(slackEv!.bodyStatesAfter!.bob.yM).toBeCloseTo(0.40, 8);
    expect(slackEv!.constraintsAfter?.["string:bob"].tensionN).toBeCloseTo(0, 9);
    expect(slackEv!.constraintsAfter?.["string:bob"].state).toBe("slack");
  });

  it("all_finite_tracks 播放至物块离开传送带（t = 1.62 s）且不生成虚构落地", () => {
    const variant = structuredClone(hubeiFixture) as Record<string, unknown>;
    const stages = variant.stages as Record<string, unknown>[];
    stages[2].end = { kind: "all_finite_tracks" };

    const vNode = validateStagePlan(variant);
    expect(vNode.ok).toBe(true);
    if (!vNode.ok) return;
    const motion = computeStageMotion(vNode.reading);
    if ("ok" in motion) throw new Error(motion.message);

    expect(motion.durationSeconds).toBeCloseTo(1.62, 8);
    expect(motion.endReason).toBe("conveyor_exit");
    expect(motion.events.some((e) => e.kind === "conveyor_exit")).toBe(true);
    expect(motion.events.some((e) => e.kind === "land")).toBe(false);
  });

  it("题给碰后速度超弹性或穿模时两端均报 PRECONDITION_CONFLICT", () => {
    const superElastic = structuredClone(hubeiFixture) as Record<string, unknown>;
    ((superElastic.stages as Record<string, unknown>[])[1].knownPostVelocity as Record<string, unknown>).vxMps = -3;
    const rNode = validateStagePlan(superElastic);
    const rQoder = validateQoder(superElastic);
    expect(rNode.ok).toBe(false);
    expect(rQoder.ok).toBe(false);
    if (!rNode.ok && !rQoder.ok) {
      expect(rNode.code).toBe("INCONSISTENT_CONDITIONS");
      expect(rQoder.code).toBe("INCONSISTENT_CONDITIONS");
    }
  });
});
