import { useRef, type ClipboardEvent, type RefObject } from "react";
import { ArrowUp, ImagePlus, X } from "lucide-react";
import { extractClipboardImage } from "../home/imageTools";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
  inputRef?: RefObject<HTMLTextAreaElement>;
  onImagePick: (file: File) => void;
  file?: File | null;
  previewUrl?: string | null;
  onClearImage?: () => void;
  error?: string | null;
  preparing?: boolean;
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
  inputRef,
  onImagePick,
  file,
  previewUrl,
  onClearImage,
  error,
  preparing,
}: Props) {
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? fallbackRef;
  const fileRef = useRef<HTMLInputElement | null>(null);

  const locked = Boolean(disabled) || Boolean(preparing);
  const canSend = (value.trim().length > 0 || Boolean(file)) && !locked;

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(120, el.scrollHeight)}px`;
  };

  const handlePaste = (event: ClipboardEvent) => {
    if (locked) return;
    const pasted = extractClipboardImage(event.clipboardData);
    if (!pasted) return;
    event.preventDefault();
    onImagePick(pasted);
  };

  return (
    <div className="chat-input-wrap" onPaste={handlePaste}>
      <textarea
        ref={textareaRef}
        className="chat-input"
        placeholder={
          file
            ? "可补充题干文字，点击发送将按新题识图…"
            : (placeholder ?? "提问或修改物理条件，也可粘贴题图…")
        }
        rows={1}
        value={value}
        disabled={locked}
        onChange={(e) => {
          onChange(e.target.value);
          resize();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
      />
      {previewUrl && file && (
        <div className="chat-preview-bar">
          <div className="composer-preview chat-preview">
            <img src={previewUrl} alt="待识别题图预览" />
            <span className="name" title={file.name}>
              {file.name}
            </span>
            {onClearImage && (
              <button
                type="button"
                onClick={onClearImage}
                disabled={locked}
                aria-label="移除图片"
                title="移除图片"
              >
                <X size={13} strokeWidth={2.2} />
              </button>
            )}
          </div>
          <span className="chat-preview-hint">
            {preparing ? "正在处理图片…" : "发送后将按新题识图"}
          </span>
        </div>
      )}
      {error && (
        <p className="composer-error chat-composer-error" role="alert">
          {error}
        </p>
      )}
      <div className="chat-input-row">
        <button
          type="button"
          className="attach-button"
          onClick={() => fileRef.current?.click()}
          disabled={locked}
          aria-label="上传图片"
          title="上传 JPG / PNG 题图（也支持直接粘贴）"
        >
          <ImagePlus size={16} strokeWidth={1.8} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImagePick(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="send-button"
          onClick={onSend}
          disabled={!canSend}
          aria-label={file ? "发送并按新题识图" : "发送"}
        >
          <ArrowUp size={16} strokeWidth={2.2} color="#fff" />
        </button>
      </div>
    </div>
  );
}
