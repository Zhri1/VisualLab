import { describe, expect, it } from 'vitest';
import type { ShareState } from '../shareLink';
import {
  buildShareUrl,
  decodeShareState,
  encodeShareState,
  readShareFromLocation,
} from '../shareLink';
import type { FavoriteEntry } from '../favorites';
import { isFavorite, loadFavorites, removeFavorite, saveFavorite } from '../favorites';

const KEY = 'visuallab.favorites.v1';

/** 测试辅助：把任意文本编成 base64url（与生产编码链路一致）。 */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** 测试辅助：可注入的假 Storage。 */
function createFakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get length(): number {
      return map.size;
    },
    key(index: number): string | null {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(key: string): string | null {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      map.set(key, String(value));
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    clear(): void {
      map.clear();
    },
  };
}

describe('shareLink 编解码', () => {
  it('中文 + 嵌套 reading 往返一致', () => {
    const state: ShareState = {
      sampleId: 'incline-spring',
      reading: {
        标题: '斜面弹簧·含摩擦',
        阶段: [
          { 名称: '压缩释放', 参数: { 加速度: -2.5, 方向: '沿斜面向上' } },
          { 名称: '匀速滑行', 备注: '摩擦与重力分量平衡' },
        ],
        标签: ['力学', '能量守恒'],
      },
      timeSeconds: 12.5,
      paceEnabled: true,
      playbackRate: 1.5,
    };
    const encoded = encodeShareState(state);
    expect(decodeShareState(`#s=${encoded}`)).toEqual(state);
    expect(readShareFromLocation({ hash: `#s=${encoded}` })).toEqual(state);
  });

  it('编码结果是 base64url，不含 + / =', () => {
    const encoded = encodeShareState({
      sampleId: '样例',
      reading: { 文本: '中文+/=测试' },
    });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('buildShareUrl 把编码放进 #s= 并替换旧 hash', () => {
    const state: ShareState = { sampleId: 'demo', timeSeconds: 3 };
    const url = buildShareUrl('https://example.com/app?x=1#old', state);
    expect(url.startsWith('https://example.com/app?x=1#s=')).toBe(true);
    expect(readShareFromLocation({ hash: new URL(url).hash })).toEqual(state);
  });

  it('非法 hash 返回 null', () => {
    const badHashes = ['', '#', '#s=', '#s=!!!', '#s=abc$def', '#s=A', '###', '#s=%%%%'];
    for (const bad of badHashes) {
      expect(decodeShareState(bad)).toBeNull();
    }
    expect(decodeShareState(`#s=${toBase64Url('not json')}`)).toBeNull();
    expect(decodeShareState(`#s=${toBase64Url('[1,2,3]')}`)).toBeNull();
    expect(decodeShareState(`#s=${toBase64Url('42')}`)).toBeNull();
    expect(decodeShareState(`#s=${toBase64Url('null')}`)).toBeNull();
    expect(readShareFromLocation({ hash: '' })).toBeNull();
  });

  it('截断的编码返回 null', () => {
    const encoded = encodeShareState({ reading: { 说明: '这是一段足够长的中文说明文字' } });
    expect(decodeShareState(`#s=${encoded.slice(0, -1)}`)).toBeNull();
    expect(decodeShareState(`#s=${encoded.slice(0, -2)}`)).toBeNull();
  });

  it('解码后超过 200KB 拒绝，限内正常往返', () => {
    const big: ShareState = { reading: { blob: 'x'.repeat(210 * 1024) } };
    expect(decodeShareState(`#s=${encodeShareState(big)}`)).toBeNull();
    const ok: ShareState = { reading: { blob: 'x'.repeat(150 * 1024) } };
    expect(decodeShareState(`#s=${encodeShareState(ok)}`)).toEqual(ok);
  });

  it('非法类型字段被丢弃，只保留合法字段', () => {
    const raw = {
      sampleId: 123,
      timeSeconds: 'fast',
      paceEnabled: 'yes',
      playbackRate: 2,
      extra: 'drop',
    };
    expect(decodeShareState(`#s=${toBase64Url(JSON.stringify(raw))}`)).toEqual({
      playbackRate: 2,
    });
  });

  it('兼容多参数 hash 与裸 base64url 载荷', () => {
    const encoded = encodeShareState({ sampleId: 'x' });
    expect(decodeShareState(`#a=1&s=${encoded}&b=2`)).toEqual({ sampleId: 'x' });
    expect(decodeShareState(encoded)).toEqual({ sampleId: 'x' });
  });
});

describe('favorites 错题本', () => {
  it('按 id 去重置顶并更新内容', () => {
    const storage = createFakeStorage();
    saveFavorite({ id: 'a', title: '旧标题', savedAt: 1 }, storage);
    saveFavorite({ id: 'b', title: '乙', savedAt: 2 }, storage);
    const list = saveFavorite({ id: 'a', title: '新标题', savedAt: 3, note: '备注' }, storage);
    expect(list.map((e) => e.id)).toEqual(['a', 'b']);
    expect(list[0]).toEqual({ id: 'a', title: '新标题', savedAt: 3, note: '备注' });
    expect(loadFavorites(storage)).toEqual(list);
    expect(JSON.parse(storage.getItem(KEY) ?? '[]')).toEqual(list);
  });

  it('上限 50 条，最新在前，最旧被淘汰', () => {
    const storage = createFakeStorage();
    let list: FavoriteEntry[] = [];
    for (let i = 0; i < 55; i += 1) {
      list = saveFavorite({ id: `q${i}`, title: `题${i}`, savedAt: i }, storage);
    }
    expect(list).toHaveLength(50);
    expect(list[0].id).toBe('q54');
    expect(list[49].id).toBe('q5');
    expect(loadFavorites(storage)).toHaveLength(50);
    expect(isFavorite('q0', storage)).toBe(false);
    expect(isFavorite('q54', storage)).toBe(true);
  });

  it('损坏 JSON 容错为空数组', () => {
    for (const raw of ['{{{', 'null', '"text"', '{"a":1}', '']) {
      const storage = createFakeStorage({ [KEY]: raw });
      expect(loadFavorites(storage)).toEqual([]);
    }
  });

  it('非法条目被过滤，重复 id 只保留第一条', () => {
    const storage = createFakeStorage({
      [KEY]: JSON.stringify([
        { id: 'ok', title: '合法', savedAt: 1 },
        { id: 2, title: 'bad', savedAt: 1 },
        null,
        'x',
        { title: '缺 id', savedAt: 1 },
        { id: 'ok', title: '重复', savedAt: 9 },
      ]),
    });
    expect(loadFavorites(storage)).toEqual([{ id: 'ok', title: '合法', savedAt: 1 }]);
  });

  it('写入失败静默返回旧列表，存储内容不变', () => {
    const old = [{ id: 'keep', title: '保留', savedAt: 1 }];
    const storage: Storage = {
      ...createFakeStorage({ [KEY]: JSON.stringify(old) }),
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    expect(saveFavorite({ id: 'new', title: '新', savedAt: 2 }, storage)).toEqual(old);
    expect(storage.getItem(KEY)).toBe(JSON.stringify(old));
    expect(removeFavorite('keep', storage)).toEqual(old);
  });

  it('removeFavorite 与 isFavorite 行为正确', () => {
    const storage = createFakeStorage();
    saveFavorite({ id: 'a', title: '甲', savedAt: 1 }, storage);
    saveFavorite({ id: 'b', title: '乙', savedAt: 2 }, storage);
    expect(isFavorite('a', storage)).toBe(true);
    const list = removeFavorite('a', storage);
    expect(list.map((e) => e.id)).toEqual(['b']);
    expect(isFavorite('a', storage)).toBe(false);
    expect(removeFavorite('missing', storage)).toEqual(list);
  });

  it('注入的假 Storage 相互隔离', () => {
    const s1 = createFakeStorage();
    const s2 = createFakeStorage();
    saveFavorite({ id: 'a', title: '甲', savedAt: 1 }, s1);
    expect(loadFavorites(s2)).toEqual([]);
  });

  it('无 window/localStorage 时回退内存存储', () => {
    // vitest 默认 node 环境没有 window，走内存 Map 回退。
    expect(typeof window).toBe('undefined');
    const entry: FavoriteEntry = { id: 'mem-1', title: '内存收藏', savedAt: 1 };
    expect(saveFavorite(entry).some((e) => e.id === 'mem-1')).toBe(true);
    expect(loadFavorites().some((e) => e.id === 'mem-1')).toBe(true);
    expect(isFavorite('mem-1')).toBe(true);
    expect(removeFavorite('mem-1').some((e) => e.id === 'mem-1')).toBe(false);
    expect(isFavorite('mem-1')).toBe(false);
  });

  it('分享状态可存入错题本并原样恢复', () => {
    const state: ShareState = {
      sampleId: 'incline-spring',
      reading: { 题干: '中文题干', 图示: { 斜面角: 30 } },
      timeSeconds: 8,
    };
    const decoded = decodeShareState(`#s=${encodeShareState(state)}`);
    expect(decoded).not.toBeNull();
    const storage = createFakeStorage();
    const entry: FavoriteEntry = {
      id: 'fav-1',
      title: '错题一',
      savedAt: 100,
      sampleId: decoded?.sampleId,
      reading: decoded?.reading,
    };
    saveFavorite(entry, storage);
    const restored = loadFavorites(storage)[0];
    expect(encodeShareState({ sampleId: restored.sampleId, reading: restored.reading })).toBe(
      encodeShareState({ sampleId: state.sampleId, reading: state.reading }),
    );
  });
});