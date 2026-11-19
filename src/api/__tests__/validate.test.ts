/**
 * buildPlan（模型回包 → 契约状态）的回归测试。
 *
 * 重点：CONTRACTS.md 第 2 节要求三种 200 回包都带非空 message，
 * 假设条目由 assumptions 承载、正文只报数量，所以 message 里必须能看到这些条目。
 *
 * 输入按 fixtures/incline-spring.reading.json 的结构直接构造，
 * 不读文件，避免用例被 fixture 改动牵连。
 */
import { describe, expect, it } from "vitest";
import { buildPlan } from "../validate";

/** 与 fixtures/incline-spring.reading.json 同构的标准题 */
const SAMPLE_INPUT = {
  templateId: "incline_spring",
  conditions: {
    gravityMps2: 10,
    inclineAngleDeg: 37,
    inclineLengthM: 4,
    kineticFrictionCoefficient: 0.5,
    initialSpeedMps: 0,
    blockMassKg: 1,
    springGapM: 1,
    springConstantNpm: 400,
  },
  facts: {
    slidesAfterRelease: true,
    losslessTurn: true,
    horizontalIsFrictionless: true,
    springIsUnattached: true,
  },
};

/** 每次拿一份新对象，避免用例之间互相污染 */
const sample = (assumptions?: unknown) => ({
  ...SAMPLE_INPUT,
  conditions: { ...SAMPLE_INPUT.conditions },
  facts: { ...SAMPLE_INPUT.facts },
  ...(assumptions === undefined ? {} : { assumptions }),
});

describe("buildPlan 的 ok 回包", () => {
  it("无 assumptions 时 message 是「已按题面条件识别完成」", () => {
    const r = buildPlan(sample());
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.message).toBe("已按题面条件识别完成");
    expect(r.assumptions).toEqual([]);
  });

  it("ok 回包的 message 一定非空（去掉首尾空白后长度 > 0）", () => {
    const withItems = buildPlan(sample(["g=10 m/s²", "μ=0.5", "倾角 37°"]));
    const withoutItems = buildPlan(sample());
    for (const r of [withItems, withoutItems]) {
      expect(r.status).toBe("ok");
      if (r.status !== "ok") continue;
      expect(typeof r.message).toBe("string");
      expect(r.message.trim().length).toBeGreaterThan(0);
    }
  });

  it("有 assumptions 时 message 逐条出现这些条目", () => {
    const items = ["g=10 m/s²", "μ=0.5", "倾角 37°"];
    const r = buildPlan(sample(items));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.assumptions).toEqual(items);
    for (const item of items) {
      expect(r.message).toContain(item);
    }
  });

  it("assumptions 只取前 3 条，message 也只报这 3 条", () => {
    const items = ["g=10 m/s²", "μ=0.5", "倾角 37°", "第 4 条不该出现", "第 5 条不该出现"];
    const r = buildPlan(sample(items));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.assumptions).toHaveLength(3);
    expect(r.assumptions).toEqual(items.slice(0, 3));
    expect(r.message).toContain("倾角 37°");
    expect(r.message).not.toContain("第 4 条不该出现");
    expect(r.message).not.toContain("第 5 条不该出现");
  });

  it("空白条目与非字符串被过滤，不会污染 message", () => {
    const r = buildPlan(sample(["g=10 m/s²", "   ", 42, null, "μ=0.5"]));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.assumptions).toEqual(["g=10 m/s²", "μ=0.5"]);
    expect(r.message).toContain("g=10 m/s²");
    expect(r.message).toContain("μ=0.5");
  });
});

describe("buildPlan 的 needs_input 假设条目", () => {
  /** 缺弹簧间距的输入，可按需附带 assumptions */
  const missingGap = (assumptions?: unknown) => {
    const input = sample(assumptions);
    input.conditions.springGapM = null as unknown as number;
    return input;
  };

  it("缺项时 assumptions 原样透传（0–3 条）", () => {
    const items = ["g=10 m/s²", "μ=0.5", "倾角 37°"];
    const r = buildPlan(missingGap(items));
    expect(r.status).toBe("needs_input");
    if (r.status !== "needs_input") return;
    expect(r.assumptions).toEqual(items);
  });

  it("缺项且模型没给假设时是空数组，而不是 undefined", () => {
    const r = buildPlan(missingGap());
    expect(r.status).toBe("needs_input");
    if (r.status !== "needs_input") return;
    expect(r.assumptions).toEqual([]);
  });

  it("缺项时也过滤空白与非字符串，并截断到 3 条", () => {
    const r = buildPlan(
      missingGap(["g=10 m/s²", "   ", 42, null, "μ=0.5", "倾角 37°", "第 4 条不该出现"])
    );
    expect(r.status).toBe("needs_input");
    if (r.status !== "needs_input") return;
    expect(r.assumptions).toEqual(["g=10 m/s²", "μ=0.5", "倾角 37°"]);
  });

  it("认不出题型（reading 为 null）时同样携带 assumptions", () => {
    const r = buildPlan({ assumptions: ["g=10 m/s²"] });
    expect(r.status).toBe("needs_input");
    if (r.status !== "needs_input") return;
    expect(r.reading).toBeNull();
    expect(r.assumptions).toEqual(["g=10 m/s²"]);
  });

  it("unsupported 是纯提示，不带 assumptions 字段", () => {
    const r = buildPlan({ templateId: "unsupported", conditions: {}, facts: {} });
    expect(r.status).toBe("unsupported");
    expect("assumptions" in r).toBe(false);
  });
});

describe("buildPlan 的非 ok 支路", () => {
  it("needs_input 保留已识别字段，并携带 assumptions 与提示", () => {
    const input = sample(["g=10 m/s²"]);
    input.conditions.springGapM = null as unknown as number;
    const r = buildPlan(input);
    expect(r.status).toBe("needs_input");
    if (r.status !== "needs_input") return;
    expect(r.missingKeys).toContain("springGapM");
    expect(r.reading?.conditions.inclineAngleDeg).toBe(37);
    expect(r.assumptions).toEqual(["g=10 m/s²"]);
    expect(r.message.trim().length).toBeGreaterThan(0);
  });

  it("unsupported 回包也带非空 message", () => {
    const r = buildPlan({
      templateId: "unsupported",
      conditions: {},
      facts: {},
      unsupportedReason: "带电粒子在磁场中做圆周运动",
    });
    expect(r.status).toBe("unsupported");
    if (r.status !== "unsupported") return;
    expect(r.message.trim().length).toBeGreaterThan(0);
    expect(r.message).toContain("带电粒子在磁场中做圆周运动");
  });
});