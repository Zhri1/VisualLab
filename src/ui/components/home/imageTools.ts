/**
 * 首页图片入口的轻量工具：前置校验与上传前缩放。
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

/**
 * 从标准 paste 事件的 clipboardData 中提取单个图片文件。
 * 仅在存在 image/* 附件时返回 File；纯文字粘贴返回 null，由浏览器原生处理。
 */
export function extractClipboardImage(
  data: {
    items?: ArrayLike<{ type: string; getAsFile: () => File | null }>;
    files?: ArrayLike<File>;
  } | null | undefined,
): File | null {
  if (!data) return null;
  let pasted: File | null = null;
  if (data.items) {
    for (let i = 0; i < data.items.length; i += 1) {
      const entry = data.items[i];
      if (entry?.type.startsWith("image/")) {
        pasted = entry.getAsFile();
        if (pasted) break;
      }
    }
  }
  if (!pasted && data.files) {
    for (let i = 0; i < data.files.length; i += 1) {
      const f = data.files[i];
      if (f && f.type.startsWith("image/")) {
        pasted = f;
        break;
      }
    }
  }
  if (!pasted || !pasted.type.startsWith("image/")) return null;
  if (pasted.name && pasted.name.trim()) return pasted;
  const ext = pasted.type === "image/jpeg" ? "jpg" : pasted.type === "image/png" ? "png" : "img";
  return new File([pasted], `粘贴图片.${ext}`, {
    type: pasted.type,
    lastModified: pasted.lastModified || Date.now(),
  });
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

    const type = outputType(file);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, type === "image/jpeg" ? 0.9 : undefined),
    );
    if (!blob) return file;
    const encoded = new File([blob], file.name, { type, lastModified: Date.now() });
    return encoded.size < file.size ? encoded : file;
  } catch {
    return file;
  } finally {
    decoded.close();
  }
}