import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Image as ImageIcon, Repeat } from "lucide-react";
import type { Workspace } from "../../../hooks/useWorkspace";
import { isStageReading } from "../../../types";
import { ChatPanel } from "../chat/ChatPanel";
import { PhysicsCanvas } from "./PhysicsCanvas";
import { MultiBodyReadouts } from "./MultiBodyPhysicsCanvas";
import { PhysicsExplanation } from "./PhysicsExplanation";
import { MultiBodyExplanation } from './MultiBodyExplanation';
import { PlaybackControls } from "./PlaybackControls";
import { OriginalProblemViewer } from "./OriginalProblemViewer";
import { advancePlayback, segmentAt } from "./playback";
import "./player.css";

interface Props {
  ws: Workspace;
}
export function stageForLegend(plan:{stages:unknown[]},stagePath:string|undefined,stageIndex:number|undefined):Record<string,unknown>|null{
  const value=stagePath?stagePath.split('/').slice(1).reduce<unknown>((v,k)=>v!==null&&typeof v==='object'?(v as Record<string,unknown>)[k]:undefined,plan):plan.stages[stageIndex??-1];
  return value!==null&&typeof value==='object'?value as Record<string,unknown>:null;
}

type MobileTab = "player" | "chat";

/** 只在手机宽度渲染标签，桌面 DOM 与改动前保持一致。 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export function WorkspaceLayout({ ws }: Props) {
  const { motion, currentTime, isPlaying } = ws;
  const isMobile = useMediaQuery("(max-width: 720px)");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("player");
  const [metaOpen, setMetaOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [trackedBodyId,setTrackedBodyId]=useState<string|undefined>(motion?.primaryBodyId);
  useEffect(()=>setTrackedBodyId(motion?.primaryBodyId),[motion]);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);
  const clockTimeRef = useRef(currentTime);
  clockTimeRef.current = currentTime;
  const activeSegment = motion ? segmentAt(motion.segments, currentTime) : undefined;
  const stagePlan = isStageReading(ws.appliedReading) ? ws.appliedReading : isStageReading(ws.reading)?ws.reading:null;
  const legacyReading = ws.appliedReading && !isStageReading(ws.appliedReading) ? ws.appliedReading : null;
  const stageLabels = {
    horizontal_approach:'水平接近',pendulum_swing:'轻绳摆',collision_1d:'正碰',parallel_motion:'同步运动',block_plank:'滑块与木板',
    spring_release: "预压释放",
    incline_slide: "斜面",
    lossless_turn: "转向",
    horizontal_slide: "水平",
    constant_force_1d: "常力",
    conveyor_belt: "传送带",
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
  const Explanation=motion?.primaryBodyId?MultiBodyExplanation:PhysicsExplanation;

  // 播放循环不能依赖 ws 对象本身，否则每帧重建会重置 dt。
  const setTimeRef = useRef(ws.setCurrentTime);
  setTimeRef.current = ws.setCurrentTime;
  const setPlayingRef = useRef(ws.setIsPlaying);
  setPlayingRef.current = ws.setIsPlaying;

  // 手机浏览器地址栏/键盘会改变可视高度：用 visualViewport 撑住整屏工作台。
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty("--app-vh", `${Math.max(320, Math.round(viewport.height))}px`);
    };
    apply();
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
      root.style.removeProperty("--app-vh");
    };
  }, []);

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
      {isMobile && (
        <div className="mobile-tabs" role="tablist" aria-label="工作台视图">
          <button
            type="button"
            role="tab"
            id="work-tab-player"
            aria-selected={mobileTab === "player"}
            aria-controls="work-panel-player"
            className="mobile-tab"
            onClick={() => setMobileTab("player")}
          >
            播放
          </button>
          <button
            type="button"
            role="tab"
            id="work-tab-chat"
            aria-selected={mobileTab === "chat"}
            aria-controls="work-panel-chat"
            className="mobile-tab"
            onClick={() => setMobileTab("chat")}
          >
            对话
          </button>
        </div>
      )}

      <div className="workspace">
        <section
          id="work-panel-player"
          role="tabpanel"
          aria-labelledby="work-tab-player"
          className={'panel player-panel'+(motion?.primaryBodyId?' body-player-panel':'')+(isMobile && mobileTab !== "player" ? " is-tab-hidden" : "")}
        >
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
            {ws.sampleCompare && (
              <button
                className="ghost-button compare-toggle"
                onClick={ws.toggleSampleCompare}
                aria-pressed={ws.compareOn}
                aria-label={ws.compareOn ? ws.sampleCompare.backLabel : ws.sampleCompare.label}
                title={ws.compareOn ? ws.sampleCompare.backLabel : ws.sampleCompare.label}
              >
                <Repeat size={14} strokeWidth={1.8} />
                <span className="btn-label">
                  {ws.compareOn ? ws.sampleCompare.backLabel : ws.sampleCompare.label}
                </span>
              </button>
            )}
            <button className="ghost-button" onClick={() => setViewerOpen(true)} aria-label="查看原题">
              <ImageIcon size={14} strokeWidth={1.8} />
              <span className="btn-label">查看原题</span>
            </button>
          </div>

          <button
            type="button"
            className="meta-toggle"
            aria-expanded={metaOpen}
            aria-controls="player-meta"
            onClick={() => setMetaOpen((open) => !open)}
          >
            路段与计时
            <ChevronDown size={15} strokeWidth={2} className="chev" />
          </button>
          <div id="player-meta" className={`player-meta${metaOpen ? "" : " is-collapsed"}`}>
          {motion?.timing && <div className="notice info" role="status"><span>{motion.timing.mode === "full" ? "全程精确播放" : motion.timing.mode === "suffix" ? "前段示意 · 从B精确计时" : "仅展示已知状态 · 用时未知"}：{motion.timing.reason}
            {motion.calculations?.map(c => <span key={c.quantity}>　{{ initial_elastic_energy: "初始弹性势能", release_speed: "脱离速度", arc_entry_speed: "入弧速度" }[c.quantity] ?? c.quantity} = {Number(c.value.toPrecision(6))} {c.unit}（{c.source === "derived" ? "物理推导" : "题设/用户给定"}）</span>)}</span></div>}
          {motion?.motionStatus&&<div className="notice info" role="status"><span>{motion.motionStatus.state==='model_limit'?'有限求解范围':motion.motionStatus.state==='range_end'?'播放范围终点':'真实静止结局'}：{motion.motionStatus.message}</span></div>}
          {motion?.primaryBodyId&&<label className="body-tracking">跟踪物体<select aria-label="跟踪物体" value={trackedBodyId??motion.primaryBodyId} onChange={e=>setTrackedBodyId(e.target.value)}>{motion.stageGeometry?.bodies?.map(b=><option value={b.bodyId} key={b.bodyId}>{b.bodyId}</option>)}</select><span>{(motion.stageGeometry?.bodies?.length??0)>1?'两物体共用同一物理时间':'物体与绳共用同一物理时间'}</span></label>}
          {motion?.primaryBodyId && (
            <MultiBodyReadouts motion={motion} time={currentTime} isPlaying={isPlaying} />
          )}
          </div>
          {motion && (
            <ul className={'scene-legend'+(motion.primaryBodyId?' body-scene-legend':'')} aria-label="路段与动摩擦因数">
              {stagePlan ? motion.segments.map((segment) => {
                const stage = stageForLegend(stagePlan,segment.stagePath,segment.stageIndex);
                const friction = stage && "kineticFrictionCoefficient" in stage && typeof stage.kineticFrictionCoefficient === "number"
                  ? stage.kineticFrictionCoefficient
                  : null;
                return (
                  <li key={`${segment.stagePath??segment.stageIndex}-${segment.kind}-${segment.startSeconds}`} aria-current={activeSegment === segment ? "step" : undefined}>
                    <b>{String((segment.stageIndex ?? 0) + 1).padStart(2, "0")}</b> {segment.bodyIds?.join(' + ')} {segment.name}
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
          <div className={'canvas-frame'+(motion?.primaryBodyId?' body-canvas-frame':'')}>
            {motion ? (
              <PhysicsCanvas motion={motion} time={currentTime} isPlaying={isPlaying} trackedBodyId={trackedBodyId} readouts={false} />
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
              {motion.timing?.mode !== "state_only" && (
                <>
                  <button
                    type="button"
                    className="explain-toggle"
                    aria-expanded={explainOpen}
                    aria-controls="explain-slot"
                    onClick={() => setExplainOpen((open) => !open)}
                  >
                    本段原理
                    <ChevronDown size={15} strokeWidth={2} className="chev" />
                  </button>
                  <div id="explain-slot" className={`explanation-slot${explainOpen ? "" : " is-collapsed"}`}>
                    <Explanation motion={motion} time={currentTime} />
                    <div className="explanation-reserve" aria-hidden="true">
                      {explanationTimes.map((time, index) => (
                        <Explanation key={index} motion={motion} time={time} />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          ) : null}
        </section>

        <ChatPanel ws={ws} className={isMobile && mobileTab !== "chat" ? "is-tab-hidden" : undefined} />
      </div>

      <OriginalProblemViewer
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        reading={ws.reading}
        imageUrl={ws.imageUrl}
        problemText={ws.problemText}
        missingKeys={ws.missingKeys}
        fieldErrors={ws.notice?.fieldErrors ?? []}
        onApply={ws.applyConditions}
      />
    </>
  );
}
