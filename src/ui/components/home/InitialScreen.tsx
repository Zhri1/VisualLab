import { useEffect, useRef, useState } from "react";
// 组件只负责输入态，识别与状态机在 useWorkspace
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "../../../config/brand";
import type { Notice } from "../../../hooks/useWorkspace";
import { ImageCropDialog } from "./ImageCropDialog";
import { PromptComposer } from "./PromptComposer";
import { SampleCard } from "./SampleCard";
import { loadHomeDraft, makeRecent, pushRecent, saveHomeDraft } from "./homeDraft";
import type { RecentProblem } from "./homeDraft";
import {
  checkImageFile,
  cropImageFile,
  dataUrlToFile,
  prepareImageFile,
  readFileAsDataUrl,
  rotateImageFile,
} from "./imageTools";
import type { CropRect } from "./imageTools";

interface Props {
  busy: boolean;
  notice: Notice | null;
  onSubmit: (input: { file: File | null; text: string }) => void;
  onSample: () => void;
}

/** 文字模式的可点样例：覆盖模板必需字段，减少“缺项/不支持”。 */
const TEXT_EXAMPLES = [
  {
    label: "斜面 + 弹簧",
    text: "质量 1 kg 的滑块从倾角 37°、长 4 m 的斜面顶端由静止下滑，动摩擦因数 0.5；水平段光滑，与劲度系数 400 N/m 的弹簧碰撞并压缩，求最大压缩量。",
  },
  {
    label: "换一组参数",
    text: "质量 2 kg，斜面倾角 30°，斜面长 3 m，动摩擦因数 0.2，弹簧劲度系数 200 N/m，水平段无摩擦。",
  },
];

/** 小于该体积的题图才写入最近记录（避免 localStorage 超限）。 */
const RECENT_IMAGE_BYTES = 240_000;

export function InitialScreen({ busy, notice, onSubmit, onSample }: Props) {
  const [initial] = useState(() => loadHomeDraft());
  const [text, setText] = useState(initial.text);
  const [recents, setRecents] = useState<RecentProblem[]>(initial.recents);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  useEffect(() => {
    saveHomeDraft({ text, recents });
  }, [text, recents]);

  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const replacePreview = (next: File) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(next);
    previewRef.current = url;
    setPreviewUrl(url);
    setFile(next);
  };

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
      replacePreview(await prepareImageFile(next));
    } catch {
      setLocalError("图片处理失败，请换一张图片重试");
    } finally {
      setPreparing(false);
    }
  };

  const rotate = async (direction: "left" | "right") => {
    if (!file || busy || preparing) return;
    setLocalError(null);
    setPreparing(true);
    try {
      replacePreview(await rotateImageFile(file, direction === "left" ? 270 : 90));
    } catch {
      setLocalError("旋转失败，请换一张图片重试");
    } finally {
      setPreparing(false);
    }
  };

  const applyCrop = async (rect: CropRect) => {
    setCropOpen(false);
    if (!file) return;
    setPreparing(true);
    setLocalError(null);
    try {
      replacePreview(await cropImageFile(file, rect));
    } catch {
      setLocalError("裁剪失败，请换一张图片重试");
    } finally {
      setPreparing(false);
    }
  };

  const rememberRecent = (trimmed: string) => {
    const label = trimmed ? trimmed.slice(0, 24) : (file?.name ?? "题图");
    const entry = makeRecent({ label, text: trimmed });
    const nextRecents = pushRecent({ text: trimmed, recents }, entry).recents;
    setRecents(nextRecents);
    saveHomeDraft({ text: trimmed, recents: nextRecents });

    if (file && file.size <= RECENT_IMAGE_BYTES) {
      void readFileAsDataUrl(file)
        .then((dataUrl) => {
          const withImage = nextRecents.map((item) =>
            item.id === entry.id ? { ...item, imageDataUrl: dataUrl } : item,
          );
          setRecents(withImage);
          saveHomeDraft({ text: trimmed, recents: withImage });
        })
        .catch(() => {
          /* 缩略数据保存失败不影响识别 */
        });
    }
  };

  const submit = () => {
    if (busy || preparing) return;
    const trimmed = text.trim();
    if (!trimmed && !file) return;
    rememberRecent(trimmed);
    onSubmit({ file, text: trimmed });
  };

  const restoreRecent = async (item: RecentProblem) => {
    setLocalError(null);
    setText(item.text);
    if (item.imageDataUrl) {
      try {
        replacePreview(await dataUrlToFile(item.imageDataUrl, `recent-${item.id}.png`));
      } catch {
        setLocalError("这张历史图片无法恢复，请重新上传");
      }
    } else {
      clearPreview();
    }
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>(".composer-text")?.focus();
    });
  };

  const showChips = !file && !text.trim();

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
          onRotate={(direction) => {
            void rotate(direction);
          }}
          onCrop={() => setCropOpen(true)}
        />

        {(preparing || busy) && (
          <div className="recognizing" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <span>{preparing ? "正在处理图片…" : "正在识别题目…"}</span>
            {busy && elapsed > 0 && (
              <span className="recognizing-time" aria-hidden="true">
                {elapsed}s
              </span>
            )}
            {busy && elapsed >= 15 && (
              <span className="recognizing-hint">仍在识别，网络较慢时可稍后重试</span>
            )}
          </div>
        )}

        {!preparing && !busy && notice && (
          <div
            className={`notice ${notice.kind} notice-card`}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            <div className="notice-body">
              <span>{notice.text}</span>
              {notice.fieldErrors && notice.fieldErrors.length > 0 && (
                <ul className="notice-fields">
                  {notice.fieldErrors.slice(0, 4).map((error) => (
                    <li key={`${error.code}-${error.message}`}>{error.message}</li>
                  ))}
                </ul>
              )}
              {notice.showSample && (
                <button className="link" onClick={onSample}>
                  用内置示例
                </button>
              )}
            </div>
            {notice.kind === "error" && (
              <div className="notice-actions">
                <button className="ghost-button" onClick={submit} disabled={busy}>
                  重试
                </button>
              </div>
            )}
          </div>
        )}

        {!preparing && !busy && !notice && <SampleCard onClick={onSample} disabled={busy} />}

        {showChips && (
          <div className="text-samples">
            <span className="text-samples-label">没有题图？试试</span>
            {TEXT_EXAMPLES.map((example) => (
              <button
                key={example.label}
                type="button"
                className="text-chip"
                onClick={() => {
                  setText(example.text);
                  window.requestAnimationFrame(() => {
                    document.querySelector<HTMLTextAreaElement>(".composer-text")?.focus();
                  });
                }}
              >
                {example.label}
              </button>
            ))}
          </div>
        )}

        <ol className="home-steps" aria-label="使用步骤">
          <li>
            <span className="home-step-index">1</span>上传题图或粘贴题干
          </li>
          <li>
            <span className="home-step-index">2</span>核对条件、补齐缺项
          </li>
          <li>
            <span className="home-step-index">3</span>播放动画、看关键事件
          </li>
        </ol>

        {recents.length > 0 && (
          <div className="home-recents">
            <span className="home-recents-label">最近</span>
            {recents.map((item) => (
              <button
                key={item.id}
                type="button"
                className="recent-chip"
                onClick={() => {
                  void restoreRecent(item);
                }}
                title={item.text || item.label}
              >
                {item.imageDataUrl ? "图 · " : ""}
                {item.label || "题图"}
              </button>
            ))}
          </div>
        )}

        <details className="home-capabilities">
          <summary>支持范围与隐私</summary>
          <p>
            支持「斜面 → 水平 → 弹簧」以及多阶段组合（含竖直圆弧、抛体）；暂不支持电磁、光学等题型。
          </p>
          <p>题图只用于本次识别请求，不会被本站持久保存；最近记录仅存在你的浏览器本地。</p>
        </details>

        <p className="home-note">
          支持 JPG / PNG 单题图片（≤8MB）· 支持斜面→弹簧及多阶段组合
        </p>
      </div>

      {cropOpen && previewUrl && (
        <ImageCropDialog
          previewUrl={previewUrl}
          onCancel={() => setCropOpen(false)}
          onConfirm={(rect) => {
            void applyCrop(rect);
          }}
        />
      )}
    </main>
  );
}