import { useEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, X } from "lucide-react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  file: File | null;
  previewUrl: string | null;
  onPickFile: (f: File | null) => void;
  busy: boolean;
  /** 选图校验/压缩失败的提示 */
  error?: string | null;
  /** 图片正在压缩 */
  preparing?: boolean;
}

export function PromptComposer({
  value,
  onChange,
  onSubmit,
  file,
  previewUrl,
  onPickFile,
  busy,
  error,
  preparing,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(84, Math.min(220, el.scrollHeight))}px`;
  };

  const locked = busy || Boolean(preparing);
  const canSubmit = (value.trim().length > 0 || Boolean(file)) && !locked;

  const handlePaste = (event: React.ClipboardEvent) => {
    if (locked) return;
    const data = event.clipboardData;
    if (!data) return;
    let item: DataTransferItem | null = null;
    for (let index = 0; index < (data.items?.length ?? 0); index += 1) {
      const entry = data.items[index];
      if (entry?.type.startsWith("image/")) {
        item = entry;
        break;
      }
    }
    const pasted = item?.getAsFile() ?? data.files?.[0] ?? null;
    if (pasted && pasted.type.startsWith("image/")) {
      event.preventDefault();
      onPickFile(pasted);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (locked) return;
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) {
      onPickFile(dropped);
      return;
    }
    const text = event.dataTransfer.getData("text/plain");
    if (text.trim()) onChange(value.trim() ? `${value}\n${text}` : text);
  };

  return (
    <div
      className={`composer${dragging ? " is-dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!locked) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={handleDrop}
    >
      <textarea
        ref={textareaRef}
        className="composer-text"
        placeholder="输入物理问题，或上传一道题目…"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          resize();
        }}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // 输入法回车是在确认候选词，不能当作发送
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          // Shift+Enter 换行，便于多行题干
          if (e.shiftKey) return;
          e.preventDefault();
          if (canSubmit) onSubmit();
        }}
        disabled={locked}
      />

      {previewUrl && file && (
        <div className="composer-preview">
          <img src={previewUrl} alt="题图预览" />
          <span className="name" title={file.name}>
            {file.name}
          </span>
          <button onClick={() => onPickFile(null)} aria-label="移除图片" type="button">
            <X size={13} strokeWidth={2.2} />
          </button>
        </div>
      )}

      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}

      <div className="composer-row">
        <button
          className="attach-button"
          onClick={() => fileRef.current?.click()}
          aria-label="上传题目图片"
          title="上传 JPG / PNG 题图"
          disabled={locked}
          type="button"
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
          type="button"
        >
          <ArrowUp size={19} strokeWidth={2.1} color="#fff" />
        </button>
      </div>

      {dragging && <div className="composer-drop">松手即可加入题图</div>}
    </div>
  );
}