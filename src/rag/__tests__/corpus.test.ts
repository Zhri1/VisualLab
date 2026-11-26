import { describe, expect, it } from "vitest";
import { PHYSICS_RAG_CORPUS } from "../corpus.ts";
import type { RagDifficulty } from "../types.ts";

/** 仓库 stage_plan 全部 18 个合法 StageKind */
const VALID_STAGE_KINDS = new Set<string>([
  "incline_slide",
  "lossless_turn",
  "horizontal_slide",
  "spring_contact",
  "spring_release",
  "projectile",
  "vertical_arc",
  "constant_force_1d",
  "conveyor_belt",
  "magnetic_deflection",
  "movable_arc",
  "spring_pair",
  "horizontal_approach",
  "pendulum_swing",
  "collision_1d",
  "parallel_motion",
  "block_plank",
  "pulley_system",
]);

/** VisualLab 全部 16 类核心物理模型（不含纯衔接阶段 lossless_turn 与容器阶段 parallel_motion） */
const CORE_16_MODELS = [
  "incline_slide",
  "horizontal_slide",
  "spring_contact",
  "spring_release",
  "projectile",
  "vertical_arc",
  "constant_force_1d",
  "conveyor_belt",
  "magnetic_deflection",
  "movable_arc",
  "spring_pair",
  "horizontal_approach",
  "pendulum_swing",
  "collision_1d",
  "block_plank",
  "pulley_system",
] as const;

const VALID_DIFFICULTIES = new Set<RagDifficulty>(["基础", "中档", "拔高"]);
const PLACEHOLDER_PATTERN = /\b(TODO|TBD|FIXME|XXX)\b|待补充|待完善|\?\?\?|\{\{|\}\}/i;

describe("PHYSICS_RAG_CORPUS 质量与自洽校验", () => {
  it("条目总数不少于 30 道，且无重复 id 与重复 title", () => {
    expect(PHYSICS_RAG_CORPUS.length).toBeGreaterThanOrEqual(30);

    const ids = new Set<string>();
    const titles = new Set<string>();
    for (const entry of PHYSICS_RAG_CORPUS) {
      expect(entry.id.trim().length).toBeGreaterThan(0);
      expect(ids.has(entry.id), `发现重复 id: ${entry.id}`).toBe(false);
      ids.add(entry.id);

      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(titles.has(entry.title), `发现重复 title: ${entry.title}`).toBe(false);
      titles.add(entry.title);
    }
  });

  it("每条的 stageSignature 非空且全部属于 18 个合法 StageKind", () => {
    for (const entry of PHYSICS_RAG_CORPUS) {
      expect(
        entry.stageSignature.length,
        `条目 ${entry.id} 的 stageSignature 不能为空`,
      ).toBeGreaterThan(0);

      for (const stage of entry.stageSignature) {
        expect(
          VALID_STAGE_KINDS.has(stage),
          `条目 ${entry.id} 包含非法 StageKind: ${stage}`,
        ).toBe(true);
      }
    }
  });

  it("全面覆盖全部 16 类核心物理模型、全部 18 种 StageKind 及三档难度", () => {
    const coveredStages = new Set<string>();
    const coveredDifficulties = new Set<RagDifficulty>();

    for (const entry of PHYSICS_RAG_CORPUS) {
      expect(VALID_DIFFICULTIES.has(entry.difficulty)).toBe(true);
      coveredDifficulties.add(entry.difficulty);
      for (const stage of entry.stageSignature) {
        coveredStages.add(stage);
      }
    }

    for (const model of CORE_16_MODELS) {
      expect(coveredStages.has(model), `缺少核心模型覆盖: ${model}`).toBe(true);
    }
    for (const stage of VALID_STAGE_KINDS) {
      expect(coveredStages.has(stage), `缺少 StageKind 覆盖: ${stage}`).toBe(true);
    }
    for (const diff of VALID_DIFFICULTIES) {
      expect(coveredDifficulties.has(diff), `缺少难度分层覆盖: ${diff}`).toBe(true);
    }
  });

  it("每条 stem、keyFormulas、pitfalls、solutionOutline、planHint 均满足格式与自洽标准", () => {
    for (const entry of PHYSICS_RAG_CORPUS) {
      // stem 长度合理、含具体数值、不含占位符
      expect(
        entry.stem.trim().length,
        `条目 ${entry.id} 的 stem 过短`,
      ).toBeGreaterThanOrEqual(45);
      expect(
        /\d/.test(entry.stem),
        `条目 ${entry.id} 的 stem 必须包含具体物理数值`,
      ).toBe(true);
      expect(
        PLACEHOLDER_PATTERN.test(entry.stem),
        `条目 ${entry.id} 的 stem 不得包含未定义占位符`,
      ).toBe(false);

      // 非磁场题应明确给出重力加速度 g = 10 m/s²
      const isMagneticOnly =
        entry.stageSignature.length === 1 && entry.stageSignature[0] === "magnetic_deflection";
      if (!isMagneticOnly) {
        expect(
          entry.stem.includes("g = 10 m/s²"),
          `条目 ${entry.id} 的 stem 缺少明确重力加速度 g = 10 m/s²`,
        ).toBe(true);
      }

      // tags 非空
      expect(entry.tags.length, `条目 ${entry.id} 的 tags 不能为空`).toBeGreaterThanOrEqual(2);

      // keyFormulas: 2~4 条纯文本直观公式，不含 LaTeX 反斜杠
      expect(entry.keyFormulas.length, `条目 ${entry.id} 的 keyFormulas 数量应在 2~4 条`).toBeGreaterThanOrEqual(2);
      expect(entry.keyFormulas.length, `条目 ${entry.id} 的 keyFormulas 数量应在 2~4 条`).toBeLessThanOrEqual(4);
      for (const formula of entry.keyFormulas) {
        expect(formula.trim().length).toBeGreaterThan(0);
        expect(
          formula.includes("\\"),
          `条目 ${entry.id} 的公式不得使用 LaTeX 反斜杠: ${formula}`,
        ).toBe(false);
      }

      // pitfalls: 2~3 条非空
      expect(entry.pitfalls.length, `条目 ${entry.id} 的 pitfalls 数量应在 2~3 条`).toBeGreaterThanOrEqual(2);
      expect(entry.pitfalls.length, `条目 ${entry.id} 的 pitfalls 数量应在 2~3 条`).toBeLessThanOrEqual(3);
      for (const pitfall of entry.pitfalls) {
        expect(pitfall.trim().length).toBeGreaterThan(0);
      }

      // solutionOutline 与 planHint 非空且不含占位符
      expect(entry.solutionOutline.trim().length).toBeGreaterThanOrEqual(50);
      expect(PLACEHOLDER_PATTERN.test(entry.solutionOutline)).toBe(false);
      expect(entry.planHint.trim().length).toBeGreaterThanOrEqual(15);
      expect(PLACEHOLDER_PATTERN.test(entry.planHint)).toBe(false);
    }
  });
});
