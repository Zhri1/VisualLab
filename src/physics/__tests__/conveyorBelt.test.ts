import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assembleScene, buildMotion, validateStagePlan } from "../index.ts";

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
});
