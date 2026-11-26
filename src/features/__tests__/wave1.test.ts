import { describe, expect, it } from "vitest";
import { motionLibrary } from "../../adapters";
import { buildFromReading, defaultScanPath, findCriticals, getParam, outcomeOf, scanBounds, scanRange, withParam } from "../critical/scanner";
import { forcesAt } from "../forces/forceModel";
import { formatForceMagnitude } from "../forces/drawForces";
import { pickHudCorner, stageWorldBounds } from "../../ui/components/workspace/StagePhysicsCanvas";
import { fitViewport } from "../../ui/components/workspace/canvasViewport";
import { systemEnergyAt } from "../energy/systemEnergy";
import loop from "../../../fixtures/gaokao-proj-arc-horiz-loop.reading.json";
import incline from "../../../fixtures/gaokao-incline-arc-horiz-spring.reading.json";
import collision from "../../../fixtures/horizontal-collision-flight.reading.json";
import pendulum from "../../../fixtures/horizontal-collision-pendulum.reading.json";

function build(input: unknown) {
  const a = motionLibrary.assembleScene(input as never);
  if (!a.ok) throw new Error(JSON.stringify(a.errors));
  const b = motionLibrary.buildMotion(a.scene);
  if (!b.ok) throw new Error(b.message);
  return b.motion;
}

describe("临界扫描", () => {
  it("路径读写不破坏原 reading", () => {
    const path = defaultScanPath(loop);
    expect(path).toBeTruthy();
    const before = getParam(loop, path!);
    const next = withParam(loop, path!, (before ?? 0) + 1);
    expect(getParam(next, path!)).toBe((before ?? 0) + 1);
    expect(getParam(loop, path!)).toBe(before);
  });

  it("整圆题能扫出临界值且两侧结局不同", () => {
    const path = defaultScanPath(loop)!;
    const bounds = scanBounds(loop, path)!;
    const points = scanRange(loop, path, bounds.lo, bounds.hi, 20);
    const criticals = findCriticals(loop, path, points, 12);
    expect(criticals.length).toBeGreaterThanOrEqual(1);
    for (const c of criticals) {
      expect(c.left.key).not.toBe(c.right.key);
      expect(c.value).toBeGreaterThan(bounds.lo);
      expect(c.value).toBeLessThan(bounds.hi);
    }
  });

  it("多物体题也有可扫描初值", () => {
    const path = defaultScanPath(pendulum);
    expect(path).toEqual(["initial", "bodies", 0, "vxMps"]);
    const m = buildFromReading(withParam(pendulum, path!, 4));
    expect(m).toBeTruthy();
    expect(m!.events.some((e) => (e.eventKind ?? e.id) === "collision")).toBe(true);
    expect(outcomeOf(m!).key).toMatch(/pendulum_first_turn|collision_complete/);
  });

  it("桌沿被题设钉死的题扫描时给出装配失败而非崩溃", () => {
    const path = defaultScanPath(collision)!;
    expect(buildFromReading(withParam(collision, path, 9))).toBeNull();
  });
});

describe("受力矢量", () => {
  it("斜面段给出 G/N/f 且 N=mg·cosθ", () => {
    const motion = build(incline);
    const arrows = forcesAt(motion, 0.5);
    const g = arrows.find((a) => a.kind === "gravity")!;
    const n = arrows.find((a) => a.kind === "normal")!;
    const f = arrows.find((a) => a.kind === "friction")!;
    expect(g.magnitudeN).toBeCloseTo(10, 6);
    expect(n.magnitudeN).toBeCloseTo(10 * Math.cos((37 * Math.PI) / 180), 6);
    expect(f.magnitudeN).toBeCloseTo(0.25 * n.magnitudeN, 6);
    expect(f.dir.x * Math.cos((37 * Math.PI) / 180) + f.dir.y * -Math.sin((37 * Math.PI) / 180)).toBeLessThan(0);
  });

  it("分解模式追加两个虚线分量", () => {
    const motion = build(incline);
    const plain = forcesAt(motion, 0.5, false);
    const split = forcesAt(motion, 0.5, true);
    expect(split.filter((a) => a.dashed).length).toBe(2);
    expect(split.length).toBe(plain.length + 2);
  });

  it("碰撞题两物体都有重力箭头", () => {
    const motion = build(collision);
    const arrows = forcesAt(motion, 0.2);
    expect(arrows.filter((a) => a.kind === "gravity").length).toBe(2);
  });

  it("匀强磁场洛伦兹力按 F=qv×B 精确指向圆心且保留毫牛级大小", () => {
    const makeMagneticPlan = (chargeC: number, fieldDirection: "into_page" | "out_of_page") => ({
      kind: "stage_plan",
      schemaVersion: 1,
      massKg: 1e-3,
      gravityMps2: 10,
      initial: { vxMps: 2, vyMps: 0 },
      stages: [
        {
          kind: "magnetic_deflection",
          magneticTeslaB: 1,
          chargeC,
          regionWidthM: 1,
          fieldDirection,
        },
      ],
    });

    // q = +1e-3 C, B = 1 T, v = 2 m/s, into_page → F洛 = 0.002 N，初始向上 (0, +1)
    const mPosIn = build(makeMagneticPlan(1e-3, "into_page"));
    const aPosIn0 = forcesAt(mPosIn, 0).find((a) => a.kind === "magnetic")!;
    expect(aPosIn0).toBeTruthy();
    expect(aPosIn0.label).toBe("F洛");
    expect(aPosIn0.magnitudeN).toBeCloseTo(0.002, 9);
    expect(aPosIn0.dir.x).toBeCloseTo(0, 6);
    expect(aPosIn0.dir.y).toBeCloseTo(1, 6);

    // 偏转途中始终垂直于瞬时速度且指向圆心
    const tMid = mPosIn.durationSeconds * 0.5;
    const sMid = mPosIn.sampleAt(tMid);
    const aMid = forcesAt(mPosIn, tMid).find((a) => a.kind === "magnetic")!;
    const dotV = aMid.dir.x * sMid.velocity.x + aMid.dir.y * sMid.velocity.y;
    expect(dotV).toBeCloseTo(0, 6);
    const mg = mPosIn.stageGeometry!.magnetics?.[0] ?? mPosIn.stageGeometry!.magnetic!;
    const toCenter = { x: mg.center.xM - sMid.position.x, y: mg.center.yM - sMid.position.y };
    const toCenterLen = Math.hypot(toCenter.x, toCenter.y);
    expect(aMid.dir.x).toBeCloseTo(toCenter.x / toCenterLen, 5);
    expect(aMid.dir.y).toBeCloseTo(toCenter.y / toCenterLen, 5);

    // q < 0, into_page → 初始向下 (0, -1)
    const mNegIn = build(makeMagneticPlan(-1e-3, "into_page"));
    const aNegIn0 = forcesAt(mNegIn, 0).find((a) => a.kind === "magnetic")!;
    expect(aNegIn0.magnitudeN).toBeCloseTo(0.002, 9);
    expect(aNegIn0.dir.x).toBeCloseTo(0, 6);
    expect(aNegIn0.dir.y).toBeCloseTo(-1, 6);

    // q > 0, out_of_page → 初始向下 (0, -1)
    const mPosOut = build(makeMagneticPlan(1e-3, "out_of_page"));
    const aPosOut0 = forcesAt(mPosOut, 0).find((a) => a.kind === "magnetic")!;
    expect(aPosOut0.magnitudeN).toBeCloseTo(0.002, 9);
    expect(aPosOut0.dir.x).toBeCloseTo(0, 6);
    expect(aPosOut0.dir.y).toBeCloseTo(-1, 6);
  });

  it("formatForceMagnitude 准确格式化宏牛、毫牛与微观科学计数法", () => {
    expect(formatForceMagnitude(125.4)).toBe("125 N");
    expect(formatForceMagnitude(9.8)).toBe("9.8 N");
    expect(formatForceMagnitude(0.002)).toBe("0.002 N");
    expect(formatForceMagnitude(0.002)).not.toContain("0.0 N");
    expect(formatForceMagnitude(1.6e-13)).toBe("1.6×10⁻¹³ N");
  });
});

describe("HUD 四角智能避让", () => {
  it("四角全空时默认返回 top-right", () => {
    expect(pickHudCorner({ canvasW: 800, canvasH: 480, hudW: 200, hudH: 40, obstacles: [] })).toBe("top-right");
  });

  it("水平传送带在左上 + 平抛在右下时默认落在右上角", () => {
    const conveyorProj = build({
      kind: "stage_plan",
      schemaVersion: 1,
      massKg: 1,
      gravityMps2: 10,
      initial: { vxMps: 0 },
      stages: [
        {
          kind: "conveyor_belt",
          initialBeltSpeedMps: 4,
          segments: [{ accelerationMps2: 0, durationSeconds: 2 }],
          kineticFrictionCoefficient: 0.4,
        },
        {
          kind: "projectile",
          dropHeightM: 5,
        },
      ],
    });
    const W = 800;
    const H = 480;
    const vp = fitViewport(W, H, stageWorldBounds(conveyorProj), { top: 48, right: 48, bottom: 44, left: 48 });
    expect(pickHudCorner({ canvasW: W, canvasH: H, hudW: 220, hudH: 42, motion: conveyorProj, vp })).toBe("top-right");
  });

  it("右上被占用时自动切到 top-left 或 bottom-left", () => {
    expect(
      pickHudCorner({
        canvasW: 800,
        canvasH: 480,
        hudW: 200,
        hudH: 40,
        obstacles: [{ x: 560, y: 0, w: 240, h: 120 }],
      }),
    ).toBe("top-left");

    expect(
      pickHudCorner({
        canvasW: 800,
        canvasH: 480,
        hudW: 200,
        hudH: 40,
        obstacles: [
          { x: 560, y: 0, w: 240, h: 120 },
          { x: 0, y: 0, w: 240, h: 120 },
        ],
      }),
    ).toBe("bottom-left");
  });

  it("标注调色盘展开（annotationPaletteOpen=true）时避开右上角", () => {
    expect(
      pickHudCorner({
        canvasW: 800,
        canvasH: 480,
        hudW: 200,
        hudH: 40,
        obstacles: [],
        annotationPaletteOpen: true,
      }),
    ).toBe("top-left");
  });
});

describe("系统能量", () => {
  it("多物体碰撞前后动能+耗散守恒（弹性碰耗散≈0）", () => {
    const motion = build(collision);
    const before = systemEnergyAt(motion, 0)!;
    const after = systemEnergyAt(motion, motion.durationSeconds)!;
    expect(before.kineticJ).toBeGreaterThan(0);
    expect(after.dissipatedJ).toBeLessThan(1e-6);
  });

  it("粗糙斜面题耗散随时间单调不减", () => {
    const motion = build(incline);
    const a = systemEnergyAt(motion, 0.5)!;
    const b = systemEnergyAt(motion, 1.5)!;
    expect(b.dissipatedJ).toBeGreaterThanOrEqual(a.dissipatedJ - 1e-9);
  });
});
