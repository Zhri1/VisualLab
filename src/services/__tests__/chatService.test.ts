import { describe, expect, it } from "vitest";
import { isStageTruncateCommand } from "../../hooks/useWorkspace";
import {
  buildTutorPayload,
  getLocalSimilarProblems,
  getQuickParamSuggestions,
  tryParseStagePlanUpdate,
} from "../chatService";
import type { StagePlanDraft } from "../../physics/stagePlan";

const MOVABLE_ARC_PLAN: StagePlanDraft = {
  kind: "stage_plan",
  schemaVersion: 1,
  gravityMps2: 10,
  massKg: 1,
  initial: { speedMps: 0 },
  stages: [
    { kind: "movable_arc", radiusM: 0.8, grooveMassKg: 3 },
    { kind: "spring_pair", targetMassKg: 2, springConstantNpm: 100, gapM: 0.5 },
  ],
};

const INCLINE_PLAN: StagePlanDraft = {
  kind: "stage_plan",
  schemaVersion: 1,
  gravityMps2: 10,
  massKg: 1,
  initial: { speedMps: 0 },
  stages: [
    { kind: "incline_slide", lengthM: 2.5, angleDeg: 37, kineticFrictionCoefficient: 0.25 },
    { kind: "lossless_turn", lossless: true },
    { kind: "horizontal_slide", kineticFrictionCoefficient: 0, end: { kind: "distance", distanceM: 1.2 } },
    { kind: "spring_contact", springConstantNpm: 200, frictionless: true, unattached: true },
  ],
};

describe("isStageTruncateCommand 阶段截断意图识别", () => {
  it("绝不误拦截带疑问词的正常物理提问", () => {
    expect(isStageTruncateCommand("物体滑到坡底的速度怎么算？")).toBe(false);
    expect(isStageTruncateCommand("前两段机械能守恒吗？")).toBe(false);
    expect(isStageTruncateCommand("到桌沿时为什么没停？")).toBe(false);
    expect(isStageTruncateCommand("滑到坡底需要多少时间")).toBe(false);
    expect(isStageTruncateCommand("解析一下前两段的受力")).toBe(false);
  });

  it("准确识别明确的截断指令", () => {
    expect(isStageTruncateCommand("只看斜面")).toBe(true);
    expect(isStageTruncateCommand("只播前两段")).toBe(true);
    expect(isStageTruncateCommand("截到坡底")).toBe(true);
    expect(isStageTruncateCommand("到坡底为止")).toBe(true);
    expect(isStageTruncateCommand("前两段")).toBe(true);
    expect(isStageTruncateCommand("保留前3段")).toBe(true);
  });
});

describe("buildTutorPayload 清理 null/undefined 噪音", () => {
  it("不向模型发送 problemText: null 等空字段", () => {
    const payload = buildTutorPayload({
      motion: null,
      reading: {
        ...MOVABLE_ARC_PLAN,
        gravityMps2: null,
      },
      problemText: null,
      currentTime: 0,
      history: [],
      conditions: {},
    });

    expect("problemText" in payload).toBe(false);
    expect("durationSeconds" in payload).toBe(false);
    expect("currentSnapshot" in payload).toBe(false);
    expect("currentEnergyJ" in payload).toBe(false);
    expect("gravityMps2" in (payload.reading as Record<string, unknown>)).toBe(false);
    expect((payload.reading as Record<string, unknown>).massKg).toBe(1);
  });
});

describe("tryParseStagePlanUpdate stage_plan 自然语言改参", () => {
  it("支持修改质量、半径、劲度系数、摩擦因数、重力加速度与槽质量且不污染原对象", () => {
    const massRes = tryParseStagePlanUpdate("把质量改成 2 kg", MOVABLE_ARC_PLAN);
    expect(massRes?.type).toBe("update_stage_plan");
    if (massRes?.type === "update_stage_plan") {
      expect(massRes.nextReading.massKg).toBe(2);
      expect(MOVABLE_ARC_PLAN.massKg).toBe(1);
      expect(massRes.changes[0]).toMatchObject({ key: "massKg", from: 1, to: 2, unit: "kg" });
    }

    const radiusRes = tryParseStagePlanUpdate("把半径改成 1.2 m", MOVABLE_ARC_PLAN);
    expect(radiusRes?.type).toBe("update_stage_plan");
    if (radiusRes?.type === "update_stage_plan") {
      expect(radiusRes.nextReading.stages[0].radiusM).toBe(1.2);
    }

    const grooveRes = tryParseStagePlanUpdate("把圆弧槽质量改为 5 kg", MOVABLE_ARC_PLAN);
    expect(grooveRes?.type).toBe("update_stage_plan");
    if (grooveRes?.type === "update_stage_plan") {
      expect(grooveRes.nextReading.stages[0].grooveMassKg).toBe(5);
    }

    const springRes = tryParseStagePlanUpdate("把劲度系数改成 250", INCLINE_PLAN);
    expect(springRes?.type).toBe("update_stage_plan");
    if (springRes?.type === "update_stage_plan") {
      expect(springRes.nextReading.stages[3].springConstantNpm).toBe(250);
    }

    const muRes = tryParseStagePlanUpdate("把摩擦因数改成 0.2", INCLINE_PLAN);
    expect(muRes?.type).toBe("update_stage_plan");
    if (muRes?.type === "update_stage_plan") {
      expect(muRes.nextReading.stages[0].kineticFrictionCoefficient).toBe(0.2);
    }

    const gRes = tryParseStagePlanUpdate("把重力加速度改成 9.8", INCLINE_PLAN);
    expect(gRes?.type).toBe("update_stage_plan");
    if (gRes?.type === "update_stage_plan") {
      expect(gRes.nextReading.gravityMps2).toBe(9.8);
    }
  });

  it("不误拦截假设性物理提问", () => {
    expect(tryParseStagePlanUpdate("如果把质量改成 2 kg，底端速度会怎么变化？", MOVABLE_ARC_PLAN)).toBeNull();
  });

  it("未给数值时返回追问 clarify", () => {
    const res = tryParseStagePlanUpdate("把半径改一下", MOVABLE_ARC_PLAN);
    expect(res?.type).toBe("clarify");
  });
});

describe("getQuickParamSuggestions 与 getLocalSimilarProblems", () => {
  it("动态提取当前题目的 2~3 个改参建议", () => {
    const suggestions = getQuickParamSuggestions(MOVABLE_ARC_PLAN);
    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    expect(suggestions.length).toBeLessThanOrEqual(3);
    expect(suggestions.some((s) => s.command.includes("半径"))).toBe(true);
  });

  it("按当前阶段类型返回对应的本地相似变式题库", () => {
    const movableList = getLocalSimilarProblems(MOVABLE_ARC_PLAN);
    expect(movableList.length).toBeGreaterThanOrEqual(2);
    expect(movableList[0].tags.join(",")).toContain("动量守恒");

    const inclineList = getLocalSimilarProblems(INCLINE_PLAN);
    expect(inclineList.length).toBeGreaterThanOrEqual(2);
    expect(inclineList[0].stem).toContain("斜面");
  });

  it("全量本地相似题库均参数齐全、几何自洽且无非法接续表述", () => {
    const sampleDrafts: Array<StagePlanDraft | null> = [
      null,
      MOVABLE_ARC_PLAN,
      INCLINE_PLAN,
      { kind: "stage_plan", schemaVersion: 1, initial: { speedMps: 4 }, stages: [{ kind: "spring_pair" }] },
      { kind: "stage_plan", schemaVersion: 1, initial: { speedMps: 4 }, stages: [{ kind: "vertical_arc" }] },
      { kind: "stage_plan", schemaVersion: 1, initial: { vxMps: 4, vyMps: 0 }, stages: [{ kind: "projectile" }] },
      { kind: "stage_plan", schemaVersion: 1, initial: { speedMps: 0 }, stages: [{ kind: "block_plank" }] },
      { kind: "stage_plan", schemaVersion: 1, initial: { vxMps: 0 }, stages: [{ kind: "conveyor_belt" }] },
      { kind: "stage_plan", schemaVersion: 1, initial: { speedMps: 0 }, stages: [{ kind: "pulley_system" }] },
      { kind: "stage_plan", schemaVersion: 1, initial: { speedMps: 0 }, stages: [{ kind: "collision_1d" }] },
      { kind: "stage_plan", schemaVersion: 1, initial: { speedMps: 0 }, stages: [{ kind: "pendulum_swing" }] },
    ];

    for (const draft of sampleDrafts) {
      const list = getLocalSimilarProblems(draft);
      expect(list.length).toBeGreaterThanOrEqual(2);
      for (const item of list) {
        expect(item.title.trim().length).toBeGreaterThan(0);
        expect(item.stem.trim().length).toBeGreaterThan(20);
        expect(item.focus.trim().length).toBeGreaterThan(0);
        expect(item.hint.trim().length).toBeGreaterThan(0);
        expect(item.tags.length).toBeGreaterThan(0);
        // 必须给出 g = 10 m/s² 且包含具体数字，避免纯字母符号题
        expect(item.stem).toMatch(/g\s*=\s*10\s*m\/s²/);
        expect(item.stem).toMatch(/\d/);
        // 严禁出现转向后直接平抛（缺少水平段）的非法表述
        expect(item.stem).not.toMatch(/无损转向后立即.{0,12}飞出/);
        // 严禁出现字面 null/undefined
        expect(item.stem).not.toMatch(/\b(?:null|undefined)\b/i);
      }
    }

    // 针对已修复题目的定向回归断言
    const arcList = getLocalSimilarProblems({
      kind: "stage_plan",
      schemaVersion: 1,
      initial: { speedMps: 4 },
      stages: [{ kind: "vertical_arc" }],
    });
    expect(arcList[0].stem).toContain("45°");
    expect(arcList[0].stem).toContain("内侧");
    expect(arcList[0].stem).toContain("225°");

    const projList = getLocalSimilarProblems({
      kind: "stage_plan",
      schemaVersion: 1,
      initial: { vxMps: 4, vyMps: 0 },
      stages: [{ kind: "projectile" }],
    });
    expect(projList[1].stem).toContain("光滑水平平台");

    const pulleyList = getLocalSimilarProblems({
      kind: "stage_plan",
      schemaVersion: 1,
      initial: { speedMps: 0 },
      stages: [{ kind: "pulley_system" }],
    });
    expect(pulleyList[1].stem).toContain("μs = 0.2");
    expect(pulleyList[1].stem).toContain("加速滑动");

    const collList = getLocalSimilarProblems({
      kind: "stage_plan",
      schemaVersion: 1,
      initial: { speedMps: 0 },
      stages: [{ kind: "collision_1d" }],
    });
    expect(collList[0].stem).toContain("μ = 0.2");
    expect(collList[1].stem).toContain("x = 0");
    expect(collList[1].stem).toContain("x = 6 m");
  });
});
