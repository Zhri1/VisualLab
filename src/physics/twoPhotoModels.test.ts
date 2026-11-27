import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateStagePlan, assembleStageScene, buildStageMotion } from "./index";
import { adaptStageMotion } from "../adapters/stageMotionAdapter";
import { validateStagePlan as validateQoderStagePlan } from "../../functions/stagePlan";

const loadFixture = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "fixtures", name), "utf8"));

describe("switchable_em_collision 分区电磁场与双粒子正碰回归", () => {
  it("归一化标度下精确复现入磁角 -30°、E/B、撤场时长 6L/(√7 v₀) 与甲路程 2√21L/7", () => {
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

    // 2. 核对入磁角 -30° 与事件序列
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
    // E = m v0^2 / (6 q L) = 2 * 16 / (6 * 0.5 * 3) = 32 / 9
    expect(byName("电场强度 E")).toBeCloseTo(32 / 9, 8);
    // Δt = 6 L / (√7 v0) = 18 / (4√7)
    expect(byName("撤场至恢复的时长")).toBeCloseTo((6 * 3) / (Math.sqrt(7) * 4), 8);
    // distance = (2√21 / 7) L
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

    // 1. 坡底 4 m/s
    const bottom = motion.events.find((e) => e.kind === "reach_bottom")!;
    expect(Math.hypot(bottom.velocityAfter.vxMps, bottom.velocityAfter.vyMps)).toBeCloseTo(4, 8);

    // 2. 共速 5 m/s、滑痕 0.2 m、摩擦功 0.9 J
    const common = motion.events.find((e) => e.kind === "conveyor_common_velocity")!;
    expect(common.velocityAfter.vxMps).toBeCloseTo(5, 8);
    expect(common.conveyorSlipDistanceM).toBeCloseTo(0.2, 8);
    expect(common.conveyorFrictionWorkJ).toBeCloseTo(0.9, 8);

    // 3. 明确标注略去未知共速段，不把 1.8 m 当作物理带长
    expect(motion.geometry.conveyor?.beltLengthM).toBeNull();
    expect(motion.geometry.conveyor?.endOmitted).toBe(true);
    expect(motion.playbackGaps?.length).toBe(1);
    expect(motion.events.some((e) => e.kind === "conveyor_uniform_omitted")).toBe(true);

    // 4. 可平动半圆顶点相对速率 3 m/s、压力 3 N、绝对速度 -2.2 和 +0.8 m/s
    const top = motion.events.find((e) => e.kind === "movable_semicircle_top")!;
    expect(top.normalForceAfterN).toBeCloseTo(3, 8);
    const endSample = motion.sampleAt(motion.durationSeconds);
    const endGroove = motion.movableSemicircleAt?.(motion.durationSeconds)!;
    expect(endSample.vxMps).toBeCloseTo(-2.2, 8);
    expect(endGroove.grooveVX).toBeCloseTo(0.8, 8);
    expect(endGroove.relativeSpeedMps).toBeCloseTo(3, 8);
    expect(endSample.constraint?.normalForceN).toBeCloseTo(3, 8);
    expect(endGroove.grooveXM).toBeGreaterThan(motion.geometry.movableSemicircle!.entry.xM);

    // 5. 适配层透传 playbackGaps 和 movableSemicircleAt
    const adapted = adaptStageMotion(motion, vNode.reading);
    expect(adapted.playbackGaps?.length).toBe(1);
    expect(adapted.movableSemicircleAt?.(adapted.durationSeconds)?.grooveVX).toBeCloseTo(0.8, 8);
  });

  it("显式带长变式按实际带长计算，不省略共速段；短带未共速按实际离带速进入半圆", () => {
    // 变式 A：显式带长 3.0 m（> 1.8 m），共速后继续匀速 1.2 m 至带端
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

    // 变式 B：显式短带 1.0 m（< 1.8 m），离开时未共速 v = sqrt(4^2 + 2*2.5*1) = sqrt(21) ≈ 4.5826 m/s
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
