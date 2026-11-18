/**
 * 与播放时间同步的物理解释。
 * 优先展示当前阶段；若刚经过某个事件，则展示该事件的字幕。
 *
 * 排版分三层：交代「在第几段」（小标签）、「正在发生什么」（标题）、
 * 「为什么」（正文）；公式单独成栏，与正文之间只用一条分隔线区隔，
 * 避免公式框和正文框互相争抢边界。
 */
import type { Motion } from "../../../types";

interface Props {
  motion: Motion;
  time: number;
}

/**
 * 只做显示用的公式排版，不参与计算。
 * 数学惯例：变量斜体、函数名正体（sin / cos / tan / ln…），
 * 所以先排除函数名再做斜体，否则整串会斜成一片、失去可读的对比。
 */
const FUNCTIONS = new Set(["sin", "cos", "tan", "cot", "ln", "log", "exp", "min", "max"]);

function Formula({ text }: { text: string }) {
  const parts = text.split(/([A-Za-zα-ωΑ-Ωθμ]+)/g);
  return (
    <span>
      {parts.map((p, i) => {
        const isVar = /^[A-Za-zα-ωΑ-Ωθμ]+$/.test(p) && p.length <= 3;
        if (!isVar) return <span key={i}>{p}</span>;
        return FUNCTIONS.has(p) ? (
          <span className="fn" key={i}>
            {p}
          </span>
        ) : (
          <i key={i}>{p}</i>
        );
      })}
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
    <div className={"explain" + (recent ? " is-event" : "")}>
      <div className="explain-main">
        <div className="explain-meta">
          <span className="stage-pill">
            阶段 {segIndex}<span className="slash">/</span>{motion.segments.length}
          </span>
          {recent && <span className="event-flag">关键事件</span>}
        </div>
        <p className="stage-name">{recent ? recent.label : seg.name}</p>
        <p className="stage-desc">{recent ? recent.caption : seg.summary}</p>
      </div>
      <div className="formula" title={seg.formula}>
        <Formula text={seg.formula} />
      </div>
    </div>
  );
}
