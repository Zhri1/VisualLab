import { describe, expect, it } from "vitest";
import { checkImageFile, MAX_IMAGE_BYTES } from "../imageTools";

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