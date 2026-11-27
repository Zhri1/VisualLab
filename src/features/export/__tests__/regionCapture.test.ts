import { describe, it, expect, vi, afterEach } from "vitest";
import { copyPngToClipboard, normalizeDragRect } from "../regionCapture";

describe("框选截图归一化与剪贴板写入", () => {
  const origNavigator = globalThis.navigator;
  const origClipboardItem = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", { value: origNavigator, configurable: true });
    if (origClipboardItem === undefined) {
      delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
    } else {
      Object.defineProperty(globalThis, "ClipboardItem", { value: origClipboardItem, configurable: true });
    }
    vi.restoreAllMocks();
  });

  it("normalizeDragRect 支持正向、反向及对角拖动，并钳制在可见边界内", () => {
    const bounds = { left: 20, top: 60, right: 820, bottom: 660 };
    // 正向拖动
    expect(normalizeDragRect(100, 120, 350, 300, bounds)).toEqual({
      left: 100, top: 120, width: 250, height: 180,
    });
    // 反向拖动（右下到左上）
    expect(normalizeDragRect(420, 380, 120, 140, bounds)).toEqual({
      left: 120, top: 140, width: 300, height: 240,
    });
    // 越界拖出可见区域外应自动钳制
    expect(normalizeDragRect(900, 720, -10, 10, bounds)).toEqual({
      left: 20, top: 60, width: 800, height: 600,
    });
  });

  it("copyPngToClipboard 仅在 clipboard.write 实际完成后 resolve，并携带 image/png ClipboardItem", async () => {
    let resolveWrite!: () => void;
    const writeMock = vi.fn(() => new Promise<void>((res) => { resolveWrite = res; }));
    class FakeClipboardItem {
      readonly items: Record<string, Blob>;
      constructor(items: Record<string, Blob>) {
        this.items = items;
      }
    }
    Object.defineProperty(globalThis, "ClipboardItem", { value: FakeClipboardItem, configurable: true });
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { write: writeMock } },
      configurable: true,
    });

    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    let finished = false;
    const promise = copyPngToClipboard(blob).then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(writeMock).toHaveBeenCalledTimes(1);
    const passed = (writeMock.mock.calls[0] as unknown as [FakeClipboardItem[]])[0];
    expect(passed[0].items["image/png"]).toBe(blob);

    resolveWrite();
    await promise;
    expect(finished).toBe(true);
  });

  it("剪贴板写入被拒绝或不支持时抛出明确中文提示", async () => {
    class FakeClipboardItem {
      constructor(public readonly items: Record<string, Blob>) {}
    }
    Object.defineProperty(globalThis, "ClipboardItem", { value: FakeClipboardItem, configurable: true });
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { write: vi.fn().mockRejectedValue(new Error("NotAllowedError")) } },
      configurable: true,
    });

    const blob = new Blob(["png"], { type: "image/png" });
    await expect(copyPngToClipboard(blob)).rejects.toThrow(/写入系统剪贴板失败.*保存 PNG/);

    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    await expect(copyPngToClipboard(blob)).rejects.toThrow(/不支持图片剪贴板写入/);
  });
});
