/**
 * 事件时间轴。标记来自 motion.events，点击即跳转。
 * 拖动轨道时暂停播放并实时预览。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Motion } from "../../../types";

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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") onSeek(Math.min(duration, time + 0.05));
      if (e.key === "ArrowLeft") onSeek(Math.max(0, time - 0.05));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duration, onSeek, time]);

  const activeEvent = [...motion.events].reverse().find((e) => e.timeSeconds <= time + 1e-6);

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
          const done = time >= ev.timeSeconds - 1e-6;
          return (
            <div
              key={ev.id}
              className={
                "marker" + (done ? " done" : "") + (activeEvent?.id === ev.id ? " current" : "")
              }
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

      <div className="marks">
        {motion.events.map((ev, i) => {
          const p = (ev.timeSeconds / duration) * 100;
          const edge = i === 0 ? " edge-start" : p > 88 ? " edge-end" : "";
          return (
            <div
              key={ev.id}
              className={"mark-label" + edge + (activeEvent?.id === ev.id ? " active" : "")}
              style={{ left: `${p}%`, opacity: time >= ev.timeSeconds - 1e-6 ? 1 : 0.55 }}
              onClick={() => onSeekEvent(ev.id)}
            >
              <div className="k">{ev.label}</div>
              <div className="v">{ev.timeSeconds.toFixed(2)} s</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
