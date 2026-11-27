import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import type { Motion } from "../../../types";
import { EventTimeline } from "./EventTimeline";
import { formatPace } from "./playback";

export const PLAYBACK_RATES = [0.25, 0.5, 1, 2] as const;

export interface RatePopoverLayout {
  placement: "top" | "bottom";
  left: number;
  top?: number;
  bottom?: number;
  minWidth: number;
}

const POPOVER_GAP = 6;
const POPOVER_MARGIN = 8;
const POPOVER_ESTIMATED_HEIGHT = 152;
const POPOVER_MIN_WIDTH = 96;

/** 根据触发按钮视口位置计算倍率浮层的固定定位，移动端及底部空间不足时优先向上展开。 */
export function computeRatePopoverLayout(
  anchor: Pick<DOMRect, "left" | "top" | "bottom" | "width">,
  viewportWidth: number,
  viewportHeight: number,
): RatePopoverLayout {
  const minWidth = Math.max(Math.ceil(anchor.width), POPOVER_MIN_WIDTH);
  const spaceAbove = anchor.top - POPOVER_MARGIN;
  const spaceBelow = viewportHeight - anchor.bottom - POPOVER_MARGIN;
  const preferTop = viewportWidth <= 760 || spaceBelow < POPOVER_ESTIMATED_HEIGHT + POPOVER_GAP;
  const placement: "top" | "bottom" =
    preferTop && (spaceAbove >= POPOVER_ESTIMATED_HEIGHT + POPOVER_GAP || spaceAbove >= spaceBelow)
      ? "top"
      : "bottom";
  const maxLeft = Math.max(POPOVER_MARGIN, viewportWidth - minWidth - POPOVER_MARGIN);
  const left = Math.min(Math.max(POPOVER_MARGIN, anchor.left), maxLeft);

  if (placement === "top") {
    return {
      placement,
      left,
      bottom: Math.max(POPOVER_MARGIN, viewportHeight - anchor.top + POPOVER_GAP),
      minWidth,
    };
  }
  return {
    placement,
    left,
    top: Math.max(POPOVER_MARGIN, anchor.bottom + POPOVER_GAP),
    minWidth,
  };
}

interface Props {
  motion: Motion;
  time: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onReplay: () => void;
  onNextEvent: () => void;
  onSeek: (t: number) => void;
  onSeekEvent: (id: string) => void;
  onScrubStart: () => void;
  playbackRate: number;
  defaultPace?: number;
  paceEnabled?: boolean;
  onPaceEnabledChange?: (enabled: boolean) => void;
  onRateChange: (rate: number) => void;
  autoPauseEvents: boolean;
  onAutoPauseChange: (enabled: boolean) => void;
  segmentName?: string;
  onSlowSegment: () => void;
  onExitSegment: () => void;
}

export function PlaybackControls({
  motion,
  time,
  isPlaying,
  onTogglePlay,
  onReplay,
  onNextEvent,
  onSeek,
  onSeekEvent,
  onScrubStart,
  playbackRate,
  defaultPace = 1,
  paceEnabled = true,
  onPaceEnabledChange,
  onRateChange,
  autoPauseEvents,
  onAutoPauseChange,
  segmentName,
  onSlowSegment,
  onExitSegment,
}: Props) {
  const unavailable=motion.timing?.mode==='state_only'||!!motion.primaryBodyId&&motion.durationSeconds===0;
  const effectivePace = playbackRate * (paceEnabled ? defaultPace : 1);
  const paceAdjusted = paceEnabled && Math.abs(defaultPace - 1) > 1e-6;
  const modeStatusText = segmentName
    ? `本段慢放 · ${segmentName} · 段末停止${paceAdjusted ? `（物理流速 ${formatPace(effectivePace)}×）` : ""}`
    : paceAdjusted
      ? `默认已按观看节奏${defaultPace < 1 ? "放慢" : "调快"}至 ${formatPace(defaultPace)}× 物理时间${playbackRate !== 1 ? `（当前 ${formatPace(effectivePace)}×）` : ""}`
      : "全程播放";

  const [rateOpen, setRateOpen] = useState(false);
  const [popoverLayout, setPopoverLayout] = useState<RatePopoverLayout | null>(null);
  const rateButtonRef = useRef<HTMLButtonElement | null>(null);
  const ratePopoverRef = useRef<HTMLDivElement | null>(null);
  const rateOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pendingFocusModeRef = useRef<"selected" | "first" | "last" | null>(null);
  const rateListboxId = useId();

  const updatePopoverPosition = useCallback(() => {
    const trigger = rateButtonRef.current;
    if (!trigger) {
      setRateOpen(false);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    if (
      (rect.width === 0 && rect.height === 0) ||
      rect.right < 0 ||
      rect.left > window.innerWidth ||
      rect.bottom < 0 ||
      rect.top > window.innerHeight
    ) {
      setRateOpen(false);
      return;
    }
    setPopoverLayout(computeRatePopoverLayout(rect, window.innerWidth, window.innerHeight));
  }, []);

  const openRatePopover = useCallback((focusMode: "selected" | "first" | "last" = "selected") => {
    const trigger = rateButtonRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setPopoverLayout(computeRatePopoverLayout(rect, window.innerWidth, window.innerHeight));
    pendingFocusModeRef.current = focusMode;
    setRateOpen(true);
  }, []);

  const closeRatePopover = useCallback((restoreFocus: boolean) => {
    setRateOpen(false);
    if (restoreFocus) {
      rateButtonRef.current?.focus();
    }
  }, []);

  const handleSelectRate = useCallback(
    (rate: number) => {
      setRateOpen(false);
      onRateChange(rate);
      rateButtonRef.current?.focus();
    },
    [onRateChange],
  );

  useEffect(() => {
    if (unavailable) setRateOpen(false);
  }, [unavailable]);

  useEffect(() => {
    if (!rateOpen) return;

    const focusMode = pendingFocusModeRef.current ?? "selected";
    pendingFocusModeRef.current = null;
    const selectedIdx = PLAYBACK_RATES.findIndex((rate) => Math.abs(rate - playbackRate) < 1e-6);
    const targetIdx =
      focusMode === "first" ? 0 : focusMode === "last" ? PLAYBACK_RATES.length - 1 : selectedIdx >= 0 ? selectedIdx : 2;
    const rafId = window.requestAnimationFrame(() => {
      rateOptionRefs.current[targetIdx]?.focus();
    });

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (rateButtonRef.current?.contains(target) || ratePopoverRef.current?.contains(target))
      ) {
        return;
      }
      setRateOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRatePopover(true);
      }
    };

    const onViewportChange = () => updatePopoverPosition();

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [rateOpen, playbackRate, closeRatePopover, updatePopoverPosition]);

  const handleRateTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!rateOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      openRatePopover(event.key === "ArrowUp" ? "last" : "first");
    }
  };

  const handleRateListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const activeEl = document.activeElement;
    const currentIdx = rateOptionRefs.current.findIndex((el) => el === activeEl);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % PLAYBACK_RATES.length : 0;
      rateOptionRefs.current[nextIdx]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const prevIdx =
        currentIdx >= 0 ? (currentIdx - 1 + PLAYBACK_RATES.length) % PLAYBACK_RATES.length : PLAYBACK_RATES.length - 1;
      rateOptionRefs.current[prevIdx]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      rateOptionRefs.current[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      rateOptionRefs.current[PLAYBACK_RATES.length - 1]?.focus();
    } else if (event.key === "Tab") {
      setRateOpen(false);
    }
  };

  const ratePopover =
    rateOpen && popoverLayout && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={ratePopoverRef}
            id={rateListboxId}
            className="rate-popover"
            role="listbox"
            aria-label="播放倍率"
            data-placement={popoverLayout.placement}
            style={{
              left: `${popoverLayout.left}px`,
              top: popoverLayout.top !== undefined ? `${popoverLayout.top}px` : undefined,
              bottom: popoverLayout.bottom !== undefined ? `${popoverLayout.bottom}px` : undefined,
              minWidth: `${popoverLayout.minWidth}px`,
            }}
            onKeyDown={handleRateListKeyDown}
          >
            {PLAYBACK_RATES.map((rate, index) => {
              const selected = Math.abs(rate - playbackRate) < 1e-6;
              return (
                <button
                  key={rate}
                  ref={(el) => {
                    rateOptionRefs.current[index] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={selected ? "rate-option is-selected" : "rate-option"}
                  data-rate={rate}
                  onClick={() => handleSelectRate(rate)}
                >
                  <span>{rate}×</span>
                  {selected && <Check size={13} strokeWidth={2.2} className="rate-check" aria-hidden="true" />}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="transport">
      <div className="transport-row">
        <div className="transport-primary">
          <button className="tbtn" onClick={onReplay} title="从头重播" aria-label="从头重播" disabled={unavailable}>
            <RotateCcw size={17} strokeWidth={1.9} />
          </button>

          <button
            className="tbtn primary"
            onClick={onTogglePlay}
            title={isPlaying ? "暂停" : "播放"}
            aria-label={isPlaying ? "暂停" : "播放"}
            disabled={unavailable}
          >
            {isPlaying ? (
              <Pause size={15} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={15} fill="currentColor" strokeWidth={0} style={{ marginLeft: 2 }} />
            )}
          </button>

          <button
            className="tbtn"
            onClick={onNextEvent}
            title="跳到下一关键事件"
            aria-label="跳到下一关键事件"
            disabled={unavailable}
          >
            <SkipForward size={17} strokeWidth={1.9} />
          </button>
        </div>

        {!unavailable && (
          <div className="transport-options" role="group" aria-label="辅助播放选项">
            <button
              ref={rateButtonRef}
              type="button"
              className="transport-pill rate-control"
              aria-label="播放倍率"
              aria-haspopup="listbox"
              aria-expanded={rateOpen}
              aria-controls={rateOpen ? rateListboxId : undefined}
              title="播放倍率"
              onClick={() => (rateOpen ? closeRatePopover(false) : openRatePopover("selected"))}
              onKeyDown={handleRateTriggerKeyDown}
            >
              <span className="rate-value">{playbackRate}×</span>
              <ChevronDown size={13} strokeWidth={2} className={rateOpen ? "rate-chev is-open" : "rate-chev"} aria-hidden="true" />
            </button>
            {ratePopover}
            <button
              type="button"
              className="transport-pill segment-control"
              aria-pressed={Boolean(segmentName)}
              onClick={segmentName ? onExitSegment : onSlowSegment}
              title={segmentName ? `退出本段慢放（${segmentName}）` : "从当前位置慢放本段，到段末自动暂停"}
            >
              <span className="segment-label">{segmentName ? `退出 · ${segmentName}` : "慢放本段"}</span>
            </button>
            <label
              className={`transport-pill auto-pause-control${autoPauseEvents ? " is-active" : ""}`}
              title="经过每个关键事件时自动暂停"
            >
              <input
                type="checkbox"
                className="player-sr-only"
                checked={autoPauseEvents}
                onChange={(event) => onAutoPauseChange(event.target.checked)}
              />
              <span>关键点暂停</span>
            </label>
            {onPaceEnabledChange && (
              <label
                className={`transport-pill auto-pause-control auto-slow-control${paceEnabled ? " is-active" : ""}`}
                title={
                  paceAdjusted
                    ? `${modeStatusText}；统一缩放时间轴，各物体相对速度不变`
                    : "统一缩放时间轴，各物体相对速度不变；只放慢不加速"
                }
              >
                <input
                  type="checkbox"
                  className="player-sr-only"
                  checked={paceEnabled}
                  onChange={(event) => onPaceEnabledChange(event.target.checked)}
                />
                <span>自动慢放</span>
                {paceAdjusted && <span className="pace-badge">{formatPace(defaultPace)}×</span>}
              </label>
            )}
          </div>
        )}

        <div className="time-readout">
          {motion.timing?.mode === "state_only" ? "已知状态 · 用时未知" : <><b>{time.toFixed(2)}</b> s / {motion.durationSeconds.toFixed(2)} s</>}
        </div>
      </div>

      {motion.timing?.mode !== 'state_only' && <EventTimeline
        motion={motion}
        time={time}
        onSeek={onSeek}
        onSeekEvent={onSeekEvent}
        onScrubStart={onScrubStart}
      />}
      {!unavailable && (
        <p className="playback-mode player-sr-only" role="status">
          {modeStatusText}
        </p>
      )}
    </div>
  );
}
