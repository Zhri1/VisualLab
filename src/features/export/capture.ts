/**
 * 零依赖画布导出工具：PNG 截图、WebM 录屏、Blob 下载、定时帧序列截图。
 * 仅使用浏览器原生 API（canvas.toBlob / captureStream / MediaRecorder / URL.createObjectURL）。
 */

/** 把画布当前内容编码为 PNG Blob；画布被跨域内容污染（tainted）时 reject。 */
export function capturePng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("截取 PNG 失败：canvas.toBlob 返回空（画布可能已被跨域内容污染）"));
        }
      }, "image/png");
    } catch {
      reject(new Error("截取 PNG 失败：画布可能被跨域内容污染（tainted），无法导出像素"));
    }
  });
}

/**
 * 用 canvas.captureStream + MediaRecorder 录制画布为 WebM。
 * 优先 video/webm;codecs=vp9，回退 vp8、裸 webm；均不支持时 reject（中文 message）。
 * 注意：录制期间画布必须持续重绘，captureStream 才会产出新帧。
 */
export async function recordCanvasWebM(
  canvas: HTMLCanvasElement,
  durationMs: number,
  fps = 30,
): Promise<Blob> {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error("录制 WebM 失败：durationMs 必须是非负有限数");
  }
  if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") {
    throw new Error("当前浏览器不支持 canvas.captureStream 或 MediaRecorder，无法录制 WebM");
  }
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(
    (type) => MediaRecorder.isTypeSupported(type),
  );
  if (!mimeType) {
    throw new Error("当前浏览器不支持 WebM（VP9/VP8）视频录制，无法导出 WebM");
  }

  const stream = canvas.captureStream(Math.max(1, Math.round(fps)));
  const stopTracks = (): void => {
    for (const track of stream.getTracks()) track.stop();
  };

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType });
  } catch {
    stopTracks();
    throw new Error("创建 MediaRecorder 失败，当前浏览器无法录制 WebM");
  }

  return new Promise<Blob>((resolve, reject) => {
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => {
      stopTracks();
      reject(new Error("录制 WebM 过程中 MediaRecorder 出错"));
    };
    recorder.onstop = () => {
      stopTracks();
      resolve(new Blob(chunks, { type: mimeType }));
    };
    try {
      recorder.start();
    } catch {
      stopTracks();
      reject(new Error("启动 MediaRecorder 失败，无法录制 WebM"));
      return;
    }
    setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, durationMs);
  });
}

/** 触发浏览器下载：临时 <a download> + ObjectURL，延迟回收以免下载未开始。 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 按给定时间点序列截图：对每个 t 调用 seek(t)，等待 settleMs（默认 100ms）让画面
 * 完成渲染后再 capturePng。seek 应为同步或能在 settleMs 内完成渲染；
 * 若渲染依赖多帧 rAF，请调大 settleMs。
 */
export async function captureFrameSequence(
  canvas: HTMLCanvasElement,
  times: number[],
  seek: (t: number) => void,
  settleMs = 100,
): Promise<{ timeSeconds: number; blob: Blob }[]> {
  const results: { timeSeconds: number; blob: Blob }[] = [];
  for (const timeSeconds of times) {
    seek(timeSeconds);
    await wait(Math.max(0, settleMs));
    const blob = await capturePng(canvas);
    results.push({ timeSeconds, blob });
  }
  return results;
}
