/**
 * 与播放时间同步的物理解释。
 * 优先展示当前阶段；若刚经过某个事件，则展示该事件的字幕。
 */
import type { Motion } from "../../../types";

interface Props {
  motion: Motion;
  time: number;
}

/** 只做显示用的公式排版，不参与计算 */
function Formula({ text }: { text: string }) {
  const parts = text.split(/([A-Za-zα-ωΑ-Ωθμω]+)/g);
  return (
    <span>
      {parts.map((p, i) =>
        /^[A-Za-zα-ωΑ-Ωθμω]+$/.test(p) && p.length <= 3 ? <i key={i}>{p}</i> : <span key={i}>{p}</span>
      )}
    </span>
  );
}

export function PhysicsExplanation({ motion, time }: Props) {
  const seg =
    [...motion.segments].reverse().find((s) => time >= s.startSeconds - 1e-6) ??
    motion.segments[0];

  // 事件刚发生后的 0.6 s 内，展示事件字幕而不是阶段说明
  const recent = [...motion.events]
    .reverse()
    .find((e) => time >= e.timeSeconds - 1e-6 && time - e.timeSeconds < 0.6);

  const segIndex = motion.segments.findIndex((s) => s.kind === seg.kind) + 1;

  return (
    <div className="explain">
      <div className="explain-main">
        <div className="explain-row">
          <span className="stage-pill">
            阶段 {segIndex} / {motion.segments.length}
          </span>
          <span className="stage-name">{recent ? recent.label : seg.name}</span>
        </div>
        <div className="stage-desc">{recent ? recent.caption : seg.summary}</div>
      </div>
      <div className="formula" title={seg.formula}>
        <Formula text={seg.formula} />
      </div>
    </div>
  );
}
