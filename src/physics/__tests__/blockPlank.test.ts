import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assembleScene, buildMotion, validateStagePlan } from "../index.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"));
const acceptance = read("block-plank.acceptance.json");
const build = (plan: unknown) => {
  const assembled: any = assembleScene(plan);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled));
  return buildMotion(assembled.scene).motion as any;
};

describe("滑块与可移动木板：共享基准与变式", () => {
  for (const c of acceptance.cases) {
    it(`${c.id}：匹配独立基准（终态、用时与事件）`, () => {
      const motion = build(read(c.readingFile));
      expect(motion.durationSeconds).toBeCloseTo(c.durationSeconds, 9);
      expect(motion.endReason).toBe(c.endReason);
      const end = motion.sampleAt(motion.durationSeconds);
      expect(end.bodies.block.xM).toBeCloseTo(c.finalBlock.xM, 9);
      expect(end.bodies.block.vxMps).toBeCloseTo(c.finalBlock.vxMps, 9);
      expect(end.bodies.plank.xM).toBeCloseTo(c.finalPlank.xM, 9);
      expect(end.bodies.plank.vxMps).toBeCloseTo(c.finalPlank.vxMps, 9);
      if (c.commonVelocityTimeSeconds !== undefined) {
        const ev = motion.events.find((e: any) => e.kind === "common_velocity");
        expect(ev).toBeDefined();
        expect(ev.timeSeconds).toBeCloseTo(c.commonVelocityTimeSeconds, 9);
      }
      if (c.relativeDisplacementM !== undefined) {
        const s0 = motion.sampleAt(0);
        const sEnd = motion.sampleAt(motion.durationSeconds);
        const rel = (sEnd.bodies.block.xM - sEnd.bodies.plank.xM) - (s0.bodies.block.xM - s0.bodies.plank.xM);
        expect(rel).toBeCloseTo(c.relativeDisplacementM, 9);
      }
    });
  }

  it("双体水平动量在无外力相对滑行全程守恒", () => {
    const motion = build(read("block-plank-common.reading.json"));
    for (let i = 0; i <= 40; i++) {
      const s = motion.sampleAt(motion.durationSeconds * i / 40);
      expect(1 * s.bodies.block.vxMps + 3 * s.bodies.plank.vxMps).toBeCloseTo(4, 9);
    }
  });

  it("共速后 20N 重滑：数值加速度精确为块 3 m/s²、板 17/3 m/s²，块相对板向后", () => {
    const motion = build(read("block-plank-force-reslide.reading.json"));
    const t0 = 1.5, h = 1e-5;
    const s1 = motion.sampleAt(t0 - h), s2 = motion.sampleAt(t0 + h);
    const ab = (s2.bodies.block.vxMps - s1.bodies.block.vxMps) / (2 * h);
    const ap = (s2.bodies.plank.vxMps - s1.bodies.plank.vxMps) / (2 * h);
    expect(ab).toBeCloseTo(3, 5);
    expect(ap).toBeCloseTo(17 / 3, 5);
    expect(ab - ap).toBeLessThan(0);
    expect(motion.events.map((e: any) => e.kind)).toEqual([
      "release", "common_velocity", "reslide_start", "plank_edge_leave",
    ]);
  });

  it("事件邻域验证：1.5m 到边在 0.5s 处平滑连续且无共速事件", () => {
    const motion = build(read("block-plank-edge.reading.json"));
    expect(motion.events.some((e: any) => e.kind === "common_velocity")).toBe(false);
    const before = motion.sampleAt(0.5 - 1e-7);
    const at = motion.sampleAt(0.5);
    expect(Math.abs(before.bodies.block.xM - at.bodies.block.xM)).toBeLessThan(1e-6);
    expect(Math.abs(before.bodies.plank.vxMps - at.bodies.plank.vxMps)).toBeLessThan(1e-6);
  });

  it("校验：共速后有外力但缺 μs 报 NEEDS_INPUT（绝不默认 μs=μk），μs<μk 报 RANGE，越界报冲突", () => {
    const missingMus = read("block-plank-force-together.reading.json");
    delete missingMus.stages[0].staticFrictionCoefficient;
    const r1: any = validateStagePlan(missingMus);
    expect(r1.ok).toBe(false);
    expect(r1.code).toBe("NEEDS_INPUT");
    expect(r1.missingKeys).toEqual(["/stages/0/staticFrictionCoefficient"]);

    const badMus = read("block-plank-force-together.reading.json");
    badMus.stages[0].staticFrictionCoefficient = 0.2;
    expect((validateStagePlan(badMus) as any).fieldErrors[0]).toMatchObject({ path: "/stages/0/staticFrictionCoefficient", code: "RANGE" });

    const roughGround = read("block-plank-common.reading.json");
    roughGround.stages[0].groundFrictionless = false;
    expect((validateStagePlan(roughGround) as any).code).toBe("UNSUPPORTED");

    const outOfPlank = read("block-plank-common.reading.json");
    outOfPlank.initial.bodies[0].xM = 5;
    expect((validateStagePlan(outOfPlank) as any).fieldErrors[0].code).toBe("PRECONDITION_CONFLICT");
  });

  it("边界回归：fsReq ≈ 0 省略 μs 时保持共同运动；恰在板边共速不误判为离板", () => {
    // Fb/m === Fp/M (0.1/1 === 0.3/3)，浮点下 fsReq ≈ 1.39e-17，未给 μs 仍共同加速
    const equalRatio = read("block-plank-common.reading.json");
    equalRatio.stages[0].postCommonForce = { blockForceXN: 0.1, plankForceXN: 0.3, durationSeconds: 1 };
    const m1 = build(equalRatio);
    expect(m1.events.some((e: any) => e.kind === "common_force_together")).toBe(true);
    expect(m1.events.some((e: any) => e.kind === "reslide_start")).toBe(false);

    // 恰在右端共速：m=2, M=3, μk=0.1, g=10, v_b=0.7, v_p=0, L=0.147 -> tc=0.42s, s(tc)=0.147=L
    const tangent = {
      kind: "stage_plan", schemaVersion: 1, gravityMps2: 10,
      bodies: [{ bodyId: "block", massKg: 2 }, { bodyId: "plank", massKg: 3 }],
      primaryBodyId: "block",
      initial: { bodies: [{ bodyId: "block", xM: 0, vxMps: 0.7 }, { bodyId: "plank", xM: 0, vxMps: 0 }] },
      stages: [{ kind: "block_plank", blockBodyId: "block", plankBodyId: "plank", plankLengthM: 0.147, kineticFrictionCoefficient: 0.1, groundFrictionless: true }],
    };
    const m2 = build(tangent);
    expect(m2.endReason).toBe("prefix_end");
    expect(m2.events.some((e: any) => e.kind === "common_velocity")).toBe(true);
    expect(m2.events.some((e: any) => e.kind === "plank_edge_leave")).toBe(false);
  });
});
