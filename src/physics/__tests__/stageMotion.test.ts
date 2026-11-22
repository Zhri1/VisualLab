import { describe, expect, it } from "vitest";
import complete from "../../../fixtures/stage-composition.reading.json";
import legacy from "../../../fixtures/incline-spring.reading.json";
import { assembleScene, assembleStageScene, buildMotion, validateStagePlan } from "../index";
import type { StageMotion } from "../index";

function run(input: unknown): StageMotion {
  const validation = validateStagePlan(input);
  if (!validation.ok) throw new Error(JSON.stringify(validation));
  const assembled = assembleScene(validation.reading);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled));
  const built = buildMotion(assembled.scene);
  return built.motion;
}
function event(motion: StageMotion, kind: string) {
  const found = motion.events.find((item) => item.kind === kind);
  if (!found) throw new Error("缺少事件 " + kind);
  return found;
}
function close(actual: number, expected: number, tolerance = 1e-10) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}
function withEdge(distanceM: number) {
  const copy = structuredClone(complete);
  copy.stages[2].end!.distanceM = distanceM;
  return copy;
}

describe("动态有序阶段组合", () => {
  it("完整链在2.7s落地，坡底原点、几何与末速度符合契约", () => {
    const motion = run(complete);
    close(event(motion, "reach_bottom").timeSeconds, 1.2);
    close(event(motion, "lossless_turn").timeSeconds, 1.2);
    close(event(motion, "leave_table").timeSeconds, 2.2);
    close(motion.durationSeconds, 2.7);
    expect(motion.endReason).toBe("landed");
    const end = motion.sampleAt(motion.durationSeconds);
    close(end.xM, 7);
    expect(end.yM).toBe(-1.25);
    close(end.vxMps, 4);
    close(end.vyMps, -5);
    expect(end.springCompressionM).toBe(0);
    expect(motion.geometry).toMatchObject({
      incline: { end: { xM: 0, yM: 0 } },
      horizontal: { start: { xM: 0, yM: 0 }, plannedEnd: { xM: 5, yM: 0 } },
      projectile: { launch: { xM: 5, yM: 0 }, landingPlane: { yM: -1.25 } },
      positionReference: "front_bottom", blockSizeM: 0.3,
    });
    close(motion.geometry.incline!.start.xM, -1.8 * Math.sqrt(3));
    close(motion.geometry.incline!.start.yM, 1.8);
    expect(motion.segments.map((item) => [item.stageIndex, item.kind])).toEqual([[0, "incline_slide"], [2, "horizontal_slide"], [3, "projectile"]]);
    expect(motion.events.map((item) => item.kind)).toEqual(["release", "reach_bottom", "lossless_turn", "reach_target", "leave_table", "land"]);
  });

  it("十进制时刻落在事件时刻1 ulp内时仍取事件状态", () => {
    // 事件时刻由各段时长累加得到，这里实际是 1.2000000000000002；
    // 播放进度按十进制 1.2 推进，严格相等会错过转向、停在坡底前一瞬。
    const motion = run(complete);
    const turn = event(motion, "lossless_turn");
    expect(Math.abs(turn.timeSeconds - 1.2)).toBeLessThanOrEqual(1e-9);
    const atDecimal = motion.sampleAt(1.2);
    close(atDecimal.vxMps, 6);
    expect(atDecimal.vyMps).toBe(0);
    expect(atDecimal).toEqual(motion.sampleAt(turn.timeSeconds));
    // 容差只吸收浮点误差，不吞掉事件前的采样
    close(motion.sampleAt(1.2 - 1e-7).vxMps, 3 * Math.sqrt(3), 1e-6);
    expect(motion.sampleAt(1.2 - 1e-7).vyMps).toBeLessThan(0);
  });

  it("完整链与斜面前缀在t−ε、t、t+ε取不同且连续的末态", () => {
    const full = run(complete);
    const prefix = run({ ...complete, stages: complete.stages.slice(0, 1) });
    const t = event(full, "reach_bottom").timeSeconds;
    const epsilon = 1e-7;
    const expectedVx = 3 * Math.sqrt(3);
    for (const motion of [full, prefix]) {
      const before = motion.sampleAt(t - epsilon);
      close(before.vxMps, expectedVx, 1e-6);
      close(before.vyMps, -3, 1e-6);
      close(before.xM, 0, 1e-6);
      close(before.yM, 0, 1e-6);
    }
    const atFull = full.sampleAt(t);
    expect(atFull.xM).toBe(0);
    expect(atFull.yM).toBe(0);
    close(atFull.vxMps, 6);
    expect(atFull.vyMps).toBe(0);
    const afterFull = full.sampleAt(t + epsilon);
    close(afterFull.vxMps, 6 - 2 * epsilon);
    expect(afterFull.vyMps).toBe(0);
    close(afterFull.xM, 6 * epsilon - epsilon ** 2);
    const atPrefix = prefix.sampleAt(prefix.durationSeconds);
    close(atPrefix.vxMps, expectedVx);
    close(atPrefix.vyMps, -3);
    expect(prefix.sampleAt(t + epsilon)).toEqual(atPrefix);
    expect(prefix.sampleAt(Infinity)).toEqual(atPrefix);
    expect(prefix.endReason).toBe("prefix_end");
    expect(prefix.geometry.horizontal).toBeUndefined();
    expect(prefix.geometry.projectile).toBeUndefined();
    expect(prefix.events.some((item) => item.kind === "lossless_turn")).toBe(false);
    expect(prefix.geometry.incline).toEqual(full.geometry.incline);
    expect(complete.stages).toHaveLength(4);
  });

  for (const [distance, reason] of [[10, "stop_before_target"], [9, "stop_at_target"]] as const) {
    it(`桌沿${distance}m时在4.2s停住，并保留题设桌沿`, () => {
      const motion = run(withEdge(distance));
      close(motion.durationSeconds, 4.2);
      const end = motion.sampleAt(motion.durationSeconds);
      close(end.xM, 9);
      expect(end.vxMps).toBe(0);
      expect(end.vyMps).toBe(0);
      expect(end.yM).toBe(0);
      expect(end.springCompressionM).toBe(0);
      expect(motion.endReason).toBe(reason);
      expect(motion.termination.reason).toBe(reason);
      expect(motion.events[motion.events.length - 1].kind).toBe("stop");
      expect(motion.termination.eventId).toBe(motion.events[motion.events.length - 1].id);
      expect(motion.termination.stageIndex).toBe(2);
      expect(motion.geometry.horizontal!.plannedEnd).toEqual({ xM: distance, yM: 0 });
      expect(motion.geometry.projectile).toBeUndefined();
      expect(motion.segments.some((item) => item.kind === "projectile")).toBe(false);
      expect(motion.events.some((item) => ["leave_table", "apex", "land"].includes(item.kind))).toBe(false);
      expect(motion.sampleAt(motion.durationSeconds + 100)).toEqual(end);
      expect(motion.sampleAt(Infinity)).toEqual(end);
      expect(motion.sampleAt(motion.durationSeconds - 1e-7).vxMps).toBeGreaterThan(0);
      if (reason === "stop_at_target") expect(end.xM).toBe(motion.geometry.horizontal!.plannedEnd!.xM);
    });
  }

  it("同刻事件order唯一递增，精确事件时间取最后执行的状态", () => {
    const motion = run(complete);
    expect(new Set(motion.events.map((item) => item.id)).size).toBe(motion.events.length);
    expect(motion.events.map((item) => item.order)).toEqual(motion.events.map((_, index) => index));
    const turn = event(motion, "lossless_turn");
    close(turn.velocityBefore.vxMps, 3 * Math.sqrt(3));
    close(turn.velocityBefore.vyMps, -3);
    close(turn.velocityAfter.vxMps, 6);
    expect(turn.velocityAfter.vyMps).toBe(0);
    for (const item of motion.events) {
      const sameTime = motion.events.filter((other) => other.timeSeconds === item.timeSeconds);
      const last = sameTime[sameTime.length - 1];
      const sample = motion.sampleAt(item.timeSeconds);
      expect({ vxMps: sample.vxMps, vyMps: sample.vyMps }).toEqual(last.velocityAfter);
    }
    for (let i = 1; i < motion.segments.length; i++) {
      expect(motion.segments[i].startSeconds).toBe(motion.segments[i - 1].endSeconds);
    }
    expect(motion.sampleAt(-1)).toEqual(motion.sampleAt(0));
    expect(motion.sampleAt(NaN)).toEqual(motion.sampleAt(0));
    expect(motion.sampleAt(100)).toEqual(motion.sampleAt(motion.durationSeconds));
  });

  it("同一计划更换阶段前缀，转向仅在包含该段时执行", () => {
    const prefix = run({ ...complete, stages: complete.stages.slice(0, 2) });
    expect(prefix.events[prefix.events.length - 1].kind).toBe("lossless_turn");
    expect(prefix.endReason).toBe("prefix_end");
    close(prefix.durationSeconds, 1.2);
    expect(prefix.segments).toHaveLength(1);
    expect(prefix.sampleAt(prefix.durationSeconds).vyMps).toBe(0);
  });

  it("把旧斜面弹簧转换为阶段后，仍使用同样的低层公式", () => {
    const c = legacy.conditions;
    const composed = run({
      kind: "stage_plan", schemaVersion: 1, gravityMps2: c.gravityMps2, massKg: c.blockMassKg,
      initial: { speedMps: 0 },
      stages: [
        { kind: "incline_slide", lengthM: c.inclineLengthM, angleDeg: c.inclineAngleDeg, kineticFrictionCoefficient: c.kineticFrictionCoefficient, slidesAfterRelease: true },
        { kind: "lossless_turn", lossless: true },
        { kind: "horizontal_slide", kineticFrictionCoefficient: 0, end: { kind: "distance", distanceM: c.springGapM } },
        { kind: "spring_contact", springConstantNpm: c.springConstantNpm, frictionless: true, unattached: true },
      ],
    });
    const legacyScene = assembleScene(legacy);
    if (!legacyScene.ok) throw new Error(legacyScene.message);
    const legacyMotion = buildMotion(legacyScene.scene);
    if (!legacyMotion.ok) throw new Error(legacyMotion.message);
    const original = legacyMotion.motion;
    close(composed.durationSeconds, original.durationSeconds);
    close(event(composed, "spring_contact").timeSeconds, 2.2360830607403024);
    close(event(composed, "max_compression").timeSeconds, 2.314622877080047);
    const maximum = composed.sampleAt(event(composed, "max_compression").timeSeconds);
    close(maximum.springCompressionM, 0.20124476049249176);
    expect(maximum.vxMps).toBe(0);
    expect(composed.endReason).toBe("spring_detached");
    expect(composed.sampleAt(composed.durationSeconds).springCompressionM).toBe(0);
    close(composed.sampleAt(composed.durationSeconds).vxMps, -4.024895209849835);
    expect(composed.geometry.spring!.anchor.xM).toBeGreaterThan(maximum.xM);
    for (let i = 0; i <= 100; i++) {
      const t = original.durationSeconds * i / 100;
      const old = original.sampleAt(t);
      const current = composed.sampleAt(t);
      close(current.xM, old.xM);
      close(current.yM, old.yM);
      close(current.vxMps, old.vxMps);
      close(current.vyMps, old.vyMps);
      close(current.springCompressionM, old.springCompressionM);
    }
  });

  it("独立抛体含实际最高点，落差相对发射点且保留入射速度", () => {
    const motion = run({ kind: "stage_plan", schemaVersion: 1, gravityMps2: 10, initial: { vxMps: 4, vyMps: 10 }, stages: [{ kind: "projectile", dropHeightM: 0 }] });
    close(motion.durationSeconds, 2);
    close(event(motion, "apex").timeSeconds, 1);
    expect(motion.sampleAt(1).vyMps).toBe(0);
    close(motion.sampleAt(1).yM, 5);
    expect(motion.sampleAt(2)).toEqual({ xM: 8, yM: 0, vxMps: 4, vyMps: -10, springCompressionM: 0 });
  });

  it("独立弹簧、零速停止及零落差抛体处理零时长边界", () => {
    const spring = run({ kind: "stage_plan", schemaVersion: 1, massKg: 1, initial: { speedMps: 2 }, stages: [{ kind: "spring_contact", springConstantNpm: 100, frictionless: true, unattached: true }] });
    close(spring.durationSeconds, Math.PI / 10);
    close(spring.sampleAt(Math.PI / 20).springCompressionM, 0.2);
    const stopped = run({ kind: "stage_plan", schemaVersion: 1, initial: { speedMps: 0 }, stages: [{ kind: "horizontal_slide", kineticFrictionCoefficient: 0, end: { kind: "stop" } }] });
    expect(stopped.durationSeconds).toBe(0);
    expect(stopped.endReason).toBe("stopped");
    expect(stopped.segments).toEqual([]);
    const landed = run({ kind: "stage_plan", schemaVersion: 1, gravityMps2: 10, initial: { vxMps: 0, vyMps: -2 }, stages: [{ kind: "projectile", dropHeightM: 0 }] });
    expect(landed.durationSeconds).toBe(0);
    expect(landed.endReason).toBe("landed");
    expect(landed.events.map((item) => item.kind)).toEqual(["release", "land"]);
    expect(landed.sampleAt(10).vyMps).toBe(-2);
  });

  it("带初速的斜面可先减速停止，后续转向不执行", () => {
    const motion = run({ ...complete, initial: { speedMps: 1 }, stages: [{ ...complete.stages[0], kineticFrictionCoefficient: 1 }, complete.stages[1]] });
    expect(motion.endReason).toBe("stop_before_target");
    expect(motion.events[motion.events.length - 1].kind).toBe("stop");
    expect(motion.events.some((item) => item.kind === "lossless_turn")).toBe(false);
    expect(motion.sampleAt(motion.durationSeconds).vxMps).toBe(0);
    expect(motion.sampleAt(motion.durationSeconds).vyMps).toBe(0);
  });

  it("装配复用共享校验，结构失败和字段定位保持原样", () => {
    expect(assembleStageScene(withEdge(-1))).toMatchObject({ ok: false, code: "INCONSISTENT_CONDITIONS", fieldErrors: [{ path: "/stages/2/end/distanceM" }] });
  });

  it("水平接弹簧通过有序阶段复用，省略未使用的重力", () => {
    const motion = run({
      kind: "stage_plan", schemaVersion: 1, massKg: 1, initial: { speedMps: 2 },
      stages: [
        { kind: "horizontal_slide", kineticFrictionCoefficient: 0, end: { kind: "distance", distanceM: 1 } },
        { kind: "spring_contact", springConstantNpm: 100, frictionless: true, unattached: true },
      ],
    });
    close(event(motion, "spring_contact").timeSeconds, 0.5);
    close(motion.durationSeconds, 0.5 + Math.PI / 10);
    close(motion.sampleAt(event(motion, "max_compression").timeSeconds).springCompressionM, 0.2);
    expect(motion.sampleAt(motion.durationSeconds)).toEqual({ xM: 1, yM: 0, vxMps: -2, vyMps: 0, springCompressionM: 0 });
  });

  it("unknown输入经公开入口收窄后可构建新旧场景", () => {
    const input: unknown = complete;
    const assembled = assembleScene(input);
    if (!assembled.ok) throw new Error(assembled.message);
    const built = buildMotion(assembled.scene);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.message);
    if ("kind" in assembled.scene) expect(assembled.scene.kind).toBe("stage_scene");
    else throw new Error("应为阶段场景");
    expect("termination" in built.motion).toBe(true);
  });
});
