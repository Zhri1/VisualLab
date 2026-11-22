import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
// 组件只负责输入态，识别与状态机在 useWorkspace
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "../../../config/brand";
import type { Notice } from "../../../hooks/useWorkspace";
import { PromptComposer } from "./PromptComposer";
import { loadDraftText, saveDraftText } from "./homeDraft";
import { checkImageFile, prepareImageFile } from "./imageTools";

interface Props {
  busy: boolean;
  notice: Notice | null;
  onSubmit: (input: { file: File | null; text: string }) => void;
  onSample: () => void;
}

export function InitialScreen({ busy, notice, onSubmit, onSample }: Props) {
  const [text, setText] = useState(() => loadDraftText());
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  useEffect(() => {
    saveDraftText(text);
  }, [text]);

  const clearPreview = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreviewUrl(null);
    setFile(null);
  };

  const pickFile = async (next: File | null) => {
    setLocalError(null);
    if (!next) {
      clearPreview();
      return;
    }
    const check = checkImageFile(next);
    if (!check.ok) {
      setLocalError(check.message);
      return;
    }
    setPreparing(true);
    try {
      const prepared = await prepareImageFile(next);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      const url = URL.createObjectURL(prepared);
      previewRef.current = url;
      setPreviewUrl(url);
      setFile(prepared);
    } catch {
      setLocalError("图片处理失败，请换一张图片重试");
    } finally {
      setPreparing(false);
    }
  };

  const submit = () => {
    if (busy || preparing) return;
    const trimmed = text.trim();
    if (!trimmed && !file) return;
    onSubmit({ file, text: trimmed });
  };

  return (
    <main className="home">
      <div className="home-inner">
        <h1 className="wordmark">{PRODUCT_NAME}</h1>
        <p className="tagline">{PRODUCT_TAGLINE}</p>

        <PromptComposer
          value={text}
          onChange={(value) => {
            setText(value);
            if (localError) setLocalError(null);
          }}
          onSubmit={submit}
          file={file}
          previewUrl={previewUrl}
          onPickFile={(next) => {
            void pickFile(next);
          }}
          busy={busy}
          error={localError}
          preparing={preparing}
        />

        {busy ? (
          <div className="recognizing" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            正在识别题目…
          </div>
        ) : notice ? (
          <div
            className={`notice ${notice.kind}`}
            style={{ marginTop: 20, textAlign: "left", maxWidth: 560, marginInline: "auto" }}
            role={notice.kind === "error" ? "alert" : "status"}
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

        <p className="home-note">支持 JPG / PNG 单题图片 · 斜面 → 弹簧及多阶段</p>
      </div>
    </main>
  );
}