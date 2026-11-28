import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveArcRadiusFromDrop,
  deriveCriticalArcTopRadius,
  deriveProjectileTangentDrop,
  deriveProjectileTangentLaunchSpeed,
  resolveGaokaoImplicitParams,
  type GaokaoPlanDraftInput,
} from "../gaokaoConstraints.ts";
import { validateStagePlan } from "../stagePlan.ts";
import { assembleStageScene, buildStageMotion } from "../stageMotion.ts";

describe("deriveProjectileTangentDrop", () => {
  it("平抛切向进入 -53° 正向圆弧：精确数值与来源记录正确", () => {
    const res = deriveProjectileTangentDrop({
      vxMps: 6,
      vyMps: 0,
      gravityMps2: 10,
      nextArcStartAngleDeg: -53,
      nextArcDirection: "positive",
      stageIndex: 0,
      nextArcStageIndex: 1,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const tan53 = Math.tan((53 * Math.PI) / 180);
    const expectedVy = -6 * tan53;
    const expectedTime = -expectedVy / 10;
    const expectedDrop = (expectedVy * expectedVy) / 20;
    const expectedSpeed = Math.hypot(6, expectedVy);

    expect(res.entryVyMps).toBeCloseTo(expectedVy, 12);
    expect(res.flightSeconds).toBeCloseTo(expectedTime, 12);
    expect(res.dropHeightM).toBeCloseTo(expectedDrop, 12);
    expect(res.entrySpeedMps).toBeCloseTo(expectedSpeed, 12);
    expect(res.dropHeightM).toBeCloseTo(3.1698863255, 8);
    expect(res.calculation).toEqual({
      stageIndex: 0,
      targetPath: "/stages/0/dropHeightM",
      quantity: "projectile_drop_height",
      value: res.dropHeightM,
      unit: "m",
      source: "derived",
      rule: "tangent_to_next_arc",
      inputPaths: [
        "/gravityMps2",
        "/stages/0/end",
        "/stages/1/path/startAngleDeg",
        "/stages/1/path/direction",
      ],
    });
  });

  it("支持向左平抛切向进入负向圆弧（vx < 0, d = -1）", () => {
    const res = deriveProjectileTangentDrop({
      vxMps: -6,
      vyMps: 0,
      gravityMps2: 10,
      nextArcStartAngleDeg: 53,
      nextArcDirection: "negative",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.entryVyMps).toBeLessThan(0);
    expect(res.dropHeightM).toBeCloseTo(3.1698863255, 8);
  });

  it("支持斜上抛先升后降并以非负落差切向入弧", () => {
    const res = deriveProjectileTangentDrop({
      vxMps: 6,
      vyMps: 4,
      gravityMps2: 10,
      nextArcStartAngleDeg: -53,
      nextArcDirection: "positive",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // vyEntry ≈ -7.962269 < 4，且 |vyEntry| > |vyMps|，dropHeightM > 0
    expect(res.flightSeconds).toBeCloseTo((4 - res.entryVyMps) / 10, 12);
    expect(res.dropHeightM).toBeCloseTo((res.entryVyMps ** 2 - 16) / 20, 12);
    expect(res.dropHeightM).toBeGreaterThan(0);
  });

  it("边界冲突：平抛无法切向进入向上倾斜的圆弧（entryVy > vyMps）", () => {
    const res = deriveProjectileTangentDrop({
      vxMps: 6,
      vyMps: 0,
      gravityMps2: 10,
      nextArcStartAngleDeg: 37,
      nextArcDirection: "positive",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("PRECONDITION_CONFLICT");
    expect(res.path).toBe("/stages/0/end");
  });

  it("边界冲突：斜上抛切向入弧点高于抛出点（dropHeightM < 0）", () => {
    const res = deriveProjectileTangentDrop({
      vxMps: 6,
      vyMps: 12,
      gravityMps2: 10,
      nextArcStartAngleDeg: -53,
      nextArcDirection: "positive",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("PRECONDITION_CONFLICT");
    expect(res.path).toBe("/stages/0/end");
  });

  it("边界冲突：水平速度与入口切线水平分量反向、为零或入口切线竖直（±90°）", () => {
    const opposite = deriveProjectileTangentDrop({
      vxMps: -6,
      vyMps: 0,
      gravityMps2: 10,
      nextArcStartAngleDeg: -53,
      nextArcDirection: "positive",
    });
    expect(opposite.ok).toBe(false);
    if (!opposite.ok) expect(opposite.code).toBe("PRECONDITION_CONFLICT");

    const verticalTangent = deriveProjectileTangentDrop({
      vxMps: 6,
      vyMps: 0,
      gravityMps2: 10,
      nextArcStartAngleDeg: -90,
      nextArcDirection: "positive",
      stageIndex: 0,
      nextArcStageIndex: 1,
    });
    expect(verticalTangent.ok).toBe(false);
    if (!verticalTangent.ok) {
      expect(verticalTangent.code).toBe("PRECONDITION_CONFLICT");
      expect(verticalTangent.path).toBe("/stages/1/path/startAngleDeg");
    }
  });
});

describe("deriveArcRadiusFromDrop", () => {
  it("从 -53° 正向扫过 53° 落差 2m 反求半径：精确数值正确", () => {
    const res = deriveArcRadiusFromDrop({
      verticalDropM: 2,
      startAngleDeg: -53,
      sweepAngleDeg: 53,
      direction: "positive",
      stageIndex: 1,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const expectedDeltaCos = 1 - Math.cos((53 * Math.PI) / 180);
    const expectedR = 2 / expectedDeltaCos;
    expect(res.endAngleDeg).toBe(0);
    expect(res.deltaCos).toBeCloseTo(expectedDeltaCos, 12);
    expect(res.radiusM).toBeCloseTo(expectedR, 12);
    expect(res.radiusM).toBeCloseTo(5.0227912058, 8);
    expect(res.calculation).toEqual({
      stageIndex: 1,
      targetPath: "/stages/1/radiusM",
      quantity: "arc_radius",
      value: res.radiusM,
      unit: "m",
      source: "derived",
      rule: "arc_radius_from_drop",
      inputPaths: [
        "/stages/1/verticalDropM",
        "/stages/1/path/startAngleDeg",
        "/stages/1/path/direction",
        "/stages/1/path/end/sweepAngleDeg",
      ],
    });
  });

  it("边界冲突：deltaCos <= 0（上行或对称等高圆弧）与非正落差", () => {
    const uphill = deriveArcRadiusFromDrop({
      verticalDropM: 2,
      startAngleDeg: 0,
      sweepAngleDeg: 60,
      direction: "positive",
      stageIndex: 1,
    });
    expect(uphill.ok).toBe(false);
    if (!uphill.ok) {
      expect(uphill.code).toBe("PRECONDITION_CONFLICT");
      expect(uphill.path).toBe("/stages/1/verticalDropM");
    }

    const symmetric = deriveArcRadiusFromDrop({
      verticalDropM: 2,
      startAngleDeg: -53,
      sweepAngleDeg: 106,
      direction: "positive",
      stageIndex: 1,
    });
    expect(symmetric.ok).toBe(false);
    if (!symmetric.ok) {
      expect(symmetric.code).toBe("PRECONDITION_CONFLICT");
    }

    const nonPositiveDrop = deriveArcRadiusFromDrop({
      verticalDropM: 0,
      startAngleDeg: -53,
      sweepAngleDeg: 53,
      direction: "positive",
      stageIndex: 1,
    });
    expect(nonPositiveDrop.ok).toBe(false);
    if (!nonPositiveDrop.ok) expect(nonPositiveDrop.code).toBe("RANGE");
  });
});

describe("deriveCriticalArcTopRadius", () => {
  it("最低点入轨临界过顶：R = u^2 / (5g) 且 v_top = sqrt(gR)", () => {
    const res = deriveCriticalArcTopRadius({
      entrySpeedMps: 10,
      gravityMps2: 10,
      startAngleDeg: 0,
      stageIndex: 3,
      constraintIndex: 0,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.radiusM).toBeCloseTo(2, 12);
    expect(res.topSpeedMps).toBeCloseTo(Math.sqrt(20), 12);
    expect(res.calculation).toEqual({
      stageIndex: 3,
      targetPath: "/stages/3/radiusM",
      quantity: "critical_arc_top_radius",
      value: res.radiusM,
      unit: "m",
      source: "derived",
      rule: "critical_arc_top",
      inputPaths: ["/gravityMps2", "/constraints/0", "/stages/3/path/startAngleDeg"],
    });
  });

  it("任意入口角（如 90° 侧方入轨）：R = u^2 / (3g)", () => {
    const res = deriveCriticalArcTopRadius({
      entrySpeedMps: 6,
      gravityMps2: 10,
      startAngleDeg: 90,
      stageIndex: 1,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.radiusM).toBeCloseTo(36 / 30, 12);
    expect(res.topSpeedMps).toBeCloseTo(Math.sqrt(12), 12);
  });

  it("边界冲突：零速或负速入圆轨报错", () => {
    const zero = deriveCriticalArcTopRadius({
      entrySpeedMps: 0,
      gravityMps2: 10,
      startAngleDeg: 0,
      stageIndex: 3,
      constraintIndex: 0,
    });
    expect(zero.ok).toBe(false);
    if (!zero.ok) {
      expect(zero.code).toBe("PRECONDITION_CONFLICT");
      expect(zero.path).toBe("/constraints/0");
    }
  });
});

describe("resolveGaokaoImplicitParams", () => {
  it("完整解析标准高考四段综合题样例 fixtures/gaokao-proj-arc-horiz-loop.reading.json", () => {
    const fixturePath = resolve(process.cwd(), "fixtures/gaokao-proj-arc-horiz-loop.reading.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as GaokaoPlanDraftInput;

    const resolved = resolveGaokaoImplicitParams(fixture);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(resolved.consumedConstraintIndices).toEqual([0]);
    expect(resolved.calculations).toHaveLength(3);

    // Stage 0: A->B 平抛切向入弧反求 dropHeightM
    const stage0 = resolved.stages[0];
    expect(stage0.end).toBeUndefined();
    expect(stage0.startLabel).toBe("A");
    expect(stage0.endLabel).toBe("B");
    expect(stage0.dropHeightM).toBeCloseTo(3.1698863255, 8);

    // Stage 1: B->C 圆弧高差反求 radiusM
    const stage1 = resolved.stages[1];
    expect(stage1.verticalDropM).toBeUndefined();
    expect(stage1.startLabel).toBe("B");
    expect(stage1.endLabel).toBe("C");
    expect(stage1.radiusM).toBeCloseTo(5.0227912058, 8);

    // Stage 3: D->E 整圆临界过顶反求 radiusM
    const stage3 = resolved.stages[3];
    expect(stage3.startLabel).toBe("D");
    expect(stage3.endLabel).toBe("E");
    expect(stage3.radiusM).toBeCloseTo(1.9879545302, 8);

    // 验证 3 条来源记录
    expect(resolved.calculations.map((c) => c.rule)).toEqual([
      "tangent_to_next_arc",
      "arc_radius_from_drop",
      "critical_arc_top",
    ]);
    expect(resolved.calculations.every((c) => c.source === "derived")).toBe(true);
    expect(resolved.calculations.map((c) => c.targetPath)).toEqual([
      "/stages/0/dropHeightM",
      "/stages/1/radiusM",
      "/stages/3/radiusM",
    ]);

    // 确认原 fixture 对象未被就地修改
    expect(fixture.stages[0].end).toEqual({ kind: "tangent_to_next_arc" });
    expect(fixture.stages[1].radiusM).toBeNull();
    expect(fixture.stages[3].radiusM).toBeNull();
  });

  it("互斥冲突：tangent_to_next_arc 与显式 dropHeightM 共存", () => {
    const res = resolveGaokaoImplicitParams({
      gravityMps2: 10,
      initial: { vxMps: 6, vyMps: 0 },
      stages: [
        { kind: "projectile", dropHeightM: 3.2, end: { kind: "tangent_to_next_arc" } },
        {
          kind: "vertical_arc",
          radiusM: 5,
          side: "inside",
          frictionless: true,
          path: {
            startAngleDeg: -53,
            direction: "positive",
            end: { kind: "physical_endpoint", sweepAngleDeg: 53 },
          },
        },
      ],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.fieldErrors).toContainEqual(
      expect.objectContaining({ path: "/stages/0", code: "PRECONDITION_CONFLICT" }),
    );
  });

  it("互斥冲突：verticalDropM 与显式 radiusM 共存，以及 critical_arc_top 与显式 radiusM 共存", () => {
    const dropConflict = resolveGaokaoImplicitParams({
      gravityMps2: 10,
      initial: { speedMps: 10 },
      stages: [
        {
          kind: "vertical_arc",
          radiusM: 5,
          verticalDropM: 2,
          side: "inside",
          frictionless: true,
          path: {
            startAngleDeg: -53,
            direction: "positive",
            end: { kind: "physical_endpoint", sweepAngleDeg: 53 },
          },
        },
      ],
    });
    expect(dropConflict.ok).toBe(false);
    if (!dropConflict.ok) {
      expect(dropConflict.fieldErrors).toContainEqual(
        expect.objectContaining({ path: "/stages/0", code: "PRECONDITION_CONFLICT" }),
      );
    }

    const critConflict = resolveGaokaoImplicitParams({
      gravityMps2: 10,
      initial: { speedMps: 10 },
      constraints: [{ kind: "critical_arc_top", stageIndex: 0 }],
      stages: [
        {
          kind: "vertical_arc",
          radiusM: 2,
          side: "inside",
          frictionless: true,
          path: {
            startAngleDeg: 0,
            direction: "positive",
            end: { kind: "observation", sweepAngleDeg: 360 },
          },
        },
      ],
    });
    expect(critConflict.ok).toBe(false);
    if (!critConflict.ok) {
      expect(critConflict.fieldErrors).toContainEqual(
        expect.objectContaining({ path: "/constraints/0", code: "PRECONDITION_CONFLICT" }),
      );
    }
  });

  it("水平粗糙段提前刹停导致零速入圆轨时，critical_arc_top 报 PRECONDITION_CONFLICT", () => {
    const res = resolveGaokaoImplicitParams({
      gravityMps2: 10,
      initial: { speedMps: 4 },
      constraints: [{ kind: "critical_arc_top", stageIndex: 1 }],
      stages: [
        {
          kind: "horizontal_slide",
          kineticFrictionCoefficient: 0.5,
          end: { kind: "distance", distanceM: 10 },
        },
        {
          kind: "vertical_arc",
          radiusM: null,
          side: "inside",
          frictionless: true,
          path: {
            startAngleDeg: 0,
            direction: "positive",
            end: { kind: "observation", sweepAngleDeg: 360 },
          },
        },
      ],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.fieldErrors).toContainEqual(
      expect.objectContaining({ path: "/constraints/0", code: "PRECONDITION_CONFLICT" }),
    );
  });

  it("缺参不臆造：缺少重力或初速时返回精确 missingKeys", () => {
    const res = resolveGaokaoImplicitParams({
      gravityMps2: null,
      initial: { vxMps: null, vyMps: 0 },
      stages: [
        { kind: "projectile", end: { kind: "tangent_to_next_arc" } },
        {
          kind: "vertical_arc",
          radiusM: null,
          verticalDropM: 2,
          side: "inside",
          frictionless: true,
          path: {
            startAngleDeg: -53,
            direction: "positive",
            end: { kind: "physical_endpoint", sweepAngleDeg: 53 },
          },
        },
      ],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.missingKeys).toContain("/gravityMps2");
    expect(res.missingKeys).toContain("/initial/vxMps");
  });

  it("不拦截首段为 spring_release 的既有预压弹簧临界约束", () => {
    const res = resolveGaokaoImplicitParams({
      massKg: 0.1,
      gravityMps2: 10,
      initial: { speedMps: 0 },
      constraints: [{ kind: "critical_arc_top", stageIndex: 2 }],
      stages: [
        {
          kind: "spring_release",
          springConstantNpm: null,
          initialCompressionM: null,
          kineticFrictionCoefficient: 0.2,
          unattached: true,
          slidesAfterRelease: true,
          releaseCompleteByM: 2,
        },
        {
          kind: "horizontal_slide",
          kineticFrictionCoefficient: 0.2,
          end: { kind: "distance_from_stage_start", stageIndex: 0, distanceM: 2 },
        },
        {
          kind: "vertical_arc",
          radiusM: 0.4,
          endAngleDeg: 180,
          side: "inside",
          frictionless: true,
        },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.calculations).toEqual([]);
    expect(res.consumedConstraintIndices).toEqual([]);
  });
});

describe("deriveProjectileTangentLaunchSpeed（已知落差与切向入弧反求水平出射速度）", () => {
  it("图 1 参数（H=1.8m, g=10, -37° 正向）与图 2 参数（H=0.8m, g=10, -53° 正向）精确反求 vx", () => {
    const f1 = deriveProjectileTangentLaunchSpeed({
      dropHeightM: 1.8,
      gravityMps2: 10,
      nextArcStartAngleDeg: -37,
      nextArcDirection: "positive",
    });
    expect(f1.ok).toBe(true);
    if (f1.ok) {
      const expectedVx = 6 / Math.tan((37 * Math.PI) / 180);
      expect(f1.entryVyMps).toBeCloseTo(-6, 12);
      expect(f1.flightSeconds).toBeCloseTo(0.6, 12);
      expect(f1.vxMps).toBeCloseTo(expectedVx, 10);
      expect(f1.vxMps).toBeCloseTo(7.96227, 4);
      expect(f1.calculation.rule).toBe("tangent_to_next_arc_launch_vx");
    }

    const f2 = deriveProjectileTangentLaunchSpeed({
      dropHeightM: 0.8,
      gravityMps2: 10,
      nextArcStartAngleDeg: -53,
      nextArcDirection: "positive",
    });
    expect(f2.ok).toBe(true);
    if (f2.ok) {
      const expectedVx = 4 / Math.tan((53 * Math.PI) / 180);
      expect(f2.entryVyMps).toBeCloseTo(-4, 12);
      expect(f2.flightSeconds).toBeCloseTo(0.4, 12);
      expect(f2.vxMps).toBeCloseTo(expectedVx, 10);
      expect(f2.vxMps).toBeCloseTo(3.01422, 4);
    }
  });

  it("支持镜像向左平抛（+53° 负向）与合成变式（45°、H=1.25m 得精确 vx=5 m/s）", () => {
    const mirror = deriveProjectileTangentLaunchSpeed({
      dropHeightM: 0.8,
      gravityMps2: 10,
      nextArcStartAngleDeg: 53,
      nextArcDirection: "negative",
    });
    expect(mirror.ok).toBe(true);
    if (mirror.ok) {
      expect(mirror.vxMps).toBeCloseTo(-4 / Math.tan((53 * Math.PI) / 180), 10);
      expect(mirror.entryVyMps).toBeCloseTo(-4, 12);
    }

    const synth = deriveProjectileTangentLaunchSpeed({
      dropHeightM: 1.25,
      gravityMps2: 10,
      nextArcStartAngleDeg: -45,
      nextArcDirection: "positive",
    });
    expect(synth.ok).toBe(true);
    if (synth.ok) {
      expect(synth.vxMps).toBeCloseTo(5, 12);
      expect(synth.entryVyMps).toBeCloseTo(-5, 12);
      expect(synth.flightSeconds).toBeCloseTo(0.5, 12);
    }
  });

  it("拒绝竖直入口、水平入口、切线向上与非正落差", () => {
    const vert = deriveProjectileTangentLaunchSpeed({
      dropHeightM: 1,
      gravityMps2: 10,
      nextArcStartAngleDeg: -90,
      nextArcDirection: "positive",
    });
    expect(vert.ok).toBe(false);
    if (!vert.ok) expect(vert.code).toBe("PRECONDITION_CONFLICT");

    const horiz = deriveProjectileTangentLaunchSpeed({
      dropHeightM: 1,
      gravityMps2: 10,
      nextArcStartAngleDeg: 0,
      nextArcDirection: "positive",
    });
    expect(horiz.ok).toBe(false);
    if (!horiz.ok) expect(horiz.code).toBe("PRECONDITION_CONFLICT");

    const upward = deriveProjectileTangentLaunchSpeed({
      dropHeightM: 1,
      gravityMps2: 10,
      nextArcStartAngleDeg: 37,
      nextArcDirection: "positive",
    });
    expect(upward.ok).toBe(false);
    if (!upward.ok) expect(upward.code).toBe("PRECONDITION_CONFLICT");

    const zeroDrop = deriveProjectileTangentLaunchSpeed({
      dropHeightM: 0,
      gravityMps2: 10,
      nextArcStartAngleDeg: -37,
      nextArcDirection: "positive",
    });
    expect(zeroDrop.ok).toBe(false);
    if (!zeroDrop.ok) expect(zeroDrop.code).toBe("RANGE");
  });
});

describe("第一阶段端到端验收：图 1、图 2 与合成变式", () => {
  it("图 1（semicircle-projectile-tangent-arc）：反求 vA≈8 m/s、vB≈10 m/s 并完整运行三段", () => {
    const raw = JSON.parse(
      readFileSync(resolve(process.cwd(), "fixtures/semicircle-projectile-tangent-arc.reading.json"), "utf8"),
    );
    const val = validateStagePlan(raw);
    expect(val.ok).toBe(true);
    if (!val.ok) return;

    const vAExpected = 6 / Math.tan((37 * Math.PI) / 180);
    const vBExpected = Math.hypot(vAExpected, 6);
    expect((val.reading.initial as { speedMps: number }).speedMps).toBeCloseTo(vBExpected, 8);
    expect(val.reading.derivedCalculations?.map((c) => c.quantity)).toEqual([
      "projectile_launch_vx",
      "arc_entry_speed",
    ]);

    const scene = assembleStageScene(val.reading);
    expect(scene.ok).toBe(true);
    if (!scene.ok) return;
    const built = buildStageMotion(scene.scene);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.motion.segments).toHaveLength(3);
    const launchEv = built.motion.events.find((e) => e.kind === "projectile_launch")!;
    expect(launchEv).toBeDefined();
    expect(launchEv.velocityAfter.vxMps).toBeCloseTo(vAExpected, 4);
    expect(Math.abs(launchEv.velocityAfter.vyMps)).toBeLessThan(1e-6);
    // A 点压力 FA = m vA²/R - mg ≈ 60.44 N
    const atA = built.motion.sampleAt(launchEv.timeSeconds - 1e-6);
    expect(atA.constraint?.normalForceN).toBeCloseTo((vAExpected * vAExpected) / 0.9 - 10, 2);
    // C 点切向入弧（stageIndex=2 的 arc_enter 事件），验证入弧速度与支持力 FC = m vC²/r + mg cos37°
    const enterC = built.motion.events.find((e) => e.stageIndex === 2 && e.kind === "arc_enter")!;
    expect(enterC).toBeDefined();
    expect(enterC.velocityBefore.vxMps).toBeCloseTo(vAExpected, 4);
    expect(enterC.velocityBefore.vyMps).toBeCloseTo(-6, 4);
    const atC = built.motion.sampleAt(enterC.timeSeconds + 1e-6);
    const expectedFc = (vAExpected * vAExpected + 36) / 0.5 + 10 * Math.cos((37 * Math.PI) / 180);
    expect(atC.constraint?.normalForceN).toBeCloseTo(expectedFc, 1);
  });

  it("图 1 第 4 问独立临界分支：恰好从 A 点飞出（vA=3 m/s, vB=√45 m/s）落地距 B 为 1.8 m", () => {
    const plan = {
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      massKg: 1,
      initial: { speedMps: Math.sqrt(45) },
      stages: [
        {
          kind: "vertical_arc",
          radiusM: 0.9,
          side: "inside",
          frictionless: true,
          path: { startAngleDeg: 0, direction: "negative", end: { kind: "physical_endpoint", sweepAngleDeg: 180 } },
        },
        { kind: "projectile", landingPlaneYM: 0 },
      ],
    };
    const val = validateStagePlan(plan);
    expect(val.ok).toBe(true);
    if (!val.ok) return;
    const scene = assembleStageScene(val.reading);
    expect(scene.ok).toBe(true);
    if (!scene.ok) return;
    const built = buildStageMotion(scene.scene);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const endSample = built.motion.sampleAt(built.motion.durationSeconds);
    expect(endSample.xM).toBeCloseTo(1.8, 4);
    expect(endSample.yM).toBeCloseTo(0, 4);
  });

  it("图 2（spring-projectile-arc-incline）：反求 vx≈3 m/s、Ep≈4.5 J，以 suffix 从桌缘精确播放至上坡折返", () => {
    const raw = JSON.parse(
      readFileSync(resolve(process.cwd(), "fixtures/spring-projectile-arc-incline.reading.json"), "utf8"),
    );
    const val = validateStagePlan(raw);
    expect(val.ok).toBe(true);
    if (!val.ok) return;

    const vxExpected = 4 / Math.tan((53 * Math.PI) / 180);
    const epExpected = 0.5 * 1 * vxExpected * vxExpected;
    expect(val.playback?.mode).toBe("suffix");
    expect(val.playback?.startStageIndex).toBe(1);
    expect(val.playback?.vxMps).toBeCloseTo(vxExpected, 8);
    expect(val.reading.energy?.elasticEnergyJ).toBeCloseTo(epExpected, 8);
    expect(val.reading.energy?.origin).toBe("tangent_to_next_arc");
    expect(val.reading.derivedCalculations?.map((c) => c.quantity)).toEqual([
      "projectile_launch_vx",
      "initial_elastic_energy",
    ]);

    const scene = assembleStageScene(val.reading);
    expect(scene.ok).toBe(true);
    if (!scene.ok) return;
    const built = buildStageMotion(scene.scene);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.motion.timing?.mode).toBe("suffix");
    expect(built.motion.segments.length).toBeGreaterThanOrEqual(3);
    const at0 = built.motion.sampleAt(0);
    expect(at0.vxMps).toBeCloseTo(vxExpected, 6);
    expect(at0.vyMps).toBeCloseTo(0, 6);
  });

  it("合成变式：改动落差、半径与入口角后反求同步更新，且过约束时仍报冲突", () => {
    const variant = {
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      massKg: 2,
      initial: { speedMps: 0 },
      stages: [
        {
          kind: "spring_release",
          springConstantNpm: null,
          initialCompressionM: null,
          kineticFrictionCoefficient: 0,
          unattached: true,
          slidesAfterRelease: true,
        },
        { kind: "projectile", dropHeightM: 1.25, end: { kind: "tangent_to_next_arc" } },
        {
          kind: "vertical_arc",
          radiusM: 0.8,
          side: "inside",
          frictionless: true,
          path: { startAngleDeg: -45, direction: "positive", end: { kind: "physical_endpoint", sweepAngleDeg: 45 } },
        },
      ],
    };
    const val = validateStagePlan(variant);
    expect(val.ok).toBe(true);
    if (!val.ok) return;
    // H=1.25, g=10 => vy=-5; -45° => vx=5; m=2 => Ep = 0.5*2*25 = 25 J
    expect(val.playback?.vxMps).toBeCloseTo(5, 10);
    expect(val.reading.energy?.elasticEnergyJ).toBeCloseTo(25, 10);

    // 过约束：同时显式给 energy 与 dropHeightM + tangent_to_next_arc 须报互斥冲突
    const overConstrained = {
      ...variant,
      energy: { stageIndex: 0, elasticEnergyJ: 25, origin: "given" },
    };
    const bad = validateStagePlan(overConstrained);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.fieldErrors.some((e) => e.code === "PRECONDITION_CONFLICT")).toBe(true);
  });
});
