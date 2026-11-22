import { useEffect } from "react";

export interface SampleOption {
  id: string;
  title: string;
  description: string;
}

/** 内置示例清单：后续新增示例只需往这里加条目。 */
export const SAMPLE_OPTIONS: SampleOption[] = [
  {
    id: "incline-spring-2m",
    title: "斜面滑块压缩弹簧",
    description: "倾角 37°，水平段 2 m 后接触弹簧",
  },
];

interface Props {
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function SamplePicker({ onSelect, onClose }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sample-picker-backdrop" onClick={onClose}>
      <div
        className="sample-picker"
        role="dialog"
        aria-modal="true"
        aria-label="选择内置示例"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sample-picker-head">选择内置示例</div>
        <ul className="sample-picker-list">
          {SAMPLE_OPTIONS.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className="sample-option"
                onClick={() => onSelect(option.id)}
              >
                <span className="sample-option-title">{option.title}</span>
                <span className="sample-option-desc">{option.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}