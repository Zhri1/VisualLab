/**
 * 识别回包 mock 的回归测试。
 * mockPlan 是现场演示与断网时的兜底路径，四种回包都要有覆盖。
 *
 * 运行：npm run test
 */
import { afterEach, describe, expect, it } from "vitest";
import fixture from "../../../fixtures/incline-spring.reading.json";
import { SAMPLE_READING, mockPlan, setMockScenario } from "../imageRecognition";

// 强制场景是模块级状态，每条用例后复位，避免污染其他用例
afterEach(() => {
  setMockScenario(null);
});

describe("mockPlan", () => {
  it("内置示例一定返回 ok，且弹簧间距为 1 m", () => {
    const r = mockPlan(false, true);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.reading.conditions.springGapM).toBe(1);
  });

  it("内置示例不受强制场景影响", () => {
    setMockScenario("error");
    expect(mockPlan(false, true).status).toBe("ok");
  });

  it("有图、无强制场景 → ok，reading 与契约样例逐字段一致", () => {
    const r = mockPlan(true);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.reading).toEqual(fixture);
    expect(r.reading).toEqual(SAMPLE_READING);
  });

  it("无图、非示例 → needs_input，缺 springGapM", () => {
    const r = mockPlan(false);
    expect(r.status).toBe("needs_input");
    if (r.status !== "needs_input") return;
    expect(r.missingKeys).toContain("springGapM");
  });

  it("强制 unsupported → unsupported", () => {
    setMockScenario("unsupported");
    expect(mockPlan(true).status).toBe("unsupported");
  });

  it("强制 error → error，httpStatus 为 502", () => {
    setMockScenario("error");
    const r = mockPlan(true);
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.httpStatus).toBe(502);
  });
});
