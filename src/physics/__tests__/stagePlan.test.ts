import { describe, expect, it } from "vitest";
import complete from "../../../fixtures/stage-composition.reading.json";
import missingDistance from "../../../fixtures/stage-missing-distance.reading.json";
import { validateReading, validateStagePlan } from "../index";
import legacy from "../../../fixtures/incline-spring.reading.json";

const horizontal = (end: unknown = { kind: "distance", distanceM: 1 }) => ({
  kind: "stage_plan", schemaVersion: 1, initial: { speedMps: 2 },
  stages: [{ kind: "horizontal_slide", kineticFrictionCoefficient: 0, end }],
});
const spring = () => ({
  kind: "stage_plan", schemaVersion: 1, massKg: 1, initial: { speedMps: 2 },
  stages: [{ kind: "spring_contact", springConstantNpm: 100, frictionless: true, unattached: true }],
});

describe("共享阶段计划校验", () => {
  it("C的完整fixture成功，未用质量可以为null", () => {
    const result = validateStagePlan(complete);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.reading.stages).toEqual(complete.stages);
    expect(result.reading.massKg).toBeUndefined();
    expect(result.reading.gravityMps2).toBe(10);
    expect(validateReading(legacy).ok).toBe(true);
  });

  it("缺距离fixture返回部分计划与零基JSON Pointer", () => {
    const result = validateStagePlan(missingDistance);
    expect(result).toMatchObject({
      ok: false, code: "NEEDS_INPUT", missingKeys: ["/stages/2/end/distanceM"], fieldErrors: [],
    });
    if (result.ok) throw new Error("应提示补值");
    expect(result.reading?.stages[2]).toEqual(missingDistance.stages[2]);
    expect(missingDistance.stages[2].end?.distanceM).toBeNull();
  });

  it("整块end缺失与缺距离分开定位", () => {
    const result = validateStagePlan(horizontal(null));
    expect(result).toMatchObject({ ok: false, code: "NEEDS_INPUT", missingKeys: ["/stages/0/end"] });
    if (result.ok) throw new Error("应提示补值");
    expect(result.reading?.stages[0].end).toBeNull();
  });

  it("非法距离只进fieldErrors，不混入missingKeys", () => {
    const input = structuredClone(missingDistance);
    input.stages[2].end!.distanceM = -1 as never;
    const result = validateStagePlan(input);
    expect(result).toMatchObject({
      ok: false, code: "INCONSISTENT_CONDITIONS", missingKeys: [],
      fieldErrors: [{ path: "/stages/2/end/distanceM", code: "RANGE" }],
    });
  });

  it("非有限数在draft转null且独立带错误原因", () => {
    const result = validateStagePlan(horizontal({ kind: "distance", distanceM: Infinity }));
    expect(result).toMatchObject({
      ok: false, code: "INCONSISTENT_CONDITIONS", missingKeys: [],
      fieldErrors: [{ path: "/stages/0/end/distanceM", code: "NOT_FINITE" }],
    });
    if (result.ok) throw new Error("应拒绝非有限数");
    expect(result.reading?.stages[0].end).toEqual({ kind: "distance", distanceM: null });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("缺项与可修正错误同时保留且不互相覆盖", () => {
    const input = structuredClone(complete);
    input.gravityMps2 = null as never;
    input.stages[2].end!.distanceM = -2;
    expect(validateStagePlan(input)).toMatchObject({
      ok: false, code: "INCONSISTENT_CONDITIONS", missingKeys: ["/gravityMps2"],
      fieldErrors: [{ path: "/stages/2/end/distanceM", code: "RANGE" }],
    });
  });

  it("上游结构或字段类型损坏返回INVALID_READING", () => {
    for (const input of [null, [], { ...complete, stages: "broken" }, { ...complete, stages: [1] }, horizontal("broken"), horizontal({ kind: "distance", distanceM: "1" })]) {
      expect(validateStagePlan(input)).toMatchObject({ ok: false, code: "INVALID_READING", reading: null });
    }
  });

  it("结构未确认时保留null reading并提示补齐", () => {
    expect(validateStagePlan({ kind: "stage_plan", schemaVersion: 1, stages: [] })).toMatchObject({ ok: false, code: "NEEDS_INPUT", reading: null, missingKeys: ["/stages"] });
    expect(validateStagePlan({ ...complete, stages: [{ kind: null }] })).toMatchObject({ ok: false, code: "NEEDS_INPUT", reading: null, missingKeys: ["/stages/0/kind"] });
  });

  it.each([{}, true, "1", []])("非数字版本 %j 属于上游类型损坏", (schemaVersion) => {
    expect(validateStagePlan({ ...complete, schemaVersion })).toMatchObject({
      ok: false, code: "INVALID_READING", reading: null,
      fieldErrors: [{ path: "/schemaVersion", code: "TYPE" }],
    });
  });

  it.each([true, {}, 1, []])("非字符串结束类型 %j 属于上游类型损坏", (kind) => {
    const input = structuredClone(complete);
    input.stages[2].end!.kind = kind as never;
    expect(validateStagePlan(input)).toMatchObject({
      ok: false, code: "INVALID_READING", reading: null,
      fieldErrors: [{ path: "/stages/2/end/kind", code: "TYPE" }],
    });
  });

  it.each([null, undefined])("版本和结束类型缺值 %j 仍提示补齐", (value) => {
    const input = structuredClone(complete);
    input.schemaVersion = value as never;
    expect(validateStagePlan(input)).toMatchObject({
      ok: false, code: "NEEDS_INPUT", fieldErrors: [],
      missingKeys: ["/schemaVersion"],
    });
    input.schemaVersion = 1;
    input.stages[2].end!.kind = value as never;
    expect(validateStagePlan(input)).toMatchObject({
      ok: false, code: "NEEDS_INPUT", fieldErrors: [],
      missingKeys: ["/stages/2/end/kind"],
    });
  });

  it("未登记的字符串结束类型仍属超范围", () => {
    const input = structuredClone(complete);
    input.stages[2].end!.kind = "unknown";
    expect(validateStagePlan(input)).toMatchObject({
      ok: false, code: "UNSUPPORTED",
      fieldErrors: [{ path: "/stages/2/end/kind", code: "UNSUPPORTED" }],
    });
  });

  it("局部stage.kind未知时继续透传已知阶段、参数及结束条件", () => {
    const input = structuredClone(complete);
    delete (input.stages[2] as Record<string, unknown>).kind;
    const result = validateStagePlan(input);
    expect(result).toMatchObject({
      ok: false, code: "NEEDS_INPUT", missingKeys: ["/stages/2/kind"], fieldErrors: [],
    });
    if (result.ok) throw new Error("应提示补齐kind");
    expect(result.reading?.stages[0]).toEqual(complete.stages[0]);
    expect(result.reading?.stages[1]).toEqual(complete.stages[1]);
    expect(result.reading?.stages[2]).toEqual({ ...complete.stages[2], kind: null });
    expect(result.reading?.stages[3]).toEqual(complete.stages[3]);
    expect(result.reading?.initial).toEqual(complete.initial);
    expect(result.reading?.gravityMps2).toBe(10);
    expect(input.stages[2]).not.toHaveProperty("kind");
  });

  it("标量和分量互斥，错误定位初态整块", () => {
    const result = validateStagePlan({ ...complete, initial: { speedMps: 0, vxMps: 0, vyMps: 0 } });
    expect(result).toMatchObject({
      ok: false, code: "INCONSISTENT_CONDITIONS", fieldErrors: [{ path: "/initial", code: "PRECONDITION_CONFLICT" }],
    });
    if (!result.ok) expect(result.reading?.initial).toEqual({ speedMps: 0, vxMps: 0, vyMps: 0 });
  });

  it("局部kind未知不吞掉其他阶段缺项与非有限错误", () => {
    const input = structuredClone(complete);
    delete (input.stages[1] as Record<string, unknown>).kind;
    delete (input.stages[2].end as Record<string, unknown>).distanceM;
    input.stages[3].dropHeightM = Infinity;
    const result = validateStagePlan(input);
    expect(result).toMatchObject({
      ok: false, code: "INCONSISTENT_CONDITIONS",
      missingKeys: ["/stages/1/kind", "/stages/2/end/distanceM"],
      fieldErrors: [{ path: "/stages/3/dropHeightM", code: "NOT_FINITE" }],
    });
    if (result.ok) throw new Error("应提示修正");
    expect(result.reading?.stages[0]).toEqual(complete.stages[0]);
    expect(result.reading?.stages[1].kind).toBeNull();
    expect(result.reading?.stages[2].end).toEqual({ kind: "distance", distanceM: null });
    expect(result.reading?.stages[3].dropHeightM).toBeNull();
  });

  it("独立抛体需要分量并允许符号", () => {
    const input = { kind: "stage_plan", schemaVersion: 1, gravityMps2: 10, initial: { vxMps: -2, vyMps: -3 }, stages: [{ kind: "projectile", dropHeightM: 0 }] };
    expect(validateStagePlan(input).ok).toBe(true);
    expect(validateStagePlan({ ...input, initial: { speedMps: 1 } })).toMatchObject({ ok: false, code: "INCONSISTENT_CONDITIONS" });
    expect(validateStagePlan({ ...input, initial: { vxMps: 1 } })).toMatchObject({ ok: false, code: "NEEDS_INPUT", missingKeys: ["/initial/vyMps"] });
  });

  it("重力和质量按实际阶段所需检查", () => {
    expect(validateStagePlan(horizontal()).ok).toBe(true);
    expect(validateStagePlan(spring()).ok).toBe(true);
    expect(validateStagePlan({ ...spring(), massKg: null })).toMatchObject({ ok: false, missingKeys: ["/massKg"] });
    const input = horizontal();
    input.stages[0].kineticFrictionCoefficient = 0.2;
    expect(validateStagePlan(input)).toMatchObject({ ok: false, missingKeys: ["/gravityMps2"] });
    const prefix = { ...complete, stages: complete.stages.slice(0, 1) };
    expect(validateStagePlan(prefix).ok).toBe(true);
  });

  it("事实未知提示核对，明确违反前提返回超范围", () => {
    const input = spring();
    expect(validateStagePlan({ ...input, stages: [{ ...input.stages[0], frictionless: null }] })).toMatchObject({ ok: false, code: "NEEDS_INPUT", missingKeys: ["/stages/0/frictionless"] });
    expect(validateStagePlan({ ...input, stages: [{ ...input.stages[0], unattached: false }] })).toMatchObject({ ok: false, code: "UNSUPPORTED" });
    const rest = { ...complete, stages: [{ ...complete.stages[0], slidesAfterRelease: null }] };
    expect(validateStagePlan(rest)).toMatchObject({ ok: false, missingKeys: ["/stages/0/slidesAfterRelease"] });
  });

  it("静止下滑与非正加速度冲突可修正", () => {
    const stages = [{ ...complete.stages[0], kineticFrictionCoefficient: 1 }];
    expect(validateStagePlan({ ...complete, stages })).toMatchObject({
      ok: false, code: "INCONSISTENT_CONDITIONS",
      fieldErrors: [{ path: "/stages/0/kineticFrictionCoefficient", code: "PRECONDITION_CONFLICT" }],
    });
  });

  it("弹簧首段需正速，光滑正速无法以摩擦停止", () => {
    expect(validateStagePlan({ ...spring(), initial: { speedMps: 0 } })).toMatchObject({ ok: false, code: "INCONSISTENT_CONDITIONS" });
    expect(validateStagePlan(horizontal({ kind: "stop" }))).toMatchObject({ ok: false, code: "INCONSISTENT_CONDITIONS", fieldErrors: [{ path: "/stages/0/end" }] });
    expect(validateStagePlan({ ...horizontal({ kind: "stop" }), initial: { speedMps: 0 } }).ok).toBe(true);
  });

  it("不支持的模块、版本与连接明确超范围", () => {
    for (const input of [
      { ...complete, schemaVersion: 2 },
      { ...complete, stages: [{ kind: "collision" }] },
      { ...complete, stages: [complete.stages[0], complete.stages[2]] },
      { ...complete, stages: [complete.stages[1]] },
      { ...complete, stages: [...complete.stages, complete.stages[2]] },
    ]) expect(validateStagePlan(input)).toMatchObject({ ok: false, code: "UNSUPPORTED" });
  });
});
