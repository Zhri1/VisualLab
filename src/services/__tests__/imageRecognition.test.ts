/**
 * 识别回包 mock 的回归测试。
 * mockPlan 是现场演示与断网时的兜底路径，四种回包都要有覆盖。
 *
 * 运行：npm run test
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../fixtures/incline-spring.reading.json";
import stageFixture from "../../../fixtures/stage-composition.reading.json";
import type { StagePlanDraft } from "../../physics/stagePlan";
import { SAMPLE_READING, mockPlan, setMockScenario } from "../imageRecognition";
import { SAMPLES } from "../../data/samples";
import { isStageReading } from "../../types";

// 强制场景是模块级状态，每条用例后复位，避免污染其他用例
afterEach(() => {
  setMockScenario(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(["offline", "409"])("生产模式接口%s时内置示例仍可独立打开", async (scenario) => {
  vi.stubEnv("VITE_USE_MOCK_API", "false");
  const fetch = scenario === "offline"
    ? vi.fn().mockRejectedValue(new TypeError("接口不可用"))
    : vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "接口未启用" }), { status: 409 }));
  vi.stubGlobal("fetch", fetch);
  vi.resetModules();
  const { requestPlan } = await import("../imageRecognition");
  const result = await requestPlan({ isSample: true });
  expect(result.status).toBe("ok");
  if (result.status === "ok") {
    expect(result.reading).toEqual(SAMPLES[0].reading);
    expect(result.imageUrl).toBe(SAMPLES[0].imageUrl);
  }
  expect(fetch).not.toHaveBeenCalled();
});

it("生产模式真实上传仍发送图片到原识别接口", async () => {
  vi.stubEnv("VITE_USE_MOCK_API", "false");
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ok", reading: fixture })));
  vi.stubGlobal("fetch", fetch);
  vi.resetModules();
  const { requestPlan, ENDPOINT } = await import("../imageRecognition");
  const file = new File(["synthetic"], "question.png", { type: "image/png" });
  const result = await requestPlan({ file });
  expect(result.status).toBe("ok");
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
  const form = fetch.mock.calls[0][1].body as FormData;
  expect(form.get("image")).toBe(file);
});

describe("mockPlan", () => {
  it("内置示例一定返回 ok，携带原题图片与默认示例 reading", () => {
    const r = mockPlan(false, true);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.reading).toEqual(SAMPLES[0].reading);
    expect(r.imageUrl).toBe(SAMPLES[0].imageUrl);
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
    if (!r.reading || isStageReading(r.reading)) throw new Error("应为旧模板缺项样例");
    expect(r.reading.conditions.springGapM).toBeNull();
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

  it("两条 needs_input 支路的 assumptions 与有图 ok 回包逐条一致", () => {
    const okReply = mockPlan(true, false);
    expect(okReply.status).toBe("ok");
    if (okReply.status !== "ok") return;

    const forced = (() => {
      setMockScenario("needs_input");
      return mockPlan(true);
    })();
    setMockScenario(null);
    const noImage = mockPlan(false);

    for (const r of [forced, noImage]) {
      expect(r.status).toBe("needs_input");
      if (r.status !== "needs_input") continue;
      expect(r.assumptions).toEqual(okReply.assumptions);
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

describe("stage_plan 服务适配", () => {
  const stagePlan = stageFixture as StagePlanDraft;

  it("真实截断指令只提交 command + 完整 currentPlan", async () => {
    vi.stubEnv("VITE_USE_MOCK_API", "false");
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "ok", intent: { type: "truncate_stages", throughStageIndex: 0 },
    })));
    vi.stubGlobal("fetch", fetch);
    vi.resetModules();
    const { requestStageCommand, ENDPOINT } = await import("../imageRecognition");
    const result = await requestStageCommand("只看斜面", stagePlan);
    expect(result).toEqual({ status: "ok", intent: { type: "truncate_stages", throughStageIndex: 0 } });
    expect(fetch).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    const form = fetch.mock.calls[0][1].body as FormData;
    expect(form.get("command")).toBe("只看斜面");
    expect(form.get("currentPlan")).toBe(JSON.stringify(stagePlan));
    expect(form.get("text")).toBeNull();
    expect(form.get("image")).toBeNull();
  });

  it("离线 mock 也走同一截断意图", async () => {
    vi.stubEnv("VITE_USE_MOCK_API", "true");
    vi.resetModules();
    const { requestStageCommand } = await import("../imageRecognition");
    const result = await requestStageCommand("只看斜面", stagePlan);
    expect(result).toEqual({ status: "ok", intent: { type: "truncate_stages", throughStageIndex: 0 } });
  });

  it("needs_input 透传阶段 fieldErrors", async () => {
    vi.stubEnv("VITE_USE_MOCK_API", "false");
    const fieldErrors = [{ path: "/stages/3/dropHeightM", code: "NOT_FINITE", message: "数值须为有限数" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "needs_input", reading: stagePlan, missingKeys: [], fieldErrors, message: "请修正",
    }))));
    vi.resetModules();
    const { requestPlan } = await import("../imageRecognition");
    const result = await requestPlan({ text: "测试" });
    expect(result.status).toBe("needs_input");
    if (result.status === "needs_input") expect(result.fieldErrors).toEqual(fieldErrors);
  });
});
