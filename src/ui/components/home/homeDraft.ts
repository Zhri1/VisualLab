/**
 * 首页草稿与最近题目：只落在 localStorage，图片仅存小体积缩略数据。
 * 存储失败（隐私模式/配额满）时静默降级，不影响识别。
 */

export interface RecentProblem {
  id: string;
  /** 展示用短标题（题干前若干字或文件名） */
  label: string;
  text: string;
  /** 可选的小图 data URL，过大不保存 */
  imageDataUrl?: string;
  createdAt: number;
}

export interface HomeDraftState {
  text: string;
  recents: RecentProblem[];
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "visuallab:home-draft:v1";
const MAX_RECENTS = 3;
/** 单张图最多占约 320KB 字符，避免挤爆 localStorage。 */
const MAX_IMAGE_CHARS = 320_000;

export function emptyDraft(): HomeDraftState {
  return { text: "", recents: [] };
}

function safeStorage(): DraftStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadHomeDraft(storage: DraftStorage | null = safeStorage()): HomeDraftState {
  if (!storage) return emptyDraft();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyDraft();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyDraft();
    const record = parsed as { text?: unknown; recents?: unknown };
    const text = typeof record.text === "string" ? record.text.slice(0, 4000) : "";
    const recents = Array.isArray(record.recents)
      ? record.recents
          .filter((item): item is RecentProblem => {
            if (!item || typeof item !== "object") return false;
            const entry = item as Partial<RecentProblem>;
            return (
              typeof entry.id === "string" &&
              typeof entry.label === "string" &&
              typeof entry.text === "string" &&
              typeof entry.createdAt === "number"
            );
          })
          .slice(0, MAX_RECENTS)
          .map((item) => ({
            ...item,
            imageDataUrl:
              typeof item.imageDataUrl === "string" && item.imageDataUrl.length <= MAX_IMAGE_CHARS
                ? item.imageDataUrl
                : undefined,
          }))
      : [];
    return { text, recents };
  } catch {
    return emptyDraft();
  }
}

export function saveHomeDraft(
  state: HomeDraftState,
  storage: DraftStorage | null = safeStorage(),
): void {
  if (!storage) return;
  try {
    const recents = state.recents.slice(0, MAX_RECENTS).map((item) => ({
      ...item,
      imageDataUrl:
        item.imageDataUrl && item.imageDataUrl.length <= MAX_IMAGE_CHARS
          ? item.imageDataUrl
          : undefined,
    }));
    storage.setItem(STORAGE_KEY, JSON.stringify({ text: state.text.slice(0, 4000), recents }));
  } catch {
    /* 配额满或隐私模式：不阻塞主流程 */
  }
}

export function makeRecent(input: {
  label: string;
  text: string;
  imageDataUrl?: string;
  id?: string;
}): RecentProblem {
  return {
    id: input.id ?? `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    label: input.label.slice(0, 40),
    text: input.text.slice(0, 4000),
    imageDataUrl:
      input.imageDataUrl && input.imageDataUrl.length <= MAX_IMAGE_CHARS
        ? input.imageDataUrl
        : undefined,
    createdAt: Date.now(),
  };
}

/** 新记录置顶；同题（label+text）去重并保留旧图，最多三条。 */
export function pushRecent(state: HomeDraftState, entry: RecentProblem): HomeDraftState {
  const key = `${entry.label}\u0000${entry.text}`;
  const previous = state.recents.find((item) => `${item.label}\u0000${item.text}` === key);
  const merged: RecentProblem = {
    ...entry,
    imageDataUrl: entry.imageDataUrl ?? previous?.imageDataUrl,
  };
  const rest = state.recents.filter((item) => `${item.label}\u0000${item.text}` !== key);
  return { ...state, recents: [merged, ...rest].slice(0, MAX_RECENTS) };
}