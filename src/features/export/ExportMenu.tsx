import { useState } from "react";
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

/** 导出：PNG 关键帧 / WebM 全过程 / GIF 关键帧 / 打印讲义（PDF）。 */
export function ExportMenu({ getCanvas, motion, title, problemText, wallMs, onSeek }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frames, setFrames] = useState<PrintFrame[]>([]);
  const events = motion.events.slice(0, 6);

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

  return (
    <div className="export-menu" role="group" aria-label="导出与分享">
      <button type="button" className="ghost-button" disabled={busy !== null} onClick={png}>存图</button>
      <button type="button" className="ghost-button" disabled={busy !== null} onClick={webm}>{busy === "webm" ? "录制中…" : "录视频"}</button>
      <button type="button" className="ghost-button" disabled={busy !== null} onClick={gif}>{busy === "gif" ? "生成中…" : "GIF"}</button>
      <button type="button" className="ghost-button" disabled={busy !== null} onClick={print}>讲义</button>
      {error && <span className="export-error" role="alert">{error}</span>}
      <PrintSheet title={title} problemText={problemText} frames={frames} formulas={motion.segments.map((s) => s.formula).filter(Boolean)} />
    </div>
  );
}
