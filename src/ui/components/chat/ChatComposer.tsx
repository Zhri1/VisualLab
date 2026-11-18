import { useRef } from "react";
import { ArrowUp, ImagePlus } from "lucide-react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  onImagePick: (file: File) => void;
}

export function ChatComposer({ value, onChange, onSend, disabled, onImagePick }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(120, el.scrollHeight)}px`;
  };

  return (
    <div className="chat-input-wrap">
      <textarea
        ref={textareaRef}
        className="chat-input"
        placeholder="提问或修改物理条件…"
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          resize();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      <div className="chat-input-row">
        <button
          className="attach-button"
          onClick={() => fileRef.current?.click()}
          aria-label="上传图片"
          title="上传图片"
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
          className="send-button"
          onClick={onSend}
          disabled={!value.trim() || disabled}
          aria-label="发送"
        >
          <ArrowUp size={16} strokeWidth={2.2} color="#fff" />
        </button>
      </div>
    </div>
  );
}
