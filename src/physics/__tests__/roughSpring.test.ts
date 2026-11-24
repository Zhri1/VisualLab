import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { assembleScene, buildMotion, validateStagePlan } from "../index.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"));
const acceptance = read("rough-spring.acceptance.json");
const build = (plan: unknown) => {
  const assembled: any = assembleScene(plan);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled));
  return buildMotion(assembled.scene).motion as any;
};
const withStage = (speed: number, patch: Record<string, unknown>) => {
  const plan = read("rough-spring-detach.reading.json");
  plan.initial.speedMps = speed;
  plan.stages[0] = { ...plan.stages[0], ...patch };
  return plan;
};

describe("粗糙弹簧接触：共享基准", () => {
  for (const c of acceptance.cases) {
    it(`${c.id}：${c.outcome}`, () => {
      const motion = build(read(c.readingFile));
      const max = motion.events.find((e: any) => e.kind === "max_compression");
      expect(max.timeSeconds).toBeCloseTo(c.maxCompressionTimeSeconds, 9);
      expect(motion.sampleAt(max.timeSeconds).springCompressionM).toBeCloseTo(c.maxCompressionM, 9);
      expect(motion.sampleAt(max.timeSeconds).vxMps).toBeCloseTo(0, 9);
      expect(motion.durationSeconds).toBeCloseTo(c.durationSeconds, 9);
      const end = motion.sampleAt(motion.durationSeconds);
      expect(end.springCompressionM).toBeCloseTo(c.finalCompressionM, 9);
      expect(motion.energyAt(motion.durationSeconds).frictionHeatJ).toBeCloseTo(c.frictionHeatJ, 9);
      if (c.detachVxMps !== undefined) {
        expect(end.vxMps).toBeCloseTo(c.detachVxMps, 9);
        expect(motion.endReason).toBe("spring_detached");
        expect(motion.events.map((e: any) => e.kind)).toEqual(["release", "spring_contact", "max_compression", "spring_detach"]);
      } else {
        expect(end.vxMps).toBe(0);
        expect(motion.endReason).toBe("stopped");
        expect(motion.events.map((e: any) => e.kind)).toEqual(["release", "spring_contact", "max_compression", "stop"]);
      }
    });
  }

  it("能量全程守恒：动能+弹性势能+累计摩擦耗能=入射动能", () => {
    for (const c of acceptance.cases) {
      const motion = build(read(c.readingFile));
      for (let i = 0; i <= 200; i++) {
        const e = motion.energyAt(motion.durationSeconds * i / 200);
        expect(e.kineticJ + e.elasticPotentialJ + e.frictionHeatJ).toBeCloseTo(0.5 * c.speedMps ** 2, 9);
        expect(e.gravitationalPotentialJ).toBeNull();
        expect(e.priorFrictionKnown).toBe(true);
      }
    }
  });

  it("累计摩擦耗能单调不减，回弹段继续增加", () => {
    const motion = build(read("rough-spring-detach.reading.json"));
    let previous = -1;
    for (let i = 0; i <= 400; i++) {
      const heat = motion.energyAt(motion.durationSeconds * i / 400).frictionHeatJ;
      expect(heat).toBeGreaterThanOrEqual(previous);
      previous = heat;
    }
    const tMax = motion.events.find((e: any) => e.kind === "max_compression").timeSeconds;
    expect(motion.energyAt(tMax).frictionHeatJ).toBeCloseTo(2 * 0.4633249580710800, 9);
  });

  it("摩擦按实际运动方向：压缩段减速更快，回弹段加速度较小", () => {
    const motion = build(read("rough-spring-detach.reading.json"));
    const h = 1e-6, tMax = motion.events.find((e: any) => e.kind === "max_compression").timeSeconds;
    const a = (t: number) => (motion.sampleAt(t + h).vxMps - motion.sampleAt(t - h).vxMps) / (2 * h);
    // 压缩段刚入射：弹力≈0，摩擦向左，a=-μg=-2；回弹末端临近脱离：摩擦向右，a≈+2（方向随运动反向）。
    expect(a(1e-4)).toBeCloseTo(-2, 2);
    expect(a(tMax - 1e-3)).toBeLessThan(0);
    expect(a(tMax + 1e-3)).toBeLessThan(0);
    expect(a(motion.durationSeconds - 1e-4)).toBeCloseTo(2, 2);
  });
});

describe("粗糙弹簧接触：静摩擦上限与已知事实", () => {
  it("不能默认 μs=μk：弹力在 μk·mg 与 μs·mg 之间时，μs=μk 会回弹，题给 μs=0.25 则保持", () => {
    // x_max=0.22 m → kx=2.2 N，介于 μk·mg=2 N 与 μs·mg=2.5 N
    const speed = Math.sqrt(2 * (5 * 0.22 ** 2 + 2 * 0.22));
    const equal = build(withStage(speed, { staticFrictionCoefficient: 0.2 }));
    expect(equal.durationSeconds).toBeGreaterThan(equal.events.find((e: any) => e.kind === "max_compression").timeSeconds + 0.1);
    expect(equal.sampleAt(equal.durationSeconds).springCompressionM).toBeCloseTo(0.18, 9);
    const given = build(withStage(speed, { staticFrictionCoefficient: 0.25 }));
    expect(given.durationSeconds).toBeCloseTo(given.events.find((e: any) => e.kind === "max_compression").timeSeconds, 12);
    expect(given.sampleAt(given.durationSeconds).springCompressionM).toBeCloseTo(0.22, 9);
  });
  it("弹力恰等于静摩擦上限时保持", () => {
    const speed = Math.sqrt(2 * (5 * 0.225 ** 2 + 2 * 0.225));
    const motion = build(withStage(speed, { staticFrictionCoefficient: 0.225 }));
    expect(motion.endReason).toBe("stopped");
    expect(motion.sampleAt(motion.durationSeconds).springCompressionM).toBeCloseTo(0.225, 9);
  });
  it("只给已知事实：不能回弹/能回弹都按事实，且不要求 μs", () => {
    const stays = build(withStage(2, { staticFrictionCoefficient: null, reboundAtMaxCompression: false }));
    expect(stays.endReason).toBe("stopped");
    expect(stays.sampleAt(stays.durationSeconds).springCompressionM).toBeCloseTo(0.4633249580710800, 9);
    const rebounds = build(withStage(2, { staticFrictionCoefficient: null, reboundAtMaxCompression: true }));
    expect(rebounds.endReason).toBe("spring_detached");
    expect(rebounds.sampleAt(rebounds.durationSeconds).vxMps).toBeCloseTo(-0.5416644121883593, 9);
  });
  it("缺静摩擦也缺事实 → NEEDS_INPUT 且只报该叶", () => {
    const r: any = validateStagePlan(withStage(2, { staticFrictionCoefficient: null }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NEEDS_INPUT");
    expect(r.missingKeys).toEqual(["/stages/0/staticFrictionCoefficient"]);
    const absent = withStage(2, {}); delete absent.stages[0].staticFrictionCoefficient;
    expect((validateStagePlan(absent) as any).missingKeys).toEqual(["/stages/0/staticFrictionCoefficient"]);
  });
  it("矛盾：事实与静摩擦判断相反、或弹力不超过动摩擦力却声称回弹", () => {
    const a: any = assembleScene(withStage(2, { reboundAtMaxCompression: false }));
    expect(a.ok).toBe(false);
    expect(a.fieldErrors[0]).toMatchObject({ path: "/stages/0/reboundAtMaxCompression", code: "PRECONDITION_CONFLICT" });
    const b: any = assembleScene(withStage(1, { staticFrictionCoefficient: null, reboundAtMaxCompression: true }));
    expect(b.ok).toBe(false);
    expect(b.fieldErrors[0].path).toBe("/stages/0/reboundAtMaxCompression");
  });
  it("字段分类：μs<μk 为 RANGE，负数 RANGE，类型错 TYPE，同时给 frictionless 为冲突", () => {
    expect((validateStagePlan(withStage(2, { staticFrictionCoefficient: 0.1 })) as any).fieldErrors[0]).toMatchObject({ path: "/stages/0/staticFrictionCoefficient", code: "RANGE" });
    expect((validateStagePlan(withStage(2, { kineticFrictionCoefficient: -1 })) as any).fieldErrors[0].code).toBe("RANGE");
    const typed: any = validateStagePlan(withStage(2, { reboundAtMaxCompression: "yes", staticFrictionCoefficient: null }));
    expect(typed.code).toBe("INVALID_READING");
    const both: any = validateStagePlan(withStage(2, { frictionless: true }));
    expect(both.fieldErrors.some((e: any) => e.code === "PRECONDITION_CONFLICT")).toBe(true);
  });
  it("缺 μk 的叶子与缺 g、m 分别报缺失", () => {
    expect((validateStagePlan(withStage(2, { kineticFrictionCoefficient: null })) as any).missingKeys).toEqual(["/stages/0/kineticFrictionCoefficient"]);
    const plan = withStage(2, {}); delete plan.gravityMps2;
    expect((validateStagePlan(plan) as any).missingKeys).toContain("/gravityMps2");
  });
});

describe("能量显示：兼容旧输入与未知前段", () => {
  it("旧光滑弹簧无摩擦：动能+弹性势能守恒，耗能为 0，事件序列不变", () => {
    const motion = build({ kind: "stage_plan", schemaVersion: 1, massKg: 2, initial: { speedMps: 3 }, stages: [{ kind: "spring_contact", springConstantNpm: 200, frictionless: true, unattached: true }] });
    expect(motion.events.map((e: any) => e.kind)).toEqual(["release", "spring_contact", "max_compression", "spring_detach"]);
    for (let i = 0; i <= 50; i++) {
      const e = motion.energyAt(motion.durationSeconds * i / 50);
      expect(e.kineticJ + e.elasticPotentialJ).toBeCloseTo(9, 9);
      expect(e.frictionHeatJ).toBe(0);
    }
  });
  it("无质量的斜面计划不伪造能量", () => {
    const motion = build(read("incline-projectile.reading.json"));
    expect(motion.energyAt(0)).toBeNull();
  });
  it("预压释放全程：初始弹性势能 → 动能与摩擦耗能，总量守恒", () => {
    const motion = build(read("precompressed-spring-complete.reading.json"));
    const e0 = motion.energyAt(0);
    expect(e0.elasticPotentialJ).toBeCloseTo(1.4, 9);
    expect(e0.priorFrictionKnown).toBe(true);
    for (let i = 0; i <= 100; i++) {
      const e = motion.energyAt(motion.durationSeconds * i / 100);
      if (e.elasticPotentialJ !== null || e.gravitationalPotentialJ !== null) {
        const total = e.kineticJ + (e.elasticPotentialJ ?? 0) + (e.gravitationalPotentialJ ?? 0) + e.frictionHeatJ;
        expect(total).toBeCloseTo(1.4, 6);
      }
    }
  });
  it("缺参预压的 suffix 窗口：优先保留未知，耗能自窗口起算", () => {
    const motion = build(read("precompressed-spring-fixed-energy.reading.json"));
    const e = motion.energyAt(0);
    if (motion.timing && motion.timing.mode !== "full") {
      expect(e.priorFrictionKnown).toBe(false);
      expect(e.frictionHeatJ).toBe(0);
    }
  });
});
