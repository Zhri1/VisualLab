import { useEffect, useRef } from "react";
import { ArrowUp, ImagePlus, X } from "lucide-react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  file: File | null;
  previewUrl: string | null;
  onPickFile: (f: File | null) => void;
  busy: boolean;
}

export function PromptComposer({
  value,
  onChange,
  onSubmit,
  file,
  previewUrl,
  onPickFile,
  busy,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(84, Math.min(220, el.scrollHeight))}px`;
  };

  const canSubmit = (value.trim().length > 0 || Boolean(file)) && !busy;

  return (
    <div className="composer">
      <textarea
        ref={textareaRef}
        className="composer-text"
        placeholder="输入物理问题，或上传一道题目…"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          resize();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (canSubmit) onSubmit();
          }
        }}
        disabled={busy}
      />

      {previewUrl && file && (
        <div className="composer-preview">
          <img src={previewUrl} alt="题图预览" />
          <span className="name">{file.name}</span>
          <button onClick={() => onPickFile(null)} aria-label="移除图片">
            <X size={13} strokeWidth={2.2} />
          </button>
        </div>
      )}

      <div className="composer-row">
        <button
          className="attach-button"
          onClick={() => fileRef.current?.click()}
          aria-label="上传题目图片"
          title="上传 JPG / PNG 题图"
          disabled={busy}
        >
          <ImagePlus size={19} strokeWidth={1.7} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (f) onPickFile(f);
            e.target.value = "";
          }}
        />
        <button
          className="send-button"
          onClick={onSubmit}
          disabled={!canSubmit}
          aria-label="开始识别"
        >
          <ArrowUp size={19} strokeWidth={2.1} color="#fff" />
        </button>
      </div>
    </div>
  );
}
