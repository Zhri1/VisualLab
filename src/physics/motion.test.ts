import assert from "node:assert/strict";
import test from "node:test";
import reading from "../../fixtures/incline-spring.reading.json" with { type: "json" };
import { assembleScene, buildMotion } from "./index.ts";
import type { MotionEvent, Reading } from "./index.ts";

function makeMotion(overrides: Partial<Reading["conditions"]> = {}) {
  const assembled = assembleScene({ ...reading, conditions: { ...reading.conditions, ...overrides } });
  assert.ok(assembled.ok);
  const result = buildMotion(assembled.scene);
  assert.ok(result.ok);
  return result.motion;
}

function eventFor(events: MotionEvent[], id: MotionEvent["id"]) {
  const event = events.find((item) => item.id === id);
  assert.ok(event, `缺少事件 ${id}`);
  return event;
}

function closeTo(actual: number, expected: number, tolerance = 0.0001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `实际值 ${actual}，预期值 ${expected} ± ${tolerance}`);
}

test("标准题返回三段连续时间和五个关键事件", () => {
  const motion = makeMotion();
  const eventTimes = [
    ["release", 0],
    ["turn", 1.9876],
    ["spring_contact", 2.2361],
    ["max_compression", 2.3146],
    ["spring_detach", 2.3932],
  ] as const;
  assert.deepEqual(motion.events.map((event) => event.id), eventTimes.map(([id]) => id));
  for (const [id, seconds] of eventTimes) {
    closeTo(eventFor(motion.events, id).timeSeconds, seconds);
  }

  const turn = eventFor(motion.events, "turn");
  const contact = eventFor(motion.events, "spring_contact");
  const detach = eventFor(motion.events, "spring_detach");
  assert.equal(motion.durationSeconds, detach.timeSeconds);
  assert.deepEqual(motion.segments, [
    { id: "incline", startSeconds: 0, endSeconds: turn.timeSeconds },
    { id: "horizontal", startSeconds: turn.timeSeconds, endSeconds: contact.timeSeconds },
    { id: "spring", startSeconds: contact.timeSeconds, endSeconds: detach.timeSeconds },
  ]);
  const midway = motion.sampleAt(turn.timeSeconds / 2);
  closeTo(midway.xM, 0.75 * motion.geometry.incline.start.xM, 1e-12);
  closeTo(midway.yM, 0.75 * motion.geometry.incline.start.yM, 1e-12);
  const horizontalMidway = motion.sampleAt((turn.timeSeconds + contact.timeSeconds) / 2);
  closeTo(horizontalMidway.xM, 0.5, 1e-12);
  closeTo(horizontalMidway.vxMps, 4.0249);
  assert.equal(horizontalMidway.yM, 0);
  assert.equal(horizontalMidway.springCompressionM, 0);
});

test("转向在坡底保持位置与速率，事件取样使用水平方向", () => {
  const motion = makeMotion();
  const turn = eventFor(motion.events, "turn");
  assert.ok(turn.id === "turn");
  const { beforeVelocity, afterVelocity, timeSeconds } = turn;
  const angleRad = 37 * Math.PI / 180;
  closeTo(beforeVelocity.vxMps, 4.0249 * Math.cos(angleRad));
  closeTo(beforeVelocity.vyMps, -4.0249 * Math.sin(angleRad));
  closeTo(Math.hypot(beforeVelocity.vxMps, beforeVelocity.vyMps), afterVelocity.vxMps, 1e-12);
  assert.equal(afterVelocity.vyMps, 0);

  const justBefore = motion.sampleAt(timeSeconds - 1e-7);
  const atTurn = motion.sampleAt(timeSeconds);
  const justAfter = motion.sampleAt(timeSeconds + 1e-7);
  closeTo(justBefore.vxMps, beforeVelocity.vxMps, 1e-6);
  closeTo(justBefore.vyMps, beforeVelocity.vyMps, 1e-6);
  assert.deepEqual(atTurn, { ...motion.geometry.incline.end, ...afterVelocity, springCompressionM: 0 });
  for (const sample of [justBefore, justAfter]) {
    closeTo(sample.xM, atTurn.xM, 1e-6);
    closeTo(sample.yM, atTurn.yM, 1e-6);
  }
});

test("接触边界保持位置与速度，随后开始压缩", () => {
  const motion = makeMotion();
  const contact = eventFor(motion.events, "spring_contact");
  const justBefore = motion.sampleAt(contact.timeSeconds - 1e-7);
  const atContact = motion.sampleAt(contact.timeSeconds);
  const justAfter = motion.sampleAt(contact.timeSeconds + 1e-7);
  assert.deepEqual({ xM: atContact.xM, yM: atContact.yM }, motion.geometry.spring.contact);
  assert.equal(atContact.springCompressionM, 0);
  assert.equal(justBefore.springCompressionM, 0);
  assert.ok(justAfter.springCompressionM > 0);
  closeTo(justBefore.xM, atContact.xM, 1e-6);
  closeTo(justAfter.xM, atContact.xM, 1e-6);
  closeTo(justBefore.vxMps, atContact.vxMps, 1e-6);
  closeTo(justAfter.vxMps, atContact.vxMps, 1e-6);
});

test("最大压缩速度恰为零，反弹后以向左速度脱离", () => {
  const motion = makeMotion();
  const maxCompression = eventFor(motion.events, "max_compression");
  const detach = eventFor(motion.events, "spring_detach");
  const maxSample = motion.sampleAt(maxCompression.timeSeconds);
  closeTo(maxSample.springCompressionM, 0.2012);
  closeTo(maxSample.xM, 1 + maxSample.springCompressionM, 1e-12);
  assert.equal(maxSample.vxMps, 0);
  assert.equal(maxSample.vyMps, 0);
  assert.ok(motion.geometry.spring.anchor.xM > maxSample.xM);
  assert.match(maxCompression.explanation, /80\.50 N.*指向左/);

  const compressing = motion.sampleAt(maxCompression.timeSeconds - 0.01);
  const rebounding = motion.sampleAt(maxCompression.timeSeconds + 0.01);
  assert.ok(compressing.vxMps > 0 && rebounding.vxMps < 0);
  assert.ok(rebounding.springCompressionM > 0 && rebounding.springCompressionM < maxSample.springCompressionM);
  closeTo(rebounding.springCompressionM, compressing.springCompressionM, 1e-12);

  const atDetach = motion.sampleAt(detach.timeSeconds);
  const justBefore = motion.sampleAt(detach.timeSeconds - 1e-7);
  assert.equal(atDetach.springCompressionM, 0);
  assert.equal(atDetach.xM, motion.geometry.spring.contact.xM);
  assert.equal(atDetach.vyMps, 0);
  closeTo(atDetach.vxMps, -4.0249);
  closeTo(justBefore.xM, atDetach.xM, 1e-6);
  closeTo(justBefore.vxMps, atDetach.vxMps, 1e-6);
});

test("超出时间轴的有限时间在释放或脱离状态取样", () => {
  const motion = makeMotion();
  const initial = motion.sampleAt(0);
  assert.deepEqual(initial, { ...motion.geometry.incline.start, vxMps: 0, vyMps: 0, springCompressionM: 0 });
  assert.deepEqual(motion.sampleAt(-1), initial);
  assert.deepEqual(motion.sampleAt(Number.MAX_VALUE), motion.sampleAt(motion.durationSeconds));
});

test("修改间距后，弹簧右移且接触推迟，最大压缩量保持", () => {
  const original = makeMotion();
  const edited = makeMotion({ springGapM: 2 });
  assert.equal(edited.geometry.spring.contact.xM - original.geometry.spring.contact.xM, 1);
  closeTo(edited.geometry.spring.anchor.xM - original.geometry.spring.anchor.xM, 1, 1e-12);
  const contact = eventFor(edited.events, "spring_contact");
  closeTo(contact.timeSeconds, 2.4845);
  assert.equal(edited.sampleAt(contact.timeSeconds).xM, 2);
  assert.match(contact.explanation, /2 m/);
  const originalMax = original.sampleAt(eventFor(original.events, "max_compression").timeSeconds);
  const editedMax = edited.sampleAt(eventFor(edited.events, "max_compression").timeSeconds);
  closeTo(editedMax.springCompressionM, originalMax.springCompressionM, 1e-12);
});

test("修改劲度系数后，接触时刻保持，最大压缩量和字幕重算", () => {
  const original = makeMotion();
  const edited = makeMotion({ springConstantNpm: 100 });
  const contact = eventFor(edited.events, "spring_contact");
  assert.equal(contact.timeSeconds, eventFor(original.events, "spring_contact").timeSeconds);
  const editedMax = eventFor(edited.events, "max_compression");
  closeTo(edited.sampleAt(editedMax.timeSeconds).springCompressionM, 0.4025);
  assert.match(editedMax.explanation, /0\.4025 m.*40\.25 N/);
  assert.ok(edited.durationSeconds > original.durationSeconds);
});

test("时间轴无法区分弹簧关键点时返回可展示的字段错误", () => {
  const assembled = assembleScene({
    ...reading,
    conditions: { ...reading.conditions, springConstantNpm: Number.MAX_VALUE },
  });
  assert.ok(assembled.ok);
  const result = buildMotion(assembled.scene);
  assert.ok(!result.ok);
  assert.equal(result.code, "INVALID_READING");
  assert.ok(result.fields.includes("springConstantNpm"));
});
