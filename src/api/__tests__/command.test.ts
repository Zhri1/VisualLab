/**
 * parseCommand 的回归测试。
 *
 * 契约：STAGE_COMPOSITION.md 第 4.3 节。
 * 「只看斜面」必须解析成 throughStageIndex = 0，A 据此截断前缀后重新装配，
 * 不重新请求识别。指令能识别但计划里没有对应阶段时，必须是 unsupported 而不是静默成功。
 */
import { describe, expect, it } from "vitest";
import { parseCommand } from "../command";

/** 与 fixtures/stage-composition.reading.json 同构 */
const PLAN = {
  stages: [
    { kind: "incline_slide" },
    { kind: "lossless_turn" },
    { kind: "horizontal_slide" },
    { kind: "projectile" },
  ],
};

describe("parseCommand", () => {
  it("只看斜面 → 保留第 1 段", () => {
    const result = parseCommand("只看斜面", PLAN);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.intent).toEqual({ type: "truncate_stages", throughStageIndex: 0 });
  });

  it("只看到坡底 → 仍停在斜面段", () => {
    const result = parseCommand("只看到坡底", PLAN);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.intent.throughStageIndex).toBe(0);
  });

  it("只看转向 → 保留到无损转向", () => {
    const result = parseCommand("只看坡底转向", PLAN);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.intent.throughStageIndex).toBe(1);
  });

  it("只看到桌面 → 保留到水平段", () => {
    const result = parseCommand("只看到桌面", PLAN);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.intent.throughStageIndex).toBe(2);
  });

  it("只看落地 → 保留到抛体段", () => {
    const result = parseCommand("只看落地", PLAN);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.intent.throughStageIndex).toBe(3);
  });

  it("前两段 → 下标 1", () => {
    const result = parseCommand("前两段", PLAN);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.intent.throughStageIndex).toBe(1);
  });

  it("前 9 段超出计划长度 → unsupported", () => {
    const result = parseCommand("前9段", PLAN);
    expect(result.status).toBe("unsupported");
  });

  it("计划里没有弹簧段 → unsupported", () => {
    const result = parseCommand("只看弹簧", PLAN);
    expect(result.status).toBe("unsupported");
  });

  it("空指令 → needs_input 并给出路径", () => {
    const result = parseCommand("   ", PLAN);
    expect(result.status).toBe("needs_input");
    if (result.status !== "needs_input") return;
    expect(result.missingKeys).toContain("/intent/throughStageIndex");
  });

  it("无关指令 → unsupported，不静默成功", () => {
    const result = parseCommand("换个颜色", PLAN);
    expect(result.status).toBe("unsupported");
  });

  it("标点与空格不影响解析", () => {
    const result = parseCommand("只看 斜面。", PLAN);
    expect(result.status).toBe("ok");
  });

  it("只看圆弧槽 / 只看弹簧双球 → 动量守恒组合的两段", () => {
    const plan = { stages: [{ kind: "movable_arc" }, { kind: "spring_pair" }] };
    const arc = parseCommand("只看圆弧槽", plan);
    expect(arc.status).toBe("ok");
    if (arc.status === "ok") expect(arc.intent.throughStageIndex).toBe(0);
    const pair = parseCommand("只看弹簧双球", plan);
    expect(pair.status).toBe("ok");
    if (pair.status === "ok") expect(pair.intent.throughStageIndex).toBe(1);
  });

  it("旧计划里没有圆弧槽 → 不静默成功", () => {
    const result = parseCommand("只看圆弧槽", PLAN);
    expect(result.status).toBe("unsupported");
  });
});
