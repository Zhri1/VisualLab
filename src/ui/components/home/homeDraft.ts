/**
 * 首页草稿：只保存题干文本，刷新后可恢复。
 * 存储失败（隐私模式/配额满）时静默降级，不影响识别。
 */

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "visuallab:home-draft:v1";

function safeStorage(): DraftStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadDraftText(storage: DraftStorage | null = safeStorage()): string {
  if (!storage) return "";
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return "";
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return "";
    const text = (parsed as { text?: unknown }).text;
    return typeof text === "string" ? text.slice(0, 4000) : "";
  } catch {
    return "";
  }
}

export function saveDraftText(
  text: string,
  storage: DraftStorage | null = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ text: text.slice(0, 4000) }));
  } catch {
    /* 配额满或隐私模式：不阻塞主流程 */
  }
}