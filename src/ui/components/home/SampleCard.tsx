import { ArrowRight } from "lucide-react";

interface Props {
  onClick: () => void;
  disabled?: boolean;
}

/** 示例入口：给一张示意图和一句结果描述，避免“盲盒”按钮。 */
export function SampleCard({ onClick, disabled }: Props) {
  return (
    <button
      type="button"
      className="sample-button sample-card"
      onClick={onClick}
      disabled={disabled}
      aria-label="用内置示例：斜面滑块压缩弹簧"
    >
      <svg className="sample-card-art" viewBox="0 0 120 72" aria-hidden="true">
        <line x1="6" y1="61" x2="114" y2="61" stroke="currentColor" strokeWidth="1.6" opacity="0.35" />
        <polygon points="10,60 56,18 56,60" fill="currentColor" opacity="0.1" />
        <line x1="10" y1="60" x2="56" y2="18" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
        <rect
          x="34"
          y="32"
          width="13"
          height="10"
          rx="2"
          fill="currentColor"
          opacity="0.75"
          transform="rotate(-40 40.5 37)"
        />
        <rect x="58" y="47" width="13" height="13" rx="2" fill="currentColor" opacity="0.75" />
        <path
          d="M72 53.5h4l3-5 4 10 4-10 4 10 4-10 3 5h6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          opacity="0.75"
        />
        <line x1="107" y1="44" x2="107" y2="61" stroke="currentColor" strokeWidth="2.2" opacity="0.55" />
      </svg>
      <span className="sample-card-copy">
        <strong>内置示例</strong>
        <small>斜面滑块压缩弹簧 · 2 m</small>
      </span>
      <ArrowRight size={16} strokeWidth={2} className="sample-card-arrow" />
    </button>
  );
}