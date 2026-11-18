/**
 * 对照 PROJECT_PLAN_FINAL.md 第 3 节的验收数值。
 * 这组用例同时是交给成员 B 的对齐基准：B 的实现必须逐项通过。
 *
 * 运行：npm run test
 */
import { describe, expect, it } from "vitest";
import { SAMPLE_READING } from "../../services/imageRecognition";
import type { Reading } from "../../types";
import { motionLibrary } from "../index";

const { assembleScene, buildMotion } = motionLibrary;

function run(reading: Reading) {
  const s = assembleScene(reading);
  if (!s.ok) throw new Error(s.errors.map((e) => e.message).join("; "));
  const m = buildMotion(s.scene);
  if (!m.ok) throw new Error(m.message);
  return m.motion;
}

const ev = (m: ReturnType<typeof run>, id: string) => {
  const e = m.events.find((x) => x.id === id);
  if (!e) throw new Error(`缺少事件 ${id}`);
  return e;
};

describe("主演示题数值", () => {
  const m = run(SAMPLE_READING);

  it("斜面加速度 2.0250 m/s²", () => {
    expect(ev(m, "release").detail).toContain("2.0250");
  });

  it("到达坡底 1.9876 s、速率 4.0249 m/s", () => {
    expect(ev(m, "reach_bottom").timeSeconds).toBeCloseTo(1.9876, 3);
    const v = ev(m, "reach_bottom").velocityAfter!;
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(4.0249, 3);
  });

  it("转向位置连续：转向前后同为坡底原点", () => {
    const s = m.sampleAt(1.9876 - 1e-4);
    const after = m.sampleAt(1.9876 + 1e-4);
    expect(Math.hypot(s.position.x, s.position.y)).toBeLessThan(1e-3);
    expect(Math.hypot(after.position.x, after.position.y)).toBeLessThan(1e-3);
  });

  it("接触弹簧 2.2361 s，已水平前进 1.00 m", () => {
    expect(ev(m, "contact_spring").timeSeconds).toBeCloseTo(2.2361, 3);
    expect(m.sampleAt(2.2361).position.x).toBeCloseTo(1, 2);
  });

  it("最大压缩 2.3146 s、x≈0.2012 m、速度为零、弹力≈80.50 N", () => {
    const e = ev(m, "max_compression");
    expect(e.timeSeconds).toBeCloseTo(2.3146, 3);
    const s = m.sampleAt(e.timeSeconds);
    expect(s.springCompressionM).toBeCloseTo(0.2012, 3);
    expect(Math.abs(s.velocity.x)).toBeLessThan(1e-6);
  });

  it("恢复原长脱离 2.3932 s，速度约 −4.0249 m/s", () => {
    const e = ev(m, "detach_spring");
    expect(e.timeSeconds).toBeCloseTo(2.3932, 3);
    expect(m.sampleAt(e.timeSeconds).velocity.x).toBeCloseTo(-4.0249, 3);
  });

  it("全程时长即脱离时刻", () => {
    expect(m.durationSeconds).toBeCloseTo(2.3932, 3);
  });
});

describe("变式", () => {
  it("k 改为 100 N/m：最大压缩约 0.4025 m，接触时刻不变", () => {
    const r: Reading = {
      ...SAMPLE_READING,
      conditions: { ...SAMPLE_READING.conditions, springConstantNpm: 100 },
    };
    const m = run(r);
    expect(ev(m, "max_compression").detail).toContain("0.4025");
    expect(ev(m, "contact_spring").timeSeconds).toBeCloseTo(2.2361, 3);
  });

  it("springGapM 改为 2：接触时刻约 2.4845 s，弹簧右移 1 m", () => {
    const r: Reading = {
      ...SAMPLE_READING,
      conditions: { ...SAMPLE_READING.conditions, springGapM: 2 },
    };
    const m = run(r);
    expect(ev(m, "contact_spring").timeSeconds).toBeCloseTo(2.4845, 3);
    expect(m.geometry.springContactX).toBe(2);
  });
});

describe("校验", () => {
  it("缺项返回 MISSING 并带字段名", () => {
    const r: Reading = {
      ...SAMPLE_READING,
      conditions: { ...SAMPLE_READING.conditions, springGapM: null },
    };
    const s = assembleScene(r);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.errors[0].field).toBe("springGapM");
  });

  it("μ ≥ tanθ 时提示前提冲突", () => {
    const r: Reading = {
      ...SAMPLE_READING,
      conditions: { ...SAMPLE_READING.conditions, kineticFrictionCoefficient: 2 },
    };
    const s = assembleScene(r);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.errors.some((e) => e.code === "PRECONDITION_CONFLICT")).toBe(true);
  });

  it("事实为 false 时返回超范围", () => {
    const r: Reading = {
      ...SAMPLE_READING,
      facts: { ...SAMPLE_READING.facts, horizontalIsFrictionless: false },
    };
    const s = assembleScene(r);
    expect(s.ok).toBe(false);
  });

  it("非 incline_spring 模板被拒绝", () => {
    const s = assembleScene({ ...SAMPLE_READING, templateId: "projectile" });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.errors[0].code).toBe("UNSUPPORTED_TEMPLATE");
  });
});

describe("真实物理库接入边界", () => {
  it("三段首尾相接，事件采用阶段后的状态", () => {
    const m = run(SAMPLE_READING);
    expect(m.segments.map((segment) => segment.kind)).toEqual(["incline", "horizontal", "spring"]);
    expect(m.segments[0].startSeconds).toBe(0);
    expect(m.segments[0].endSeconds).toBe(m.segments[1].startSeconds);
    expect(m.segments[1].endSeconds).toBe(m.segments[2].startSeconds);
    expect(m.segments[2].endSeconds).toBe(m.durationSeconds);
    expect(ev(m, "reach_bottom").segment).toBe("horizontal");
    expect(ev(m, "contact_spring").segment).toBe("spring");
    for (const segment of m.segments) {
      expect(segment.name && segment.summary && segment.formula).toBeTruthy();
      const sample = m.sampleAt((segment.startSeconds + segment.endSeconds) / 2);
      expect(Number.isFinite(sample.position.x)).toBe(true);
      if (segment.kind !== "incline") expect(sample.position.y).toBe(0);
    }
  });

  it("转向速度矢量保留速率，精确事件取样已经水平", () => {
    const m = run(SAMPLE_READING);
    const event = ev(m, "reach_bottom");
    expect(event.velocityBefore!.x).toBeGreaterThan(0);
    expect(event.velocityBefore!.y).toBeLessThan(0);
    expect(Math.hypot(event.velocityBefore!.x, event.velocityBefore!.y)).toBeCloseTo(event.velocityAfter!.x, 12);
    expect(m.sampleAt(event.timeSeconds).position).toEqual({ x: 0, y: 0 });
    expect(m.sampleAt(event.timeSeconds).velocity).toEqual(event.velocityAfter);
  });

  it("接触点、压缩位移和固定端在同一坐标系，水平段匀速", () => {
    const m = run(SAMPLE_READING);
    const turn = ev(m, "reach_bottom").timeSeconds;
    const contact = ev(m, "contact_spring").timeSeconds;
    const max = ev(m, "max_compression").timeSeconds;
    expect(m.sampleAt(contact).position).toEqual({ x: m.geometry.springContactX, y: 0 });
    expect(m.sampleAt(contact).springCompressionM).toBe(0);
    expect(m.sampleAt((turn + contact) / 2).velocity).toEqual(m.sampleAt(contact).velocity);
    const sample = m.sampleAt(max);
    expect(sample.position.y).toBe(0);
    expect(sample.position.x).toBeCloseTo(m.geometry.springContactX + sample.springCompressionM, 12);
    expect(m.geometry.springAnchorX).toBeGreaterThan(sample.position.x);
    expect(m.geometry.blockSizeM).toBe(0.3);
    expect(ev(m, "max_compression").detail).toContain("80.50 N");
  });

  it("末端、越界与 NaN 安全取样，脱离压缩量归零且向左", () => {
    const m = run(SAMPLE_READING);
    const end = m.sampleAt(m.durationSeconds);
    expect(end.position).toEqual({ x: m.geometry.springContactX, y: 0 });
    expect(end.springCompressionM).toBe(0);
    expect(end.velocity.x).toBeLessThan(0);
    expect(m.sampleAt(m.durationSeconds + 10)).toEqual(end);
    expect(m.sampleAt(Infinity)).toEqual(end);
    expect(m.sampleAt(-10)).toEqual(m.sampleAt(0));
    expect(m.sampleAt(NaN)).toEqual(m.sampleAt(0));
  });

  it("反复改值重算独立，旧运动保留原参数结果", () => {
    const original = run(SAMPLE_READING);
    const edited = run({ ...SAMPLE_READING, conditions: { ...SAMPLE_READING.conditions, springGapM: 2, springConstantNpm: 100 } });
    const restored = run(SAMPLE_READING);
    expect(ev(edited, "contact_spring").timeSeconds).toBeCloseTo(2.4845, 3);
    expect(edited.sampleAt(ev(edited, "max_compression").timeSeconds).springCompressionM).toBeCloseTo(0.4025, 3);
    expect(ev(original, "contact_spring").timeSeconds).toBe(ev(restored, "contact_spring").timeSeconds);
    expect(original.geometry.springContactX).toBe(1);
  });

  it("保留缺项、非法数值、范围及前提错误的原字段", () => {
    const cases = [
      [{ ...SAMPLE_READING, facts: { ...SAMPLE_READING.facts, losslessTurn: null } }, "losslessTurn", "MISSING"],
      [{ ...SAMPLE_READING, conditions: { ...SAMPLE_READING.conditions, blockMassKg: NaN } }, "blockMassKg", "NOT_FINITE"],
      [{ ...SAMPLE_READING, conditions: { ...SAMPLE_READING.conditions, springGapM: -1 } }, "springGapM", "RANGE"],
      [{ ...SAMPLE_READING, facts: { ...SAMPLE_READING.facts, springIsUnattached: false } }, "springIsUnattached", "PRECONDITION_CONFLICT"],
    ] as const;
    for (const [reading, field, code] of cases) {
      const result = assembleScene(reading);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toContainEqual(expect.objectContaining({ field, code }));
    }
  });
});

