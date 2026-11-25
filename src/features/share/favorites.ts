/**
 * 错题本持久化：收藏条目存 localStorage，key 为 visuallab.favorites.v1。
 * 按 id 去重置顶、上限 50 条；损坏 JSON 容错为空数组；
 * 写入失败（配额满 / 隐私模式）静默返回旧列表；SSR / 无 window 时回退内存 Map。
 */

export interface FavoriteEntry {
  id: string;
  title: string;
  savedAt: number;
  sampleId?: string;
  reading?: unknown;
  note?: string;
}

const STORAGE_KEY = 'visuallab.favorites.v1';
const MAX_FAVORITES = 50;

/** SSR / 无 window / localStorage 不可用时的内存回退存储。 */
const memoryStore = new Map<string, string>();
const memoryStorage: Storage = {
  get length(): number {
    return memoryStore.size;
  },
  key(index: number): string | null {
    return Array.from(memoryStore.keys())[index] ?? null;
  },
  getItem(key: string): string | null {
    return memoryStore.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    memoryStore.set(key, String(value));
  },
  removeItem(key: string): void {
    memoryStore.delete(key);
  },
  clear(): void {
    memoryStore.clear();
  },
};

function resolveStorage(storage?: Storage): Storage {
  if (storage) return storage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    /* 隐私模式等场景访问 localStorage 会抛异常：回退内存 */
  }
  return memoryStorage;
}

/** 校验单条收藏：id / title / savedAt 必须合法，可选字段按类型收取。 */
function sanitizeEntry(item: unknown): FavoriteEntry | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const raw = item as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  if (typeof raw.title !== 'string') return null;
  if (typeof raw.savedAt !== 'number' || !Number.isFinite(raw.savedAt)) return null;
  const entry: FavoriteEntry = { id: raw.id, title: raw.title, savedAt: raw.savedAt };
  if (typeof raw.sampleId === 'string') entry.sampleId = raw.sampleId;
  if ('reading' in raw) entry.reading = raw.reading;
  if (typeof raw.note === 'string') entry.note = raw.note;
  return entry;
}

/** 读取收藏列表；损坏 JSON / 非数组 / 非法条目一律容错。 */
export function loadFavorites(storage?: Storage): FavoriteEntry[] {
  const store = resolveStorage(storage);
  let raw: string | null = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: FavoriteEntry[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const entry = sanitizeEntry(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
}

/** 收藏一条：按 id 去重并置顶，上限 50；写入失败静默返回旧列表。 */
export function saveFavorite(entry: FavoriteEntry, storage?: Storage): FavoriteEntry[] {
  const store = resolveStorage(storage);
  const current = loadFavorites(store);
  const next = [entry, ...current.filter((e) => e.id !== entry.id)].slice(0, MAX_FAVORITES);
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return current;
  }
  return next;
}

/** 按 id 移除收藏；写入失败静默返回旧列表。 */
export function removeFavorite(id: string, storage?: Storage): FavoriteEntry[] {
  const store = resolveStorage(storage);
  const current = loadFavorites(store);
  const next = current.filter((e) => e.id !== id);
  if (next.length === current.length) return current;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return current;
  }
  return next;
}

/** 判断某 id 是否已收藏。 */
export function isFavorite(id: string, storage?: Storage): boolean {
  return loadFavorites(storage).some((e) => e.id === id);
}