import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assembleScene, buildMotion, validateStagePlan } from "../index.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"));
const acceptance = read("constant-force.acceptance.json");
const build = (plan: unknown) => {
  const assembled: any = assembleScene(plan);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled));
  return buildMotion(assembled.scene).motion as any;
};

describe("常力作用与分段匀变速：共享基准与变式", () => {
  for (const c of acceptance.cases) {
    it(`${c.id}：各检查点位置与带方向速度匹配独立基准`, () => {
      const motion = build(read(c.readingFile));
      expect(motion.durationSeconds).toBeCloseTo(c.durationSeconds, 9);
      expect(motion.endReason).toBe(c.endReason);
      for (const cp of c.checkpoints) {
        const s = motion.sampleAt(cp.timeSeconds);
        expect(s.xM).toBeCloseTo(cp.xM, 9);
        expect(s.yM).toBeCloseTo(cp.yM, 9);
        expect(s.vxMps).toBeCloseTo(cp.vxMps, 9);
        expect(s.vyMps).toBeCloseTo(cp.vyMps, 9);
      }
    });
  }

  it("基准题 2kg：4N 作用 2s 到 x=4m,v=4m/s，再 -2N 停在 6s,x=12m，且段内加速度准确", () => {
    const motion = build(read("constant-force-benchmark.reading.json"));
    expect(motion.sampleAt(1)).toMatchObject({ xM: 1, vxMps: 2 });
    expect(motion.sampleAt(2)).toMatchObject({ xM: 4, vxMps: 4 });
    expect(motion.sampleAt(4)).toMatchObject({ xM: 10, vxMps: 2 });
    expect(motion.sampleAt(6)).toMatchObject({ xM: 12, vxMps: 0 });
    expect(motion.events.map((e: any) => e.kind)).toEqual([
      "release", "force_segment_start", "force_segment_end", "force_segment_start", "stop",
    ]);
  });

  it("反向折返变式：发 turn_around 事件，带负号速度继承到第二段", () => {
    const motion = build(read("constant-force-reversal.reading.json"));
    const turn = motion.events.find((e: any) => e.kind === "turn_around");
    expect(turn).toBeDefined();
    expect(turn.timeSeconds).toBeCloseTo(3, 9);
    expect(motion.sampleAt(3).xM).toBeCloseTo(9, 9);
    expect(motion.sampleAt(3).vxMps).toBeCloseTo(0, 9);
    expect(motion.sampleAt(5).vxMps).toBeCloseTo(-4, 9);
    expect(motion.geometry.linearTrack).toEqual({ minXM: 0, maxXM: 9, yM: 0 });
  });

  it("静止停止后可继续接续下一常力段", () => {
    const motion = build({
      kind: "stage_plan", schemaVersion: 1, massKg: 2, initial: { speedMps: 4 },
      stages: [
        { kind: "constant_force_1d", netForceXN: -2, end: { kind: "stop" } },
        { kind: "constant_force_1d", netForceXN: 4, end: { kind: "duration", durationSeconds: 2 } },
      ],
    });
    expect(motion.durationSeconds).toBeCloseTo(6, 9);
    expect(motion.sampleAt(4)).toMatchObject({ xM: 8, vxMps: 0 });
    expect(motion.sampleAt(6)).toMatchObject({ xM: 12, vxMps: 4 });
    expect(motion.endReason).toBe("prefix_end");
  });

  it("校验：缺 massKg / netForceXN / durationSeconds 报缺失；无法减速至零报冲突", () => {
    const noMass = read("constant-force-benchmark.reading.json");
    delete noMass.massKg;
    expect((validateStagePlan(noMass) as any).missingKeys).toContain("/massKg");

    const badStop = {
      kind: "stage_plan", schemaVersion: 1, massKg: 2, initial: { speedMps: 4 },
      stages: [{ kind: "constant_force_1d", netForceXN: 2, end: { kind: "stop" } }],
    };
    const r: any = validateStagePlan(badStop);
    expect(r.ok).toBe(false);
    expect(r.fieldErrors[0]).toMatchObject({ path: "/stages/0/end", code: "PRECONDITION_CONFLICT" });

    const secondBadStop = read("constant-force-benchmark.reading.json");
    secondBadStop.stages[1].netForceXN = 2;
    const r2: any = validateStagePlan(secondBadStop);
    expect(r2.ok).toBe(false);
    expect(r2.fieldErrors[0]).toMatchObject({ path: "/stages/1/end", code: "PRECONDITION_CONFLICT" });

    // 反向/零速进入右侧弹簧仍报 PRECONDITION_CONFLICT
    const negToSpring: any = assembleScene({
      kind: "stage_plan", schemaVersion: 1, massKg: 2, initial: { speedMps: 2 },
      stages: [
        { kind: "constant_force_1d", netForceXN: -4, end: { kind: "duration", durationSeconds: 2 } },
        { kind: "spring_contact", springConstantNpm: 100, frictionless: true, unattached: true },
      ],
    });
    expect(negToSpring.ok).toBe(false);
    expect(negToSpring.fieldErrors[0]).toMatchObject({ path: "/stages/1", code: "PRECONDITION_CONFLICT" });

    // 反向进入水平滑动段现已支持向左匀减速停止（vx=-2, μ=0.2, g=10 → 再向左滑 1m 停在 x=-1m）
    const negToHoriz: any = assembleScene({
      kind: "stage_plan", schemaVersion: 1, massKg: 2, gravityMps2: 10, initial: { speedMps: 2 },
      stages: [
        { kind: "constant_force_1d", netForceXN: -4, end: { kind: "duration", durationSeconds: 2 } },
        { kind: "horizontal_slide", kineticFrictionCoefficient: 0.2, end: { kind: "stop" } },
      ],
    });
    expect(negToHoriz.ok).toBe(true);
    const negMotion = buildMotion(negToHoriz.scene).motion;
    expect(negMotion.endReason).toBe("stopped");
    expect(negMotion.sampleAt(negMotion.durationSeconds).xM).toBeCloseTo(-1, 6);
    expect(negMotion.sampleAt(negMotion.durationSeconds).vxMps).toBe(0);
  });
});

describe("基础直线与抛体回归：自由落体、平抛、斜抛、斜面接续", () => {
  it("自由落体（vx=0, vy=0, dropHeightM=20, g=10 → t=2s, vy=-20）", () => {
    const motion = build({
      kind: "stage_plan", schemaVersion: 1, gravityMps2: 10,
      initial: { vxMps: 0, vyMps: 0 },
      stages: [{ kind: "projectile", dropHeightM: 20 }],
    });
    expect(motion.durationSeconds).toBeCloseTo(2, 9);
    const end = motion.sampleAt(2);
    expect(end.xM).toBeCloseTo(0, 9);
    expect(end.yM).toBeCloseTo(-20, 9);
    expect(end.vxMps).toBeCloseTo(0, 9);
    expect(end.vyMps).toBeCloseTo(-20, 9);
    expect(motion.endReason).toBe("landed");
  });

  it("平抛（vx=5, vy=0, dropHeightM=1.25, g=10 → t=0.5s, x=2.5）", () => {
    const motion = build({
      kind: "stage_plan", schemaVersion: 1, gravityMps2: 10,
      initial: { vxMps: 5, vyMps: 0 },
      stages: [{ kind: "projectile", dropHeightM: 1.25 }],
    });
    expect(motion.durationSeconds).toBeCloseTo(0.5, 9);
    const end = motion.sampleAt(0.5);
    expect(end.xM).toBeCloseTo(2.5, 9);
    expect(end.yM).toBeCloseTo(-1.25, 9);
    expect(end.vxMps).toBeCloseTo(5, 9);
    expect(end.vyMps).toBeCloseTo(-5, 9);
  });

  it("斜抛（vx=3, vy=4, dropHeightM=0, g=10 → apex 0.4s, land 0.8s, x=2.4）", () => {
    const motion = build({
      kind: "stage_plan", schemaVersion: 1, gravityMps2: 10,
      initial: { vxMps: 3, vyMps: 4 },
      stages: [{ kind: "projectile", dropHeightM: 0 }],
    });
    expect(motion.durationSeconds).toBeCloseTo(0.8, 9);
    const apex = motion.events.find((e: any) => e.kind === "apex");
    expect(apex.timeSeconds).toBeCloseTo(0.4, 9);
    expect(motion.sampleAt(0.4).yM).toBeCloseTo(0.8, 9);
    expect(motion.sampleAt(0.8).xM).toBeCloseTo(2.4, 9);
  });

  it("斜面转向接水平抛体（stage-composition）与斜面直接斜抛（incline-projectile）均无回归", () => {
    const comp = build(read("stage-composition.reading.json"));
    expect(comp.endReason).toBe("landed");
    const inc = build(read("incline-projectile.reading.json"));
    expect(inc.endReason).toBe("landed");
  });
});
