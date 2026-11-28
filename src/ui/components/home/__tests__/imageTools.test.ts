import { describe, expect, it } from "vitest";
import { checkImageFile, extractClipboardImage, MAX_IMAGE_BYTES } from "../imageTools";

const fileOf = (type: string, size = 16): File =>
  ({ type, size, name: "题图", lastModified: 0 } as File);

describe("checkImageFile", () => {
  it("接受 JPG / PNG", () => {
    expect(checkImageFile(fileOf("image/png"))).toEqual({ ok: true });
    expect(checkImageFile(fileOf("image/jpeg"))).toEqual({ ok: true });
  });

  it("拒绝其它格式并给出提示", () => {
    const result = checkImageFile(fileOf("image/webp"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("JPG / PNG");
  });

  it("拒绝超过 8MB 的图片", () => {
    const result = checkImageFile(fileOf("image/png", MAX_IMAGE_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("8MB");
  });

  it("边界值 8MB 仍可接受", () => {
    expect(checkImageFile(fileOf("image/png", MAX_IMAGE_BYTES))).toEqual({ ok: true });
  });
});

describe("extractClipboardImage", () => {
  it("纯文字粘贴返回 null，不接管原生粘贴", () => {
    const data = {
      items: [{ type: "text/plain", getAsFile: () => null }],
      files: [],
    };
    expect(extractClipboardImage(data)).toBeNull();
  });

  it("从剪贴板 items 提取 PNG 截图并在文件名为空时补默认名", () => {
    const raw = new File([new Uint8Array([1, 2, 3])], "", { type: "image/png" });
    const extracted = extractClipboardImage({
      items: [{ type: "image/png", getAsFile: () => raw }],
      files: [],
    });
    expect(extracted).not.toBeNull();
    expect(extracted?.type).toBe("image/png");
    expect(extracted?.name).toBe("粘贴图片.png");
  });

  it("从 files 回退提取并透传不支持的图片格式以便提示错误", () => {
    const webp = new File([new Uint8Array([1, 2])], "clip.webp", { type: "image/webp" });
    const extracted = extractClipboardImage({ items: [], files: [webp] });
    expect(extracted).toBe(webp);
    expect(checkImageFile(extracted!).ok).toBe(false);
  });
});