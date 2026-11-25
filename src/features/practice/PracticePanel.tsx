import { useState } from "react";

export interface PracticeItem {
  prompt: string;
  options: string[];
  answer: number;
  explain: string;
}

/** 预测—验证：先答再播放；答完揭示并给一句解释。 */
export function PracticePanel({ items, onReveal }: { items: PracticeItem[]; onReveal: () => void }) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  if (!items.length) return null;
  const item = items[idx];
  const correct = submitted && picked === item.answer;
  return (
    <div className="practice-card" role="dialog" aria-label="先预测再播放">
      <div className="practice-head">先预测 · 第 {idx + 1}/{items.length} 题</div>
      <p className="practice-prompt">{item.prompt}</p>
      <div className="practice-options">
        {item.options.map((opt, i) => (
          <button
            key={opt}
            type="button"
            className="practice-option"
            aria-pressed={picked === i}
            disabled={submitted}
            data-correct={submitted && i === item.answer ? "true" : undefined}
            data-wrong={submitted && picked === i && i !== item.answer ? "true" : undefined}
            onClick={() => setPicked(i)}
          >
            {opt}
          </button>
        ))}
      </div>
      {submitted ? (
        <>
          <p className={`practice-verdict ${correct ? "ok" : "no"}`}>{correct ? "预测正确" : "再想想——正确答案已标出"}</p>
          <p className="practice-explain">{item.explain}</p>
          <div className="practice-actions">
            {idx + 1 < items.length && (
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setIdx(idx + 1);
                  setPicked(null);
                  setSubmitted(false);
                }}
              >
                下一题
              </button>
            )}
            <button type="button" className="ghost-button primary" onClick={onReveal}>播放验证</button>
          </div>
        </>
      ) : (
        <div className="practice-actions">
          <button type="button" className="ghost-button primary" disabled={picked === null} onClick={() => setSubmitted(true)}>提交预测</button>
          <button type="button" className="ghost-button" onClick={onReveal}>跳过直接看</button>
        </div>
      )}
    </div>
  );
}
