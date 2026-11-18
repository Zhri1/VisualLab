/**
 * 联调条：强制切换识别回包类型，用来走查四种页面状态。
 * 仅在开发环境渲染，构建产物里不会出现。
 */
import { useState } from "react";
import { getMockScenario, setMockScenario, type MockScenario } from "../../../services/imageRecognition";

const OPTIONS: { value: MockScenario | null; label: string }[] = [
  { value: null, label: "正常" },
  { value: "needs_input", label: "缺项" },
  { value: "unsupported", label: "超范围" },
  { value: "error", label: "服务失败" },
];

interface Props {
  /** 用当前选中的回包重新走一次识别 */
  onReload: () => void;
  /** 载入内置示例，永远成功 */
  onSample: () => void;
  hasImage: boolean;
}

export function DevBar({ onReload, onSample, hasImage }: Props) {
  const [value, setValue] = useState<MockScenario | null>(getMockScenario());

  if (!import.meta.env.DEV) return null;

  return (
    <div className="dev-bar">
      <span className="label">识别回包</span>
      {OPTIONS.map((o) => (
        <button
          key={o.label}
          className={value === o.value ? "active" : ""}
          onClick={() => {
            setMockScenario(o.value);
            setValue(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
      <button
        onClick={onReload}
        title={hasImage ? "用当前回包重新识别" : "当前没有图片，会走文字识别"}
      >
        重跑
      </button>
      <button onClick={onSample} title="载入内置示例（不受上方开关影响）">
        示例
      </button>
    </div>
  );
}
