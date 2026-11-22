/**
 * 事件时间轴。标记来自 motion.events，点击即跳转。
 * 拖动轨道时暂停播放并实时预览。
 *
 * 结构分两层：上面是「按真实时间比例」的刻度轨道，下面是「按顺序」的事件索引。
 * 主演示题的时间分布很不均匀——1.99 s 之后的三个事件挤在最后 0.16 s 里，
 * 若把标签径向贴在轨道旁必然互相压叠；拆成刻度 + 索引后，
 * 位置仍然真实，文字也能各自站住。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Motion } from "../../../types";
import { displayEventAt } from './playback';

interface Props {
  motion: Motion;
  time: number;
  onSeek: (t: number) => void;
  onSeekEvent: (id: string) => void;
  onScrubStart: () => void;
}

export function EventTimeline({ motion, time, onSeek, onSeekEvent, onScrubStart }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const duration = Math.max(motion.durationSeconds, 0.001);
  const ratio = Math.min(1, Math.max(0, time / duration));

  const posToTime = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return r * duration;
    },
    [duration]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    onScrubStart();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    onSeek(posToTime(e.clientX));
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    onSeek(posToTime(e.clientX));
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* 捕获已释放 */
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowRight") onSeek(Math.min(duration, time + 0.05));
      if (e.key === "ArrowLeft") onSeek(Math.max(0, time - 0.05));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duration, onSeek, time]);

  const activeEvent = displayEventAt(motion,time);
  const passedAt=(seconds:number)=>motion.primaryBodyId?seconds<=time:time>=seconds-1e-6;

  return (
    <div className="timeline">
      <div
        className="track"
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="slider"
        tabIndex={0}
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration * 100) / 100}
        aria-valuenow={Math.round(time * 100) / 100}
      >
        <div className="track-fill" style={{ width: `${ratio * 100}%` }} />
        {motion.events.map((ev) => {
          const p = (ev.timeSeconds / duration) * 100;
          const done = passedAt(ev.timeSeconds);
          const current = activeEvent?.id === ev.id;
          return (
            <span
              key={ev.id}
              className={"tick" + (done ? " done" : "") + (current ? " current" : "")}
              style={{ left: `${p}%` }}
              title={`${ev.label} · ${ev.timeSeconds.toFixed(2)} s`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSeekEvent(ev.id);
              }}
            />
          );
        })}
        <div className="knob" style={{ left: `${ratio * 100}%` }} />
      </div>

      <ol className="event-index" aria-label="关键事件">
        {motion.events.map((ev) => {
          const current = activeEvent?.id === ev.id;
          const passed = passedAt(ev.timeSeconds);
          return (
            <li key={ev.id}>
              <button
                type="button"
                className={
                  "event-item" + (current ? " current" : "") + (passed ? " passed" : "")
                }
                onClick={() => onSeekEvent(ev.id)}
                aria-current={current ? "step" : undefined}
              >
                <span className="t">{ev.timeSeconds.toFixed(2)} s</span>
                <span className="n">{ev.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
