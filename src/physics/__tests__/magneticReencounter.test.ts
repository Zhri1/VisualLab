import { describe, it, expect } from "vitest";
import { validateStagePlan } from "../stagePlan";
import { validateStagePlan as validateQoder } from "../../../functions/stagePlan";
import { solveMagneticReencounter, type MagneticReencounterStage } from "../magneticReencounter";
import { computeMagneticReencounterMotion } from "../magneticReencounterMotion";
import { motionLibrary } from "../../adapters";
import { drawMultiBodyScene } from "../../ui/components/workspace/MultiBodyPhysicsCanvas";
import hubei2023 from "../../../fixtures/magnetic-reencounter-hubei2023.reading.json";

describe("magnetic_reencounter 纯匀强磁场双动粒子弹性正碰与周期再相遇", () => {
  it("2023 湖北物理第15题基准（归一化）：9 次正碰、动量能量守恒、t=18πτ 坐标与乙累计路程 67πa", () => {
    const vNode = validateStagePlan(hubei2023);
    const vQoder = validateQoder(hubei2023);
    expect(vNode.ok).toBe(true);
    expect(vQoder.ok).toBe(true);
    if (!vNode.ok) return;

    const stage = vNode.reading.stages[0] as MagneticReencounterStage;
    const solved = solveMagneticReencounter(stage);
    const motion = computeMagneticReencounterMotion(stage);

    // 1. 基本质量与周期关系
    expect(solved.massB).toBeCloseTo(0.5, 12);
    expect(solved.periodA).toBeCloseTo(2 * Math.PI, 12);
    expect(solved.periodB).toBeCloseTo(Math.PI, 12);
    expect(solved.reencounterIntervalSeconds).toBeCloseTo(2 * Math.PI, 12);
    expect(solved.firstCollisionSeconds).toBeCloseTo(Math.PI, 12);

    // 2. 乙初态由首次正碰逆推：t=0 时在 O(0, 0)，vy=+5（πτ 内完整回一周）
    const s0 = motion.sampleAt(0);
    expect(s0.bodies!["甲"].xM).toBeCloseTo(2, 9);
    expect(s0.bodies!["甲"].yM).toBeCloseTo(0, 9);
    expect(s0.bodies!["甲"].vyMps).toBeCloseTo(1, 9);
    expect(s0.bodies!["乙"].xM).toBeCloseTo(0, 9);
    expect(s0.bodies!["乙"].yM).toBeCloseTo(0, 9);
    expect(s0.bodies!["乙"].vyMps).toBeCloseTo(5, 9);

    // 3. 首次碰撞 t = π：碰前 vy甲 = -1, vy乙 = +5；碰后 vy甲 = +3, vy乙 = -3
    const col1 = solved.collisions[0];
    expect(col1.timeSeconds).toBeCloseTo(Math.PI, 12);
    expect(col1.beforeA.vyMps).toBeCloseTo(-1, 9);
    expect(col1.beforeB.vyMps).toBeCloseTo(5, 9);
    expect(col1.afterA.vyMps).toBeCloseTo(3, 9);
    expect(col1.afterB.vyMps).toBeCloseTo(-3, 9);

    // 4. 共 9 次碰撞，严格位于 t = (1, 3, ..., 17)π；碰后 0 时刻不重复触发
    expect(solved.collisions.length).toBe(9);
    solved.collisions.forEach((c, idx) => {
      expect(c.timeSeconds).toBeCloseTo((2 * idx + 1) * Math.PI, 10);
      expect(c.momentumAfterKgMps).toBeCloseTo(c.momentumBeforeKgMps, 10);
      expect(c.energyAfterJ).toBeCloseTo(c.energyBeforeJ, 10);
    });

    // 精确事件前后取样：t1 - 1e-7 取碰前，t1 取碰后，t1 + 1e-7 沿碰后圆分离
    const pre1 = motion.sampleAt(Math.PI - 1e-7);
    const at1 = motion.sampleAt(Math.PI);
    const post1 = motion.sampleAt(Math.PI + 1e-7);
    expect(pre1.bodies!["甲"].vyMps).toBeCloseTo(-1, 5);
    expect(pre1.bodies!["乙"].vyMps).toBeCloseTo(5, 5);
    expect(at1.bodies!["甲"].vyMps).toBeCloseTo(3, 9);
    expect(at1.bodies!["乙"].vyMps).toBeCloseTo(-3, 9);
    expect(post1.bodies!["甲"].yM).toBeGreaterThan(0);
    expect(post1.bodies!["乙"].yM).toBeLessThan(0);

    // 5. t = 18π 末态坐标与乙自首次碰后累计路程 67π
    const sEnd = motion.sampleAt(18 * Math.PI);
    expect(sEnd.bodies!["甲"].xM).toBeCloseTo(-6, 9);
    expect(sEnd.bodies!["甲"].yM).toBeCloseTo(0, 9);
    expect(sEnd.bodies!["乙"].xM).toBeCloseTo(0, 9);
    expect(sEnd.bodies!["乙"].yM).toBeCloseTo(0, 9);
    expect(solved.distanceBAfterFirstCollisionM).toBeCloseTo(67 * Math.PI, 9);

    // 6. 适配器与双体画布无异常绘制
    const assembled = motionLibrary.assembleScene(vNode.reading);
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    const built = motionLibrary.buildMotion(assembled.scene);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const ctx = new Proxy({}, { get: (_t, key) => (key === "measureText" ? () => ({ width: 50 }) : () => {}) }) as CanvasRenderingContext2D;
    expect(() => drawMultiBodyScene(ctx, 640, 360, built.motion, 0)).not.toThrow();
    expect(() => drawMultiBodyScene(ctx, 640, 360, built.motion, Math.PI)).not.toThrow();
    expect(() => drawMultiBodyScene(ctx, 640, 360, built.motion, built.motion.durationSeconds)).not.toThrow();
  });

  it("SI 标度缩放变式：长度、速度与时间按 m, q, B, a 精确缩放", () => {
    const siPlan = structuredClone(hubei2023) as Record<string, unknown>;
    const st = (siPlan.stages as Record<string, unknown>[])[0];
    st.scaleMode = "si";
    st.massScaleKg = 2;
    st.chargeScaleC = 0.5;
    st.magneticTeslaB = 4;
    st.lengthScaleM = 0.5;
    // τ = m/(qB) = 2/(0.5*4) = 1 s; v = qBa/m = 0.5 m/s
    const vNode = validateStagePlan(siPlan);
    const vQoder = validateQoder(siPlan);
    expect(vNode.ok).toBe(true);
    expect(vQoder.ok).toBe(true);
    if (!vNode.ok) return;

    const solved = solveMagneticReencounter(vNode.reading.stages[0] as MagneticReencounterStage);
    expect(solved.tauSeconds).toBeCloseTo(1, 12);
    expect(solved.speedScaleMps).toBeCloseTo(0.5, 12);
    expect(solved.massB).toBeCloseTo(1, 12);
    expect(solved.finalA.xM).toBeCloseTo(-3, 9);
    expect(solved.finalB.xM).toBeCloseTo(0, 9);
    expect(solved.distanceBAfterFirstCollisionM).toBeCloseTo(33.5 * Math.PI, 9);
  });

  it("观察时刻与周期比变式（k=4 与 T甲/T乙=3）：不依赖固定常数", () => {
    // 变式 A：观察至 4πτ（2 次碰撞于 1π, 3π；乙首次碰后走 2π*3 + 1π*5 = 11π）
    const shortPlan = structuredClone(hubei2023) as Record<string, unknown>;
    (shortPlan.stages as Record<string, unknown>[])[0].observationTimeOverPiTau = 4;
    const vShort = validateStagePlan(shortPlan);
    expect(vShort.ok).toBe(true);
    if (!vShort.ok) return;
    const sShort = solveMagneticReencounter(vShort.reading.stages[0] as MagneticReencounterStage);
    expect(sShort.collisions.length).toBe(2);
    expect(sShort.distanceBAfterFirstCollisionM).toBeCloseTo(11 * Math.PI, 9);

    // 变式 B：周期比 T甲/T乙 = 3（m乙 = m/3），观察至 6πτ（碰撞于 1π, 3π, 5π 共 3 次）
    const ratio3Plan = structuredClone(hubei2023) as Record<string, unknown>;
    const st3 = (ratio3Plan.stages as Record<string, unknown>[])[0];
    st3.periodRatioAOverB = 3;
    st3.observationTimeOverPiTau = 6;
    const v3 = validateStagePlan(ratio3Plan);
    expect(v3.ok).toBe(true);
    if (!v3.ok) return;
    const s3 = solveMagneticReencounter(v3.reading.stages[0] as MagneticReencounterStage);
    expect(s3.massB).toBeCloseTo(1 / 3, 12);
    expect(s3.collisions.length).toBe(3);
    for (const c of s3.collisions) {
      expect(c.momentumAfterKgMps).toBeCloseTo(c.momentumBeforeKgMps, 10);
      expect(c.energyAfterJ).toBeCloseTo(c.energyBeforeJ, 10);
    }
  });

  it("边界拒绝：非外切几何、无理周期比与反向偏转几何两端均明确报错", () => {
    // 1. 碰后同向导致两圆内切而非外切 → UNSUPPORTED
    const internalTan = structuredClone(hubei2023) as Record<string, unknown>;
    (internalTan.stages as Record<string, unknown>[])[0].postFirstCollisionSpeedRatioA = 3;
    const rIntNode = validateStagePlan(internalTan);
    const rIntQoder = validateQoder(internalTan);
    expect(rIntNode.ok).toBe(false);
    expect(rIntQoder.ok).toBe(false);
    if (!rIntNode.ok && !rIntQoder.ok) {
      expect(rIntNode.code).toBe("UNSUPPORTED");
      expect(rIntQoder.code).toBe("UNSUPPORTED");
    }

    // 2. 无理周期比无法证实周期同刻再相遇 → UNSUPPORTED
    const irrational = structuredClone(hubei2023) as Record<string, unknown>;
    (irrational.stages as Record<string, unknown>[])[0].periodRatioAOverB = Math.SQRT2;
    const rIrrNode = validateStagePlan(irrational);
    const rIrrQoder = validateQoder(irrational);
    expect(rIrrNode.ok).toBe(false);
    expect(rIrrQoder.ok).toBe(false);
    if (!rIrrNode.ok && !rIrrQoder.ok) {
      expect(rIrrNode.code).toBe("UNSUPPORTED");
      expect(rIrrQoder.code).toBe("UNSUPPORTED");
    }

    // 3. 磁场反向导致洛伦兹力向右偏转、无法从 (2,0) 沿 +y 到达 (0,0) → INCONSISTENT_CONDITIONS
    const wrongField = structuredClone(hubei2023) as Record<string, unknown>;
    (wrongField.stages as Record<string, unknown>[])[0].fieldDirection = "out_of_page";
    const rFldNode = validateStagePlan(wrongField);
    const rFldQoder = validateQoder(wrongField);
    expect(rFldNode.ok).toBe(false);
    expect(rFldQoder.ok).toBe(false);
    if (!rFldNode.ok && !rFldQoder.ok) {
      expect(rFldNode.code).toBe("INCONSISTENT_CONDITIONS");
      expect(rFldQoder.code).toBe("INCONSISTENT_CONDITIONS");
    }
  });
});
