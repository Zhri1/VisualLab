import assert from "node:assert/strict";
import test from "node:test";
import horizontal from "../../fixtures/horizontal-spring.reading.json" with { type: "json" };
import incline from "../../fixtures/incline-to-stop.reading.json" with { type: "json" };
import table from "../../fixtures/table-edge-projectile.reading.json" with { type: "json" };
import projectile from "../../fixtures/projectile-motion.reading.json" with { type: "json" };
import original from "../../fixtures/incline-spring.reading.json" with { type: "json" };
import { assembleScene, buildMotion, validateReading } from "./index.ts";
import type { BatchReading } from "./index.ts";

function run(input: unknown) {
  const assembled = assembleScene(input);
  assert.ok(assembled.ok, JSON.stringify(assembled));
  const built = buildMotion(assembled.scene);
  assert.ok(built.ok, JSON.stringify(built));
  return built.motion;
}

function findEvent(motion: ReturnType<typeof run>, id: string) {
  const result = motion.events.find((item) => item.id === id);
  assert.ok(result, `缺少事件 ${id}`);
  return result;
}

function close(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected} ± ${tolerance}`);
}

function edit<T extends { conditions: object }>(reading: T, conditions: object) {
  return { ...reading, conditions: { ...reading.conditions, ...conditions } };
}

test("四份登记样例可校验、装配并按 templateId 提供几何", () => {
  const readings = [horizontal, incline, table, projectile] as BatchReading[];
  for (const reading of readings) {
    const validation = validateReading(reading);
    assert.ok(validation.ok);
    assert.deepEqual(validation.reading, reading);
    const assembled = assembleScene(reading);
    assert.ok(assembled.ok);
    assert.equal(assembled.scene.templateId, reading.templateId);
    assert.equal(assembled.scene.geometry.templateId, reading.templateId);
    assert.equal(run(reading).geometry.templateId, reading.templateId);
  }
});

test("水平弹簧手算时间、压缩量、能量和脱离速度", () => {
  const motion = run(horizontal);
  const contact = findEvent(motion, "spring_contact").timeSeconds;
  const max = findEvent(motion, "max_compression").timeSeconds;
  close(contact, 0.5);
  close(max, 0.6570796326794897);
  close(motion.durationSeconds, 0.8141592653589793);
  assert.deepEqual(motion.sampleAt(contact), { xM: 1, yM: 0, vxMps: 2, vyMps: 0, springCompressionM: 0 });
  close(motion.sampleAt(max).springCompressionM, 0.2);
  assert.equal(motion.sampleAt(max).vxMps, 0);
  const midpoint = motion.sampleAt((contact + max) / 2);
  close(0.5 * midpoint.vxMps ** 2 + 50 * midpoint.springCompressionM ** 2, 2);
  assert.deepEqual(motion.sampleAt(motion.durationSeconds), { xM: 1, yM: 0, vxMps: -2, vyMps: 0, springCompressionM: 0 });
  assert.equal(motion.geometry.templateId, "horizontal_spring");
  if (motion.geometry.templateId === "horizontal_spring") assert.ok(motion.geometry.spring.anchor.xM > 1.2);
});

test("水平弹簧改质量和劲度后使用同一运动公式重算", () => {
  const motion = run(edit(horizontal, { blockMassKg: 4, springConstantNpm: 100 }));
  close(motion.sampleAt(findEvent(motion, "max_compression").timeSeconds).springCompressionM, 0.4);
  close(findEvent(motion, "spring_contact").timeSeconds, 0.5);
});

test("斜面接水平停止使用两种独立摩擦，符合手算基准", () => {
  const motion = run(incline);
  const turn = findEvent(motion, "turn");
  close(turn.timeSeconds, 1.2649110640673518);
  const atTurn = motion.sampleAt(turn.timeSeconds);
  close(atTurn.vxMps, 6.324555320336759);
  assert.equal(atTurn.xM, 0);
  assert.equal(atTurn.yM, 0);
  assert.equal(atTurn.vyMps, 0);
  close(motion.durationSeconds, 3.794733192202055);
  const stopped = motion.sampleAt(motion.durationSeconds);
  close(stopped.xM, 8);
  assert.equal(stopped.yM, 0);
  assert.equal(stopped.vxMps, 0);
  assert.equal(stopped.vyMps, 0);
  assert.equal(stopped.springCompressionM, 0);
  assert.equal(turn.id, "turn");
  if (turn.id === "turn") {
    assert.ok(turn.beforeVelocity && turn.afterVelocity);
    close(Math.hypot(turn.beforeVelocity.vxMps, turn.beforeVelocity.vyMps), turn.afterVelocity.vxMps);
  }
  const moreFriction = run(edit(incline, { horizontalKineticFrictionCoefficient: 0.5 }));
  close(findEvent(moreFriction, "turn").timeSeconds, turn.timeSeconds);
  close(moreFriction.sampleAt(moreFriction.durationSeconds).xM, 4);
});

test("桌面5 m路径在1 s离桌，再飞0.5 s，距桌沿2 m落地", () => {
  const motion = run(table);
  const edgeTime = findEvent(motion, "table_edge").timeSeconds;
  close(edgeTime, 1);
  assert.deepEqual(motion.sampleAt(edgeTime), { xM: 5, yM: 1.25, vxMps: 4, vyMps: 0, springCompressionM: 0 });
  close(motion.durationSeconds, 1.5);
  const landed = motion.sampleAt(motion.durationSeconds);
  close(landed.xM, 7);
  close(landed.vyMps, -5);
  assert.equal(landed.yM, 0);
  assert.equal(landed.vxMps, 4);
  assert.equal(landed.springCompressionM, 0);
  assert.deepEqual(motion.segments.map((segment) => segment.id), ["table", "projectile"]);
});

for (const distance of [9, 10]) {
  test(`桌沿距离${distance} m时以停止结束，边沿零速不进入平抛`, () => {
    const motion = run(edit(table, { distanceToEdgeM: distance }));
    assert.deepEqual(motion.events.map((event) => event.id), ["release", "stop"]);
    assert.deepEqual(motion.segments.map((segment) => segment.id), ["table"]);
    close(motion.durationSeconds, 3);
    assert.deepEqual(motion.sampleAt(3), { xM: 9, yM: 1.25, vxMps: 0, vyMps: 0, springCompressionM: 0 });
  });
}

test("桌面临界距离两侧及浮点相等容差按相应路径结束", () => {
  assert.ok(run(edit(table, { distanceToEdgeM: 8.99 })).events.some((event) => event.id === "land"));
  assert.ok(run(edit(table, { distanceToEdgeM: 9.01 })).events.some((event) => event.id === "stop"));
  assert.deepEqual(run(edit(table, { distanceToEdgeM: 9 - Number.EPSILON * 9 })).events.map((event) => event.id), ["release", "stop"]);
});

test("零桌面摩擦保持水平速率并离桌", () => {
  const motion = run(edit(table, { kineticFrictionCoefficient: 0 }));
  close(findEvent(motion, "table_edge").timeSeconds, 5 / 6);
  close(motion.sampleAt(findEvent(motion, "table_edge").timeSeconds).vxMps, 6);
  close(motion.durationSeconds, 5 / 6 + 0.5);
  close(motion.sampleAt(motion.durationSeconds).xM, 8);
});

const projectileCases = [
  { label: "自由落体", h: 5, vx: 0, vy: 0, duration: 1, x: 0, apex: false },
  { label: "平抛", h: 1.25, vx: 4, vy: 0, duration: 0.5, x: 2, apex: false },
  { label: "竖直上抛", h: 0, vx: 0, vy: 10, duration: 2, x: 0, apex: true },
  { label: "斜抛", h: 0, vx: 4, vy: 10, duration: 2, x: 8, apex: true },
];
for (const c of projectileCases) {
  test(`${c.label}复用重力飞行并符合独立手算`, () => {
    const motion = run(edit(projectile, { initialHeightM: c.h, initialVxMps: c.vx, initialVyMps: c.vy }));
    close(motion.durationSeconds, c.duration);
    const landed = motion.sampleAt(c.duration);
    close(landed.xM, c.x);
    assert.equal(landed.yM, 0);
    close(landed.vyMps, c.vy - 10 * c.duration);
    assert.equal(motion.events.some((event) => event.id === "apex"), c.apex);
    if (c.apex) {
      const apex = findEvent(motion, "apex");
      close(apex.timeSeconds, 1);
      assert.equal(motion.sampleAt(apex.timeSeconds).vyMps, 0);
      close(motion.sampleAt(apex.timeSeconds).yM, 5);
    }
  });
}

test("负水平速度和向下初速可从高处飞行，无内部最高点", () => {
  const motion = run(edit(projectile, { initialHeightM: 5, initialVxMps: -4, initialVyMps: -10 }));
  close(motion.durationSeconds, Math.SQRT2 - 1);
  close(motion.sampleAt(motion.durationSeconds).xM, -4 * (Math.SQRT2 - 1));
  assert.deepEqual(motion.events.map((event) => event.id), ["release", "land"]);
});

for (const vy of [0, -3]) {
  test(`地面起始vy=${vy}时立即终止，保留接地瞬间速度`, () => {
    const motion = run(edit(projectile, { initialHeightM: 0, initialVxMps: 0, initialVyMps: vy }));
    assert.equal(motion.durationSeconds, 0);
    assert.deepEqual(motion.segments, []);
    assert.deepEqual(motion.events.map((event) => [event.id, event.timeSeconds]), [["release", 0], ["land", 0]]);
    assert.deepEqual(motion.sampleAt(100), { xM: 0, yM: 0, vxMps: 0, vyMps: vy, springCompressionM: 0 });
  });
}

test("所有运动阶段连续、内部插值有效且事件后状态与越界钳制一致", () => {
  for (const reading of [horizontal, incline, table, projectile, original]) {
    const motion = run(reading);
    assert.deepEqual(motion.sampleAt(-1), motion.sampleAt(0));
    assert.deepEqual(motion.sampleAt(NaN), motion.sampleAt(0));
    assert.deepEqual(motion.sampleAt(Infinity), motion.sampleAt(motion.durationSeconds));
    assert.deepEqual(motion.sampleAt(-Infinity), motion.sampleAt(0));
    assert.deepEqual(motion.sampleAt(motion.durationSeconds + 1), motion.sampleAt(motion.durationSeconds));
    for (let i = 0; i < motion.segments.length; i++) {
      const segment = motion.segments[i];
      if (i > 0) assert.equal(segment.startSeconds, motion.segments[i - 1].endSeconds);
      const middle = motion.sampleAt((segment.startSeconds + segment.endSeconds) / 2);
      assert.ok(Object.values(middle).every(Number.isFinite));
      if (i === motion.segments.length - 1) assert.equal(segment.endSeconds, motion.durationSeconds);
    }
    for (const e of motion.events.filter((item) => item.timeSeconds > 0 && item.timeSeconds < motion.durationSeconds)) {
      const before = motion.sampleAt(e.timeSeconds - 1e-7);
      const at = motion.sampleAt(e.timeSeconds);
      const after = motion.sampleAt(e.timeSeconds + 1e-7);
      close(before.xM, at.xM, 2e-6);
      close(before.yM, at.yM, 2e-6);
      close(after.xM, at.xM, 2e-6);
      close(after.yM, at.yM, 2e-6);
    }
  }
});

test("新模板每个必填数值均支持缺项补齐，拒绝错误类型及非有限数", () => {
  for (const reading of [horizontal, incline, table, projectile]) {
    for (const key of Object.keys(reading.conditions)) {
      for (const value of [null, undefined]) {
        const result = validateReading(edit(reading, { [key]: value }));
        assert.ok(!result.ok);
        assert.equal(result.code, "NEEDS_INPUT");
        assert.deepEqual(result.fields, [key]);
      }
      for (const value of ["1", Infinity, NaN]) {
        const result = validateReading(edit(reading, { [key]: value }));
        assert.ok(!result.ok);
        assert.equal(result.code, "INVALID_READING");
        assert.deepEqual(result.fields, [key]);
      }
    }
  }
});

test("事实未确认可补齐，明确违反前提超范围，原字段保持", () => {
  for (const reading of [horizontal, incline, table, projectile]) {
    for (const key of Object.keys(reading.facts)) {
      for (const value of [null, false, "true"]) {
        const result = validateReading({ ...reading, facts: { ...reading.facts, [key]: value } });
        assert.ok(!result.ok);
        assert.equal(result.code, value === null ? "NEEDS_INPUT" : value === false ? "UNSUPPORTED" : "INVALID_READING");
        assert.deepEqual(result.fields, [key]);
      }
    }
  }
});

test("范围、停止适用前提和从静止下滑冲突有字段错误", () => {
  const cases = [
    [edit(horizontal, { initialSpeedMps: 0 }), "INVALID_READING", "initialSpeedMps"],
    [edit(incline, { horizontalKineticFrictionCoefficient: 0 }), "UNSUPPORTED", "horizontalKineticFrictionCoefficient"],
    [edit(incline, { initialSpeedMps: 1 }), "UNSUPPORTED", "initialSpeedMps"],
    [edit(incline, { kineticFrictionCoefficient: 1 }), "INCONSISTENT_CONDITIONS", "kineticFrictionCoefficient"],
    [edit(projectile, { initialHeightM: -1 }), "INVALID_READING", "initialHeightM"],
    [edit(table, { tableHeightM: 0 }), "INVALID_READING", "tableHeightM"],
    [edit(table, { distanceToEdgeM: 0 }), "INVALID_READING", "distanceToEdgeM"],
    [{ ...horizontal, conditions: [] }, "INVALID_READING", "conditions"],
    [{ ...projectile, facts: 1 }, "INVALID_READING", "facts"],
    [{ ...projectile, templateId: "unregistered" }, "UNSUPPORTED", "templateId"],
  ] as const;
  for (const [input, code, field] of cases) {
    const result = assembleScene(input);
    assert.ok(!result.ok);
    assert.equal(result.code, code);
    assert.ok(result.fields.includes(field));
  }
});

test("无法表示的时间边界返回字段错误", () => {
  const result = assembleScene(edit(horizontal, { springConstantNpm: Number.MAX_VALUE }));
  assert.ok(!result.ok);
  assert.equal(result.code, "INVALID_READING");
  assert.ok(result.fields.includes("springConstantNpm"));
});
