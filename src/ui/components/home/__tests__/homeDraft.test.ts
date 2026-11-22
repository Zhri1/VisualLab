import { describe, expect, it } from "vitest";
import { loadDraftText, saveDraftText, type DraftStorage } from "../homeDraft";

class MemoryStorage implements DraftStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe("homeDraft", () => {
  it("空存储返回空字符串", () => {
    expect(loadDraftText(new MemoryStorage())).toBe("");
  });

  it("保存后可恢复题干", () => {
    const storage = new MemoryStorage();
    saveDraftText("质量 1 kg 的滑块…", storage);
    expect(loadDraftText(storage)).toBe("质量 1 kg 的滑块…");
  });

  it("坏 JSON 不崩溃", () => {
    const storage = new MemoryStorage();
    storage.setItem("visuallab:home-draft:v1", "{not-json");
    expect(loadDraftText(storage)).toBe("");
  });

  it("存储写入失败时静默降级", () => {
    const broken: DraftStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(() => saveDraftText("题干", broken)).not.toThrow();
  });

  it("超长题干截断到 4000 字", () => {
    const storage = new MemoryStorage();
    saveDraftText("x".repeat(5000), storage);
    expect(loadDraftText(storage)).toHaveLength(4000);
  });
});