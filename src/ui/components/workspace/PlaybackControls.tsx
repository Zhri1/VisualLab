import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import type { Motion } from "../../../types";
import { EventTimeline } from "./EventTimeline";
import { formatPace } from "./playback";

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
            <label className="transport-pill rate-control" title="播放倍率">
              <select
                aria-label="播放倍率"
                value={playbackRate}
                onChange={(event) => onRateChange(Number(event.target.value))}
              >
                {[0.25, 0.5, 1, 2].map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}×
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="transport-pill segment-control"
              aria-pressed={Boolean(segmentName)}
              onClick={segmentName ? onExitSegment : onSlowSegment}
              title={segmentName ? `退出本段慢放（${segmentName}）` : "慢放当前阶段，到段末自动暂停"}
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
