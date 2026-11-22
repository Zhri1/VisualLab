import { describe, expect, it } from "vitest";
import {
  emptyDraft,
  loadHomeDraft,
  makeRecent,
  pushRecent,
  saveHomeDraft,
  type DraftStorage,
  type RecentProblem,
} from "../homeDraft";

class MemoryStorage implements DraftStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const recent = (label: string, text = label): RecentProblem => ({
  id: label,
  label,
  text,
  createdAt: 0,
});

describe("homeDraft", () => {
  it("空存储返回空草稿", () => {
    expect(loadHomeDraft(new MemoryStorage())).toEqual(emptyDraft());
  });

  it("保存后可恢复文字与最近记录", () => {
    const storage = new MemoryStorage();
    saveHomeDraft({ text: "题干", recents: [recent("a")] }, storage);
    const restored = loadHomeDraft(storage);
    expect(restored.text).toBe("题干");
    expect(restored.recents).toHaveLength(1);
    expect(restored.recents[0].label).toBe("a");
  });

  it("坏 JSON 不崩溃", () => {
    const storage = new MemoryStorage();
    storage.setItem("visuallab:home-draft:v1", "{not-json");
    expect(loadHomeDraft(storage)).toEqual(emptyDraft());
  });

  it("最近记录去重且最多三条", () => {
    let state = emptyDraft();
    for (const label of ["a", "b", "c", "d"]) {
      state = pushRecent(state, recent(label));
    }
    expect(state.recents.map((item) => item.label)).toEqual(["d", "c", "b"]);

    const deduped = pushRecent(state, recent("c"));
    expect(deduped.recents.map((item) => item.label)).toEqual(["c", "d", "b"]);
  });

  it("过大的图片数据不写入", () => {
    const storage = new MemoryStorage();
    saveHomeDraft(
      { text: "", recents: [makeRecent({ label: "大图", text: "", imageDataUrl: "x".repeat(400_000) })] },
      storage,
    );
    expect(loadHomeDraft(storage).recents[0].imageDataUrl).toBeUndefined();
  });
});