import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, Film, FileText, Image as ImageIcon, Sparkles } from "lucide-react";
import type { Motion } from "../../types";
import { capturePng, downloadBlob, recordCanvasWebM } from "./capture";
import { encodeGif, type GifFrame } from "./gifEncoder";
import { PrintSheet, type PrintFrame } from "./PrintSheet";

interface Props {
  getCanvas: () => HTMLCanvasElement | null;
  motion: Motion;
  title: string;
  problemText: string;
  /** 预计墙钟时长（含慢放），用于录视频 */
  wallMs: number;
  onSeek: (t: number) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取截图失败"));
    reader.readAsDataURL(blob);
  });

/** 导出下拉菜单：PNG 关键帧 / WebM 全过程 / GIF 关键帧 / 打印讲义（PDF）。 */
export function ExportMenu({ getCanvas, motion, title, problemText, wallMs, onSeek }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frames, setFrames] = useState<PrintFrame[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const events = motion.events.slice(0, 6);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const scaled = (canvas: HTMLCanvasElement, width = 480) => {
    const off = document.createElement("canvas");
    const ratio = canvas.height / canvas.width;
    off.width = width;
    off.height = Math.max(1, Math.round(width * ratio));
    const ctx = off.getContext("2d")!;
    ctx.drawImage(canvas, 0, 0, off.width, off.height);
    return off;
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setOpen(false);
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const png = () =>
    run("png", async () => {
      const canvas = getCanvas();
      if (!canvas) throw new Error("画布未就绪");
      downloadBlob(`${title}.png`, await capturePng(canvas));
    });

  const webm = () =>
    run("webm", async () => {
      const canvas = getCanvas();
      if (!canvas) throw new Error("画布未就绪");
      downloadBlob(`${title}.webm`, await recordCanvasWebM(canvas, Math.max(1000, wallMs)));
    });

  const gif = () =>
    run("gif", async () => {
      const canvas = getCanvas();
      if (!canvas) throw new Error("画布未就绪");
      const frames: GifFrame[] = [];
      for (const e of events) {
        onSeek(e.timeSeconds);
        await sleep(160);
        const off = scaled(canvas);
        const img = off.getContext("2d")!.getImageData(0, 0, off.width, off.height);
        frames.push({ data: img.data, width: off.width, height: off.height, delayMs: 600 });
      }
      downloadBlob(`${title}.gif`, new Blob([encodeGif(frames) as unknown as BlobPart], { type: "image/gif" }));
    });

  const print = () =>
    run("print", async () => {
      const canvas = getCanvas();
      if (!canvas) throw new Error("画布未就绪");
      const picked: PrintFrame[] = [];
      for (const e of events.slice(0, 4)) {
        onSeek(e.timeSeconds);
        await sleep(160);
        picked.push({ timeSeconds: e.timeSeconds, label: e.label, dataUrl: await blobToDataUrl(await capturePng(canvas)) });
      }
      setFrames(picked);
      await sleep(80);
      window.print();
    });

  const busyLabel =
    busy === "webm" ? "录制中…" : busy === "gif" ? "生成 GIF…" : busy === "print" ? "准备讲义…" : busy ? "导出中…" : "导出";

  return (
    <div className="export-menu" ref={wrapRef} role="group" aria-label="导出">
      <button
        type="button"
        className="ghost-button export-trigger"
        disabled={busy !== null}
        aria-label={busyLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        title="导出截图、视频、GIF 或打印讲义"
      >
        <Download size={14} strokeWidth={1.8} />
        <span className="btn-label">{busyLabel}</span>
        <ChevronDown size={13} strokeWidth={2} className={open ? "export-chev is-open" : "export-chev"} />
      </button>

      {open && (
        <div className="export-popover" role="menu" aria-label="导出格式">
          <button type="button" role="menuitem" className="export-item" onClick={png}>
            <ImageIcon size={14} strokeWidth={1.8} />
            <span>保存 PNG 关键帧</span>
          </button>
          <button type="button" role="menuitem" className="export-item" onClick={webm}>
            <Film size={14} strokeWidth={1.8} />
            <span>录制 WebM 视频</span>
          </button>
          <button type="button" role="menuitem" className="export-item" onClick={gif}>
            <Sparkles size={14} strokeWidth={1.8} />
            <span>导出 GIF 动图</span>
          </button>
          <button type="button" role="menuitem" className="export-item" onClick={print}>
            <FileText size={14} strokeWidth={1.8} />
            <span>打印讲义（PDF）</span>
          </button>
        </div>
      )}

      {error && <span className="export-error" role="alert">{error}</span>}
      <PrintSheet title={title} problemText={problemText} frames={frames} formulas={motion.segments.map((s) => s.formula).filter(Boolean)} />
    </div>
  );
}
