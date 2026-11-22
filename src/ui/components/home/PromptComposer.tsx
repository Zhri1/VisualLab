import { useEffect, useRef, useState } from "react";
import { ArrowUp, Camera, Crop, ImagePlus, RotateCcw, RotateCw, X } from "lucide-react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  file: File | null;
  previewUrl: string | null;
  onPickFile: (f: File | null) => void;
  busy: boolean;
  /** 图片校验/压缩失败的提示 */
  error?: string | null;
  /** 图片正在压缩或旋转 */
  preparing?: boolean;
  onRotate?: (direction: "left" | "right") => void;
  onCrop?: () => void;
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
  onRotate,
  onCrop,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [coarsePointer] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches,
  );

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
        placeholder="粘贴题干或题图，也可以直接拖入图片…"
        aria-label="题目描述或题干"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          resize();
        }}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (canSubmit) onSubmit();
          }
        }}
        disabled={locked}
      />

      {previewUrl && file && (
        <div className="composer-preview">
          <img src={previewUrl} alt="题图预览" />
          <span className="name" title={file.name}>
            {file.name}
          </span>
          <div className="composer-preview-actions">
            {onRotate && (
              <>
                <button
                  type="button"
                  onClick={() => onRotate("left")}
                  aria-label="向左旋转"
                  title="向左旋转"
                  disabled={locked}
                >
                  <RotateCcw size={13} strokeWidth={2.2} />
                </button>
                <button
                  type="button"
                  onClick={() => onRotate("right")}
                  aria-label="向右旋转"
                  title="向右旋转"
                  disabled={locked}
                >
                  <RotateCw size={13} strokeWidth={2.2} />
                </button>
              </>
            )}
            {onCrop && (
              <button
                type="button"
                onClick={onCrop}
                aria-label="裁剪图片"
                title="裁剪"
                disabled={locked}
              >
                <Crop size={13} strokeWidth={2.2} />
              </button>
            )}
            <button
              type="button"
              onClick={() => onPickFile(null)}
              aria-label="移除图片"
              title="移除图片"
              disabled={locked}
            >
              <X size={13} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}

      <div className="composer-row">
        <div className="composer-tools">
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
          {coarsePointer && (
            <button
              className="attach-button"
              onClick={() => cameraRef.current?.click()}
              aria-label="拍照上传"
              title="拍照上传"
              disabled={locked}
              type="button"
            >
              <Camera size={19} strokeWidth={1.7} />
            </button>
          )}
          <span className="composer-hint">可粘贴截图 · 支持 JPG / PNG</span>
        </div>
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
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
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