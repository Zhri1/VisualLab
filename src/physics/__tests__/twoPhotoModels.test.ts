import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateStagePlan, assembleStageScene, buildStageMotion } from "../index";
import { adaptStageMotion } from "../../adapters/stageMotionAdapter";
import { validateStagePlan as validateQoderStagePlan } from "../../../functions/stagePlan";

const loadFixture = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "fixtures", name), "utf8"));

describe("switchable_em_collision 分区电磁场与双粒子正碰回归", () => {
  it("归一化标度下精确复现入磁角 -30°、E/B、撤场时长 6L/(√7 v₀) 与甲路程 2√21L/7，且仅撤下半区磁场", () => {
    const raw = loadFixture("switchable-em-collision.reading.json");
    const vNode = validateStagePlan(raw);
    const vQoder = validateQoderStagePlan(raw);
    expect(vNode.ok).toBe(true);
    expect(vQoder.ok).toBe(true);
    if (!vNode.ok) return;

    const scene = assembleStageScene(vNode.reading);
    expect(scene.ok).toBe(true);
    if (!scene.ok) return;
    const built = buildStageMotion(scene.scene);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const motion = built.motion;

    // 1. 核对 E、B、E/B、撤场时长、甲漂移路程
    const byName = (q: string) => motion.calculations?.find((c) => c.quantity === q)?.value;
    expect(byName("电场强度 E")).toBeCloseTo(1 / 6, 10);
    expect(byName("磁感应强度 B")).toBeCloseTo(1 / 3, 10);
    expect(byName("场强比 E/B")).toBeCloseTo(0.5, 10);
    expect(byName("撤场至恢复的时长")).toBeCloseTo(6 / Math.sqrt(7), 10);
    expect(byName("撤场期间甲的路程")).toBeCloseTo((2 * Math.sqrt(21)) / 7, 10);

    // 2. 核对入磁角 -30°、事件序列以及仅撤磁场（上半区电场保持存在）
    const enter = motion.events.find((e) => e.kind === "magnetic_enter")!;
    const enterAngleDeg = (Math.atan2(enter.velocityAfter.vyMps, enter.velocityAfter.vxMps) * 180) / Math.PI;
    expect(enterAngleDeg).toBeCloseTo(-30, 8);
    expect(motion.events.map((e) => e.kind)).toEqual([
      "release",
      "magnetic_enter",
      "em_collision",
      "fields_off",
      "magnetic_restored",
      "observation_end",
    ]);
    const fieldsOff = motion.events.find((e) => e.kind === "fields_off")!;
    expect(fieldsOff.label).toContain("撤去磁场");
    expect(fieldsOff.label).not.toContain("两场撤去");
    expect(fieldsOff.explanation).toContain("上半区电场保持存在");

    // 3. 核对恢复磁场两圆外切且不表示再次碰撞
    const em = motion.geometry.switchableEM!;
    expect(em.scaleMode).toBe("normalized");
    const [c0, c1] = em.circles;
    const centerDist = Math.hypot(c1.center.xM - c0.center.xM, c1.center.yM - c0.center.yM);
    expect(centerDist).toBeCloseTo(c0.radiusM + c1.radiusM, 8);
    expect(c0.center.yM + c0.radiusM).toBeLessThanOrEqual(1e-9);
    expect(c1.center.yM + c1.radiusM).toBeLessThanOrEqual(1e-9);
    const restoredEv = motion.events.find((e) => e.kind === "magnetic_restored")!;
    expect(restoredEv.explanation).toContain("不表示两粒子发生再次碰撞");

    // 4. 适配层透传双粒子与 switchableEM 几何
    const adapted = adaptStageMotion(motion, vNode.reading);
    expect(adapted.primaryBodyId).toBe("甲");
    expect(adapted.stageGeometry?.switchableEM?.scaleMode).toBe("normalized");
    const midDrift = adapted.sampleAt((em.offSeconds + em.restoreSeconds) / 2);
    expect(Object.keys(midDrift.bodies ?? {}).sort()).toEqual(["乙", "甲"]);
  });

  it("SI 标度与非归一化参数按标度律正确缩放", () => {
    const raw = loadFixture("switchable-em-collision.reading.json");
    raw.stages[0] = {
      ...raw.stages[0],
      scaleMode: "si",
      massScaleKg: 2,
      chargeScaleC: 0.5,
      lengthScaleM: 3,
      speedScaleMps: 4,
    };
    const v = validateStagePlan(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const scene = assembleStageScene(v.reading);
    expect(scene.ok).toBe(true);
    if (!scene.ok) return;
    const built = buildStageMotion(scene.scene);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const byName = (q: string) => built.motion.calculations?.find((c) => c.quantity === q)?.value;
    expect(byName("电场强度 E")).toBeCloseTo(32 / 9, 8);
    expect(byName("撤场至恢复的时长")).toBeCloseTo((6 * 3) / (Math.sqrt(7) * 4), 8);
    expect(byName("撤场期间甲的路程")).toBeCloseTo((2 * Math.sqrt(21) * 3) / 7, 8);
  });

  it("磁场方向反向时给出可定位前提冲突", () => {
    const raw = loadFixture("switchable-em-collision.reading.json");
    raw.stages[0].fieldDirection = "into_page";
    const v = validateStagePlan(raw);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe("INCONSISTENT_CONDITIONS");
    expect(v.fieldErrors.some((e) => e.path === "/stages/0/fieldDirection")).toBe(true);
  });
});

describe("conveyor_belt (足够长与显式带长) + movable_semicircle 回归", () => {
  it("足够长传送带接可平动半圆精确复现坡底 4 m/s、共速 5 m/s、滑痕 0.2 m、摩擦功 0.9 J、顶点相对速 3 m/s、压力 3 N 与绝对速 -2.2/+0.8 m/s", () => {
    const raw = loadFixture("conveyor-movable-semicircle.reading.json");
    const vNode = validateStagePlan(raw);
    const vQoder = validateQoderStagePlan(raw);
    expect(vNode.ok).toBe(true);
    expect(vQoder.ok).toBe(true);
    if (!vNode.ok) return;

    const scene = assembleStageScene(vNode.reading);
    expect(scene.ok).toBe(true);
    if (!scene.ok) return;
    const built = buildStageMotion(scene.scene);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const motion = built.motion;

    const bottom = motion.events.find((e) => e.kind === "reach_bottom")!;
    expect(Math.hypot(bottom.velocityAfter.vxMps, bottom.velocityAfter.vyMps)).toBeCloseTo(4, 8);

    const common = motion.events.find((e) => e.kind === "conveyor_common_velocity")!;
    expect(common.velocityAfter.vxMps).toBeCloseTo(5, 8);
    expect(common.conveyorSlipDistanceM).toBeCloseTo(0.2, 8);
    expect(common.conveyorFrictionWorkJ).toBeCloseTo(0.9, 8);

    expect(motion.geometry.conveyor?.beltLengthM).toBeNull();
    expect(motion.geometry.conveyor?.endOmitted).toBe(true);
    expect(motion.playbackGaps?.length).toBe(1);
    expect(motion.events.some((e) => e.kind === "conveyor_uniform_omitted")).toBe(true);

    const top = motion.events.find((e) => e.kind === "movable_semicircle_top")!;
    expect(top.normalForceAfterN).toBeCloseTo(3, 8);
    const endSample = motion.sampleAt(motion.durationSeconds);
    const endGroove = motion.movableSemicircleAt?.(motion.durationSeconds)!;
    expect(endSample.vxMps).toBeCloseTo(-2.2, 8);
    expect(endGroove.grooveVX).toBeCloseTo(0.8, 8);
    expect(endGroove.relativeSpeedMps).toBeCloseTo(3, 8);
    expect(endSample.constraint?.normalForceN).toBeCloseTo(3, 8);
    expect(endGroove.grooveXM).toBeGreaterThan(motion.geometry.movableSemicircle!.entry.xM);

    const adapted = adaptStageMotion(motion, vNode.reading);
    expect(adapted.playbackGaps?.length).toBe(1);
    expect(adapted.movableSemicircleAt?.(adapted.durationSeconds)?.grooveVX).toBeCloseTo(0.8, 8);
  });

  it("显式带长变式按实际带长计算，不省略共速段；短带未共速按实际离带速进入半圆", () => {
    const longExplicit = loadFixture("conveyor-movable-semicircle.reading.json");
    longExplicit.stages[2] = {
      kind: "conveyor_belt",
      initialBeltSpeedMps: 5,
      kineticFrictionCoefficient: 0.25,
      beltLengthM: 3.0,
      entryEdge: "start",
      continuationExitEdge: "end",
    };
    const vLong = validateStagePlan(longExplicit);
    expect(vLong.ok).toBe(true);
    if (vLong.ok) {
      const s = assembleStageScene(vLong.reading);
      expect(s.ok).toBe(true);
      if (s.ok) {
        const m = buildStageMotion(s.scene);
        expect(m.ok).toBe(true);
        if (m.ok) {
          expect(m.motion.playbackGaps).toBeUndefined();
          expect(m.motion.geometry.conveyor?.beltLengthM).toBe(3.0);
          expect(m.motion.geometry.conveyor?.endOmitted).toBeUndefined();
          const exitEv = m.motion.events.find((e) => e.kind === "conveyor_exit")!;
          expect(exitEv.velocityAfter.vxMps).toBeCloseTo(5, 8);
        }
      }
    }

    const shortExplicit = loadFixture("conveyor-movable-semicircle.reading.json");
    shortExplicit.stages[2] = {
      kind: "conveyor_belt",
      initialBeltSpeedMps: 5,
      kineticFrictionCoefficient: 0.25,
      beltLengthM: 1.0,
      entryEdge: "start",
      continuationExitEdge: "end",
    };
    const vShort = validateStagePlan(shortExplicit);
    expect(vShort.ok).toBe(true);
    if (vShort.ok) {
      const s = assembleStageScene(vShort.reading);
      expect(s.ok).toBe(true);
      if (s.ok) {
        const m = buildStageMotion(s.scene);
        expect(m.ok).toBe(true);
        if (m.ok) {
          const enterEv = m.motion.events.find((e) => e.kind === "movable_semicircle_enter")!;
          expect(enterEv.velocityAfter.vxMps).toBeCloseTo(Math.sqrt(21), 6);
        }
      }
    }
  });
});

describe("BT-1 切入角预检一致性与 BT-3 双段 1/4 圆管回归", () => {
  it("斜面切向入圆轨角度不匹配时，Node 与 Qoder validateStagePlan 均在预检阶段拦截", () => {
    const mismatched = {
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      massKg: 1,
      initial: { speedMps: 0 },
      stages: [
        { kind: "incline_slide", lengthM: 2, angleDeg: 37, kineticFrictionCoefficient: 0, slidesAfterRelease: true },
        { kind: "vertical_arc", radiusM: 0.4, side: "inside", frictionless: true, path: { startAngleDeg: 0, direction: "positive", end: { kind: "observation", sweepAngleDeg: 360 } } },
      ],
    };
    const vNode = validateStagePlan(mismatched);
    const vQoder = validateQoderStagePlan(mismatched);
    expect(vNode.ok).toBe(false);
    expect(vQoder.ok).toBe(false);
    if (!vNode.ok) {
      expect(vNode.code).toBe("INCONSISTENT_CONDITIONS");
      expect(vNode.fieldErrors.some((e) => e.path === "/stages/1/path")).toBe(true);
    }

    // 修正入口角为 -37° 后，两端校验与装配计算均通过
    const matched = structuredClone(mismatched);
    (matched.stages[1] as { path: { startAngleDeg: number } }).path.startAngleDeg = -37;
    const vOk = validateStagePlan(matched);
    expect(vOk.ok).toBe(true);
    if (vOk.ok) {
      const scene = assembleStageScene(vOk.reading);
      expect(scene.ok).toBe(true);
      if (scene.ok) {
        const built = buildStageMotion(scene.scene);
        expect(built.ok).toBe(true);
        if (built.ok) {
          const top = built.motion.events.find((e) => e.kind === "arc_top")!;
          expect(top.normalForceAfterN).toBeCloseTo(14.209, 2);
        }
      }
    }
  });

  it("两段连续 1/4 细圆管（D→E→F）精确计算 vF ≈ 4.899 m/s、NF ≈ 8.40 N", () => {
    const pipePlan = {
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      massKg: 0.12,
      initial: { speedMps: Math.sqrt(8) },
      stages: [
        { kind: "vertical_arc", radiusM: 0.4, side: "rod", frictionless: true, path: { center: { xM: 0, yM: -0.4 }, startAngleDeg: 180, direction: "negative", end: { kind: "physical_endpoint", sweepAngleDeg: 90 } }, startLabel: "D", endLabel: "E" },
        { kind: "vertical_arc", radiusM: 0.4, side: "rod", frictionless: true, path: { startAngleDeg: -90, direction: "positive", end: { kind: "physical_endpoint", sweepAngleDeg: 90 } }, startLabel: "E", endLabel: "F" },
      ],
    };
    const v = validateStagePlan(pipePlan);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const scene = assembleStageScene(v.reading);
    expect(scene.ok).toBe(true);
    if (!scene.ok) return;
    const built = buildStageMotion(scene.scene);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const lowest = built.motion.events.find((e) => e.kind === "arc_lowest")!;
    expect(Math.hypot(lowest.velocityAfter.vxMps, lowest.velocityAfter.vyMps)).toBeCloseTo(Math.sqrt(24), 6);
    expect(lowest.normalForceAfterN).toBeCloseTo(8.4, 6);
  });
});
