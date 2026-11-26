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
});
