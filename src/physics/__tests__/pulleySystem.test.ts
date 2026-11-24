import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assembleScene, buildMotion, validateStagePlan } from "../index.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"));
const acceptance = read("pulley-system.acceptance.json");
const build = (plan: unknown) => {
  const assembled: any = assembleScene(plan);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled));
  return buildMotion(assembled.scene).motion as any;
};

describe("轻绳与理想定滑轮连接体：共享基准与约束切换", () => {
  for (const c of acceptance.cases) {
    it(`${c.id}：张力、加速度、末态与事件匹配独立基准`, () => {
      const motion = build(read(c.readingFile));
      expect(motion.durationSeconds).toBeCloseTo(c.durationSeconds, 9);
      expect(motion.endReason).toBe(c.endReason);
      const s0 = motion.sampleAt(0);
      expect(s0.constraints["pulley-string"].tensionN).toBeCloseTo(c.tautTensionN, 9);
      expect(s0.constraints["pulley-string"].tensionN).toBeGreaterThanOrEqual(0);
      const b1Id = motion.geometry.pulley.body1Id;
      const b2Id = motion.geometry.pulley.body2Id;
      const sEnd = motion.sampleAt(motion.durationSeconds);
      expect(Math.hypot(sEnd.bodies[b1Id].vxMps, sEnd.bodies[b1Id].vyMps)).toBeCloseTo(c.finalBody1SpeedMps, 9);
      expect(Math.hypot(sEnd.bodies[b2Id].vxMps, sEnd.bodies[b2Id].vyMps)).toBeCloseTo(c.finalBody2SpeedMps, 9);
      if (c.groundHitTimeSeconds !== undefined) {
        const hit = motion.events.find((e: any) => e.kind === "body2_ground_hit");
        const slack = motion.events.find((e: any) => e.kind === "string_slack");
        expect(hit).toBeDefined();
        expect(slack).toBeDefined();
        expect(hit.timeSeconds).toBeCloseTo(c.groundHitTimeSeconds, 9);
        expect(slack.timeSeconds).toBeCloseTo(c.groundHitTimeSeconds, 9);
        expect(sEnd.constraints["pulley-string"].state).toBe("slack");
        expect(sEnd.constraints["pulley-string"].tensionN).toBe(0);
      }
      if (c.finalBody1TotalSlideM !== undefined) {
        const dx = Math.hypot(sEnd.bodies[b1Id].xM - s0.bodies[b1Id].xM, sEnd.bodies[b1Id].yM - s0.bodies[b1Id].yM);
        expect(dx).toBeCloseTo(c.finalBody1TotalSlideM, 9);
      }
      if (c.finalDisplacementM !== undefined) {
        const dx1 = Math.hypot(sEnd.bodies[b1Id].xM - s0.bodies[b1Id].xM, sEnd.bodies[b1Id].yM - s0.bodies[b1Id].yM);
        const dx2 = Math.hypot(sEnd.bodies[b2Id].xM - s0.bodies[b2Id].xM, sEnd.bodies[b2Id].yM - s0.bodies[b2Id].yM);
        expect(dx1).toBeCloseTo(c.finalDisplacementM, 9);
        expect(dx2).toBeCloseTo(c.finalDisplacementM, 9);
      }
    });
  }

  it("拉紧时等速率与等位移约束全程成立，着地邻域 T 从 15 N 切换为 0 N", () => {
    const motion = build(read("pulley-ground-slack.reading.json"));
    const before = motion.sampleAt(0.8 - 1e-6);
    const after = motion.sampleAt(0.8 + 1e-6);
    expect(before.constraints["pulley-string"].tensionN).toBeCloseTo(15, 6);
    expect(before.bodies.block.vxMps).toBeCloseTo(-before.bodies.hanging.vyMps, 6);
    expect(after.constraints["pulley-string"].state).toBe("slack");
    expect(after.constraints["pulley-string"].tensionN).toBe(0);
    expect(after.bodies.hanging.vyMps).toBe(0);
    expect(after.bodies.block.vxMps).toBeCloseTo(4, 3);
  });

  it("校验：粗糙支承缺 μs 且缺 slidesAfterRelease 报 NEEDS_INPUT（绝不默认 μs=μk），矛盾报冲突", () => {
    const missing = read("pulley-horizontal.reading.json");
    delete missing.stages[0].surface.slidesAfterRelease;
    const r: any = validateStagePlan(missing);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NEEDS_INPUT");
    expect(r.missingKeys).toEqual(["/stages/0/surface/staticFrictionCoefficient"]);

    const conflict = read("pulley-incline-hold.reading.json");
    conflict.stages[0].surface.slidesAfterRelease = true;
    expect((validateStagePlan(conflict) as any).fieldErrors[0]).toMatchObject({ path: "/stages/0/surface/slidesAfterRelease", code: "PRECONDITION_CONFLICT" });

    const badMus = read("pulley-incline.reading.json");
    badMus.stages[0].surface.staticFrictionCoefficient = 0.1;
    expect((validateStagePlan(badMus) as any).fieldErrors[0]).toMatchObject({ path: "/stages/0/surface/staticFrictionCoefficient", code: "RANGE" });
  });

  it("边界回归：光滑斜面着地松绳后到达最高点发 turn_around 而非永久静止；不达地面且缺时长报冲突", () => {
    const smoothInclineSlack = build({
      kind: "stage_plan", schemaVersion: 1, gravityMps2: 10,
      bodies: [{ bodyId: "block", massKg: 2 }, { bodyId: "hanging", massKg: 2 }],
      primaryBodyId: "block", initial: { speedMps: 0 },
      stages: [{ kind: "pulley_system", body1Id: "block", body2Id: "hanging", surface: { kind: "incline", angleDeg: 30, kineticFrictionCoefficient: 0 }, lightInextensibleString: true, idealFixedPulley: true, body2DropToGroundM: 1.25 }],
    });
    expect(smoothInclineSlack.events.some((e: any) => e.kind === "turn_around")).toBe(true);
    expect(smoothInclineSlack.endReason).toBe("prefix_end");

    const noHit: any = assembleScene({
      kind: "stage_plan", schemaVersion: 1, gravityMps2: 10,
      bodies: [{ bodyId: "left", massKg: 3 }, { bodyId: "right", massKg: 1 }],
      primaryBodyId: "right", initial: { speedMps: 0 },
      stages: [{ kind: "pulley_system", body1Id: "left", body2Id: "right", surface: { kind: "hanging" }, lightInextensibleString: true, idealFixedPulley: true, body2DropToGroundM: 2 }],
    });
    expect(noHit.ok).toBe(false);
    expect(noHit.missingKeys).toContain("/stages/0/durationSeconds");
  });
});
