import { describe, expect, it } from "vitest";
import { motionLibrary } from "../index";
import { drawStageScene, stageWorldBounds } from "../../ui/components/workspace/StagePhysicsCanvas";
import { computeDefaultPace } from "../../ui/components/workspace/playback";
import type { Motion, StageGeometry } from "../../types";
import type { StagePlanDraft } from "../../physics";
import inclineSpringFixture from "../../../fixtures/stage-composition.reading.json";
import verticalArcFixture from "../../../fixtures/vertical-arc-endpoint.reading.json";

interface MockCanvasLog {
  texts: Array<{ text: string; x: number; y: number }>;
  lines: Array<[number, number]>;
  moveTos: Array<[number, number]>;
}

function createMockCtx() {
  const log: MockCanvasLog = { texts: [], lines: [], moveTos: [] };
  const ctx = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === "measureText") return (text: string) => ({ width: text.length * 8 });
        if (key === "fillText") return (text: string, x: number, y: number) => log.texts.push({ text, x, y });
        if (key === "lineTo") return (x: number, y: number) => log.lines.push([x, y]);
        if (key === "moveTo") return (x: number, y: number) => log.moveTos.push([x, y]);
        return () => {};
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, log };
}

/** 构造包含平抛 AB + BC 圆弧 + CD 水平 + DE 整圆及 A/B/C/D/E 地标的多段 Motion。 */
function buildMultiTrackMotion(): Motion {
  const stageGeometry: StageGeometry = {
    blockSizeM: 0.3,
    positionReference: "particle",
    projectiles: [
      { stageIndex: 0, launch: { xM: 0, yM: 2.2 }, landingPlane: { yM: 1.0 } },
    ],
    verticalArcs: [
      {
        stageIndex: 1,
        entry: { xM: 2.0, yM: 1.0 },
        center: { xM: 3.0, yM: 1.0 },
        radiusM: 1.0,
        startAngleDeg: -90,
        endAngleDeg: 0,
        plannedEnd: { xM: 3.0, yM: 0 },
        direction: "positive",
        endMode: "physical_endpoint",
        actualExit: { position: { xM: 3.0, yM: 0 }, angleDeg: 0, reason: "endpoint" },
      },
      {
        stageIndex: 3,
        entry: { xM: 6.0, yM: 0 },
        center: { xM: 6.0, yM: 1.2 },
        radiusM: 1.2,
        startAngleDeg: 0,
        endAngleDeg: 360,
        plannedEnd: { xM: 6.0, yM: 0 },
        direction: "positive",
        endMode: "observation",
        actualExit: { position: { xM: 6.0, yM: 0 }, angleDeg: 360, reason: "range_end" },
      },
    ],
    horizontals: [
      { stageIndex: 2, start: { xM: 3.0, yM: 0 }, plannedEnd: { xM: 6.0, yM: 0 } },
    ],
    landmarks: [
      { label: "A", position: { xM: 0, yM: 2.2 } },
      { label: "B", position: { xM: 2.0, yM: 1.0 } },
      { label: "C", position: { xM: 3.0, yM: 0 } },
      { label: "D", position: { xM: 6.0, yM: 0 } },
      { label: "E", position: { xM: 6.0, yM: 2.4 } },
    ],
  };

  return {
    geometry: {
      inclineTop: { x: 0, y: 2.2 },
      inclineBottom: { x: 0, y: 2.2 },
      horizontalEnd: { x: 6.0, y: 0 },
      springContactX: 6.0,
      springAnchorX: 7.0,
      blockSizeM: 0.3,
    },
    stageGeometry,
    durationSeconds: 4.0,
    segments: [
      { kind: "projectile", stageKind: "projectile", stageIndex: 0, startSeconds: 0, endSeconds: 1, name: "抛体", summary: "", formula: "" },
      { kind: "vertical_arc", stageKind: "vertical_arc", stageIndex: 1, startSeconds: 1, endSeconds: 2, name: "BC圆弧", summary: "", formula: "" },
      { kind: "horizontal", stageKind: "horizontal_slide", stageIndex: 2, startSeconds: 2, endSeconds: 3, name: "CD水平", summary: "", formula: "" },
      { kind: "vertical_arc", stageKind: "vertical_arc", stageIndex: 3, startSeconds: 3, endSeconds: 4, name: "DE整圆", summary: "", formula: "" },
    ],
    events: [],
    endReason: "prefix_end",
    sampleAt(timeSeconds: number) {
      const t = Math.max(0, Math.min(4, timeSeconds));
      if (t < 1) {
        return {
          position: { x: 2 * t, y: 2.2 - 1.2 * t * t },
          velocity: { x: 2, y: -2.4 * t },
          springCompressionM: 0,
        };
      }
      if (t < 2) {
        const u = t - 1;
        const phi = (-90 + 90 * u) * Math.PI / 180;
        return {
          position: { x: 3.0 + Math.sin(phi), y: 1.0 - Math.cos(phi) },
          velocity: { x: 3 * Math.cos(phi), y: 3 * Math.sin(phi) },
          springCompressionM: 0,
          constraint: {
            kind: "vertical_arc",
            stageIndex: 1,
            angleDeg: -90 + 90 * u,
            angularVelocityRadps: 3,
            normalForceN: 18,
            normalDirection: { x: -Math.sin(phi), y: Math.cos(phi) },
          },
        };
      }
      if (t < 3) {
        const u = t - 2;
        return {
          position: { x: 3.0 + 3.0 * u, y: 0 },
          velocity: { x: 3.0, y: 0 },
          springCompressionM: 0,
        };
      }
      const u = t - 3;
      const phi = (360 * u) * Math.PI / 180;
      return {
        position: { x: 6.0 + 1.2 * Math.sin(phi), y: 1.2 - 1.2 * Math.cos(phi) },
        velocity: { x: 6 * Math.cos(phi), y: 6 * Math.sin(phi) },
        springCompressionM: 0,
        constraint: {
          kind: "vertical_arc",
          stageIndex: 3,
          angleDeg: 360 * u,
          angularVelocityRadps: 5,
          normalForceN: 24,
          normalDirection: { x: -Math.sin(phi), y: Math.cos(phi) },
        },
      };
    },
  };
}

describe("多段同类几何数组化、地标标注与多轨道画布", () => {
  it("stageWorldBounds 完整覆盖双圆弧、水平段、抛体与 A/B/C/D/E 地标", () => {
    const motion = buildMultiTrackMotion();
    const bounds = stageWorldBounds(motion);
    // 平抛起点 x=0, y=2.2；DE 整圆圆心 (6, 1.2) 半径 1.2 -> x∈[4.8, 7.2], y∈[0, 2.4]
    expect(bounds.minX).toBeLessThanOrEqual(0);
    expect(bounds.maxX).toBeGreaterThanOrEqual(7.2);
    expect(bounds.minY).toBeLessThanOrEqual(0);
    expect(bounds.maxY).toBeGreaterThanOrEqual(2.4);
  });

  it.each([
    { name: "桌面端 955x358", w: 955, h: 358 },
    { name: "窄屏 327x349", w: 327, h: 349 },
  ])("$name 绘制多段圆弧无报错、地标防越界且仅在受约束圆弧画 R 与 N", ({ w, h }) => {
    const motion = buildMultiTrackMotion();

    // 1) 在水平段（t = 2.5s，不在圆弧约束内）：应绘制两段圆弧 polyline（>160 线段），不画 R 与 N 向量
    const freeRun = createMockCtx();
    expect(() => drawStageScene(freeRun.ctx, w, h, motion, 2.5)).not.toThrow();
    expect(freeRun.log.lines.length).toBeGreaterThan(160);
    expect(freeRun.log.texts.map((t) => t.text)).not.toContain("R");
    expect(freeRun.log.texts.map((t) => t.text)).not.toContain("N");

    // 地标 A/B/C/D/E 全部渲染且不越出画布边界
    for (const label of ["A", "B", "C", "D", "E"]) {
      const entry = freeRun.log.texts.find((t) => t.text === label);
      expect(entry).toBeDefined();
      expect(entry!.x).toBeGreaterThan(0);
      expect(entry!.x).toBeLessThan(w);
      expect(entry!.y).toBeGreaterThan(0);
      expect(entry!.y).toBeLessThan(h);
    }

    // 2) 在第二段整圆约束内（t = 3.25s）：仅画一次当前圆弧的半径 R 和支持力向量 N
    const arcRun = createMockCtx();
    expect(() => drawStageScene(arcRun.ctx, w, h, motion, 3.25)).not.toThrow();
    expect(arcRun.log.texts.filter((t) => t.text === "R")).toHaveLength(1);
    expect(arcRun.log.texts.filter((t) => t.text === "N")).toHaveLength(1);
  });

  it("stageMotion 增量填充复数几何数组并自动收集去重 startLabel/endLabel 地标", () => {
    const labeledPlan: StagePlanDraft = {
      kind: "stage_plan",
      schemaVersion: 1,
      gravityMps2: 10,
      initial: { speedMps: 0 },
      stages: [
        { kind: "incline_slide", lengthM: 3.6, angleDeg: 30, kineticFrictionCoefficient: 0, slidesAfterRelease: true, startLabel: "A", endLabel: "B" },
        { kind: "lossless_turn", lossless: true },
        { kind: "horizontal_slide", kineticFrictionCoefficient: 0.2, end: { kind: "distance", distanceM: 5 }, startLabel: "B", endLabel: "C" },
        { kind: "projectile", dropHeightM: 1.25, startLabel: "C", endLabel: "D" },
      ],
    };
    const assembled = motionLibrary.assembleScene(labeledPlan);
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    const built = motionLibrary.buildMotion(assembled.scene);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const sg = built.motion.stageGeometry!;
    // 保留旧单数字段 + 同步写入复数数组
    expect(sg.incline).toBeDefined();
    expect(sg.inclines).toHaveLength(1);
    expect(sg.inclines![0].stageIndex).toBe(0);
    expect(sg.horizontal).toBeDefined();
    expect(sg.horizontals).toHaveLength(1);
    expect(sg.horizontals![0].stageIndex).toBe(2);
    expect(sg.projectile).toBeDefined();
    expect(sg.projectiles).toHaveLength(1);
    expect(sg.projectiles![0].stageIndex).toBe(3);

    // 地标去重后按顺序收集 A/B/C/D
    expect(sg.landmarks?.map((l) => l.label)).toEqual(["A", "B", "C", "D"]);
  });

  it("computeDefaultPace 纳入复数几何数组跨度计算", () => {
    const multi = buildMultiTrackMotion();
    const pace = computeDefaultPace(multi);
    expect(pace).toBeGreaterThanOrEqual(0.15);
    expect(pace).toBeLessThanOrEqual(1);
  });

  it("回归现有单段斜面-水平-抛体与单段圆弧样例的几何数组透传与绘制", () => {
    for (const fixture of [inclineSpringFixture, verticalArcFixture]) {
      const assembled = motionLibrary.assembleScene(fixture as StagePlanDraft);
      expect(assembled.ok).toBe(true);
      if (!assembled.ok) continue;
      const built = motionLibrary.buildMotion(assembled.scene);
      expect(built.ok).toBe(true);
      if (!built.ok) continue;
      const { ctx } = createMockCtx();
      expect(() => drawStageScene(ctx, 955, 358, built.motion, built.motion.durationSeconds / 2)).not.toThrow();
      expect(() => drawStageScene(ctx, 327, 349, built.motion, built.motion.durationSeconds / 2)).not.toThrow();
    }
  });
});
