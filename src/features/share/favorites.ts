/**
 * 错题本持久化：收藏条目存 localStorage，key 为 visuallab.favorites.v1。
 * 按 id 去重置顶、上限 50 条；损坏 JSON 容错为空数组；
 * 兼容旧收藏结构，读时补齐自动分类；手动编辑的题型/难度优先于自动结果；
 * 写入失败（配额满 / 隐私模式）返回旧列表且不提示成功；SSR / 无 window 时回退内存 Map。
 */
import {
  classifyFavorite,
  FAVORITE_CATEGORIES,
  FAVORITE_DIFFICULTIES,
  type FavoriteCategory,
  type FavoriteDifficulty,
} from "./classifyFavorite";

export { FAVORITE_CATEGORIES, FAVORITE_DIFFICULTIES };
export type { FavoriteCategory, FavoriteDifficulty };

export interface FavoriteEntry {
  id: string;
  title: string;
  savedAt: number;
  sampleId?: string;
  reading?: unknown;
  note?: string;
  /** 生效题型标签；缺省或空数组在展示层显示「未分类」。 */
  categories?: FavoriteCategory[];
  /** 生效难度等级；缺省在展示层显示「未定级」。 */
  difficulty?: FavoriteDifficulty;
  /** 是否由用户手动覆盖题型标签（手动优先于自动）。 */
  categoriesManual?: boolean;
  /** 是否由用户手动覆盖难度等级（手动优先于自动）。 */
  difficultyManual?: boolean;
}

export interface ResolvedFavoriteMeta {
  categories: FavoriteCategory[];
  difficulty: FavoriteDifficulty;
  categoriesManual: boolean;
  difficultyManual: boolean;
  /** 当前难度是否为本地规则自动估计（非手动且非内置样例既有评级）。 */
  isEstimatedDifficulty: boolean;
}

export interface FavoriteMutationResult {
  ok: boolean;
  items: FavoriteEntry[];
  entry?: FavoriteEntry;
  error?: string;
}

const STORAGE_KEY = 'visuallab.favorites.v1';
const MAX_FAVORITES = 50;
const VALID_CATEGORIES = new Set<string>(FAVORITE_CATEGORIES);
const VALID_DIFFICULTIES = new Set<string>(FAVORITE_DIFFICULTIES);

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

function sanitizeCategories(value: unknown): FavoriteCategory[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const set = new Set<FavoriteCategory>();
  for (const item of value) {
    if (typeof item === 'string' && VALID_CATEGORIES.has(item)) {
      set.add(item as FavoriteCategory);
    }
  }
  return FAVORITE_CATEGORIES.filter((c) => set.has(c));
}

function sanitizeDifficulty(value: unknown): FavoriteDifficulty | undefined {
  if (typeof value === 'string' && VALID_DIFFICULTIES.has(value)) {
    return value as FavoriteDifficulty;
  }
  return undefined;
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
  const cats = sanitizeCategories(raw.categories);
  if (cats !== undefined) entry.categories = cats;
  const diff = sanitizeDifficulty(raw.difficulty);
  if (diff !== undefined) entry.difficulty = diff;
  if (typeof raw.categoriesManual === 'boolean') entry.categoriesManual = raw.categoriesManual;
  if (typeof raw.difficultyManual === 'boolean') entry.difficultyManual = raw.difficultyManual;
  return entry;
}

/** 读时解析单条收藏的生效题型与难度（手动覆盖优先，否则按 reading/sampleId 自动补齐）。 */
export function resolveFavoriteMeta(entry: FavoriteEntry): ResolvedFavoriteMeta {
  const auto = classifyFavorite({ sampleId: entry.sampleId, reading: entry.reading });
  const categoriesManual = Boolean(entry.categoriesManual);
  const difficultyManual = Boolean(entry.difficultyManual);
  const categories = categoriesManual
    ? (entry.categories ?? [])
    : (entry.categories && entry.categories.length > 0 ? entry.categories : auto.categories);
  const difficulty: FavoriteDifficulty = difficultyManual
    ? (entry.difficulty ?? "未定级")
    : (entry.difficulty && entry.difficulty !== "未定级" ? entry.difficulty : auto.difficulty);
  const isEstimatedDifficulty = !difficultyManual && difficulty !== "未定级" && auto.difficultyOrigin === "estimated";
  return { categories, difficulty, categoriesManual, difficultyManual, isEstimatedDifficulty };
}

/** 为新收藏或更新后的收藏补齐自动分类（不覆盖已手动设置的字段，也不给无信息旧结构强加冗余键）。 */
function enrichForSave(entry: FavoriteEntry, previous?: FavoriteEntry): FavoriteEntry {
  const next: FavoriteEntry = { ...entry };
  const auto = classifyFavorite({ sampleId: next.sampleId, reading: next.reading });

  if (previous?.categoriesManual && !next.categoriesManual) {
    next.categories = previous.categories ?? [];
    next.categoriesManual = true;
  } else if (!next.categoriesManual && next.categories === undefined && auto.categories.length > 0) {
    next.categories = auto.categories;
  }

  if (previous?.difficultyManual && !next.difficultyManual) {
    next.difficulty = previous.difficulty ?? "未定级";
    next.difficultyManual = true;
  } else if (!next.difficultyManual && next.difficulty === undefined && auto.difficulty !== "未定级") {
    next.difficulty = auto.difficulty;
  }

  return next;
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

/** 收藏一条（带结果状态）：按 id 去重置顶、自动补齐分类、上限 50；写入失败不报成功。 */
export function saveFavoriteWithResult(entry: FavoriteEntry, storage?: Storage): FavoriteMutationResult {
  const store = resolveStorage(storage);
  const current = loadFavorites(store);
  const previous = current.find((e) => e.id === entry.id);
  const enriched = enrichForSave(entry, previous);
  const next = [enriched, ...current.filter((e) => e.id !== enriched.id)].slice(0, MAX_FAVORITES);
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return { ok: false, items: current, error: "保存失败：本地存储空间已满或不可用" };
  }
  return { ok: true, items: next, entry: enriched };
}

/** 收藏一条：按 id 去重并置顶，上限 50；写入失败静默返回旧列表。 */
export function saveFavorite(entry: FavoriteEntry, storage?: Storage): FavoriteEntry[] {
  return saveFavoriteWithResult(entry, storage).items;
}

/**
 * 编辑已存收藏的名称、题型或难度：
 * - 去掉标题首尾空白并拦截空标题；
 * - 保留原 id、savedAt、sampleId、reading、note 与列表位置；
 * - 手动修改的题型/难度标记为 manual，优先于自动分类且刷新后保留；
 * - 写入失败返回 ok: false 与明确错误，不提示成功。
 */
export function updateFavorite(
  id: string,
  patch: {
    title?: string;
    categories?: FavoriteCategory[];
    difficulty?: FavoriteDifficulty;
    note?: string;
  },
  storage?: Storage,
): FavoriteMutationResult {
  const store = resolveStorage(storage);
  const current = loadFavorites(store);
  const index = current.findIndex((e) => e.id === id);
  if (index < 0) {
    return { ok: false, items: current, error: "未找到该收藏条目" };
  }

  const prev = current[index];
  const updated: FavoriteEntry = { ...prev };

  if (patch.title !== undefined) {
    const trimmed = patch.title.trim();
    if (!trimmed) {
      return { ok: false, items: current, error: "标题不能为空" };
    }
    updated.title = trimmed;
  }

  if (patch.categories !== undefined) {
    updated.categories = sanitizeCategories(patch.categories) ?? [];
    updated.categoriesManual = true;
  }

  if (patch.difficulty !== undefined) {
    const validDiff = sanitizeDifficulty(patch.difficulty);
    if (!validDiff) {
      return { ok: false, items: current, error: "无效的难度等级" };
    }
    updated.difficulty = validDiff;
    updated.difficultyManual = true;
  }

  if (patch.note !== undefined) {
    updated.note = patch.note;
  }

  const next = [...current];
  next[index] = updated;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return { ok: false, items: current, error: "保存失败：本地存储空间已满或不可用" };
  }
  return { ok: true, items: next, entry: updated };
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

/** 组合筛选错题本：支持按题型（含「未分类」）、难度（含「未定级」）与标题关键词筛选。 */
export function filterFavorites(
  items: FavoriteEntry[],
  criteria: {
    category?: FavoriteCategory | "全部" | "未分类";
    difficulty?: FavoriteDifficulty | "全部";
    query?: string;
  },
): FavoriteEntry[] {
  const cat = criteria.category && criteria.category !== "全部" ? criteria.category : null;
  const diff = criteria.difficulty && criteria.difficulty !== "全部" ? criteria.difficulty : null;
  const q = criteria.query?.trim().toLowerCase() ?? "";

  return items.filter((entry) => {
    const meta = resolveFavoriteMeta(entry);
    if (cat) {
      if (cat === "未分类") {
        if (meta.categories.length > 0) return false;
      } else if (!meta.categories.includes(cat)) {
        return false;
      }
    }
    if (diff && meta.difficulty !== diff) return false;
    if (q && !entry.title.toLowerCase().includes(q)) return false;
    return true;
  });
}
