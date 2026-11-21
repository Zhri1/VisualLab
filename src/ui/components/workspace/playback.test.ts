import { describe, expect, it } from "vitest";
import { advancePlayback, formatSpeed, segmentAt } from "./playback";
import type { MotionSegment } from "../../../types";

describe("播放时间推进", () => {
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
