import { describe, expect, it } from "vitest";
import { assembleStageScene, buildStageMotion } from "../../physics/index.ts";
import { PHYSICS_RAG_CORPUS } from "../corpus.ts";
import stickyPendulum from "../../../fixtures/pendulum-sticky.reading.json";

const base = { kind: "stage_plan", schemaVersion: 1, gravityMps2: 10 };

function build<T extends { stages: { kind: string }[] }>(id: string, plan: T) {
  const entry = PHYSICS_RAG_CORPUS.find((item) => item.id === id);
  expect(plan.stages.map((stage) => stage.kind)).toEqual(entry?.stageSignature);
  const assembled = assembleStageScene(plan);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled));
  return buildStageMotion(assembled.scene).motion;
}

describe("母题提示的阶段组合可通过正式装配和求解", () => {
  it("第 17 题按精确切向入口进入圆弧，完整圆轨最高点支持力为零", () => {
    const angleDeg = Math.atan2(4, 3) * 180 / Math.PI;
    const motion = build("gk-projectile-tangent-arc-loop-17", {
      ...base, massKg: 1, initial: { vxMps: 3, vyMps: 0 },
      stages: [
        { kind: "projectile", end: { kind: "tangent_to_next_arc" } },
        { kind: "vertical_arc", radiusM: 1, side: "inside", frictionless: true, path: {
          startAngleDeg: -angleDeg, direction: "positive", end: { kind: "physical_endpoint", sweepAngleDeg: angleDeg },
        } },
        { kind: "horizontal_slide", kineticFrictionCoefficient: 0.2, end: { kind: "distance", distanceM: 2 } },
        { kind: "vertical_arc", radiusM: 0.5, side: "inside", frictionless: true, path: {
          startAngleDeg: 0, direction: "positive", end: { kind: "observation", sweepAngleDeg: 360 },
        } },
      ],
    });
    const [arc, loop] = motion.events.filter((event) => event.kind === "arc_enter");
    const top = motion.events.find((event) => event.kind === "arc_top")!;
    expect(motion.sampleAt(0).yM - arc.position!.yM).toBeCloseTo(0.8, 10);
    expect(loop.velocityAfter.vxMps).toBeCloseTo(5, 10);
    expect(motion.sampleAt(top.timeSeconds).constraint?.normalForceN).toBe(0);
    expect(motion.events.slice(-2).map((event) => event.kind)).toEqual(["arc_lowest", "arc_range_end"]);
  });

  it("第 22 题离槽后先滑到桌沿，再开始平抛", () => {
    const motion = build("gk-movable-arc-recoil-projectile-22", {
      ...base, massKg: 1, initial: { speedMps: 0 },
      stages: [
        { kind: "movable_arc", radiusM: 0.6, grooveMassKg: 2, exitDirection: -1 },
        { kind: "horizontal_slide", kineticFrictionCoefficient: 0, end: { kind: "distance", distanceM: 0.2 } },
        { kind: "projectile", dropHeightM: 1.25 },
      ],
    });
    const exit = motion.events.find((event) => event.kind === "movable_arc_exit")!;
    const launch = motion.events.find((event) => event.kind === "leave_table")!;
    const launchXM = motion.sampleAt(launch.timeSeconds).xM;
    expect(motion.sampleAt(exit.timeSeconds).xM).toBeCloseTo(-0.4, 10);
    expect(launchXM).toBeCloseTo(-0.6, 10);
    expect(launch.timeSeconds).toBeGreaterThan(exit.timeSeconds);
    expect(launchXM - motion.sampleAt(Infinity).xM).toBeCloseTo(Math.SQRT2, 10);
  });

  it("第 26 题粘连共用顶层继承摆，求到真实松绳边界", () => {
    const plan = structuredClone(stickyPendulum);
    Object.assign(plan.stages[0], { lengthM: 0.8, initialAngleDeg: -90 });
    plan.stages[1].targetApproach!.velocityXMps = -14;
    const motion = build("gk-pendulum-inelastic-slack-26", plan);
    const slack = motion.events.find((event) => event.kind === "string_slack")!;
    const state = motion.sampleAt(slack.timeSeconds);
    expect(motion.endReason).toBe("string_slack");
    expect(slack.timeSeconds).toBeCloseTo(0.950559, 6);
    expect(state.constraints!["string:bob"].tensionN).toBe(0);
    expect((state.bodies!.bob.yM - 0.8) / 0.8).toBeCloseTo(0.375, 10);
    expect(state.bodies!.bob.groupId).toBe(state.bodies!.target.groupId);
  });

  it.each([
    ["gk-pulley-horizontal-table-31", 3, 2, { kind: "horizontal", kineticFrictionCoefficient: 0.2 }, 14.4, 1.96],
    ["gk-pulley-incline-slack-32", 2, 3, { kind: "incline", angleDeg: Math.atan2(3, 4) * 180 / Math.PI, kineticFrictionCoefficient: 0.25 }, 21.6, 0.49],
  ] as const)("%s 起动事实和着地后续滑可由正式入口计算", (id, m1, m2, surface, tension, distance) => {
    const motion = build(id, {
      ...base, initial: { speedMps: 0 },
      bodies: [{ bodyId: "A", massKg: m1 }, { bodyId: "B", massKg: m2 }], primaryBodyId: "A",
      stages: [{
        kind: "pulley_system", body1Id: "A", body2Id: "B", surface: { ...surface, slidesAfterRelease: true },
        lightInextensibleString: true, idealFixedPulley: true, body2DropToGroundM: 1.4,
      }],
    });
    const ground = motion.events.find((event) => event.kind === "body2_ground_hit")!;
    const start = ground.bodyStatesBefore!.A;
    const end = motion.sampleAt(Infinity).bodies!.A;
    expect(ground.timeSeconds).toBeCloseTo(1, 10);
    expect(ground.constraintsBefore!["pulley-string"].tensionN).toBeCloseTo(tension, 10);
    expect(ground.bodyStatesBefore!.B.vyMps).toBeCloseTo(-2.8, 10);
    expect(Math.hypot(end.xM - start.xM, end.yM - start.yM)).toBeCloseTo(distance, 10);
  });
});
