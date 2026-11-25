import { useState } from "react";
import type { Motion } from "../../types";
import type { SampleQuestion } from "../../data/samples";

interface Props {
  questions: SampleQuestion[];
  motion: Motion;
  onSeek: (t: number) => void;
}

/** 逐问讲解：小问 → 关键时刻 + 方程 + 代入数值。 */
export function QuestionPanel({ questions, motion, onSeek }: Props) {
  const [active, setActive] = useState(0);
  if (!questions.length) return null;
  const q = questions[active];
  const event = q.eventKind ? motion.events.find((e) => (e.eventKind ?? e.id) === q.eventKind) : undefined;
  const time = event?.timeSeconds ?? q.timeSeconds ?? 0;
  return (
    <section className="question-panel" aria-label="逐问讲解">
      <div className="question-tabs">
        {questions.map((item, i) => (
          <button
            key={item.label}
            type="button"
            className="question-tab"
            aria-pressed={i === active}
            onClick={() => {
              setActive(i);
              const ev = item.eventKind ? motion.events.find((e) => (e.eventKind ?? e.id) === item.eventKind) : undefined;
              onSeek(ev?.timeSeconds ?? item.timeSeconds ?? 0);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="question-body">
        <div className="question-formula">{q.formula}</div>
        <div className="question-substitution">{q.substitution}</div>
        <button type="button" className="ghost-button question-jump" onClick={() => onSeek(time)}>
          跳到该问时刻 {time.toFixed(2)} s
        </button>
      </div>
    </section>
  );
}
