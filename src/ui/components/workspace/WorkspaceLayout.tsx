import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { Workspace } from "../../../hooks/useWorkspace";
import { ChatPanel } from "../chat/ChatPanel";
import { PhysicsCanvas } from "./PhysicsCanvas";
import { PhysicsExplanation } from "./PhysicsExplanation";
import { PlaybackControls } from "./PlaybackControls";
import { OriginalProblemViewer } from "./OriginalProblemViewer";

interface Props {
  ws: Workspace;
}

export function WorkspaceLayout({ ws }: Props) {
  const { motion, currentTime, isPlaying } = ws;
  const [viewerOpen, setViewerOpen] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);

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

      setTimeRef.current((prev) => {
        const next = prev + dt;
        if (next >= motion.durationSeconds) {
          // 终点停在末尾并自动暂停，避免循环播放
          setPlayingRef.current(false);
          return motion.durationSeconds;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastRef.current = null;
    };
  }, [motion, isPlaying]);

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

          <div className="canvas-frame">
            {motion ? (
              <PhysicsCanvas motion={motion} time={currentTime} />
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
              />
              <PhysicsExplanation motion={motion} time={currentTime} />
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
