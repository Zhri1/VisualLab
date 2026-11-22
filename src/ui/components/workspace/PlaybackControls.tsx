import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import type { Motion } from "../../../types";
import { EventTimeline } from "./EventTimeline";

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
  onRateChange,
  autoPauseEvents,
  onAutoPauseChange,
  segmentName,
  onSlowSegment,
  onExitSegment,
}: Props) {
  return (
    <div className="transport">
      <div className="transport-row">
        <button className="tbtn" onClick={onReplay} title="从头重播" aria-label="从头重播" disabled={motion.timing?.mode === "state_only"}>
          <RotateCcw size={17} strokeWidth={1.9} />
        </button>

        <button
          className="tbtn primary"
          onClick={onTogglePlay}
          title={isPlaying ? "暂停" : "播放"}
          aria-label={isPlaying ? "暂停" : "播放"}
          disabled={motion.timing?.mode === "state_only"}
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
          disabled={motion.timing?.mode === "state_only"}
        >
          <SkipForward size={17} strokeWidth={1.9} />
        </button>

        <div className="time-readout">
          {motion.timing?.mode === "state_only" ? "已知状态 · 用时未知" : <><b>{time.toFixed(2)}</b> s / {motion.durationSeconds.toFixed(2)} s</>}
        </div>
      </div>

      {motion.timing?.mode !== "state_only" && <EventTimeline
        motion={motion}
        time={time}
        onSeek={onSeek}
        onSeekEvent={onSeekEvent}
        onScrubStart={onScrubStart}
      />}
      {motion.timing?.mode !== "state_only" && <div className="playback-auxiliary" aria-label="辅助播放选项">
        <div className="playback-options">
          <label className="rate-control">
            播放倍率
            <select value={playbackRate} onChange={(event) => onRateChange(Number(event.target.value))}>
              {[0.25, 0.5, 1, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
            </select>
          </label>
          <button
            type="button"
            className="segment-control"
            aria-pressed={Boolean(segmentName)}
            onClick={segmentName ? onExitSegment : onSlowSegment}
          >
            {segmentName ? "退出本段" : "慢放本段"}
          </button>
          <label className="auto-pause-control">
            <input type="checkbox" checked={autoPauseEvents} onChange={(event) => onAutoPauseChange(event.target.checked)} />
            关键点自动暂停
          </label>
        </div>
        <p className="playback-mode" role="status">
          {segmentName ? `本段慢放 · ${segmentName} · 段末停止` : "全程播放"}
        </p>
      </div>}
    </div>
  );
}
