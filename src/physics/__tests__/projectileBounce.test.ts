import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateStagePlan, assembleStageScene, buildStageMotion } from "../index";
import { validateStagePlan as validateQoderStagePlan } from "../../../functions/stagePlan";
import { adaptStageMotion } from "../../adapters/stageMotionAdapter";

const loadFixture = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "fixtures", name), "utf8"));

describe("弹性势能发射 → 平抛 → 首次落地反弹", () => {
  it("归一化符号题（e = 4/5，m = Ep = h = g = 1）精确复现 H=h/e²、vx=√(2Ep/m)、x1=(2/e)√(Ep·h/(m·g)) 与反弹最高点 h", () => {
    const raw = loadFixture("spring-energy-projectile-bounce-normalized.reading.json");
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
    const m = built.motion;

    // 1. 核对后缀播放与归一化标记
    expect(m.timing?.mode).toBe("suffix");
    expect(m.timing?.startStageIndex).toBe(1);
    expect(m.timing?.anchor.label).toBe("桌缘");
    expect(m.timing?.absoluteStartSeconds).toBeNull();
    expect(m.geometry.scaleMode).toBe("normalized");
    expect(m.endReason).toBe("bounce_apex");

    // 2. 核对推导桌面落差 H = h / e² = 25/16
    const e = 0.8;
    const H = 1 / (e * e);
    expect(m.geometry.projectile?.landingPlane.yM).toBeCloseTo(-H, 10);
    expect(m.calculations?.find((c) => c.quantity === "projectile_drop_height")?.value).toBeCloseTo(H, 10);

    // 3. 核对出射速度 vx = √2、首次落点 x1 = 2.5、反弹前后位置连续与速度关系
    const bounce = m.events.find((ev) => ev.kind === "ground_bounce")!;
    const apex = m.events.find((ev) => ev.kind === "bounce_apex")!;
    expect(bounce).toBeDefined();
    expect(apex).toBeDefined();
    expect(bounce.position!.xM).toBeCloseTo(2 / e, 10); // (2/e) * sqrt(1*1/(1*1)) = 2.5
    expect(bounce.position!.yM).toBeCloseTo(-H, 10);
    expect(bounce.velocityBefore.vxMps).toBeCloseTo(Math.SQRT2, 10);
    expect(bounce.velocityAfter.vxMps).toBeCloseTo(bounce.velocityBefore.vxMps, 10);
    expect(bounce.velocityBefore.vyMps).toBeCloseTo(-Math.sqrt(2 * H), 10);
    expect(bounce.velocityAfter.vyMps).toBeCloseTo(-e * bounce.velocityBefore.vyMps, 10);

    // 4. 核对同刻前后位置连续
    const eps = 1e-6;
    const before = m.sampleAt(bounce.timeSeconds - eps);
    const at = m.sampleAt(bounce.timeSeconds);
    const after = m.sampleAt(bounce.timeSeconds + eps);
    expect(Math.hypot(before.xM - at.xM, before.yM - at.yM)).toBeLessThan(1e-4);
    expect(Math.hypot(after.xM - at.xM, after.yM - at.yM)).toBeLessThan(1e-4);
    expect(before.vyMps).toBeLessThan(0);
    expect(at.vyMps).toBeGreaterThan(0);
    expect(after.vyMps).toBeGreaterThan(0);

    // 5. 核对首个反弹顶点高度 h = 1.0
    expect(apex.position!.yM - (-H)).toBeCloseTo(1, 10);
    expect(apex.velocityAfter.vyMps).toBeCloseTo(0, 10);
    expect(apex.velocityAfter.vxMps).toBeCloseTo(Math.SQRT2, 10);

    // 6. 适配层透传
    const adapted = adaptStageMotion(m, vNode.reading);
    expect(adapted.timing?.mode).toBe("suffix");
    expect(adapted.stageGeometry?.scaleMode).toBe("normalized");
  });

  it("显式 SI 数值按实算（m=0.5, Ep=4, g=10, e=0.8, h=1.6 → H=2.5, vx=4, x1=2√2）", () => {
    const raw = loadFixture("spring-energy-projectile-bounce-si.reading.json");
    const v = validateStagePlan(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const s = assembleStageScene(v.reading);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const b = buildStageMotion(s.scene);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const m = b.motion;
    expect(m.geometry.scaleMode).toBeUndefined();
    expect(m.geometry.projectile?.landingPlane.yM).toBeCloseTo(-2.5, 10);
    const bounce = m.events.find((ev) => ev.kind === "ground_bounce")!;
    const apex = m.events.find((ev) => ev.kind === "bounce_apex")!;
    expect(bounce.velocityAfter.vxMps).toBeCloseTo(4, 10);
    expect(bounce.position!.xM).toBeCloseTo(2 * Math.SQRT2, 10);
    expect(apex.position!.yM - (-2.5)).toBeCloseTo(1.6, 10);
  });

  it("e = 0 停止竖直反弹，且不能反推非零反弹高度 h", () => {
    const withH = loadFixture("spring-energy-projectile-bounce-si.reading.json");
    withH.stages[1].bounce.normalRestitution = 0;
    const vConflict = validateStagePlan(withH);
    expect(vConflict.ok).toBe(false);
    if (!vConflict.ok) {
      expect(vConflict.code).toBe("INCONSISTENT_CONDITIONS");
      expect(vConflict.fieldErrors.some((e) => e.path === "/stages/1/bounce/apexHeightM")).toBe(true);
    }

    const withDrop = {
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      initial: { vxMps: 4, vyMps: 0 },
      stages: [{ kind: "projectile", dropHeightM: 5, bounce: { normalRestitution: 0, stopAt: "first_apex" } }],
    };
    const vZero = validateStagePlan(withDrop);
    expect(vZero.ok).toBe(true);
    if (!vZero.ok) return;
    const s = assembleStageScene(vZero.reading);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const b = buildStageMotion(s.scene);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.motion.endReason).toBe("landed");
    expect(b.motion.events.some((ev) => ev.kind === "ground_bounce")).toBe(false);
    expect(b.motion.sampleAt(b.motion.durationSeconds).vyMps).toBe(0);
  });

  it("无 bounce 字段维持原有首次落地行为，不改变现有抛体逻辑", () => {
    const plain = {
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      initial: { vxMps: 4, vyMps: 0 },
      stages: [{ kind: "projectile", dropHeightM: 1.25 }],
    };
    const v = validateStagePlan(plain);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const s = assembleStageScene(v.reading);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const b = buildStageMotion(s.scene);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.motion.endReason).toBe("landed");
    expect(b.motion.events.map((e) => e.kind)).toEqual(["release", "land"]);
    expect(b.motion.sampleAt(b.motion.durationSeconds).vyMps).toBeCloseTo(-5, 10);
  });

  it("复现 A：斜抛 vy=√5、dropHeightM=1、e=0.8、apexHeightM=0.8 按 h=e²(H+vy0²/(2g)) 合法通过且反弹高=0.8", () => {
    const plan = {
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      initial: { vxMps: 4, vyMps: Math.sqrt(5) },
      stages: [{ kind: "projectile", dropHeightM: 1, bounce: { normalRestitution: 0.8, stopAt: "first_apex", apexHeightM: 0.8 } }],
    };
    const vNode = validateStagePlan(plan);
    const vQoder = validateQoderStagePlan(plan);
    expect(vNode.ok).toBe(true);
    expect(vQoder.ok).toBe(true);
    if (!vNode.ok) return;
    const s = assembleStageScene(vNode.reading);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const b = buildStageMotion(s.scene);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const apex = b.motion.events.find((e) => e.kind === "bounce_apex")!;
    expect(apex.position!.yM - (-1)).toBeCloseTo(0.8, 10);
  });

  it("复现 B：斜抛 vy=√5 仅给 apexHeightM=0.8 时按 H=h/e²−vy0²/(2g) 反求 H=1 且实际反弹高=0.8", () => {
    const plan = {
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      initial: { vxMps: 4, vyMps: Math.sqrt(5) },
      stages: [{ kind: "projectile", bounce: { normalRestitution: 0.8, stopAt: "first_apex", apexHeightM: 0.8 } }],
    };
    const vNode = validateStagePlan(plan);
    const vQoder = validateQoderStagePlan(plan);
    expect(vNode.ok).toBe(true);
    expect(vQoder.ok).toBe(true);
    if (!vNode.ok) return;
    expect((vNode.reading.stages[0] as { dropHeightM?: number }).dropHeightM).toBeCloseTo(1, 10);
    const s = assembleStageScene(vNode.reading);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const b = buildStageMotion(s.scene);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const apex = b.motion.events.find((e) => e.kind === "bounce_apex")!;
    expect(b.motion.geometry.projectile?.landingPlane.yM).toBeCloseTo(-1, 10);
    expect(apex.position!.yM - (-1)).toBeCloseTo(0.8, 10);
  });

  it("复现 C：vy=0、landingPlaneYM:null 仅给 apexHeightM=0.8 时归一化只保留一项高度，二次校验与装配均通过", () => {
    const plan = {
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      initial: { vxMps: 4, vyMps: 0 },
      stages: [{ kind: "projectile", landingPlaneYM: null, bounce: { normalRestitution: 0.8, stopAt: "first_apex", apexHeightM: 0.8 } }],
    };
    const vNode = validateStagePlan(plan);
    const vQoder = validateQoderStagePlan(plan);
    expect(vNode.ok).toBe(true);
    expect(vQoder.ok).toBe(true);
    if (!vNode.ok) return;
    expect("landingPlaneYM" in vNode.reading.stages[0]).toBe(false);
    expect((vNode.reading.stages[0] as { dropHeightM?: number }).dropHeightM).toBeCloseTo(1.25, 10);
    // 二次校验（assembleStageScene 内部复验）不得因残留 null 字段冲突
    const s = assembleStageScene(vNode.reading);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const b = buildStageMotion(s.scene);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const apex = b.motion.events.find((e) => e.kind === "bounce_apex")!;
    expect(apex.position!.yM - (-1.25)).toBeCloseTo(0.8, 10);
  });

  it("复现 D：vy=0、landingPlaneYM=-2 与 apexHeightM=0.8 矛盾（实际 1.28）时两端均拒绝", () => {
    const plan = {
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      initial: { vxMps: 4, vyMps: 0 },
      stages: [{ kind: "projectile", landingPlaneYM: -2, bounce: { normalRestitution: 0.8, stopAt: "first_apex", apexHeightM: 0.8 } }],
    };
    const vNode = validateStagePlan(plan);
    const vQoder = validateQoderStagePlan(plan);
    expect(vNode.ok).toBe(false);
    expect(vQoder.ok).toBe(false);
    if (!vNode.ok) {
      expect(vNode.code).toBe("INCONSISTENT_CONDITIONS");
      expect(vNode.fieldErrors.some((e) => e.path === "/stages/0/bounce/apexHeightM")).toBe(true);
    }
  });

  it("终段冲突：含 bounce 的抛体接后续阶段或切向入弧时两端返回清晰配置冲突，不静默忽略", () => {
    const withNext = {
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      massKg: 1,
      initial: { vxMps: 4, vyMps: 0 },
      stages: [
        { kind: "projectile", end: { kind: "tangent_to_next_arc" }, bounce: { normalRestitution: 0.8, stopAt: "first_apex" } },
        { kind: "vertical_arc", radiusM: 1, side: "inside", frictionless: true, path: { startAngleDeg: -45, direction: "positive", end: { kind: "physical_endpoint", sweepAngleDeg: 45 } } },
      ],
    };
    const vNode = validateStagePlan(withNext);
    const vQoder = validateQoderStagePlan(withNext);
    expect(vNode.ok).toBe(false);
    expect(vQoder.ok).toBe(false);
    if (!vNode.ok) {
      expect(vNode.code).toBe("INCONSISTENT_CONDITIONS");
      expect(vNode.fieldErrors.some((e) => e.path === "/stages/0/bounce")).toBe(true);
    }
  });
});
