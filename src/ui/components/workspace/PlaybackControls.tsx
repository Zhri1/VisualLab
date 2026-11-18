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
}: Props) {
  return (
    <div className="transport">
      <div className="transport-row">
        <button className="tbtn" onClick={onReplay} title="从头重播" aria-label="从头重播">
          <RotateCcw size={17} strokeWidth={1.9} />
        </button>

        <button
          className="tbtn primary"
          onClick={onTogglePlay}
          title={isPlaying ? "暂停" : "播放"}
          aria-label={isPlaying ? "暂停" : "播放"}
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
        >
          <SkipForward size={17} strokeWidth={1.9} />
        </button>

        <div className="time-readout">
          <b>{time.toFixed(2)}</b> s / {motion.durationSeconds.toFixed(2)} s
        </div>
      </div>

      <EventTimeline
        motion={motion}
        time={time}
        onSeek={onSeek}
        onSeekEvent={onSeekEvent}
        onScrubStart={onScrubStart}
      />
    </div>
  );
}
