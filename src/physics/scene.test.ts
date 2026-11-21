import assert from "node:assert/strict";
import test from "node:test";
import reading from "../../fixtures/incline-spring.reading.json" with { type: "json" };
import { assembleScene, validateReading } from "./index.ts";

test("标准样例通过校验并按实际倾角装配", () => {
  const validation = validateReading(reading);
  assert.ok(validation.ok);
  assert.deepEqual(validation.reading, reading);

  const assembled = assembleScene(reading);
  assert.ok(assembled.ok);
  const { geometry, incline } = assembled.scene;
  assert.deepEqual(geometry.incline.end, { xM: 0, yM: 0 });
  assert.ok(Math.abs(geometry.incline.start.xM - (-3.1945)) < 0.0001);
  assert.ok(Math.abs(geometry.incline.start.yM - 2.4073) < 0.0001);
  assert.ok(Math.abs(incline.accelerationMps2 - 2.0250) < 0.0001);
  assert.deepEqual(geometry.spring.contact, { xM: 1, yM: 0 });
});

test("空值和省略的字段均按原字段名提示补齐", () => {
  const missingGap = { ...reading, conditions: { ...reading.conditions, springGapM: null } };
  const withUnknownFact = { ...missingGap, facts: { ...reading.facts, losslessTurn: null } };
  const result = assembleScene(withUnknownFact);
  assert.ok(!result.ok);
  assert.equal(result.code, "NEEDS_INPUT");
  assert.deepEqual(result.fields, ["springGapM", "losslessTurn"]);

  const { springGapM, ...conditions } = reading.conditions;
  assert.equal(springGapM, 1);
  const omitted = validateReading({ ...reading, conditions });
  assert.ok(!omitted.ok);
  assert.equal(omitted.code, "NEEDS_INPUT");
  assert.deepEqual(omitted.fields, ["springGapM"]);
  assert.ok(assembleScene({ ...missingGap, conditions: { ...missingGap.conditions, springGapM: 1 } }).ok);
});

test("未登记模板、明确为假的前提和非零正初速超出范围", () => {
  const cases = [
    [{ ...reading, templateId: "projectile" }, "templateId"],
    [{ ...reading, facts: { ...reading.facts, losslessTurn: false } }, "losslessTurn"],
    [{ ...reading, conditions: { ...reading.conditions, initialSpeedMps: 1 } }, "initialSpeedMps"],
    [{
      ...reading,
      conditions: { ...reading.conditions, springGapM: null },
      facts: { ...reading.facts, springIsUnattached: false },
    }, "springIsUnattached"],
  ] as const;
  for (const [input, field] of cases) {
    const result = validateReading(input);
    assert.ok(!result.ok);
    assert.equal(result.code, "UNSUPPORTED");
    assert.deepEqual(result.fields, [field]);
  }
});

test("拒绝识别结构、类型或数值范围错误", () => {
  const cases = [
    [[], []],
    [{ ...reading, conditions: [] }, ["conditions"]],
    [{ ...reading, facts: { ...reading.facts, losslessTurn: "true" } }, ["losslessTurn"]],
    [{ ...reading, conditions: { ...reading.conditions, springGapM: "1" } }, ["springGapM"]],
    [{ ...reading, conditions: { ...reading.conditions, blockMassKg: Infinity } }, ["blockMassKg"]],
    [{ ...reading, conditions: { ...reading.conditions, inclineAngleDeg: 90 } }, ["inclineAngleDeg"]],
    [{ ...reading, conditions: { ...reading.conditions, kineticFrictionCoefficient: -0.1 } }, ["kineticFrictionCoefficient"]],
  ] as const;
  for (const [input, fields] of cases) {
    const result = assembleScene(input);
    assert.ok(!result.ok);
    assert.equal(result.code, "INVALID_READING");
    assert.ok("fields" in result);
    assert.deepEqual(result.fields, fields);
  }
});

test("装配接受零动摩擦，并报告非正下坡加速度", () => {
  const conditions = { ...reading.conditions, kineticFrictionCoefficient: 0 };
  assert.ok(assembleScene({ ...reading, conditions }).ok);

  for (const [inclineAngleDeg, kineticFrictionCoefficient] of [[37, 0.9], [45, 1]]) {
    const input = { ...reading, conditions: { ...conditions, inclineAngleDeg, kineticFrictionCoefficient } };
    assert.ok(validateReading(input).ok);
    const result = assembleScene(input);
    assert.ok(!result.ok);
    assert.equal(result.code, "INCONSISTENT_CONDITIONS");
    assert.deepEqual(result.fields, ["inclineAngleDeg", "kineticFrictionCoefficient"]);
  }
});

test("补值后重新装配，水平间距只移动弹簧接触点", () => {
  const original = assembleScene(reading);
  const edited = assembleScene({ ...reading, conditions: { ...reading.conditions, springGapM: 2 } });
  assert.ok(original.ok && edited.ok);
  assert.deepEqual(edited.scene.geometry.incline, original.scene.geometry.incline);
  assert.equal(edited.scene.geometry.spring.contact.xM - original.scene.geometry.spring.contact.xM, 1);
});
