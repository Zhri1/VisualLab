/**
 * 识别回包 mock 的回归测试。
 * mockPlan 是现场演示与断网时的兜底路径，四种回包都要有覆盖。
 *
 * 运行：npm run test
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../fixtures/incline-spring.reading.json";
import { SAMPLE_READING, mockPlan, setMockScenario } from "../imageRecognition";

// 强制场景是模块级状态，每条用例后复位，避免污染其他用例
afterEach(() => {
  setMockScenario(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("生产模式内置示例仍使用本地题设，无需模型服务", async () => {
  vi.stubEnv("VITE_USE_MOCK_API", "false");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  vi.resetModules();
  const { requestPlan } = await import("../imageRecognition");
  const result = await requestPlan({ isSample: true });
  expect(result.status).toBe("ok");
  if (result.status === "ok") expect(result.reading).toEqual(fixture);
  expect(fetch).not.toHaveBeenCalled();
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

/**
 * 形状断言：mock 是与真实服务同一套契约（CONTRACTS.md 第 2 节），
 * 前端靠 message + assumptions 生成开场白和假设胶囊，缺一个字段就会静默退化。
 */
describe("mockPlan 的回包形状", () => {
  it("内置示例 isSample=true → ok、message 非空、assumptions 3 条", () => {
    const r = mockPlan(true, true);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(typeof r.message).toBe("string");
    expect((r.message ?? "").trim().length).toBeGreaterThan(0);
    expect(Array.isArray(r.assumptions)).toBe(true);
    expect(r.assumptions).toHaveLength(3);
    expect(r.assumptions?.every((s) => typeof s === "string" && s.trim() !== "")).toBe(true);
  });

  it("有图默认支路 → ok：message 一定存在且非空", () => {
    const r = mockPlan(true);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.message).toBeDefined();
    expect((r.message ?? "").trim().length).toBeGreaterThan(0);
    expect(r.assumptions).toHaveLength(3);
    // 假设条目要能和胶囊的「g=10」断言对上
    expect(r.assumptions?.[0]).toContain("g=10");
  });

  it("needs_input 支路形状：message + missingKeys + reading 都在", () => {
    setMockScenario("needs_input");
    const r = mockPlan(true);
    expect(r.status).toBe("needs_input");
    if (r.status !== "needs_input") return;
    expect((r.message ?? "").trim().length).toBeGreaterThan(0);
    expect(Array.isArray(r.missingKeys)).toBe(true);
    expect(r.missingKeys).toContain("springGapM");
    expect(r.reading).not.toBeNull();
    expect(r.reading?.conditions.springGapM).toBeNull();
  });

  it("强制 needs_input 支路也带 assumptions，且 message 保持原文", () => {
    setMockScenario("needs_input");
    const r = mockPlan(true);
    expect(r.status).toBe("needs_input");
    if (r.status !== "needs_input") return;
    expect(Array.isArray(r.assumptions)).toBe(true);
    expect(r.assumptions).toHaveLength(3);
    expect(r.assumptions?.every((s) => typeof s === "string" && s.trim() !== "")).toBe(true);
    expect(r.assumptions?.[0]).toContain("g=10");
    // 补 assumptions 不改动既有 message
    expect(r.message).toBe("请确认弹簧接触端与斜面底端的距离");
  });

  it("无图 needs_input 支路也带 assumptions，且 message 保持原文", () => {
    const r = mockPlan(false);
    expect(r.status).toBe("needs_input");
    if (r.status !== "needs_input") return;
    expect(Array.isArray(r.assumptions)).toBe(true);
    expect(r.assumptions).toHaveLength(3);
    expect(r.assumptions?.every((s) => typeof s === "string" && s.trim() !== "")).toBe(true);
    expect(r.assumptions?.[0]).toContain("g=10");
    expect(r.message).toBe("已识别出主要条件，但坡底到弹簧的距离需要你确认");
  });

  it("两条 needs_input 支路的 assumptions 与内置示例逐条一致", () => {
    const sampleReply = mockPlan(true, true);
    expect(sampleReply.status).toBe("ok");
    if (sampleReply.status !== "ok") return;

    const forced = (() => {
      setMockScenario("needs_input");
      return mockPlan(true);
    })();
    setMockScenario(null);
    const noImage = mockPlan(false);

    for (const r of [forced, noImage]) {
      expect(r.status).toBe("needs_input");
      if (r.status !== "needs_input") continue;
      expect(r.assumptions).toEqual(sampleReply.assumptions);
    }
  });

  it("unsupported 支路形状：只有 status + 非空 message", () => {
    setMockScenario("unsupported");
    const r = mockPlan(true);
    expect(r.status).toBe("unsupported");
    if (r.status !== "unsupported") return;
    expect((r.message ?? "").trim().length).toBeGreaterThan(0);
    expect("reading" in r).toBe(false);
    expect("assumptions" in r).toBe(false);
  });

  it("error 支路形状：message 非空、带 httpStatus、不带 reading", () => {
    setMockScenario("error");
    const r = mockPlan(true);
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect((r.message ?? "").trim().length).toBeGreaterThan(0);
    expect(r.httpStatus).toBe(502);
    expect("reading" in r).toBe(false);
  });

  it("四条支路的 status 覆盖齐全，且都带非空 message", () => {
    const seen = new Map<string, string>();
    const collect = (label: string, scenario: "ok" | "needs_input" | "unsupported" | "error") => {
      setMockScenario(scenario === "ok" ? null : scenario);
      const r = mockPlan(true);
      seen.set(r.status, (r.message ?? "").trim());
      expect(r.status, label).toBe(scenario);
    };
    collect("有图默认", "ok");
    collect("强制缺项", "needs_input");
    collect("强制超范围", "unsupported");
    collect("强制错误", "error");
    expect([...seen.keys()].sort()).toEqual(["error", "needs_input", "ok", "unsupported"]);
    for (const [status, message] of seen) {
      expect(message.length, `${status} 的 message 不能为空`).toBeGreaterThan(0);
    }
  });
});
