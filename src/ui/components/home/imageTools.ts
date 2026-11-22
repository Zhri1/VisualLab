/**
 * 首页图片入口的轻量工具：前置校验、上传前缩放、旋转与裁剪。
 * 只在浏览器里跑；识别契约不受影响。
 */

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"] as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** 长边超过该值才缩放，避免把小图放大。 */
export const MAX_IMAGE_EDGE = 1600;
/** 小于该体积且尺寸不超限时保留原图，避免无谓重编码。 */
const KEEP_ORIGINAL_BYTES = 2 * 1024 * 1024;

export type ImageCheck = { ok: true } | { ok: false; message: string };

export function checkImageFile(file: File): ImageCheck {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    return { ok: false, message: "仅支持 JPG / PNG 图片" };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, message: "图片不能超过 8MB，请压缩或换一张" };
  }
  return { ok: true };
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decodeImage(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("image decode failed"));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function outputType(file: File): "image/png" | "image/jpeg" {
  return file.type === "image/png" ? "image/png" : "image/jpeg";
}

async function encodeCanvas(
  canvas: HTMLCanvasElement,
  file: File,
  name = file.name,
): Promise<File> {
  const type = outputType(file);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, type === "image/jpeg" ? 0.9 : undefined),
  );
  if (!blob) throw new Error("canvas encode failed");
  return new File([blob], name, { type, lastModified: Date.now() });
}

/** 超过长边或体积阈值时等比缩小；失败则回退原图，保证识别可用。 */
export async function prepareImageFile(file: File): Promise<File> {
  const check = checkImageFile(file);
  if (!check.ok) throw new Error(check.message);

  let decoded: Decoded;
  try {
    decoded = await decodeImage(file);
  } catch {
    return file;
  }

  try {
    const longest = Math.max(decoded.width, decoded.height);
    if (file.size <= KEEP_ORIGINAL_BYTES && longest <= MAX_IMAGE_EDGE) return file;

    const scale = Math.min(1, MAX_IMAGE_EDGE / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    const encoded = await encodeCanvas(canvas, file);
    return encoded.size < file.size ? encoded : file;
  } catch {
    return file;
  } finally {
    decoded.close();
  }
}

export async function rotateImageFile(file: File, degrees: 90 | 180 | 270): Promise<File> {
  const decoded = await decodeImage(file);
  try {
    const swap = degrees === 90 || degrees === 270;
    const canvas = document.createElement("canvas");
    canvas.width = swap ? decoded.height : decoded.width;
    canvas.height = swap ? decoded.width : decoded.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");

    if (degrees === 90) {
      context.translate(canvas.width, 0);
      context.rotate(Math.PI / 2);
    } else if (degrees === 180) {
      context.translate(canvas.width, canvas.height);
      context.rotate(Math.PI);
    } else {
      context.translate(0, canvas.height);
      context.rotate(-Math.PI / 2);
    }
    context.drawImage(decoded.source, 0, 0);
    return await encodeCanvas(canvas, file);
  } finally {
    decoded.close();
  }
}

export interface CropRect {
  /** 归一化坐标，0–1 */
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function cropImageFile(file: File, rect: CropRect): Promise<File> {
  const decoded = await decodeImage(file);
  try {
    const x = Math.min(Math.max(rect.x, 0), 1);
    const y = Math.min(Math.max(rect.y, 0), 1);
    const width = Math.min(Math.max(rect.width, 0.05), 1 - x);
    const height = Math.min(Math.max(rect.height, 0.05), 1 - y);
    const sx = x * decoded.width;
    const sy = y * decoded.height;
    const sw = Math.max(1, width * decoded.width);
    const sh = Math.max(1, height * decoded.height);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.drawImage(decoded.source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return await encodeCanvas(canvas, file);
  } finally {
    decoded.close();
  }
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: blob.type || "image/png" });
}