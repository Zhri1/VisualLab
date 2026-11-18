import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
// 组件只负责输入态，识别与状态机在 useWorkspace
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "../../../config/brand";
import type { Notice } from "../../../hooks/useWorkspace";
import { PromptComposer } from "./PromptComposer";

interface Props {
  busy: boolean;
  notice: Notice | null;
  onSubmit: (input: { file: File | null; text: string }) => void;
  onSample: () => void;
}

export function InitialScreen({ busy, notice, onSubmit, onSample }: Props) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const pickFile = (f: File | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    if (!f) {
      previewRef.current = null;
      setPreviewUrl(null);
      setFile(null);
      return;
    }
    const url = URL.createObjectURL(f);
    previewRef.current = url;
    setPreviewUrl(url);
    setFile(f);
  };

  const submit = () => {
    if (busy) return;
    if (!text.trim() && !file) return;
    onSubmit({ file, text });
  };

  return (
    <main className="home">
      <div className="home-inner">
        <h1 className="wordmark">{PRODUCT_NAME}</h1>
        <p className="tagline">{PRODUCT_TAGLINE}</p>

        <PromptComposer
          value={text}
          onChange={setText}
          onSubmit={submit}
          file={file}
          previewUrl={previewUrl}
          onPickFile={pickFile}
          busy={busy}
        />

        {busy ? (
          <div className="recognizing">
            <span className="spinner" />
            正在识别题目…
          </div>
        ) : notice ? (
          <div
            className={`notice ${notice.kind}`}
            style={{ marginTop: 20, textAlign: "left", maxWidth: 560, marginInline: "auto" }}
          >
            <span>{notice.text}</span>
            {notice.showSample && (
              <button className="link" onClick={onSample} style={{ marginLeft: "auto" }}>
                用内置示例
              </button>
            )}
          </div>
        ) : (
          <button className="sample-button" onClick={onSample} disabled={busy}>
            内置示例
            <ArrowRight size={15} strokeWidth={2} />
          </button>
        )}

        <p className="home-note">支持 JPG / PNG 单题图片 · 首版覆盖「斜面 → 弹簧」组合</p>
      </div>
    </main>
  );
}
