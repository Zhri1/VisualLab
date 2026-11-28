import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  ClipboardCheck,
  Crop,
  GitFork,
  Image as ImageIcon,
  Pencil,
  Pointer,
  Repeat,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import type { Workspace } from "../../../hooks/useWorkspace";
import { isStageReading, type MotionSegment } from "../../../types";
import { ChatPanel } from "../chat/ChatPanel";
import { PhysicsCanvas } from "./PhysicsCanvas";
import { MultiBodyReadouts } from "./MultiBodyPhysicsCanvas";
import { PhysicsExplanation } from "./PhysicsExplanation";
import { MultiBodyExplanation } from './MultiBodyExplanation';
import { PlaybackControls } from "./PlaybackControls";
import { OriginalProblemViewer } from "./OriginalProblemViewer";
import { advancePlayback, computeDefaultPace, segmentAt } from "./playback";
import { getSample } from "../../../data/samples";
import {
  ANNOTATION_COLOR_OPTIONS,
  AnnotationLayer,
  AnnotationPalette,
} from "../../../features/annotate/AnnotationLayer";
import type { AnnotationMode, AnnotationStroke } from "../../../features/annotate/types";
import { ExportMenu } from "../../../features/export/ExportMenu";
import { downloadBlob } from "../../../features/export/capture";
import { captureRegionPng, copyPngToClipboard, type RegionRect } from "../../../features/export/regionCapture";
import { RegionScreenshotOverlay } from "../../../features/export/RegionScreenshotOverlay";
import { PracticePanel } from "../../../features/practice/PracticePanel";
import { isFavorite, removeFavorite, saveFavoriteWithResult } from "../../../features/share/favorites";
import { buildShareUrl } from "../../../features/share/shareLink";
import "./player.css";

interface Props {
  ws: Workspace;
}
export function stageForLegend(plan:{stages:unknown[]},stagePath:string|undefined,stageIndex:number|undefined):Record<string,unknown>|null{
  const value=stagePath?stagePath.split('/').slice(1).reduce<unknown>((v,k)=>v!==null&&typeof v==='object'?(v as Record<string,unknown>)[k]:undefined,plan):plan.stages[stageIndex??-1];
  return value!==null&&typeof value==='object'?value as Record<string,unknown>:null;
}

export interface CurrentStageBadgeData {
  code: string;
  name: string;
  frictionText: string | null;
  fullLabel: string;
}

/** 仅提取当前播放路段的一条简洁状态，复用既有 activeSegment 与 stageForLegend，不复制阶段选择逻辑。 */
export function buildCurrentStageBadge(
  activeSegment: MotionSegment | undefined,
  stagePlan: { stages: unknown[] } | null,
  legacyFriction: number | null | undefined,
): CurrentStageBadgeData | null {
  if (!activeSegment) return null;
  if (stagePlan) {
    const stage = stageForLegend(stagePlan, activeSegment.stagePath, activeSegment.stageIndex);
    const friction =
      stage && "kineticFrictionCoefficient" in stage && typeof stage.kineticFrictionCoefficient === "number"
        ? stage.kineticFrictionCoefficient
        : null;
    const code = String((activeSegment.stageIndex ?? 0) + 1).padStart(2, "0");
    const bodyPrefix = activeSegment.bodyIds?.length ? `${activeSegment.bodyIds.join(" + ")} ` : "";
    const name = `${bodyPrefix}${activeSegment.name}`.trim();
    const frictionText = friction != null ? `μ = ${friction.toFixed(2)}` : null;
    const fullLabel = frictionText ? `${code} ${name} · ${frictionText}` : `${code} ${name}`;
    return { code, name, frictionText, fullLabel };
  }
  if (activeSegment.kind === "incline") {
    const frictionText = typeof legacyFriction === "number" ? `μ = ${legacyFriction.toFixed(2)}` : null;
    const fullLabel = frictionText ? `AB 斜面 · ${frictionText}` : "AB 斜面";
    return { code: "AB", name: "斜面", frictionText, fullLabel };
  }
  if (activeSegment.kind === "horizontal") {
    return { code: "BC", name: "水平面", frictionText: "μ = 0", fullLabel: "BC 水平面 · μ = 0" };
  }
  if (activeSegment.kind === "spring") {
    const name = activeSegment.name || "弹簧压缩与反弹";
    return { code: "CD", name, frictionText: null, fullLabel: `CD ${name}` };
  }
  const code = String((activeSegment.stageIndex ?? 0) + 1).padStart(2, "0");
  const name = activeSegment.name;
  return { code, name, frictionText: null, fullLabel: `${code} ${name}` };
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
  /** 自动调速开关：默认开（只放慢不加速），可关回原始物理流速。 */
  const [paceEnabled, setPaceEnabled] = useState(true);
  const [forcesOn, setForcesOn] = useState(false);
  const [decomposeOn, setDecomposeOn] = useState(false);
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>("off");
  const [annotationColor, setAnnotationColor] = useState<string>(ANNOTATION_COLOR_OPTIONS[0].value);
  const [strokes, setStrokes] = useState<AnnotationStroke[]>([]);
  const [screenshotMode, setScreenshotMode] = useState(false);
  const [shotToast, setShotToast] = useState<{ kind: "busy" | "ok" | "error"; text: string; blob?: Blob } | null>(null);
  const [practiceOn, setPracticeOn] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);
  const playerPaneRef = useRef<HTMLElement | null>(null);
  const frameBoxRef = useRef<HTMLDivElement | null>(null);
  const shotTimerRef = useRef<number | null>(null);
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });

  const activeReading = (ws.appliedReading ?? ws.reading) as unknown;
  const samplePractice = useMemo(() => (ws.sampleId ? getSample(ws.sampleId).practice ?? [] : []), [ws.sampleId]);
  const sampleTitle = ws.sampleId ? getSample(ws.sampleId).title : ws.problemText?.slice(0, 24) || "VisualLab 题目";
  const favoriteId = useMemo(() => {
    if (ws.sampleId) return ws.sampleId;
    const raw = ws.problemText?.trim() || JSON.stringify(activeReading ?? "").slice(0, 120);
    let hash = 0;
    for (let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
    return `custom-${Math.abs(hash)}`;
  }, [ws.sampleId, ws.problemText, activeReading]);
  const [favorited, setFavorited] = useState(() => isFavorite(favoriteId));
  useEffect(() => {
    setFavorited(isFavorite(favoriteId));
  }, [favoriteId]);

  const masked = practiceOn && !revealed && samplePractice.length > 0;

  useEffect(() => () => {
    if (shotTimerRef.current !== null) window.clearTimeout(shotTimerRef.current);
  }, []);

  const handleRegionCapture = async (rect: RegionRect) => {
    setScreenshotMode(false);
    const pane = playerPaneRef.current;
    if (!pane) return;
    if (shotTimerRef.current !== null) {
      window.clearTimeout(shotTimerRef.current);
      shotTimerRef.current = null;
    }
    setShotToast({ kind: "busy", text: "正在生成截图并复制到剪贴板…" });
    // 等一帧确保选区遮罩完全卸载后再合成
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    let blob: Blob | undefined;
    try {
      blob = await captureRegionPng(pane, rect);
      await copyPngToClipboard(blob);
      setShotToast({ kind: "ok", text: "已复制截图到剪贴板，可直接粘贴" });
      shotTimerRef.current = window.setTimeout(() => setShotToast(null), 3200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "复制截图失败，可直接保存 PNG";
      setShotToast({ kind: "error", text: msg, blob });
    }
  };

  useEffect(() => {
    const box = frameBoxRef.current;
    if (!box) return;
    const measure = () => setFrameSize({ w: box.clientWidth, h: box.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [motion]);

  useEffect(() => {
    setRevealed(false);
    setPracticeOn(false);
    setStrokes([]);
    setAnnotationMode("off");
  }, [motion]);

  const closeDrawMode = () => {
    setAnnotationMode((m) => (m === "draw" ? "off" : m));
  };

  const toggleFavorite = () => {
    if (favorited) {
      removeFavorite(favoriteId);
      setFavorited(isFavorite(favoriteId));
    } else {
      const res = saveFavoriteWithResult({
        id: favoriteId,
        title: sampleTitle,
        savedAt: Date.now(),
        sampleId: ws.sampleId ?? undefined,
        reading: activeReading,
      });
      if (res.ok) {
        setFavorited(true);
      } else {
        setShotToast({ kind: "error", text: res.error ?? "收藏保存失败，请检查浏览器本地存储权限或空间" });
      }
    }
  };

  const copyShare = () => {
    const url = buildShareUrl(`${window.location.origin}${window.location.pathname}`, {
      sampleId: ws.sampleId ?? undefined,
      reading: activeReading,
      timeSeconds: currentTime,
      playbackRate: ws.playbackRate,
    });
    const markCopied = () => {
      setCopiedShare(true);
      window.setTimeout(() => setCopiedShare(false), 2000);
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url).then(markCopied, () => window.prompt("复制此链接", url));
    } else {
      window.prompt("复制此链接", url);
    }
  };

  const [trackedBodyId,setTrackedBodyId]=useState<string|undefined>(motion?.primaryBodyId);
  useEffect(()=>setTrackedBodyId(motion?.primaryBodyId),[motion]);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);
  const clockTimeRef = useRef(currentTime);
  clockTimeRef.current = currentTime;
  const activeSegment = motion ? segmentAt(motion.segments, currentTime) : undefined;
  const defaultPace = useMemo(() => (motion ? computeDefaultPace(motion) : 1), [motion]);
  const stagePlan = isStageReading(ws.appliedReading) ? ws.appliedReading : isStageReading(ws.reading)?ws.reading:null;
  const legacyReading = ws.appliedReading && !isStageReading(ws.appliedReading) ? ws.appliedReading : null;
  const stageLabels = {
    horizontal_approach:'水平接近',pendulum_swing:'轻绳摆',collision_1d:'正碰',parallel_motion:'同步运动',block_plank:'滑块与木板',pulley_system:'定滑轮连接体',
    spring_release: "预压释放",
    incline_slide: "斜面",
    lossless_turn: "转向",
    horizontal_slide: "水平",
    constant_force_1d: "常力",
    conveyor_belt: "传送带",
    movable_arc: "可移动圆弧槽",
    movable_semicircle: "可平动半圆轨道",
    spring_pair: "弹簧双球",
    circular_orbit: "圆周轨道",
    binary_circular_orbit: "双星圆轨道",
    spring_contact: "弹簧",
    projectile: "抛体",
    vertical_arc: "圆弧",
    magnetic_deflection: "匀强磁场偏转",
    switchable_em_collision: "分区电磁场与正碰",
    magnetic_reencounter: "磁场双粒子正碰与再相遇",
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

  useEffect(() => {
    if (!metaOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMetaOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [metaOpen]);

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
        clockTimeRef.current, dt, ws.playbackRate * (paceEnabled ? defaultPace : 1),
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
  }, [motion, isPlaying, ws.playbackRate, paceEnabled, defaultPace, ws.autoPauseEvents, ws.segmentPlayback]);

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
          ref={playerPaneRef}
          id="work-panel-player"
          role="tabpanel"
          aria-labelledby="work-tab-player"
          className={'panel player-panel'+(motion?.stageGeometry?.binaryCircularOrbit?' binary-orbit-panel':'')+(motion?.primaryBodyId?' body-player-panel':'')+(isMobile && mobileTab !== "player" ? " is-tab-hidden" : "")}
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
            <div className="player-head-actions">
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
              {motion && (
                <ExportMenu
                  getCanvas={() => frameBoxRef.current?.querySelector("canvas") ?? null}
                  motion={motion}
                  title={sampleTitle}
                  problemText={ws.problemText ?? ""}
                  wallMs={Math.round((motion.durationSeconds / Math.max(0.1, ws.playbackRate * (paceEnabled ? defaultPace : 1))) * 1000)}
                  onSeek={ws.seek}
                />
              )}
              {motion && (
                <button
                  type="button"
                  className="ghost-button favorite-btn"
                  onClick={toggleFavorite}
                  aria-pressed={favorited}
                  aria-label={favorited ? "取消收藏" : "收藏到错题本"}
                  title={favorited ? "已收藏（点击取消）" : "收藏到错题本"}
                >
                  <Bookmark size={14} strokeWidth={1.8} fill={favorited ? "currentColor" : "none"} />
                  <span className="btn-label">{favorited ? "已收藏" : "收藏"}</span>
                </button>
              )}
              {motion && (
                <button
                  type="button"
                  className={`ghost-button share-btn${copiedShare ? " is-copied" : ""}`}
                  onClick={copyShare}
                  aria-label="分享链接"
                  title="复制包含当前条件与时刻的分享链接"
                >
                  {copiedShare ? <Check size={14} strokeWidth={2.2} /> : <Share2 size={14} strokeWidth={1.8} />}
                  <span className="btn-label">{copiedShare ? "已复制" : "分享"}</span>
                </button>
              )}
              <button className="ghost-button" onClick={() => setViewerOpen(true)} aria-label="查看原题">
                <ImageIcon size={14} strokeWidth={1.8} />
                <span className="btn-label">查看原题</span>
              </button>
            </div>
          </div>

          <div className={`stage-bar${metaOpen ? " is-meta-open" : ""}`}>
            <div className="stage-bar-left">
              {motion && (
                <div className="view-tools" role="toolbar" aria-label="画布辅助工具">
                  <button
                    type="button"
                    className="tool-toggle"
                    aria-pressed={forcesOn}
                    onClick={() => {
                      closeDrawMode();
                      setForcesOn((v) => {
                        if (v) setDecomposeOn(false);
                        return !v;
                      });
                    }}
                    title="在画布上显示物体受力矢量"
                  >
                    <ArrowUpRight size={13} strokeWidth={2} />
                    <span>受力</span>
                  </button>
                  <button
                    type="button"
                    className="tool-toggle"
                    aria-pressed={decomposeOn}
                    disabled={!forcesOn}
                    onClick={() => {
                      closeDrawMode();
                      setDecomposeOn((v) => !v);
                    }}
                    title={forcesOn ? "正交分解受力矢量" : "请先开启「受力」"}
                  >
                    <GitFork size={13} strokeWidth={2} />
                    <span>分解</span>
                  </button>
                  <button
                    type="button"
                    className="tool-toggle"
                    aria-pressed={annotationMode === "draw"}
                    onClick={() => setAnnotationMode((m) => (m === "draw" ? "off" : "draw"))}
                    title="在画布上自由标注"
                  >
                    <Pencil size={13} strokeWidth={2} />
                    <span>标注{strokes.length > 0 ? ` (${strokes.length})` : ""}</span>
                  </button>
                  <AnnotationPalette
                    mode={annotationMode}
                    color={annotationColor}
                    onColorChange={setAnnotationColor}
                    onClear={() => setStrokes([])}
                    canClear={strokes.length > 0}
                  />
                  {strokes.length > 0 && annotationMode !== "draw" && (
                    <button
                      type="button"
                      className="tool-toggle tool-clear"
                      onClick={() => {
                        closeDrawMode();
                        setStrokes([]);
                      }}
                      title="清空画布标注"
                    >
                      <Trash2 size={12} strokeWidth={2} />
                      <span>清空</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="tool-toggle"
                    aria-pressed={annotationMode === "laser"}
                    onClick={() => setAnnotationMode((m) => (m === "laser" ? "off" : "laser"))}
                    title="临时标注（松手后自动渐隐）"
                  >
                    <Pointer size={13} strokeWidth={2} />
                    <span>临时标注</span>
                  </button>
                  <button
                    type="button"
                    className="tool-toggle"
                    aria-label="截图"
                    aria-pressed={screenshotMode}
                    onClick={() => {
                      closeDrawMode();
                      setScreenshotMode((v) => !v);
                    }}
                    title="框选动画工作区并复制 PNG 到剪贴板（Esc 取消）"
                  >
                    <Crop size={13} strokeWidth={2} />
                    <span>截图</span>
                  </button>
                  <button
                    type="button"
                    className="tool-toggle"
                    aria-pressed={practiceOn}
                    disabled={samplePractice.length === 0}
                    onClick={() => {
                      closeDrawMode();
                      setPracticeOn((v) => !v);
                      setRevealed(false);
                    }}
                    title={samplePractice.length > 0 ? "先预测再播放动画验证" : "当前题目暂无预测练习"}
                  >
                    <ClipboardCheck size={13} strokeWidth={2} />
                    <span>练习</span>
                  </button>
                </div>
              )}
              <button
                type="button"
                className="meta-toggle tool-toggle"
                aria-expanded={metaOpen}
                aria-controls="player-meta"
                onClick={() => {
                  closeDrawMode();
                  setMetaOpen((open) => !open);
                }}
                title="展开或收起路段与计时详情"
              >
                <span>路段·计时</span>
                <ChevronDown size={13} strokeWidth={2} className="chev" />
              </button>
              {motion && (() => {
                const badge = buildCurrentStageBadge(
                  activeSegment,
                  stagePlan,
                  legacyReading?.conditions.kineticFrictionCoefficient,
                );
                if (!badge) return null;
                return (
                  <div
                    className="current-stage-badge"
                    role="status"
                    aria-live="polite"
                    aria-label={`当前路段：${badge.fullLabel}`}
                    title={badge.fullLabel}
                  >
                    <b className="current-stage-code">{badge.code}</b>
                    <span className="current-stage-name">{badge.name}</span>
                    {badge.frictionText && <span className="current-stage-mu">· {badge.frictionText}</span>}
                  </div>
                );
              })()}
            </div>
            <div id="player-meta" className={`player-meta${metaOpen ? "" : " is-collapsed"}`}>
              {motion?.timing && <div className="notice info" role="status"><span>{motion.timing.mode === "full" ? "全程精确播放" : motion.timing.mode === "suffix" ? "前段示意 · 从B精确计时" : "仅展示已知状态 · 用时未知"}：{motion.timing.reason}
                {motion.calculations?.map(c => <span key={c.quantity}>　{{ initial_elastic_energy: "初始弹性势能", release_speed: "脱离速度", arc_entry_speed: "入弧速度" }[c.quantity] ?? c.quantity} = {Number(c.value.toPrecision(6))} {c.unit}（{c.source === "derived" ? "物理推导" : "题设/用户给定"}）</span>)}</span></div>}
              {motion?.motionStatus&&<div className="notice info" role="status"><span>{motion.motionStatus.state==='model_limit'?'有限求解范围':motion.motionStatus.state==='range_end'?'播放范围终点':'真实静止结局'}：{motion.motionStatus.message}</span></div>}
              {motion?.primaryBodyId&&<label className="body-tracking">跟踪物体<select aria-label="跟踪物体" value={trackedBodyId??motion.primaryBodyId} onChange={e=>setTrackedBodyId(e.target.value)}>{motion.stageGeometry?.bodies?.map(b=><option value={b.bodyId} key={b.bodyId}>{b.bodyId}</option>)}</select><span>{(motion.stageGeometry?.bodies?.length??0)>1?'两物体共用同一物理时间':'物体与绳共用同一物理时间'}</span></label>}
              {motion?.primaryBodyId && (
                <MultiBodyReadouts motion={motion} time={currentTime} isPlaying={isPlaying} />
              )}
            </div>
          </div>
          <div className={'canvas-frame'+(motion?.primaryBodyId?' body-canvas-frame':'')} ref={frameBoxRef}>
            {motion ? (
              <div className={'canvas-stack'+(masked ? ' is-blinded' : '')}>
                <PhysicsCanvas
                  motion={motion}
                  time={currentTime}
                  isPlaying={isPlaying}
                  trackedBodyId={trackedBodyId}
                  readouts={false}
                  forces={forcesOn}
                  decompose={decomposeOn}
                />
              </div>
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
            {motion && (
              <AnnotationLayer
                width={frameSize.w}
                height={frameSize.h}
                time={currentTime}
                mode={annotationMode}
                strokes={strokes}
                onChange={setStrokes}
                color={annotationColor}
              />
            )}
            {masked && (
              <div className="practice-mask">
                <PracticePanel
                  items={samplePractice}
                  onReveal={() => {
                    setRevealed(true);
                    ws.replay();
                  }}
                />
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
                defaultPace={defaultPace}
                paceEnabled={paceEnabled}
                onPaceEnabledChange={setPaceEnabled}
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

      <RegionScreenshotOverlay
        active={screenshotMode}
        containerRef={playerPaneRef}
        onCancel={() => setScreenshotMode(false)}
        onSelect={handleRegionCapture}
      />

      {shotToast && (
        <div
          className={`region-shot-toast${shotToast.kind === "error" ? " is-error" : ""}`}
          data-screenshot-exclude="true"
          role={shotToast.kind === "error" ? "alert" : "status"}
        >
          <span>{shotToast.text}</span>
          {shotToast.kind === "error" && shotToast.blob && (
            <button
              type="button"
              className="region-shot-save-btn"
              onClick={() => {
                downloadBlob(`${sampleTitle}-截图.png`, shotToast.blob!);
                setShotToast(null);
              }}
            >
              保存 PNG
            </button>
          )}
          <button
            type="button"
            className="region-shot-dismiss"
            aria-label="关闭截图提示"
            onClick={() => setShotToast(null)}
          >
            <X size={14} strokeWidth={2.2} />
          </button>
        </div>
      )}
    </>
  );
}
