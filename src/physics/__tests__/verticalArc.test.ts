import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assembleScene, buildMotion, validateStagePlan } from "../index";
import type { StageMotion, StagePlanDraft } from "../index";
import acceptance from "../../../fixtures/vertical-arc.acceptance.json";
import endpoint from "../../../fixtures/vertical-arc-endpoint.reading.json";
import composition from "../../../fixtures/vertical-arc-composition.reading.json";
import rodCritical from "../../../fixtures/vertical-arc-rod-critical.reading.json";

function build(input: unknown): StageMotion {
  const scene = assembleScene(input);
  if (!scene.ok) throw new Error(JSON.stringify(scene));
  if (!("kind" in scene.scene)) throw new Error("应返回阶段场景");
  const result = buildMotion(scene.scene);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.motion;
}
function withSpeedSquared(value: number) { return { ...structuredClone(endpoint), initial: { speedMps: Math.sqrt(value) } }; }
const eps = 1e-7;
function close(actual: Record<string, unknown>, expected: Record<string, unknown>) {
  for (const key of ["xM", "yM", "vxMps", "vyMps", "springCompressionM"]) if (typeof expected[key] === "number") expect(actual[key], key).toBeCloseTo(expected[key] as number, 6);
}

describe("竖直圆弧公共入口", () => {
  for (const expected of acceptance.cases) it(expected.readingFile + " 与独立手算/积分基准一致", () => {
    const input = JSON.parse(readFileSync(new URL("../../../fixtures/" + expected.readingFile, import.meta.url), "utf8"));
    const motion = build(input);
    expect(motion.durationSeconds).toBeCloseTo(expected.durationSeconds, 9);
    expect(motion.events.map(e => e.kind)).toEqual(expected.eventKinds);
    expect(motion.endReason).toBe(expected.terminationReason);
    expect(motion.termination.reason).toBe(motion.endReason);
    expect(motion.termination.eventId).toBe(motion.events[motion.events.length - 1].id);
    close(motion.sampleAt(Infinity), expected.final);
    expect(motion.sampleAt(Infinity)).toEqual(motion.sampleAt(motion.durationSeconds));
    const event = motion.events.find(e => e.kind === expected.boundary.kind)!;
    expect(event.timeSeconds).toBeCloseTo(expected.boundary.timeSeconds, 9);
    const s = motion.sampleAt(event.timeSeconds);
    close(s, expected.boundary);
    expect(event.normalForceBeforeN).toBeCloseTo(expected.boundary.normalForceN, 9);
    expect(motion.sampleAt(0).constraint?.normalForceN).toBeCloseTo(expected.entryNormalForceN, 9);
    expect(motion.geometry.positionReference).toBe("particle");
    expect(motion.geometry.verticalArc?.plannedEnd).toEqual({ xM: 0, yM: .8 });
    for (const t of [event.timeSeconds - eps, event.timeSeconds, event.timeSeconds + eps]) {
      const at = motion.sampleAt(t); expect(at.springCompressionM).toBe(0);
      expect(Math.hypot(at.xM - s.xM, at.yM - s.yM)).toBeLessThan(1e-6);
      expect(Math.hypot(at.vxMps - s.vxMps, at.vyMps - s.vyMps)).toBeLessThan(1e-5);
    }
    if (expected.boundary.kind === "arc_turn") {
      expect(s.constraint?.normalForceN).toBeCloseTo(.5, 10);
      expect(motion.sampleAt(event.timeSeconds - eps).constraint!.angularVelocityRadps).toBeGreaterThan(0);
      expect(motion.sampleAt(event.timeSeconds + eps).constraint!.angularVelocityRadps).toBeLessThan(0);
      expect(motion.geometry.projectile).toBeUndefined();
      expect(motion.sampleAt(Infinity).constraint).toBeUndefined();
    } else {
      expect(s.constraint).toBeUndefined();
      const after = motion.sampleAt(event.timeSeconds + eps);
      expect(after.vyMps).toBeCloseTo(s.vyMps - 10 * eps, 9);
    }
  });

  it("水平接入继承非零位置，同刻前段事件先于入弧，端点先于发射", () => {
    const motion = build(composition), expected = acceptance.compositionCases[0];
    expect(motion.durationSeconds).toBeCloseTo(expected.durationSeconds, 9);
    close(motion.sampleAt(Infinity), expected.final);
    const enter = motion.events.find(e => e.kind === "arc_enter")!;
    const target = motion.events.find(e => e.kind === "reach_target")!;
    expect(enter.timeSeconds).toBe(target.timeSeconds);
    expect([target.order, enter.order]).toEqual([1, 2]);
    expect([target.stageIndex, enter.stageIndex]).toEqual([0, 1]);
    expect(enter.position).toEqual({ xM: 2, yM: 0 });
    expect(target.velocityAfter).toEqual(enter.velocityBefore);
    expect(enter.velocityBefore).toEqual(enter.velocityAfter);
    expect(enter.normalForceBeforeN).toBe(0); expect(enter.normalForceAfterN).toBeCloseTo(6, 10);
    expect(motion.sampleAt(enter.timeSeconds - eps).constraint).toBeUndefined();
    expect(motion.sampleAt(enter.timeSeconds).constraint?.stageIndex).toBe(1);
    for (const t of [enter.timeSeconds - eps, enter.timeSeconds, enter.timeSeconds + eps]) {
      const s = motion.sampleAt(t); close(s, { xM: 2, yM: 0 });
      expect(Math.abs(s.vxMps - Math.sqrt(20))).toBeLessThan(1e-5);
      expect(Math.abs(s.vyMps)).toBeLessThan(1e-5);
    }
    expect(motion.geometry.verticalArc).toMatchObject(expected.arcGeometry!);
    expect(motion.geometry.projectile?.launch).toEqual({ xM: 2, yM: .8 });
    expect(motion.events.map(e => e.kind)).toEqual(expected.eventKinds);
    const [boundary, launch] = motion.events.slice(3, 5);
    expect(boundary.timeSeconds).toBe(launch.timeSeconds); expect(boundary.order).toBeLessThan(launch.order);
  });

  it.each([[8, "stop_before_target"], [7, "stop_at_target"]])("水平距离 %s 时先停止，后缀均不执行", (distance, reason) => {
    const input = structuredClone(composition); input.stages[0].end!.distanceM = distance as number;
    const motion = build(input);
    expect(motion.endReason).toBe(reason);
    expect(motion.events.map(e => e.kind)).toEqual(["release", "stop"]);
    expect(motion.segments.map(s => s.kind)).toEqual(["horizontal_slide"]);
    expect(motion.geometry.verticalArc).toBeUndefined(); expect(motion.geometry.projectile).toBeUndefined();
    expect(motion.geometry.horizontal?.plannedEnd?.xM).toBe(distance);
    close(motion.sampleAt(Infinity), { xM: 7, yM: 0, vxMps: 0, vyMps: 0 });
  });

  it("零初速零时长静止、支持力为mg，不执行抛体", () => {
    const motion = build(withSpeedSquared(0));
    expect(motion.durationSeconds).toBe(0); expect(motion.endReason).toBe("stopped");
    expect(motion.events.map(e => e.kind)).toEqual(["release", "arc_enter", "stop"]);
    expect(motion.segments).toEqual([]); expect(motion.sampleAt(10).constraint?.normalForceN).toBe(1);
    expect(motion.sampleAt(NaN)).toEqual(motion.sampleAt(Infinity));
  });
  it("极短但可表示的圆弧不把离弧事件吸附到初态", () => {
    const motion = build({ ...endpoint, initial: { speedMps: 1e12 } });
    const end = motion.events.find(e => e.kind === "arc_endpoint")!;
    expect(end.timeSeconds).toBeGreaterThan(0); expect(end.timeSeconds).toBeLessThan(1e-9);
    expect(motion.sampleAt(0).yM).toBe(0); expect(motion.sampleAt(0).vxMps).toBe(1e12);
    expect(motion.sampleAt(end.timeSeconds / 2).constraint).toBeDefined();
    expect(motion.sampleAt(end.timeSeconds).yM).toBe(.8);
    expect(motion.sampleAt(end.timeSeconds).constraint).toBeUndefined();
  });
  it("相邻浮点时刻精确匹配优先，近似匹配选择更近的入弧事件", () => {
    const motion = build({ ...endpoint, initial: { speedMps: 1 }, stages: [
      { kind: "horizontal_slide", kineticFrictionCoefficient: 0, end: { kind: "distance", distanceM: 1 } },
      { ...endpoint.stages[0], radiusM: 1e-16 },
    ] });
    const enter = motion.events.find(e => e.kind === "arc_enter")!;
    const exit = motion.events.find(e => e.kind === "arc_endpoint")!;
    expect(enter.timeSeconds).toBe(1); expect(exit.timeSeconds).toBe(1 + Number.EPSILON);
    const at = motion.sampleAt(1);
    expect(at.constraint?.stageIndex).toBe(1); expect(at.vxMps).toBe(1); expect(at.yM).toBe(0);
    expect(motion.sampleAt(exit.timeSeconds).constraint).toBeUndefined();
    expect(motion.sampleAt(exit.timeSeconds).vxMps).toBeLessThan(0);
    const nearEntry = motion.sampleAt(1 - Number.EPSILON / 2);
    expect(nearEntry.constraint?.stageIndex).toBe(1); expect(nearEntry.vxMps).toBe(1);
  });
  it("无精确命中且与两个事件等距时保留后发生的事件", () => {
    const motion = build({ ...endpoint, initial: { speedMps: 1 }, stages: [
      { kind: "horizontal_slide", kineticFrictionCoefficient: 0, end: { kind: "distance", distanceM: 1 } },
      { ...endpoint.stages[0], radiusM: 4 * Number.EPSILON / Math.PI },
    ] });
    const enter = motion.events.find(e => e.kind === "arc_enter")!.timeSeconds;
    const exit = motion.events.find(e => e.kind === "arc_endpoint")!.timeSeconds;
    const middle = (enter + exit) / 2;
    expect(middle).toBeGreaterThan(enter); expect(middle).toBeLessThan(exit);
    expect(middle - enter).toBe(exit - middle);
    expect(motion.sampleAt(middle).constraint).toBeUndefined();
    expect(motion.sampleAt(middle).vxMps).toBeLessThan(0);
  });

  it.each([[8 - 1e-7, "returned_to_entry"], [8, "returned_to_entry"], [8 + 1e-7, "landed"], [20 - 1e-7, "arc_contact_lost"], [20, "arc_endpoint"], [20 + 1e-7, "arc_endpoint"]])("临界能量 %s 保留真实分支", (v2, expected) => {
    const motion = build(withSpeedSquared(v2 as number));
    expect([motion.endReason, ...motion.events.map(e => e.kind)]).toContain(expected);
    for (let i = 0; i <= 100; i++) {
      const s = motion.sampleAt(motion.durationSeconds * i / 100);
      expect([s.xM, s.yM, s.vxMps, s.vyMps].every(Number.isFinite)).toBe(true);
      if (s.constraint) {
        expect(s.constraint.normalForceN).toBeGreaterThanOrEqual(0);
        expect(Math.hypot(s.vxMps, s.vyMps) ** 2 + 20 * s.yM).toBeCloseTo(v2 as number, 6);
      }
    }
  });

  it("2gR 恰在90度零速且零法向力后仍回滑", () => {
    const motion = build(withSpeedSquared(8));
    const turn = motion.events.find(e => e.kind === "arc_turn")!;
    const at = motion.sampleAt(turn.timeSeconds);
    close(at, { xM: .4, yM: .4, vxMps: 0, vyMps: 0 });
    expect(at.constraint?.angleDeg).toBeCloseTo(90, 10); expect(at.constraint?.normalForceN).toBeCloseTo(0, 12);
  });

  it.each([4, 16, 20])("无抛体后缀 u²=%s 用实际圆弧终止事件", (v2) => {
    const input = withSpeedSquared(v2); input.stages = input.stages.slice(0, 1);
    const motion = build(input);
    expect(motion.endReason).toBe(v2 === 4 ? "returned_to_entry" : "arc_detached");
    expect(motion.events[motion.events.length - 1].kind).toBe(v2 === 4 ? "arc_return_entry" : v2 === 16 ? "arc_contact_lost" : "arc_endpoint");
    expect(motion.geometry.projectile).toBeUndefined();
  });

  it("小角端点先到达；恰在转折点的计划端点按回滑优先", () => {
    const input = withSpeedSquared(4); input.stages[0].endAngleDeg = 30;
    expect(build(input).events.map(e => e.kind)).toContain("arc_endpoint");
    input.stages[0].endAngleDeg = 60;
    expect(build(input).endReason).toBe("returned_to_entry");
  });

  it("无损转向可接圆弧，斜面原点与切向速度仍连续", () => {
    const plan = { ...composition, initial: { speedMps: 0 }, stages: [
      { kind: "incline_slide", lengthM: 2, angleDeg: 30, kineticFrictionCoefficient: 0, slidesAfterRelease: true },
      { kind: "lossless_turn", lossless: true }, ...endpoint.stages,
    ] };
    const motion = build(plan); const enter = motion.events.find(e => e.kind === "arc_enter")!;
    expect(motion.geometry.verticalArc?.entry).toEqual({ xM: 0, yM: 0 });
    expect(enter.velocityAfter.vxMps).toBeCloseTo(Math.sqrt(20), 10);
    expect(enter.velocityAfter.vyMps).toBe(0);
    expect(motion.events.filter(e => e.timeSeconds === enter.timeSeconds).map(e => e.kind)).toEqual(["reach_bottom", "lossless_turn", "arc_enter"]);
  });
});

describe("圆弧输入与固定平面", () => {
  it.each(["radiusM", "endAngleDeg", "side", "frictionless"])("缺 %s 定位新阶段字段", (key) => {
    const input = structuredClone(endpoint) as unknown as StagePlanDraft; delete input.stages[0][key];
    expect(validateStagePlan(input)).toMatchObject({ ok: false, code: "NEEDS_INPUT", missingKeys: ["/stages/0/" + key] });
  });
  it.each(["massKg", "gravityMps2"])("圆弧独立需要 %s", (key) => {
    const input = { ...endpoint, [key]: null };
    expect(validateStagePlan(input)).toMatchObject({ ok: false, missingKeys: ["/" + key] });
  });
  it.each([["radiusM", -1, "RANGE"], ["radiusM", Infinity, "NOT_FINITE"], ["radiusM", "0.4", "TYPE"], ["endAngleDeg", 181, "RANGE"], ["endAngleDeg", 0, "RANGE"], ["side", "outside", "UNSUPPORTED"], ["side", false, "TYPE"], ["frictionless", false, "UNSUPPORTED"]])("非法 %s=%s", (key, value, code) => {
    const input = structuredClone(endpoint) as unknown as StagePlanDraft; input.stages[0][key as string] = value;
    expect(validateStagePlan(input)).toMatchObject({ ok: false, fieldErrors: [{ path: "/stages/0/" + key, code }] });
  });
  it("固定地面、旧落差互斥；圆弧不接受相对落差", () => {
    for (const plane of [{ dropHeightM: .8 }, { dropHeightM: null, landingPlaneYM: 0 }]) {
      const input = { ...endpoint, stages: [endpoint.stages[0], { kind: "projectile", ...plane }] };
      expect(validateStagePlan(input)).toMatchObject({ ok: false, code: "INCONSISTENT_CONDITIONS", fieldErrors: [{ path: "/stages/1", code: "PRECONDITION_CONFLICT" }] });
    }
    expect(validateStagePlan({ ...endpoint, stages: [endpoint.stages[0], { kind: "projectile" }] })).toMatchObject({ ok: false, missingKeys: ["/stages/1/landingPlaneYM"] });
  });
  it("固定平面在实际发射点之上时装配定位错误", () => {
    const input = { ...endpoint, stages: [endpoint.stages[0], { kind: "projectile", landingPlaneYM: 1 }] };
    expect(assembleScene(input)).toMatchObject({ ok: false, code: "INCONSISTENT_CONDITIONS", fieldErrors: [{ path: "/stages/1/landingPlaneYM", code: "PRECONDITION_CONFLICT" }] });
  });
  it("独立抛体可选择固定平面，仍保留旧初态规则", () => {
    const motion = build({ kind: "stage_plan", schemaVersion: 1, gravityMps2: 10, initial: { vxMps: 4, vyMps: 0 }, stages: [{ kind: "projectile", landingPlaneYM: -1.25 }] });
    expect(motion.durationSeconds).toBeCloseTo(.5, 12); expect(motion.sampleAt(Infinity).xM).toBeCloseTo(2, 12);
    expect(validateStagePlan({ ...endpoint, initial: { vxMps: 4, vyMps: 0 } })).toMatchObject({ ok: false, code: "INCONSISTENT_CONDITIONS" });
  });
  it.each([1e200, Number.MAX_VALUE])("无法表示的圆弧量级 %s 返回字段错误", (speedMps) => {
    expect(assembleScene({ ...endpoint, initial: { speedMps } })).toMatchObject({ ok: false, code: "INCONSISTENT_CONDITIONS", fieldErrors: [{ path: "/stages/0", code: "RANGE" }] });
  });
});

describe("轻杆 / 双轨竖直圆周运动（side: rod）", () => {
  const rodPlan = (speedMps: number, extraStage: Record<string, unknown> = {}) => ({
    kind: "stage_plan",
    schemaVersion: 1,
    gravityMps2: 10,
    massKg: 0.1,
    initial: { speedMps },
    stages: [{ kind: "vertical_arc", radiusM: 0.4, endAngleDeg: 180, side: "rod", frictionless: true, ...extraStage }],
  });

  const { endAngleDeg: _, ...rodArc } = rodCritical.stages[0];
  const arcForms = [
    ["旧半圆", rodCritical.stages[0]],
    ["显式圆轨", { ...rodArc, path: { startAngleDeg: 0, direction: "positive", end: { kind: "physical_endpoint", sweepAngleDeg: 180 } } }],
  ] as const;

  it.each(arcForms)("%s临界零速只渐近最高点，保持真实运动及约束", (_label, stage) => {
    const motion = build({ ...rodCritical, stages: [stage, rodCritical.stages[1]] });
    const last = motion.events[motion.events.length - 1];
    expect(motion.events.map(e => e.kind)).toEqual(["release", "arc_enter", "arc_range_end"]);
    expect(motion.segments.map(s => s.kind)).toEqual(["vertical_arc"]);
    expect(motion.termination).toMatchObject({ reason: "prefix_end", eventId: last.id, stageIndex: 0 });
    expect(motion.motionStatus).toMatchObject({ state: "range_end", message: expect.stringContaining("趋近最高点") });
    expect(motion.geometry.projectile).toBeUndefined();
    expect(motion.geometry.verticalArc).toMatchObject({ plannedEnd: { xM: 0, yM: .8 }, actualExit: { reason: "range_end" } });
    expect(motion.durationSeconds).toBeCloseTo(1.2, 12);
    for (const time of [.1, .6, motion.durationSeconds - 1e-7, motion.durationSeconds]) {
      const gap = 4 * Math.atan(Math.exp(-5 * time));
      const speed = 4 * Math.sin(gap / 2);
      const sample = motion.sampleAt(time);
      close(sample, { xM: .4 * Math.sin(gap), yM: .4 * (1 + Math.cos(gap)), vxMps: -speed * Math.cos(gap), vyMps: speed * Math.sin(gap) });
      expect(sample.constraint?.angleDeg).toBeLessThan(180);
      expect(sample.constraint?.normalForceN).toBeCloseTo(speed ** 2 / 4 - Math.cos(gap), 11);
      expect(Math.hypot(sample.vxMps, sample.vyMps) ** 2 + 20 * sample.yM).toBeCloseTo(16, 11);
    }
    expect(last.normalForceBeforeN).toBe(last.normalForceAfterN);
    expect(motion.sampleAt(Infinity)).toEqual(motion.sampleAt(last.timeSeconds));
    expect(motion.sampleAt(Infinity).constraint?.forceRole).toBe("support");
  });

  it.each(arcForms)("%s临界两侧的轻杆保留真实回滑或到顶", (_label, stage) => {
    // 完全椭圆积分 K 以算术-几何平均值独立复算近临界积分。
    function ellipticK(complement: number) {
      let a = 1, b = Math.sqrt(complement);
      while (a - b > 1e-15) [a, b] = [(a + b) / 2, Math.sqrt(a * b)];
      return Math.PI / (2 * a);
    }
    const belowSpeed = 4 * (1 - 1e-10), aboveSpeed = 4 * (1 + 1e-10);
    const run = (speedMps: number) => build({ ...rodCritical, initial: { speedMps }, stages: [stage, rodCritical.stages[1]] });
    const below = run(belowSpeed), above = run(aboveSpeed);
    const turn = below.events.find(e => e.kind === "arc_turn")!;
    expect(below.endReason).toBe("returned_to_entry");
    expect(below.geometry.projectile).toBeUndefined();
    expect(turn.timeSeconds).toBeCloseTo(.2 * ellipticK(1 - (belowSpeed / 4) ** 2), 6);
    expect(below.sampleAt(turn.timeSeconds).constraint?.angleDeg).toBeLessThan(180);
    expect(below.sampleAt(Infinity).vxMps).toBeCloseTo(-belowSpeed, 12);
    const endpoint = above.events.find(e => e.kind === "arc_endpoint")!;
    const launch = above.events.find(e => e.kind === "projectile_launch")!;
    const k2 = (4 / aboveSpeed) ** 2;
    expect(endpoint.timeSeconds).toBeCloseTo(.2 * Math.sqrt(k2) * ellipticK(1 - k2), 6);
    expect(endpoint.timeSeconds).toBe(launch.timeSeconds);
    expect(above.sampleAt(launch.timeSeconds).vxMps).toBeCloseTo(-Math.sqrt(aboveSpeed ** 2 - 16), 10);
    expect(above.endReason).toBe("landed");
  });

  it("轻杆临界能量下，最高点以前的实物端点仍可正速飞出", () => {
    const motion = build({ ...rodCritical, stages: [{ ...rodCritical.stages[0], endAngleDeg: 90 }, rodCritical.stages[1]] });
    const launch = motion.events.find(e => e.kind === "projectile_launch")!;
    expect(launch.timeSeconds).toBeCloseTo(.2 * Math.log(1 / Math.tan(Math.PI / 8)), 12);
    expect(launch.velocityAfter.vxMps).toBe(0);
    expect(launch.velocityAfter.vyMps).toBeCloseTo(Math.sqrt(8), 12);
    expect(motion.endReason).toBe("landed");
  });

  it.each([1, -1])("显式临界轻杆从非最低点进弧，可真实通过最低点，方向 %s", direction => {
    const motion = build({
      ...rodCritical, initial: { speedMps: Math.sqrt(12) },
      stages: [{ ...rodArc, path: {
        startAngleDeg: -60 * direction, direction: direction > 0 ? "positive" : "negative",
        end: { kind: "observation", sweepAngleDeg: 360 },
      } }],
    });
    expect(motion.events.map(e => e.kind)).toEqual(["release", "arc_enter", "arc_lowest", "arc_range_end"]);
    const bottom = motion.events[2], end = motion.sampleAt(Infinity);
    expect(bottom.timeSeconds).toBeCloseTo(.2 * Math.log(Math.sqrt(3)), 12);
    expect(bottom.velocityAfter.vxMps).toBeCloseTo(4 * direction, 12);
    expect(end.constraint?.angularVelocityRadps).toBeDefined();
    expect(end.constraint!.angularVelocityRadps * direction).toBeGreaterThan(0);
    expect(Math.abs(end.constraint!.angleDeg)).toBeLessThan(180);
  });

  it("最高点 0 < v < √(gR)（v0² = 4.5gR）：杆提供向上支持力（N < 0，方向向上）", () => {
    const motion = build(rodPlan(Math.sqrt(18)));
    const endEv = motion.events.find(e => e.kind === "arc_endpoint")!;
    expect(endEv.normalForceBeforeN).toBeCloseTo(-0.5, 6);
    expect(endEv.explanation).toContain("支持力");
    const nearTop = motion.sampleAt(endEv.timeSeconds - 1e-6);
    expect(nearTop.constraint?.forceRole).toBe("support");
    expect(nearTop.constraint?.normalDirection?.y).toBeGreaterThan(0.99);
  });

  it("最高点 v > √(gR)（v0² = 6gR）：杆提供向下拉力（N > 0，方向向下）", () => {
    const motion = build(rodPlan(Math.sqrt(24)));
    const endEv = motion.events.find(e => e.kind === "arc_endpoint")!;
    expect(endEv.normalForceBeforeN).toBeCloseTo(1, 6);
    expect(endEv.explanation).toContain("拉力");
    const nearTop = motion.sampleAt(endEv.timeSeconds - 1e-6);
    expect(nearTop.constraint?.forceRole).toBe("pull");
    expect(nearTop.constraint?.normalDirection?.y).toBeLessThan(-0.99);
  });

  it("2gR < v0² < 4gR（v0² = 3gR）：单内轨会脱轨，但轻杆在 120° 处零速平滑折返且不脱轨", () => {
    const motion = build(rodPlan(Math.sqrt(12)));
    expect(motion.endReason).toBe("returned_to_entry");
    expect(motion.events.some(e => e.kind === "arc_contact_lost")).toBe(false);
    const turn = motion.events.find(e => e.kind === "arc_turn")!;
    expect(turn.normalForceBeforeN).toBeCloseTo(-0.5, 6);
    expect(motion.sampleAt(turn.timeSeconds).constraint?.angleDeg).toBeCloseTo(120, 6);
    expect(motion.sampleAt(turn.timeSeconds).constraint?.forceRole).toBe("support");
  });

  it("显式 path 整圆轻杆（360°）：v0² = 4.5gR 完整绕行一圈，最高点支持力 -0.5 N、最低点拉力 5.5 N", () => {
    const motion = build({
      kind: "stage_plan", schemaVersion: 1, gravityMps2: 10, massKg: 0.1,
      initial: { speedMps: Math.sqrt(18) },
      stages: [{
        kind: "vertical_arc", radiusM: 0.4, side: "rod", frictionless: true,
        path: { startAngleDeg: 0, direction: "positive", end: { kind: "observation", sweepAngleDeg: 360 } },
      }],
    });
    expect(motion.events.some(e => e.kind === "arc_contact_lost")).toBe(false);
    const topEv = motion.events.find(e => e.kind === "arc_top")!;
    expect(topEv).toBeDefined();
    expect(topEv.normalForceBeforeN).toBeCloseTo(-0.5, 6);
    expect(topEv.explanation).toContain("支持力");
    expect(motion.sampleAt(0).constraint?.normalForceN).toBeCloseTo(5.5, 6);
    expect(motion.sampleAt(0).constraint?.forceRole).toBe("pull");
  });

  it("critical_arc_top 约束配合 side: rod 按 v_top = 0 反求 R = u²/(4g)", () => {
    const res = validateStagePlan({
      kind: "stage_plan", schemaVersion: 1, gravityMps2: 10, massKg: 0.1,
      initial: { speedMps: 4 },
      constraints: [{ kind: "critical_arc_top", stageIndex: 0 }],
      stages: [{ kind: "vertical_arc", radiusM: null, endAngleDeg: 180, side: "rod", frictionless: true }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const st = res.reading.stages[0] as Extract<typeof res.reading.stages[0], { kind: "vertical_arc" }>;
      expect(st.radiusM).toBeCloseTo(0.4, 9);
    }
  });
});
