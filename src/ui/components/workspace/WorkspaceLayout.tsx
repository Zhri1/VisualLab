import { useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { Workspace } from "../../../hooks/useWorkspace";
import { isStageReading } from "../../../types";
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
  const stagePlan = isStageReading(ws.appliedReading) ? ws.appliedReading : null;
  const legacyReading = ws.appliedReading && !isStageReading(ws.appliedReading) ? ws.appliedReading : null;
  const stageLabels = {
    spring_release: "预压释放",
    incline_slide: "斜面",
    lossless_turn: "转向",
    horizontal_slide: "水平",
    spring_contact: "弹簧",
    projectile: "抛体",
    vertical_arc: "圆弧",
  } as const;
  const title = stagePlan
    ? stagePlan.stages.map((stage) => stageLabels[stage.kind as keyof typeof stageLabels] ?? "未知阶段").join(" · ")
    : "斜面滑块与弹簧";
  const subtitle = stagePlan
    ? `共 ${stagePlan.stages.length} 个有序阶段，按实际事件播放；修改条件后重新装配。`
    : "滑块自斜面顶端由静止下滑，经光滑水平面压缩弹簧并反弹。";
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
              <h1 className="player-title">{title}</h1>
              <p className="player-sub">{subtitle}</p>
            </div>
            <button className="ghost-button" onClick={() => setViewerOpen(true)}>
              <ImageIcon size={14} strokeWidth={1.8} />
              查看原题
            </button>
          </div>

          {motion?.timing && <div className="notice info" role="status"><span>{motion.timing.mode === "full" ? "全程精确播放" : motion.timing.mode === "suffix" ? "前段示意 · 从B精确计时" : "仅展示已知状态 · 用时未知"}：{motion.timing.reason}
            {motion.calculations?.map(c => <span key={c.quantity}>　{{ initial_elastic_energy: "初始弹性势能", release_speed: "脱离速度", arc_entry_speed: "入弧速度" }[c.quantity] ?? c.quantity} = {Number(c.value.toPrecision(6))} {c.unit}（{c.source === "derived" ? "物理推导" : "题设/用户给定"}）</span>)}</span></div>}
          {motion && (
            <ul className="scene-legend" aria-label="路段与动摩擦因数">
              {stagePlan ? motion.segments.map((segment) => {
                const stage = segment.stageIndex == null ? null : stagePlan.stages[segment.stageIndex];
                const friction = stage && "kineticFrictionCoefficient" in stage && typeof stage.kineticFrictionCoefficient === "number"
                  ? stage.kineticFrictionCoefficient
                  : null;
                return (
                  <li key={`${segment.stageIndex}-${segment.kind}`} aria-current={activeSegment === segment ? "step" : undefined}>
                    <b>{String((segment.stageIndex ?? 0) + 1).padStart(2, "0")}</b> {segment.name}
                    {friction != null && <span>μ = {friction.toFixed(2)}</span>}
                  </li>
                );
              }) : (
                <>
                  <li aria-current={activeSegment?.kind === "incline" ? "step" : undefined}>
                    <b>AB</b> 斜面 <span>μ = {legacyReading?.conditions.kineticFrictionCoefficient?.toFixed(2)}</span>
                  </li>
                  <li aria-current={activeSegment?.kind !== "incline" ? "step" : undefined}>
                    <b>BC</b> 水平面 <span>μ = 0</span>
                  </li>
                </>
              )}
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
              {motion.timing?.mode !== "state_only" && <div className="explanation-slot">
                <PhysicsExplanation motion={motion} time={currentTime} />
                <div className="explanation-reserve" aria-hidden="true">
                  {explanationTimes.map((time, index) => (
                    <PhysicsExplanation key={index} motion={motion} time={time} />
                  ))}
                </div>
              </div>}
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
