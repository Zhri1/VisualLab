import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assembleScene, buildMotion, validateStagePlan, type StagePlanDraft } from "../index.ts";
import { PHYSICS_RAG_CORPUS } from "../../rag/corpus.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"));
const acceptance = read("conveyor-belt.acceptance.json");
const build = (plan: unknown) => {
  const assembled: any = assembleScene(plan);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled));
  return buildMotion(assembled.scene).motion as any;
};

describe("传送带与滑块：共享基准与变式", () => {
  for (const c of acceptance.cases) {
    it(`${c.id}：对地与相对带面位移、速度、关键事件匹配基准`, () => {
      const motion = build(read(c.readingFile));
      expect(motion.durationSeconds).toBeCloseTo(c.durationSeconds, 9);
      expect(motion.endReason).toBe(c.endReason);
      if (c.commonVelocityTimeSeconds !== undefined) {
        const ev = motion.events.find((e: any) => e.kind === "conveyor_common_velocity");
        expect(ev).toBeDefined();
        expect(ev.timeSeconds).toBeCloseTo(c.commonVelocityTimeSeconds, 9);
      }
      if (c.reslideTimeSeconds !== undefined) {
        const ev = motion.events.find((e: any) => e.kind === "conveyor_reslide");
        expect(ev).toBeDefined();
        expect(ev.timeSeconds).toBeCloseTo(c.reslideTimeSeconds, 9);
      }
      if (c.turnAroundTimeSeconds !== undefined) {
        const ev = motion.events.find((e: any) => e.kind === "turn_around");
        expect(ev).toBeDefined();
        expect(ev.timeSeconds).toBeCloseTo(c.turnAroundTimeSeconds, 9);
      }
      for (const cp of c.checkpoints) {
        const s = motion.sampleAt(cp.timeSeconds);
        const cv = motion.conveyorAt(cp.timeSeconds);
        expect(s.xM).toBeCloseTo(cp.xM, 9);
        expect(s.vxMps).toBeCloseTo(cp.vxMps, 9);
        expect(cv.beltSpeedMps).toBeCloseTo(cp.beltSpeedMps, 9);
        expect(cv.relativeDisplacementM).toBeCloseTo(cp.relativeDisplacementM, 9);
      }
    });
  }

  it("有限带长：滑块在共速前离开带端，发 conveyor_exit 并停止", () => {
    const plan = read("conveyor-uniform.reading.json");
    plan.stages[0].beltLengthM = 0.5;
    // x = 0.5*2*t^2 = 0.5 -> t = sqrt(0.5) ≈ 0.707106781 s, vx = sqrt(2)
    const motion = build(plan);
    expect(motion.endReason).toBe("conveyor_exit");
    expect(motion.durationSeconds).toBeCloseTo(Math.SQRT1_2, 9);
    expect(motion.sampleAt(motion.durationSeconds).vxMps).toBeCloseTo(Math.SQRT2, 9);
    expect(motion.events.some((e: any) => e.kind === "conveyor_common_velocity")).toBe(false);

    // 边界回归 1：从 x=0 向右滑上向左运行的传送带，t=1s 折返，t=2s 从左端 x=0 滑离
    const leftReturn = build({
      kind: "stage_plan", schemaVersion: 1, gravityMps2: 10, initial: { vxMps: 2 },
      stages: [{ kind: "conveyor_belt", initialBeltSpeedMps: -4, segments: [{ accelerationMps2: 0, durationSeconds: 3 }], kineticFrictionCoefficient: 0.2, beltLengthM: 10 }],
    });
    expect(leftReturn.endReason).toBe("conveyor_exit");
    expect(leftReturn.durationSeconds).toBeCloseTo(2, 9);
    expect(leftReturn.sampleAt(2).xM).toBeCloseTo(0, 9);
    expect(leftReturn.sampleAt(2).vxMps).toBeCloseTo(-2, 9);

    // 边界回归 2：恰在分段末刻到达右端 x=L
    const exactEnd = build({
      kind: "stage_plan", schemaVersion: 1, gravityMps2: 10, initial: { vxMps: 2 },
      stages: [{ kind: "conveyor_belt", initialBeltSpeedMps: 2, segments: [{ accelerationMps2: 0, durationSeconds: 2 }], kineticFrictionCoefficient: 0.2, beltLengthM: 4 }],
    });
    expect(exactEnd.endReason).toBe("conveyor_exit");
    expect(exactEnd.durationSeconds).toBeCloseTo(2, 9);
  });

  it("校验：加速带缺 μs 报 NEEDS_INPUT（绝不默认 μs=μk），μs<μk 报 RANGE", () => {
    const missingMus = read("conveyor-accel.reading.json");
    delete missingMus.stages[0].staticFrictionCoefficient;
    const r: any = validateStagePlan(missingMus);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NEEDS_INPUT");
    expect(r.missingKeys).toEqual(["/stages/0/staticFrictionCoefficient"]);

    const badMus = read("conveyor-accel.reading.json");
    badMus.stages[0].staticFrictionCoefficient = 0.1;
    expect((validateStagePlan(badMus) as any).fieldErrors[0]).toMatchObject({ path: "/stages/0/staticFrictionCoefficient", code: "RANGE" });
  });

  it("倾斜传送带（μ ≥ tanθ）：共速后受静摩擦随带匀速至端点，世界坐标按倾角投影", () => {
    // θ = atan(3/4) ≈ 36.8699° (sin=0.6, cos=0.8, tan=0.75)，μ = 0.8 ≥ 0.75
    const angleDeg = Math.atan2(3, 4) * (180 / Math.PI);
    // 1) 向上倾斜传送带：从底端静止放上，a1 = μgcosθ - gsinθ = 0.4 m/s²，t1=5s 共速(v=2, s=5m)，再匀速 1.5s 到 L=8m
    const upMotion = build({
      kind: "stage_plan", schemaVersion: 1, gravityMps2: 10, initial: { vxMps: 0 },
      stages: [{
        kind: "conveyor_belt", angleDeg, inclineDirection: "up", initialBeltSpeedMps: 2,
        segments: [{ accelerationMps2: 0, durationSeconds: 20 }],
        kineticFrictionCoefficient: 0.8, beltLengthM: 8,
      }],
    });
    expect(upMotion.endReason).toBe("conveyor_exit");
    expect(upMotion.durationSeconds).toBeCloseTo(6.5, 6);
    expect(upMotion.events.some((e: any) => e.kind === "conveyor_common_velocity")).toBe(true);
    expect(upMotion.events.some((e: any) => e.kind === "conveyor_reslide")).toBe(false);
    const endUp = upMotion.sampleAt(upMotion.durationSeconds);
    expect(endUp.xM).toBeCloseTo(6.4, 6);
    expect(endUp.yM).toBeCloseTo(4.8, 6);
    expect(Math.hypot(endUp.vxMps, endUp.vyMps)).toBeCloseTo(2, 6);

    // 2) 向下倾斜传送带：μ = 0.8 ≥ 0.75，共速后匀速至底端
    const downMotion = build({
      kind: "stage_plan", schemaVersion: 1, gravityMps2: 10, initial: { vxMps: 0 },
      stages: [{
        kind: "conveyor_belt", angleDeg, inclineDirection: "down", initialBeltSpeedMps: 4,
        segments: [{ accelerationMps2: 0, durationSeconds: 10 }],
        kineticFrictionCoefficient: 0.8, beltLengthM: 10,
      }],
    });
    expect(downMotion.endReason).toBe("conveyor_exit");
    expect(downMotion.events.some((e: any) => e.kind === "conveyor_reslide")).toBe(false);
    const endDown = downMotion.sampleAt(downMotion.durationSeconds);
    expect(endDown.xM).toBeCloseTo(8, 6);
    expect(endDown.yM).toBeCloseTo(-6, 6);
    expect(Math.hypot(endDown.vxMps, endDown.vyMps)).toBeCloseTo(4, 6);
  });

  it("倾斜传送带（μ < tanθ）：向下带共速后摩擦力反向继续加速；向上带共速后继续减速并折返滑离底端", () => {
    const angleDeg = Math.atan2(3, 4) * (180 / Math.PI);
    // 1) 高考经典向下倾斜传送带：sinθ=0.6, cosθ=0.8, μ=0.5 < 0.75, v带=10 m/s, L=16 m
    // a1 = 10 m/s² -> t1=1s 共速(s=5m); 共速后摩擦力反向，a2 = 2 m/s² -> 再走 11m 用时 1s -> 总时长 2s, 离带速率 12 m/s
    const downReslide = build({
      kind: "stage_plan", schemaVersion: 1, gravityMps2: 10, initial: { vxMps: 0 },
      stages: [{
        kind: "conveyor_belt", angleDeg, inclineDirection: "down", initialBeltSpeedMps: 10,
        segments: [{ accelerationMps2: 0, durationSeconds: 10 }],
        kineticFrictionCoefficient: 0.5, beltLengthM: 16,
      }],
    });
    expect(downReslide.endReason).toBe("conveyor_exit");
    expect(downReslide.durationSeconds).toBeCloseTo(2, 6);
    const cvEv = downReslide.events.find((e: any) => e.kind === "conveyor_common_velocity");
    const rsEv = downReslide.events.find((e: any) => e.kind === "conveyor_reslide");
    expect(cvEv?.timeSeconds).toBeCloseTo(1, 6);
    expect(rsEv?.timeSeconds).toBeCloseTo(1, 6);
    const exitState = downReslide.sampleAt(2);
    expect(Math.hypot(exitState.vxMps, exitState.vyMps)).toBeCloseTo(12, 6);
    expect(exitState.xM).toBeCloseTo(12.8, 6);
    expect(exitState.yM).toBeCloseTo(-9.6, 6);

    // 2) 向上倾斜传送带（μ < tanθ）：以 v0=12 m/s 冲上 v带=2 m/s 的带面
    // a1 = -10 m/s² -> t1=1s 共速(s=7m); 共速后摩擦力反向向上，a2 = -2 m/s² -> t=2s 速度为零折返(s=8m) -> t=2+√8 s 滑回底端 s=0
    const upTurn = build({
      kind: "stage_plan", schemaVersion: 1, gravityMps2: 10, initial: { vxMps: 12 },
      stages: [{
        kind: "conveyor_belt", angleDeg, inclineDirection: "up", initialBeltSpeedMps: 2,
        segments: [{ accelerationMps2: 0, durationSeconds: 10 }],
        kineticFrictionCoefficient: 0.5, beltLengthM: 20,
      }],
    });
    expect(upTurn.endReason).toBe("conveyor_exit");
    expect(upTurn.events.find((e: any) => e.kind === "conveyor_common_velocity")?.timeSeconds).toBeCloseTo(1, 6);
    expect(upTurn.events.find((e: any) => e.kind === "conveyor_reslide")?.timeSeconds).toBeCloseTo(1, 6);
    expect(upTurn.events.find((e: any) => e.kind === "turn_around")?.timeSeconds).toBeCloseTo(2, 6);
    expect(upTurn.durationSeconds).toBeCloseTo(2 + Math.sqrt(8), 6);
    expect(upTurn.sampleAt(upTurn.durationSeconds).xM).toBeCloseTo(0, 6);
    expect(upTurn.sampleAt(upTurn.durationSeconds).yM).toBeCloseTo(0, 6);
  });

  it("倾斜传送带校验：非法倾角与非法方向报错", () => {
    const base = read("conveyor-uniform.reading.json");
    const badAngle = structuredClone(base);
    badAngle.stages[0].angleDeg = 90;
    expect((validateStagePlan(badAngle) as any).fieldErrors[0]).toMatchObject({ path: "/stages/0/angleDeg", code: "RANGE" });
    const badDir = structuredClone(base);
    badDir.stages[0].angleDeg = 30;
    badDir.stages[0].inclineDirection = "left";
    expect((validateStagePlan(badDir) as any).fieldErrors[0]).toMatchObject({ path: "/stages/0/inclineDirection", code: "UNSUPPORTED" });
  });

  it("多过程串联（斜面→转向→定长匀速传送带→平抛）且未给 durationSeconds 时正常装配并连续求解", () => {
    const motion = build({
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      initial: { speedMps: 0 },
      stages: [
        { kind: "incline_slide", lengthM: 1, angleDeg: 37, kineticFrictionCoefficient: 0.2, slidesAfterRelease: true },
        { kind: "lossless_turn", lossless: true },
        {
          kind: "conveyor_belt",
          initialBeltSpeedMps: 2,
          beltLengthM: 2,
          kineticFrictionCoefficient: 0.2,
          segments: [{ accelerationMps2: 0, durationSeconds: null }],
        },
        { kind: "projectile", dropHeightM: 1.25 },
      ],
    });
    expect(motion.endReason).toBe("landed");
    expect(motion.events.some((e: any) => e.kind === "conveyor_exit")).toBe(true);
    const end = motion.sampleAt(motion.durationSeconds);
    expect(end.xM).toBeGreaterThan(2.5);
    expect(end.yM).toBeCloseTo(-1.25, 6);
  });
});

function flightPlan(stage: Record<string, unknown> = {}, initialVx = 0): StagePlanDraft {
  return {
    kind: "stage_plan", schemaVersion: 1, gravityMps2: 10,
    initial: { vxMps: initialVx },
    stages: [
      { kind: "conveyor_belt", initialBeltSpeedMps: 2, kineticFrictionCoefficient: 0.2, beltLengthM: 6, ...stage },
      { kind: "projectile", dropHeightM: 1.25 },
    ],
  };
}

describe("实际带端与后续抛体", () => {
  it("指定观察时长内仍在带上，停在原阶段并保留当时速度", () => {
    const motion = build(flightPlan({ segments: [{ accelerationMps2: 0, durationSeconds: 0.5 }] }));
    expect(motion.endReason).toBe("prefix_end");
    expect(motion.durationSeconds).toBe(0.5);
    expect(motion.segments.map(({ kind }: { kind: string }) => kind)).toEqual(["conveyor_belt"]);
    expect(motion.events.map(({ kind }: { kind: string }) => kind)).toEqual(["release", "force_segment_end"]);
    expect(motion.geometry.projectile).toBeUndefined();
    const end = motion.sampleAt(Infinity);
    expect(end.xM).toBeCloseTo(0.25, 12);
    expect(end.vxMps).toBeCloseTo(1, 12);
  });

  it.each([{}, { segments: [{ accelerationMps2: 0, durationSeconds: null }] }])("无观察截止的定长匀速带，求得超过 20 s 的真实离带", segments => {
    const motion = build(flightPlan({ ...segments, initialBeltSpeedMps: 0.1, continuationExitEdge: "end" }));
    const exit = motion.events.find(({ kind }: { kind: string }) => kind === "conveyor_exit");
    expect(exit).toMatchObject({ conveyorExitEdge: "end", position: { xM: 6, yM: 0 } });
    expect(exit.timeSeconds).toBeCloseTo(60.025, 10);
    expect(motion.segments[1].startSeconds).toBe(exit.timeSeconds);
    expect(motion.durationSeconds).toBeCloseTo(60.525, 10);
    expect(motion.endReason).toBe("landed");
    expect(motion.sampleAt(Infinity).xM).toBeCloseTo(6.05, 12);
  });

  it("物块从右端入带后返回同侧，远端接续不误发抛体", () => {
    const motion = build(flightPlan({ initialBeltSpeedMps: 4, entryEdge: "end", continuationExitEdge: "start" }, -2));
    expect(motion.sampleAt(0)).toMatchObject({ xM: 0, yM: 0, vxMps: -2 });
    expect(motion.geometry.conveyor).toMatchObject({ originXM: -6, minXM: 0, maxXM: 6 });
    expect(motion.events.find(({ kind }: { kind: string }) => kind === "turn_around")?.timeSeconds).toBeCloseTo(1, 12);
    const exit = motion.events.at(-1);
    expect(exit).toMatchObject({ kind: "conveyor_exit", conveyorExitEdge: "end", position: { xM: 0, yM: 0 } });
    expect(exit.explanation).toContain("右端");
    expect(motion.durationSeconds).toBeCloseTo(2, 12);
    expect(motion.sampleAt(Infinity).vxMps).toBeCloseTo(2, 12);
    expect(motion.geometry.projectile).toBeUndefined();
    expect(motion.endReason).toBe("conveyor_exit");
  });

  it("到滚轮时速度变零并保持静止，不发离带事件", () => {
    const motion = build(flightPlan({ initialBeltSpeedMps: 0, beltLengthM: 1, continuationExitEdge: "end" }, 2));
    expect(motion.durationSeconds).toBeCloseTo(1, 12);
    expect(motion.sampleAt(Infinity)).toMatchObject({ xM: 1, vxMps: 0 });
    expect(motion.endReason).toBe("stopped");
    expect(motion.events.at(-1)?.kind).toBe("stop");
    expect(motion.events.some(({ kind }: { kind: string }) => kind === "conveyor_exit" || kind === "land")).toBe(false);
  });

  it("实际离带与观察截止同刻时接续抛体", () => {
    const motion = build(flightPlan({
      beltLengthM: 3, continuationExitEdge: "end", segments: [{ accelerationMps2: 0, durationSeconds: 2 }],
    }));
    const exit = motion.events.find(({ kind }: { kind: string }) => kind === "conveyor_exit");
    expect(exit).toMatchObject({ timeSeconds: 2, conveyorExitEdge: "end" });
    expect(motion.events.some(({ kind }: { kind: string }) => kind === "force_segment_end")).toBe(false);
    expect(motion.durationSeconds).toBeCloseTo(2.5, 12);
    expect(motion.endReason).toBe("landed");
  });

  it("RAG #13 的去回程共享固定带端，只在左端真实离带后落地", () => {
    const belt = { kind: "conveyor_belt", initialBeltSpeedMps: -4, beltLengthM: 3, kineticFrictionCoefficient: 0.2 };
    const up = { kind: "incline_slide", direction: "up", lengthM: null, angleDeg: Math.atan2(3, 4) * 180 / Math.PI, kineticFrictionCoefficient: 0 };
    const plan = flightPlan({}, 6);
    plan.stages = [
      { ...belt, entryEdge: "start", continuationExitEdge: "end" }, up,
      { ...belt, entryEdge: "end", continuationExitEdge: "start" }, plan.stages[1],
    ];
    const source = PHYSICS_RAG_CORPUS.find(({ id }) => id === "gk-conveyor-rebound-projectile-13")!;
    expect(source.stageSignature).toEqual(plan.stages.map(({ kind }) => kind));
    const motion = build(plan);
    const [right, left] = motion.events.filter(({ kind }: { kind: string }) => kind === "conveyor_exit");
    expect(right).toMatchObject({ conveyorExitEdge: "end", position: { xM: 3, yM: 0 } });
    expect(right.velocityAfter.vxMps).toBeCloseTo(2 * Math.sqrt(6), 12);
    expect(left).toMatchObject({ conveyorExitEdge: "start", position: { xM: 0, yM: 0 } });
    expect(left.velocityAfter.vxMps).toBeCloseTo(-4, 12);
    expect(motion.durationSeconds - left.timeSeconds).toBeCloseTo(0.5, 12);
    expect(motion.sampleAt(Infinity).xM).toBeCloseTo(-2, 12);
  });

  it("斜面回到右端的滑块在带上再次折返，离开右端时不接左端抛体", () => {
    const plan = flightPlan();
    const belt = plan.stages[0];
    plan.stages = [
      { ...belt, initialBeltSpeedMps: 4, entryEdge: "start", continuationExitEdge: "end" },
      { kind: "incline_slide", direction: "up", lengthM: null, angleDeg: 30, kineticFrictionCoefficient: 0 },
      { ...belt, initialBeltSpeedMps: 4, entryEdge: "end", continuationExitEdge: "start" },
      plan.stages[1],
    ];
    const motion = build(plan);
    const exits = motion.events.filter(({ kind }: { kind: string }) => kind === "conveyor_exit");
    expect(exits.map(({ conveyorExitEdge }: { conveyorExitEdge: string }) => conveyorExitEdge)).toEqual(["end", "end"]);
    const turn = motion.events.find(({ kind }: { kind: string }) => kind === "turn_around");
    expect(motion.sampleAt(turn.timeSeconds).xM).toBeCloseTo(2, 12);
    expect(exits[1].position).toEqual({ xM: 6, yM: 0 });
    expect(motion.sampleAt(Infinity).vxMps).toBeCloseTo(4, 12);
    expect(motion.durationSeconds).toBeCloseTo(8.1, 12);
    expect(motion.endReason).toBe("conveyor_exit");
    expect(motion.geometry.projectile).toBeUndefined();
  });

  it("RAG #14 镜像题仍为相向运动，滑块从右端以 2√5 m/s 离开", () => {
    const plan = flightPlan();
    plan.initial = { speedMps: 0 };
    plan.stages.unshift(
      { kind: "incline_slide", direction: "down", lengthM: 3.6, angleDeg: 30, kineticFrictionCoefficient: 0, slidesAfterRelease: true },
      { kind: "lossless_turn", lossless: true },
    );
    plan.stages[2] = { ...plan.stages[2], initialBeltSpeedMps: -2, beltLengthM: 4, entryEdge: "start", continuationExitEdge: "end" };
    const source = PHYSICS_RAG_CORPUS.find(({ id }) => id === "gk-incline-conveyor-projectile-14")!;
    expect(source.stem).toContain("以 v_带 = 2 m/s 向左匀速运行");
    expect(source.stageSignature).toEqual(plan.stages.map(({ kind }) => kind));
    const motion = build(plan);
    const exit = motion.events.find(({ kind }: { kind: string }) => kind === "conveyor_exit");
    expect(exit.conveyorExitEdge).toBe("end");
    expect(exit.velocityAfter.vxMps).toBeCloseTo(2 * Math.sqrt(5), 12);
    expect(motion.sampleAt(Infinity).xM).toBeCloseTo(4 + Math.sqrt(5), 12);
  });

  it("显式带端要求带长，未知端点值不通过共享校验", () => {
    expect(validateStagePlan(flightPlan({ beltLengthM: null, continuationExitEdge: "end" }))).toMatchObject({
      ok: false, missingKeys: expect.arrayContaining(["/stages/0/beltLengthM"]),
    });
    expect(validateStagePlan(flightPlan({ entryEdge: "middle" }))).toMatchObject({
      ok: false, code: "UNSUPPORTED", fieldErrors: expect.arrayContaining([expect.objectContaining({ path: "/stages/0/entryEdge" })]),
    });
  });
});
