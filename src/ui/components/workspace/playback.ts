import type { MotionSegment } from "../../../types";

export function advancePlayback(
  currentTime: number,
  elapsedSeconds: number,
  rate: number,
  endSeconds: number,
  pauseEvents: readonly { timeSeconds: number }[]
): { time: number; pause: boolean } {
  const time = Math.min(endSeconds, currentTime + elapsedSeconds * rate);
  // 事件按时间排列，只检查本帧新经过的事件，继续播放时不会停在原地。
  const event = pauseEvents.find(({ timeSeconds }) => timeSeconds > currentTime && timeSeconds <= time);
  if (event) return { time: event.timeSeconds, pause: true };
  return { time, pause: time === endSeconds };
}

export function segmentAt(segments: readonly MotionSegment[], time: number): MotionSegment | undefined {
  return segments.find((segment) => time < segment.endSeconds) ?? segments[segments.length - 1];
}

export function formatSpeed(speed: number): string {
  return speed === 0 ? "0" : speed < 0.005 ? "<0.01" : speed.toFixed(2);
}

