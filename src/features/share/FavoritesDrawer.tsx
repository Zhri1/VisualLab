import { useEffect, useMemo, useState } from "react";
import {
  FAVORITE_CATEGORIES,
  FAVORITE_DIFFICULTIES,
  filterFavorites,
  loadFavorites,
  removeFavorite,
  resolveFavoriteMeta,
  updateFavorite,
  type FavoriteCategory,
  type FavoriteDifficulty,
  type FavoriteEntry,
} from "./favorites";

interface Props {
  open: boolean;
  onClose: () => void;
  onLoad: (entry: FavoriteEntry) => void;
}

/** 错题本 / 收藏：本地持久化的题目+条件快照，支持自动/手动分类、组合筛选、搜索、编辑与就地确认删除。 */
export function FavoritesDrawer({ open, onClose, onLoad }: Props) {
  const [items, setItems] = useState<FavoriteEntry[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<FavoriteCategory | "全部" | "未分类">("全部");
  const [difficultyFilter, setDifficultyFilter] = useState<FavoriteDifficulty | "全部">("全部");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategories, setEditCategories] = useState<FavoriteCategory[]>([]);
  const [editDifficulty, setEditDifficulty] = useState<FavoriteDifficulty>("未定级");
  const [editError, setEditError] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setItems(loadFavorites());
      setEditingId(null);
      setEditError(null);
      setConfirmDeleteId(null);
    }
  }, [open]);

  const filtered = useMemo(
    () =>
      filterFavorites(items, {
        category: categoryFilter,
        difficulty: difficultyFilter,
        query,
      }),
    [items, categoryFilter, difficultyFilter, query],
  );

  if (!open) return null;

  const startEdit = (entry: FavoriteEntry) => {
    const meta = resolveFavoriteMeta(entry);
    setConfirmDeleteId(null);
    setEditingId(entry.id);
    setEditTitle(entry.title);
    setEditCategories(meta.categories);
    setEditDifficulty(meta.difficulty);
    setEditError(null);
  };

  const toggleEditCategory = (cat: FavoriteCategory) => {
    setEditCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : FAVORITE_CATEGORIES.filter((c) => c === cat || prev.includes(c)),
    );
  };

  const commitEdit = (id: string) => {
    const res = updateFavorite(id, {
      title: editTitle,
      categories: editCategories,
      difficulty: editDifficulty,
    });
    if (!res.ok) {
      setEditError(res.error ?? "保存失败");
      return;
    }
    setItems(res.items);
    setEditingId(null);
    setEditError(null);
  };

  const resetFilters = () => {
    setQuery("");
    setCategoryFilter("全部");
    setDifficultyFilter("全部");
  };

  return (
    <div className="favorites-backdrop" onClick={onClose}>
      <aside className="favorites-drawer" role="dialog" aria-label="错题本与收藏" onClick={(e) => e.stopPropagation()}>
        <div className="favorites-head">
          <b>错题本 · 收藏{items.length > 0 ? ` (${items.length})` : ""}</b>
          <button type="button" className="ghost-button" onClick={onClose}>关闭</button>
        </div>

        {items.length > 0 && (
          <div className="favorites-controls" aria-label="筛选与搜索错题">
            <input
              type="search"
              className="favorites-search"
              aria-label="按标题搜索错题"
              placeholder="按标题搜索…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="favorites-filters">
              <select
                className="favorites-select"
                aria-label="按题型筛选"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as FavoriteCategory | "全部" | "未分类")}
              >
                <option value="全部">全部题型</option>
                {FAVORITE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
                <option value="未分类">未分类</option>
              </select>
              <select
                className="favorites-select"
                aria-label="按难度筛选"
                value={difficultyFilter}
                onChange={(e) => setDifficultyFilter(e.target.value as FavoriteDifficulty | "全部")}
              >
                <option value="全部">全部难度</option>
                {FAVORITE_DIFFICULTIES.map((diff) => (
                  <option key={diff} value={diff}>{diff}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <p className="favorites-empty">还没有收藏。在工作台点「收藏」把当前题目与条件存进来。</p>
        ) : filtered.length === 0 ? (
          <div className="favorites-empty-filtered">
            <p className="favorites-empty">没有符合当前筛选条件的收藏。</p>
            <button type="button" className="ghost-button" onClick={resetFilters}>重置筛选</button>
          </div>
        ) : (
          <ul className="favorites-list">
            {filtered.map((entry) => {
              const meta = resolveFavoriteMeta(entry);
              const isEditing = editingId === entry.id;
              const isConfirmingDelete = confirmDeleteId === entry.id;
              return (
                <li key={entry.id} className="favorites-item">
                  {isEditing ? (
                    <div className="favorites-edit-form" aria-label={`编辑收藏 ${entry.title}`}>
                      <label className="favorites-edit-label">
                        <span>题目名称</span>
                        <input
                          type="text"
                          className="favorites-edit-input"
                          aria-label="编辑题目名称"
                          value={editTitle}
                          onChange={(e) => {
                            setEditTitle(e.target.value);
                            if (editError) setEditError(null);
                          }}
                        />
                      </label>
                      <div className="favorites-edit-label">
                        <span>题型标签（可多选，留空为未分类）</span>
                        <div className="favorites-cat-grid" role="group" aria-label="编辑题型标签">
                          {FAVORITE_CATEGORIES.map((cat) => {
                            const selected = editCategories.includes(cat);
                            return (
                              <button
                                key={cat}
                                type="button"
                                className={`favorites-cat-chip${selected ? " is-selected" : ""}`}
                                aria-pressed={selected}
                                onClick={() => toggleEditCategory(cat)}
                              >
                                {cat}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <label className="favorites-edit-label">
                        <span>难度等级</span>
                        <select
                          className="favorites-select"
                          aria-label="编辑难度等级"
                          value={editDifficulty}
                          onChange={(e) => setEditDifficulty(e.target.value as FavoriteDifficulty)}
                        >
                          {FAVORITE_DIFFICULTIES.map((diff) => (
                            <option key={diff} value={diff}>{diff}</option>
                          ))}
                        </select>
                      </label>
                      {editError && <p className="favorites-error" role="alert">{editError}</p>}
                      <div className="favorites-actions">
                        <button type="button" className="ghost-button is-primary" onClick={() => commitEdit(entry.id)}>
                          保存
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => {
                            setEditingId(null);
                            setEditError(null);
                          }}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="favorites-meta">
                        <b>{entry.title}</b>
                        <span>{new Date(entry.savedAt).toLocaleString()}</span>
                        {entry.note && <p className="favorites-note">{entry.note}</p>}
                      </div>
                      <div className="favorites-tags" aria-label="题型与难度">
                        <span
                          className={`favorites-diff diff-${meta.difficulty}`}
                          title={meta.isEstimatedDifficulty ? "本地规则自动估计，非官方评级" : meta.difficultyManual ? "已手动设定" : "内置样例评级"}
                        >
                          {meta.difficulty}
                          {meta.isEstimatedDifficulty ? "·估" : ""}
                        </span>
                        {meta.categories.length > 0 ? (
                          meta.categories.map((cat) => (
                            <span key={cat} className="favorites-tag">{cat}</span>
                          ))
                        ) : (
                          <span className="favorites-tag is-empty">未分类</span>
                        )}
                      </div>
                      <div className="favorites-actions">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => {
                            onLoad(entry);
                            onClose();
                          }}
                        >
                          打开
                        </button>
                        <button type="button" className="ghost-button" onClick={() => startEdit(entry)}>
                          编辑
                        </button>
                        {isConfirmingDelete ? (
                          <span className="favorites-confirm">
                            <button
                              type="button"
                              className="ghost-button is-danger"
                              onClick={() => {
                                removeFavorite(entry.id);
                                setItems(loadFavorites());
                                setConfirmDeleteId(null);
                              }}
                            >
                              确认删除
                            </button>
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              取消
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => {
                              setEditingId(null);
                              setConfirmDeleteId(entry.id);
                            }}
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>
  );
}
