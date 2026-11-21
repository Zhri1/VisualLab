import { useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { Workspace } from "../../../hooks/useWorkspace";
import { ChatPanel } from "../chat/ChatPanel";
import { PhysicsCanvas } from "./PhysicsCanvas";
import { PhysicsExplanation } from "./PhysicsExplanation";
import { PlaybackControls } from "./PlaybackControls";
import { OriginalProblemViewer } from "./OriginalProblemViewer";
import { advancePlayback, segmentAt } from "./playback";
import "./player.css";

interface Props {
  ws: Workspace;
}

export function WorkspaceLayout({ ws }: Props) {
  const { motion, currentTime, isPlaying } = ws;
  const [viewerOpen, setViewerOpen] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);
  const clockTimeRef = useRef(currentTime);
  clockTimeRef.current = currentTime;
  const activeSegment = motion ? segmentAt(motion.segments, currentTime) : undefined;
  const explanationTimes = useMemo(() => motion ? [
    ...motion.events.map((event) => event.timeSeconds),
    ...motion.segments.map((segment) => (segment.startSeconds + segment.endSeconds) / 2),
  ] : [], [motion]);

  // 播放循环不能依赖 ws 对象本身，否则每帧重建会重置 dt。
  const setTimeRef = useRef(ws.setCurrentTime);
  setTimeRef.current = ws.setCurrentTime;
  const setPlayingRef = useRef(ws.setIsPlaying);
  setPlayingRef.current = ws.setIsPlaying;

  // 播放时钟：只在工作台内运行，读取同一份 currentTime
  useEffect(() => {
    if (!motion || !isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastRef.current = null;
      return;
    }

    const tick = (ts: number) => {
      if (lastRef.current === null) lastRef.current = ts;
      const dt = Math.min(0.06, (ts - lastRef.current) / 1000);
      lastRef.current = ts;

      const next = advancePlayback(
        clockTimeRef.current, dt, ws.playbackRate,
        ws.segmentPlayback?.endSeconds ?? motion.durationSeconds,
        ws.autoPauseEvents ? motion.events : []
      );
      clockTimeRef.current = next.time;
      setTimeRef.current(next.time);
      if (next.pause) setPlayingRef.current(false);
      else rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastRef.current = null;
    };
  }, [motion, isPlaying, ws.playbackRate, ws.autoPauseEvents, ws.segmentPlayback]);

  return (
    <>
      <div className="workspace">
        <section className="panel player-panel">
          {ws.notice && (
            <div className={`notice ${ws.notice.kind}`} style={{ marginBottom: 14 }}>
              <span style={{ flex: 1 }}>{ws.notice.text}</span>
              {ws.notice.showSample && (
                <button className="link" onClick={() => ws.loadSample()} style={{ flex: "none" }}>
                  用内置示例
                </button>
              )}
              {ws.missingKeys.length > 0 && !motion && (
                <button
                  className="link"
                  onClick={() => setViewerOpen(true)}
                  style={{ flex: "none" }}
                >
                  去补齐
                </button>
              )}
            </div>
          )}

          <div className="player-head">
            <div style={{ minWidth: 0 }}>
              <h1 className="player-title">斜面滑块与弹簧</h1>
              <p className="player-sub">
                滑块自斜面顶端由静止下滑，经光滑水平面压缩弹簧并反弹。
              </p>
            </div>
            <button className="ghost-button" onClick={() => setViewerOpen(true)}>
              <ImageIcon size={14} strokeWidth={1.8} />
              查看原题
            </button>
          </div>

          {motion && (
            <ul className="scene-legend" aria-label="路段与动摩擦因数">
              <li aria-current={activeSegment?.kind === "incline" ? "step" : undefined}>
                <b>AB</b> 斜面 <span>μ = {ws.appliedReading?.conditions.kineticFrictionCoefficient?.toFixed(2)}</span>
              </li>
              <li aria-current={activeSegment?.kind !== "incline" ? "step" : undefined}>
                <b>BC</b> 水平面 <span>μ = 0</span>
              </li>
            </ul>
          )}
          <div className="canvas-frame">
            {motion ? (
              <PhysicsCanvas motion={motion} time={currentTime} isPlaying={isPlaying} />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "grid",
                  placeItems: "center",
                  color: "var(--text-tertiary)",
                  fontSize: 13,
                }}
              >
                补全条件后生成动画
              </div>
            )}
          </div>

          {motion ? (
            <>
              <PlaybackControls
                motion={motion}
                time={currentTime}
                isPlaying={isPlaying}
                onTogglePlay={ws.togglePlay}
                onReplay={ws.replay}
                onNextEvent={ws.nextEvent}
                onSeek={ws.seek}
                onSeekEvent={ws.seekEvent}
                onScrubStart={() => ws.setIsPlaying(false)}
                playbackRate={ws.playbackRate}
                onRateChange={ws.setPlaybackRate}
                autoPauseEvents={ws.autoPauseEvents}
                onAutoPauseChange={ws.setAutoPauseEvents}
                segmentName={ws.segmentPlayback?.name}
                onSlowSegment={ws.slowCurrentSegment}
                onExitSegment={ws.exitSegmentPlayback}
              />
              <div className="explanation-slot">
                <PhysicsExplanation motion={motion} time={currentTime} />
                <div className="explanation-reserve" aria-hidden="true">
                  {explanationTimes.map((time, index) => (
                    <PhysicsExplanation key={index} motion={motion} time={time} />
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </section>

        <ChatPanel ws={ws} />
      </div>

      <OriginalProblemViewer
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        reading={ws.reading}
        imageUrl={ws.imageUrl}
        missingKeys={ws.missingKeys}
        fieldErrors={ws.notice?.fieldErrors ?? []}
        onApply={ws.applyConditions}
      />
    </>
  );
}
