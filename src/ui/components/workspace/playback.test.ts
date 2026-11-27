import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { advancePlayback, computeDefaultPace, formatPace, formatSpeed, segmentAt } from "./playback";
import { computeWorldBounds, fitViewport } from "./canvasViewport";
import { computeRatePopoverLayout, PLAYBACK_RATES } from "./PlaybackControls";
import { PRESSABLE_BUTTON_SELECTOR } from "../../interactions/buttonPress";
import type { MotionSegment } from "../../../types";
import fixture from "../../../../fixtures/incline-spring.reading.json";
import { motionLibrary } from "../../../adapters";

describe("播放时间推进", () => {
  it("真实题设的自动暂停保留原始事件时间和最大压缩零速度", () => {
    const scene = motionLibrary.assembleScene(fixture);
    expect(scene.ok).toBe(true);
    if (!scene.ok) throw new Error("标准题装配失败");
    const built = motionLibrary.buildMotion(scene.scene);
    if (!built.ok) throw new Error(built.message);
    const motion = built.motion;
    for (const event of motion.events.slice(1)) {
      const next = advancePlayback(event.timeSeconds - 0.001, 0.01, 1, motion.durationSeconds, motion.events);
      expect(next.time).toBe(event.timeSeconds);
      expect(next.pause).toBe(true);
      if (event.id === "max_compression") expect(motion.sampleAt(next.time).velocity.x).toBe(0);
    }
  });
  it.each([
    [0.25, 0.375],
    [1, 0.75],
    [2, 1.25],
  ])("按 %s 倍速推进", (rate, expectedTime) => {
    expect(advancePlayback(0.25, 0.5, rate, 2, [])).toEqual({ time: expectedTime, pause: false });
  });

  it("在本段终点暂停，即使本帧原本可经过段外事件", () => {
    expect(advancePlayback(1.25, 0.5, 2, 1.5, [{ timeSeconds: 1.75 }])).toEqual({ time: 1.5, pause: true });
  });

  it("本帧跨过多个事件时，在首个事件精确暂停", () => {
    const events = [{ timeSeconds: 1 }, { timeSeconds: 1.5 }, { timeSeconds: 1.75 }];
    expect(advancePlayback(1, 0.5, 2, 2, events)).toEqual({ time: 1.5, pause: true });
  });

  it("恢复播放时跳过同刻事件，仍能停在不同但很接近的事件", () => {
    const nextTime = 1 + 1e-9;
    const events = [{ timeSeconds: 1 }, { timeSeconds: 1 }, { timeSeconds: nextTime }];
    expect(advancePlayback(1, 0.125, 1, 2, events)).toEqual({ time: nextTime, pause: true });
  });

  it("恰好推进至终点时暂停", () => {
    expect(advancePlayback(1.5, 0.5, 1, 2, [])).toEqual({ time: 2, pause: true });
  });
});

describe("速度和阶段边界", () => {
  it("静止、微小非零速度及常规速度有明确显示", () => {
    expect(formatSpeed(0)).toBe("0");
    expect(formatSpeed(0.002)).toBe("<0.01");
    expect(formatSpeed(4.0249)).toBe("4.02");
  });

  it("精确边界选择下一段，末端仍可慢放最后一段", () => {
    const segments = [
      { kind: "incline", startSeconds: 0, endSeconds: 2 },
      { kind: "horizontal", startSeconds: 2, endSeconds: 3 },
      { kind: "spring", startSeconds: 3, endSeconds: 4 },
    ] as MotionSegment[];
    expect(segmentAt(segments, 2)?.kind).toBe("horizontal");
    expect(segmentAt(segments, 4)?.kind).toBe("spring");
  });
});

describe("默认观看节奏与统一取景", () => {
  const load = (file: string) => {
    const raw = JSON.parse(readFileSync(new URL(`../../../../fixtures/${file}`, import.meta.url), "utf8"));
    const a = motionLibrary.assembleScene(raw);
    if (!a.ok) throw new Error(JSON.stringify(a));
    const b = motionLibrary.buildMotion(a.scene);
    if (!b.ok) throw new Error(b.message);
    return b.motion;
  };

  it("2.39 s 斜面弹簧参考题默认节奏放慢到 0.55×（只放慢不加速），物理事件与时长不变", () => {
    const motion = load("incline-spring.reading.json");
    const pace = computeDefaultPace(motion);
    const watch = motion.durationSeconds / pace;
    expect(pace).toBe(0.55);
    expect(watch).toBeCloseTo(motion.durationSeconds / 0.55, 6);
    expect(motion.durationSeconds).toBeCloseTo(2.3932, 3);
    expect(formatPace(pace)).toBe("0.55");
  });

  it("快例（0.5 s 木板到边 / 0.81 s 圆轨）放慢到 0.15×；6 s 常力保持 1× 不加速", () => {
    const fastPlank = load("block-plank-edge.reading.json");
    const fastArc = load("circular-track-critical.reading.json");
    const longCf = load("constant-force-benchmark.reading.json");
    expect(computeDefaultPace(fastPlank)).toBe(0.15);
    expect(computeDefaultPace(fastArc)).toBe(0.15);
    expect(computeDefaultPace(longCf)).toBe(1);
    expect(formatPace(1)).toBe("1");
  });

  it("多物体碰撞接摆动放慢到 0.25×，共用同一时间映射，采样与事件不受节奏系数影响", () => {
    const motion = load("horizontal-collision-pendulum.reading.json");
    const pace = computeDefaultPace(motion);
    expect(pace).toBe(0.25);
    expect(formatPace(pace)).toBe("0.25");
    const col = motion.events.find((e) => e.eventKind === "collision")!;
    const step = advancePlayback(col.timeSeconds - 0.001, 0.05, 1 * pace, motion.durationSeconds, motion.events);
    expect(step.time).toBe(col.timeSeconds);
    expect(step.pause).toBe(true);
    const s = motion.sampleAt(col.timeSeconds);
    expect(s.bodies?.one.position.x).toBeCloseTo(s.bodies!.two.position.x, 9);
  });

  it("fitViewport：横长 1D 场景占足横向宽度不受虚高限制，静止点与 2D 场景等比居中", () => {
    const horiz = fitViewport(900, 360, computeWorldBounds([{ x: 0, y: 0 }, { x: 12, y: 0 }]), { top: 40, right: 50, bottom: 40, left: 50 });
    expect(horiz.X(0)).toBeCloseTo(50, 6);
    expect(horiz.X(12)).toBeCloseTo(850, 6);
    expect(horiz.Y(0)).toBeCloseTo(180, 6);

    const still = fitViewport(375, 300, computeWorldBounds([{ x: 2, y: 1 }]), { top: 40, right: 30, bottom: 40, left: 30 });
    expect(Number.isFinite(still.S)).toBe(true);
    expect(still.X(2)).toBeCloseTo(187.5, 6);
    expect(still.Y(1)).toBeCloseTo(150, 6);

    const box2d = fitViewport(800, 400, computeWorldBounds([{ x: 0, y: 0 }, { x: 2, y: 2 }]), { top: 40, right: 40, bottom: 40, left: 40 });
    expect(box2d.S).toBeCloseTo(320 / 2, 6);
    expect(box2d.Y(2)).toBeCloseTo(40, 6);
    expect(box2d.Y(0)).toBeCloseTo(360, 6);
  });
});

describe("播放倍率浮层定位与按压接入", () => {
  it("保留 0.25× / 0.5× / 1× / 2× 四档且倍率胶囊命中统一按压选择器", () => {
    expect(PLAYBACK_RATES).toEqual([0.25, 0.5, 1, 2]);
    expect(PRESSABLE_BUTTON_SELECTOR).toContain("button.transport-pill");
  });

  it("桌面底部空间不足时自动向上展开，空间充足时向下展开", () => {
    const nearBottom = computeRatePopoverLayout({ left: 140, top: 690, bottom: 718, width: 68 }, 1280, 800);
    expect(nearBottom.placement).toBe("top");
    expect(nearBottom.bottom).toBe(800 - 690 + 6);
    expect(nearBottom.top).toBeUndefined();
    expect(nearBottom.left).toBe(140);
    expect(nearBottom.minWidth).toBe(96);

    const midScreen = computeRatePopoverLayout({ left: 140, top: 320, bottom: 348, width: 68 }, 1280, 800);
    expect(midScreen.placement).toBe("bottom");
    expect(midScreen.top).toBe(348 + 6);
    expect(midScreen.bottom).toBeUndefined();
  });

  it("移动端优先向上展开并做视口左右夹紧，避免贴边裁切", () => {
    const mobile = computeRatePopoverLayout({ left: 2, top: 520, bottom: 556, width: 74 }, 390, 844);
    expect(mobile.placement).toBe("top");
    expect(mobile.left).toBe(8);
    expect(mobile.bottom).toBe(844 - 520 + 6);

    const nearRight = computeRatePopoverLayout({ left: 340, top: 520, bottom: 556, width: 74 }, 390, 844);
    expect(nearRight.placement).toBe("top");
    expect(nearRight.left).toBe(390 - 96 - 8);
  });
});
