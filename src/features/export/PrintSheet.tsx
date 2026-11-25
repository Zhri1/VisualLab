import type { ReactElement } from "react";
import "./print.css";

export interface PrintFrame {
  timeSeconds: number;
  label: string;
  dataUrl: string;
}

/**
 * 打印讲义区块：题面 + 关键帧图网格 + 公式列表。
 * 平时由 print.css 置为 display:none，@media print 时隐藏 .app 其余内容、只显示本区块。
 * 公式按纯文本渲染（零依赖，不引入 KaTeX）。
 */
export function PrintSheet({
  title,
  problemText,
  frames,
  formulas,
}: {
  title: string;
  problemText: string;
  frames: PrintFrame[];
  formulas: string[];
}): ReactElement {
  return (
    <section className="print-sheet">
      <h1 className="print-sheet__title">{title}</h1>
      <p className="print-sheet__problem">{problemText}</p>
      {frames.length > 0 && (
        <div className="print-sheet__grid">
          {frames.map((frame, index) => (
            <figure className="print-sheet__frame" key={`${frame.timeSeconds}-${index}`}>
              <img src={frame.dataUrl} alt={frame.label} />
              <figcaption>
                {frame.label}（t = {frame.timeSeconds.toFixed(2)} s）
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {formulas.length > 0 && (
        <ul className="print-sheet__formulas">
          {formulas.map((formula, index) => (
            <li key={index}>{formula}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
