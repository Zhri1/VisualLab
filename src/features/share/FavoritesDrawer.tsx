import { useEffect, useState } from "react";
import { loadFavorites, removeFavorite, type FavoriteEntry } from "./favorites";

interface Props {
  open: boolean;
  onClose: () => void;
  onLoad: (entry: FavoriteEntry) => void;
}

/** 错题本 / 收藏：本地持久化的题目+条件快照。 */
export function FavoritesDrawer({ open, onClose, onLoad }: Props) {
  const [items, setItems] = useState<FavoriteEntry[]>([]);
  useEffect(() => {
    if (open) setItems(loadFavorites());
  }, [open]);
  if (!open) return null;
  return (
    <div className="favorites-backdrop" onClick={onClose}>
      <aside className="favorites-drawer" role="dialog" aria-label="错题本与收藏" onClick={(e) => e.stopPropagation()}>
        <div className="favorites-head">
          <b>错题本 · 收藏</b>
          <button type="button" className="ghost-button" onClick={onClose}>关闭</button>
        </div>
        {items.length === 0 ? (
          <p className="favorites-empty">还没有收藏。在工作台点「收藏」把当前题目与条件存进来。</p>
        ) : (
          <ul className="favorites-list">
            {items.map((entry) => (
              <li key={entry.id} className="favorites-item">
                <div className="favorites-meta">
                  <b>{entry.title}</b>
                  <span>{new Date(entry.savedAt).toLocaleString()}</span>
                </div>
                <div className="favorites-actions">
                  <button type="button" className="ghost-button" onClick={() => onLoad(entry)}>加载</button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      removeFavorite(entry.id);
                      setItems(loadFavorites());
                    }}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
