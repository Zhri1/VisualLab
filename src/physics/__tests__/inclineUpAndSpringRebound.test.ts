import { describe, expect, it } from "vitest";
import { assembleScene, buildMotion, validateStagePlan } from "../index";
import type { StageMotion } from "../index";

function run(input: unknown): StageMotion {
  const validation = validateStagePlan(input);
  if (!validation.ok) throw new Error(JSON.stringify(validation));
  const assembled = assembleScene(validation.reading);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled));
  const built = buildMotion(assembled.scene);
  return built.motion;
}

describe("上滑斜面、弹簧回弹与反向多过程接续", () => {
  describe("阶段计划校验：incline_slide 上滑与接续白名单", () => {
    it("direction: up 允许省略 lengthM（斜面足够长），但首段静止报 PRECONDITION_CONFLICT", () => {
      const okPlan = {
        kind: "stage_plan",
        schemaVersion: 1,
        gravityMps2: 10,
        initial: { speedMps: 4 },
        stages: [{ kind: "incline_slide", direction: "up", angleDeg: 30, kineticFrictionCoefficient: 0 }],
      };
      expect(validateStagePlan(okPlan).ok).toBe(true);

      const restPlan = { ...okPlan, initial: { speedMps: 0 } };
      expect(validateStagePlan(restPlan)).toMatchObject({
        ok: false,
        code: "INCONSISTENT_CONDITIONS",
        fieldErrors: [{ path: "/initial/speedMps", code: "PRECONDITION_CONFLICT" }],
      });

      const badDir = {
        ...okPlan,
        stages: [{ kind: "incline_slide", direction: "sideways", angleDeg: 30, kineticFrictionCoefficient: 0 }],
      };
      expect(validateStagePlan(badDir)).toMatchObject({
        ok: false,
        code: "UNSUPPORTED",
        fieldErrors: [{ path: "/stages/0/direction", code: "UNSUPPORTED" }],
      });
    });

    it("允许 spring_contact 后接续 horizontal_slide / lossless_turn / incline_slide", () => {
      const plan = {
        kind: "stage_plan",
        schemaVersion: 1,
        gravityMps2: 10,
        massKg: 1,
        initial: { speedMps: 4 },
        stages: [
          { kind: "spring_contact", springConstantNpm: 100, frictionless: true, unattached: true },
          { kind: "horizontal_slide", kineticFrictionCoefficient: 0.2, end: { kind: "stop" } },
        ],
      };
      expect(validateStagePlan(plan).ok).toBe(true);
    });
  });

  describe("(a) 传送带 → 光滑足够长斜面上滑返回 → 传送带折返 → 平抛", () => {
    it("物块右端离带冲上光滑斜面返回后，在水平传送带向左减速折返并再次右端离带平抛", () => {
      // 传送带 L=4m, v带=2m/s(向右), μ=0.2, g=10 => a=2m/s²
      // 去程：v0=0 加速 1s 到共速 2m/s（位移 1m），匀速 1.5s（位移 3m）至右端 x=4m，总用时 2.5s
      // 斜面：30° 光滑，u=2m/s，a=5m/s²，t1=0.4s，sMax=0.4m，折返 t2=0.4s 回到 (4,0)，速率 2m/s
      // 返程传送带：从右端 x=4m 以 vx=-2m/s 向左滑入，a=+2m/s²，经 1s 在 x=3m 速度为0折返，再经 1s 以 vx=+2m/s 回到右端 x=4m 离带
      // 平抛：从 (4, 0) 以 vx=2m/s 落差 h=1.25m（t=0.5s），落地 x=5m, y=-1.25m
      const motion = run({
        kind: "stage_plan",
        schemaVersion: 1,
        gravityMps2: 10,
        initial: { vxMps: 0 },
        stages: [
          {
            kind: "conveyor_belt",
            initialBeltSpeedMps: 2,
            beltLengthM: 4,
            kineticFrictionCoefficient: 0.2,
            segments: [{ accelerationMps2: 0, durationSeconds: null }],
          },
          {
            kind: "incline_slide",
            direction: "up",
            lengthM: null,
            angleDeg: 30,
            kineticFrictionCoefficient: 0,
          },
          {
            kind: "conveyor_belt",
            initialBeltSpeedMps: 2,
            beltLengthM: 4,
            kineticFrictionCoefficient: 0.2,
            segments: [{ accelerationMps2: 0, durationSeconds: null }],
          },
          { kind: "projectile", dropHeightM: 1.25 },
        ],
      });

      expect(motion.endReason).toBe("landed");
      expect(motion.segments.map((s) => s.kind)).toEqual([
        "conveyor_belt",
        "incline_slide",
        "conveyor_belt",
        "projectile",
      ]);
      expect(motion.events.some((e) => e.kind === "incline_turn")).toBe(true);
      expect(motion.events.some((e) => e.kind === "reach_bottom")).toBe(true);
      expect(motion.events.some((e) => e.kind === "turn_around")).toBe(true);

      // 总时长 = 2.5 + 0.8 + 2.0 + 0.5 = 5.8s
      expect(motion.durationSeconds).toBeCloseTo(5.8, 6);
      const end = motion.sampleAt(motion.durationSeconds);
      expect(end.xM).toBeCloseTo(5, 6);
      expect(end.yM).toBeCloseTo(-1.25, 6);
      expect(end.vxMps).toBeCloseTo(2, 6);
      expect(end.vyMps).toBeCloseTo(-5, 6);

      // 检验斜面最高点与传送带返程折返点
      const apexEv = motion.events.find((e) => e.kind === "incline_turn")!;
      expect(apexEv.timeSeconds).toBeCloseTo(2.9, 6);
      const apexSample = motion.sampleAt(apexEv.timeSeconds);
      expect(apexSample.yM).toBeCloseTo(0.2, 6); // sMax * sin30° = 0.4 * 0.5 = 0.2

      const turnEv = motion.events.find((e) => e.kind === "turn_around")!;
      expect(turnEv.timeSeconds).toBeCloseTo(4.3, 6);
      expect(motion.sampleAt(turnEv.timeSeconds).xM).toBeCloseTo(3, 6);
    });

    it("返程高速进入水平传送带右端，穿过整条传送带从左端离带向左平抛", () => {
      // 直接从初速 vx=5 冲上光滑斜面返回（速率 5m/s 向左）滑入 L=4m, v带=2m/s, μ=0.2 的传送带右端
      // a = +2m/s²，x(t) = 4 - 5t + t² = 0 => t = 1s 时到达左端 x=0，vx = -3m/s
      // 随后向左平抛 h=1.25m（t=0.5s），落地 x = -1.5m, y = -1.25m
      const motion = run({
        kind: "stage_plan",
        schemaVersion: 1,
        gravityMps2: 10,
        initial: { speedMps: 5 },
        stages: [
          { kind: "incline_slide", direction: "up", lengthM: null, angleDeg: 30, kineticFrictionCoefficient: 0 },
          { kind: "lossless_turn", lossless: true },
          {
            kind: "conveyor_belt",
            initialBeltSpeedMps: 2,
            beltLengthM: 4,
            kineticFrictionCoefficient: 0.2,
            segments: [{ accelerationMps2: 0, durationSeconds: null }],
          },
          { kind: "projectile", dropHeightM: 1.25 },
        ],
      });
      expect(motion.endReason).toBe("landed");
      const end = motion.sampleAt(motion.durationSeconds);
      expect(end.xM).toBeCloseTo(-5.5, 6); // incline 起点在 0，传送带占 [-4, 0]，左端 -4 再向左飞 1.5m = -5.5m
      expect(end.yM).toBeCloseTo(-1.25, 6);
      expect(end.vxMps).toBeCloseTo(-3, 6);
    });
  });

  describe("(b) 斜面下滑 → 压缩弹簧回弹 → 粗糙水平面停止 / 再冲上斜面", () => {
    it("光滑斜面下滑 → 光滑弹簧回弹 → 粗糙水平面向左匀减速停止", () => {
      // 斜面 L=3.6m, 30°, 光滑 => 坡底 v = 6m/s, t = 1.2s
      // 水平向右 2m 光滑 => x=2m, v=6m/s
      // 弹簧 k=100, m=1, 光滑 => 回弹脱离 x=2m, vx=-6m/s
      // 粗糙水平面 μ=0.3, g=10 => a=+3m/s², 向左滑行 s = 36/6 = 6m，停在 x = 2 - 6 = -4m
      const motion = run({
        kind: "stage_plan",
        schemaVersion: 1,
        gravityMps2: 10,
        massKg: 1,
        initial: { speedMps: 0 },
        stages: [
          { kind: "incline_slide", lengthM: 3.6, angleDeg: 30, kineticFrictionCoefficient: 0, slidesAfterRelease: true },
          { kind: "lossless_turn", lossless: true },
          { kind: "horizontal_slide", kineticFrictionCoefficient: 0, end: { kind: "distance", distanceM: 2 } },
          { kind: "spring_contact", springConstantNpm: 100, frictionless: true, unattached: true },
          { kind: "horizontal_slide", kineticFrictionCoefficient: 0.3, end: { kind: "stop" } },
        ],
      });

      expect(motion.endReason).toBe("stopped");
      expect(motion.segments.map((s) => s.kind)).toEqual([
        "incline_slide",
        "horizontal_slide",
        "spring_contact",
        "horizontal_slide",
      ]);
      const detachEv = motion.events.find((e) => e.kind === "spring_detach")!;
      expect(detachEv.velocityAfter.vxMps).toBeCloseTo(-6, 6);
      const end = motion.sampleAt(motion.durationSeconds);
      expect(end.xM).toBeCloseTo(-4, 6);
      expect(end.vxMps).toBe(0);
    });

    it("粗糙弹簧回弹脱离后继续向左滑过水平面并再冲上左侧光滑斜面", () => {
      // 弹簧入口 vx = 4m/s, m=1, k=100, g=10, μk=0.1, μs=0.1 => 会回弹脱离，脱离速率 vDetach > 0 向左
      // 向左通过 1m 光滑水平面，再冲上左侧 30° 足够长光滑斜面（x 向左上方延伸）并折返
      const motion = run({
        kind: "stage_plan",
        schemaVersion: 1,
        gravityMps2: 10,
        massKg: 1,
        initial: { speedMps: 4 },
        stages: [
          {
            kind: "spring_contact",
            springConstantNpm: 100,
            kineticFrictionCoefficient: 0.1,
            staticFrictionCoefficient: 0.1,
            unattached: true,
          },
          { kind: "horizontal_slide", kineticFrictionCoefficient: 0, end: { kind: "distance", distanceM: 1 } },
          { kind: "incline_slide", direction: "up", lengthM: null, angleDeg: 30, kineticFrictionCoefficient: 0 },
        ],
      });

      expect(motion.segments.map((s) => s.kind)).toEqual([
        "spring_contact",
        "horizontal_slide",
        "incline_slide",
      ]);
      const detachEv = motion.events.find((e) => e.kind === "spring_detach")!;
      const vDetach = Math.abs(detachEv.velocityAfter.vxMps);
      expect(detachEv.velocityAfter.vxMps).toBeLessThan(0);

      // 斜面应从 x = -1 向左上方延伸（end.xM < start.xM, end.yM > start.yM）
      const incGeo = motion.geometry.incline!;
      expect(incGeo.start.xM).toBeCloseTo(-1, 6);
      expect(incGeo.end.xM).toBeLessThan(incGeo.start.xM);
      expect(incGeo.end.yM).toBeGreaterThan(incGeo.start.yM);

      // 光滑斜面折返回到坡底 (-1, 0)，末速度指向右下方（vx > 0, vy < 0）
      const end = motion.sampleAt(motion.durationSeconds);
      expect(end.xM).toBeCloseTo(-1, 6);
      expect(end.yM).toBeCloseTo(0, 6);
      expect(end.vxMps).toBeGreaterThan(0);
      expect(Math.hypot(end.vxMps, end.vyMps)).toBeCloseTo(vDetach, 6);
    });
  });

  describe("(c) 上滑粗糙斜面：μ ≥ tanθ 最高点静止 vs μ < tanθ 折返滑回坡底", () => {
    it("μ ≥ tanθ（37°, tan37°≈0.7536, μ=0.8）时在最高点静止", () => {
      const motion = run({
        kind: "stage_plan",
        schemaVersion: 1,
        gravityMps2: 10,
        massKg: 2,
        initial: { speedMps: 6 },
        stages: [
          { kind: "incline_slide", direction: "up", lengthM: null, angleDeg: 37, kineticFrictionCoefficient: 0.8 },
        ],
      });
      expect(motion.endReason).toBe("stopped");
      expect(motion.events.some((e) => e.kind === "incline_turn")).toBe(false);
      expect(motion.events[motion.events.length - 1].kind).toBe("stop");
      const end = motion.sampleAt(motion.durationSeconds);
      expect(end.vxMps).toBe(0);
      expect(end.vyMps).toBe(0);
      expect(end.yM).toBeGreaterThan(0);

      // 能量守恒：初动能 = 末重力势能 + 摩擦产热
      const e0 = motion.energyAt!(0)!;
      const eEnd = motion.energyAt!(motion.durationSeconds)!;
      expect(eEnd.kineticJ).toBeCloseTo(0, 6);
      expect(eEnd.gravitationalPotentialJ! + eEnd.frictionHeatJ).toBeCloseTo(e0.kineticJ, 5);
    });

    it("μ < tanθ（37°, μk=0.25）时到达最高点折返并滑回坡底，全程机械能+产热守恒", () => {
      const motion = run({
        kind: "stage_plan",
        schemaVersion: 1,
        gravityMps2: 10,
        massKg: 2,
        initial: { speedMps: 8 },
        stages: [
          { kind: "incline_slide", direction: "up", lengthM: null, angleDeg: 37, kineticFrictionCoefficient: 0.25 },
        ],
      });
      expect(motion.endReason).toBe("prefix_end");
      expect(motion.events.map((e) => e.kind)).toEqual(["release", "incline_turn", "reach_bottom"]);
      const end = motion.sampleAt(motion.durationSeconds);
      expect(end.xM).toBeCloseTo(0, 6);
      expect(end.yM).toBeCloseTo(0, 6);
      expect(Math.hypot(end.vxMps, end.vyMps)).toBeLessThan(8);
      expect(Math.hypot(end.vxMps, end.vyMps)).toBeGreaterThan(0);

      // 全程能量守恒（含往返摩擦产热累加）
      const e0 = motion.energyAt!(0)!;
      const eEnd = motion.energyAt!(motion.durationSeconds)!;
      expect(eEnd.kineticJ + eEnd.gravitationalPotentialJ! + eEnd.frictionHeatJ).toBeCloseTo(e0.kineticJ, 5);
    });
  });

  describe("(d) 定长斜面上滑冲出坡顶接斜抛", () => {
    it("冲出坡顶触发 reach_top，无缝接续斜抛（含最高点 apex 与落地 land）", () => {
      // L=2m, 30°, 光滑, u=6m/s => aUp=5m/s², vTop = sqrt(36 - 20) = 4m/s, tTop = (6-4)/5 = 0.4s
      // 坡顶坐标：(sqrt(3), 1)，出射速度：(2*sqrt(3), 2)
      // 落地平面 y=0（相对落差 1m）：vy=2, g=10 => 最高点 t_apex = 0.2s, y_apex = 1.2m
      const motion = run({
        kind: "stage_plan",
        schemaVersion: 1,
        gravityMps2: 10,
        initial: { speedMps: 6 },
        stages: [
          { kind: "incline_slide", direction: "up", lengthM: 2, angleDeg: 30, kineticFrictionCoefficient: 0 },
          { kind: "projectile", landingPlaneYM: 0 },
        ],
      });

      expect(motion.endReason).toBe("landed");
      expect(motion.segments.map((s) => s.kind)).toEqual(["incline_slide", "projectile"]);
      expect(motion.events.map((e) => e.kind)).toEqual([
        "release",
        "reach_top",
        "projectile_launch",
        "apex",
        "land",
      ]);

      const topEv = motion.events.find((e) => e.kind === "reach_top")!;
      expect(topEv.timeSeconds).toBeCloseTo(0.4, 6);
      expect(topEv.velocityAfter.vxMps).toBeCloseTo(2 * Math.sqrt(3), 6);
      expect(topEv.velocityAfter.vyMps).toBeCloseTo(2, 6);

      const apexEv = motion.events.find((e) => e.kind === "apex")!;
      expect(apexEv.timeSeconds).toBeCloseTo(0.6, 6);
      expect(motion.sampleAt(apexEv.timeSeconds).yM).toBeCloseTo(1.2, 6);

      const end = motion.sampleAt(motion.durationSeconds);
      expect(end.yM).toBeCloseTo(0, 6);
      expect(end.vxMps).toBeCloseTo(2 * Math.sqrt(3), 6);
      expect(end.vyMps).toBeLessThan(0);
    });
  });
});
