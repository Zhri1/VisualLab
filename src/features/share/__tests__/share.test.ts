import { describe, expect, it } from 'vitest';
import type { ShareState } from '../shareLink';
import {
  buildShareUrl,
  decodeShareState,
  encodeShareState,
  readShareFromLocation,
} from '../shareLink';
import type { FavoriteEntry } from '../favorites';
import {
  filterFavorites,
  isFavorite,
  loadFavorites,
  removeFavorite,
  resolveFavoriteMeta,
  saveFavorite,
  saveFavoriteWithResult,
  updateFavorite,
} from '../favorites';
import { classifyFavorite } from '../classifyFavorite';
import switchableEmFixture from '../../../../fixtures/switchable-em-collision.reading.json';
import conveyorPegFixture from '../../../../fixtures/conveyor-collision-peg-critical.reading.json';
import gaokaoProjLoopFixture from '../../../../fixtures/gaokao-proj-arc-horiz-loop.reading.json';

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

describe('错题本自动分类、筛选、手动覆盖与旧收藏兼容', () => {
  it('内置综合题与非内置结构化力学/电磁题自动生成准确多标签与难度估计', () => {
    // 1. 内置压轴力学综合题
    const builtInMech = classifyFavorite({
      sampleId: 'gaokao-proj-arc-horiz-loop',
      reading: gaokaoProjLoopFixture,
    });
    expect(builtInMech.categories).toEqual(['斜面与滑动', '抛体', '圆周与摆']);
    expect(builtInMech.difficulty).toBe('拔高');
    expect(builtInMech.difficultyOrigin).toBe('built_in');

    // 2. 非内置力学综合题（传送带 + 正碰 + 轻绳碰钉）
    const customMech = classifyFavorite({ reading: conveyorPegFixture });
    expect(customMech.categories).toEqual(['圆周与摆', '碰撞与动量', '传送带与连接体']);
    expect(customMech.difficulty).toBe('拔高');
    expect(customMech.difficultyOrigin).toBe('estimated');

    // 3. 非内置分区电磁场题
    const customEm = classifyFavorite({ reading: switchableEmFixture });
    expect(customEm.categories).toEqual(['碰撞与动量', '电磁场']);
    expect(customEm.difficulty).toBe('拔高');
    expect(customEm.difficultyOrigin).toBe('estimated');

    // 4. 单纯接缝转向 lossless_turn 不增加难度：单斜面 + 转向仍为基础
    const simpleInclineWithTurn = classifyFavorite({
      reading: {
        kind: 'stage_plan',
        schemaVersion: 1,
        gravityMps2: 10,
        initial: { speedMps: 0 },
        stages: [
          { kind: 'incline_slide', lengthM: 2, angleDeg: 30, kineticFrictionCoefficient: 0, slidesAfterRelease: true },
          { kind: 'lossless_turn', lossless: true },
        ],
      },
    });
    expect(simpleInclineWithTurn.categories).toEqual(['斜面与滑动']);
    expect(simpleInclineWithTurn.difficulty).toBe('基础');

    // 5. 信息不足 → 未分类 / 未定级
    const unknown = classifyFavorite({ reading: { foo: 'bar' } });
    expect(unknown.categories).toEqual([]);
    expect(unknown.difficulty).toBe('未定级');
    expect(unknown.difficultyOrigin).toBe('none');
  });

  it('兼容旧 localStorage 收藏：读时自动补齐分类且保留原有 note / sampleId / reading', () => {
    const legacy = [
      { id: 'old-1', title: '旧电磁收藏', savedAt: 10, reading: switchableEmFixture, note: '易错点：只撤磁场' },
      { id: 'old-2', title: '旧样例缺reading', savedAt: 9, sampleId: 'magnetic-deflection' },
      { id: 'old-3', title: '无信息旧项', savedAt: 8, note: '仅备注' },
    ];
    const storage = createFakeStorage({ [KEY]: JSON.stringify(legacy) });
    const loaded = loadFavorites(storage);
    expect(loaded).toHaveLength(3);
    expect(loaded[0].note).toBe('易错点：只撤磁场');

    const m0 = resolveFavoriteMeta(loaded[0]);
    expect(m0.categories).toEqual(['碰撞与动量', '电磁场']);
    expect(m0.difficulty).toBe('拔高');
    expect(m0.isEstimatedDifficulty).toBe(true);

    const m1 = resolveFavoriteMeta(loaded[1]);
    expect(m1.categories).toContain('电磁场');
    expect(m1.difficulty).toBe('拔高');

    const m2 = resolveFavoriteMeta(loaded[2]);
    expect(m2.categories).toEqual([]);
    expect(m2.difficulty).toBe('未定级');
  });

  it('按题型、难度组合筛选及标题搜索（含多标签匹配、未分类、未定级）', () => {
    const storage = createFakeStorage();
    saveFavorite({ id: 'em', title: '分区电磁场压轴题', savedAt: 3, reading: switchableEmFixture }, storage);
    saveFavorite({ id: 'mech', title: '湖北传送带碰钉题', savedAt: 2, reading: conveyorPegFixture }, storage);
    saveFavorite({ id: 'raw', title: '随手记的一道题', savedAt: 1 }, storage);
    const all = loadFavorites(storage);

    expect(filterFavorites(all, { category: '碰撞与动量' }).map((e) => e.id)).toEqual(['mech', 'em']);
    expect(filterFavorites(all, { category: '电磁场', difficulty: '拔高' }).map((e) => e.id)).toEqual(['em']);
    expect(filterFavorites(all, { category: '未分类', difficulty: '未定级' }).map((e) => e.id)).toEqual(['raw']);
    expect(filterFavorites(all, { category: '传送带与连接体', query: '湖北' }).map((e) => e.id)).toEqual(['mech']);
    expect(filterFavorites(all, { category: '弹簧', query: '不存在' })).toEqual([]);
  });

  it('updateFavorite 去掉首尾空白、拦截空标题、保留原字段并持久化手动覆盖', () => {
    const storage = createFakeStorage();
    saveFavorite(
      { id: 'em', title: '原标题', savedAt: 12345, sampleId: 'custom-s', reading: switchableEmFixture, note: '原备注' },
      storage,
    );

    // 拦截空白标题
    const bad = updateFavorite('em', { title: '   ' }, storage);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('标题不能为空');

    // 手动改名 + 覆盖分类和难度
    const ok = updateFavorite(
      'em',
      { title: '  二刷：分区电磁场  ', categories: ['电磁场'], difficulty: '中档' },
      storage,
    );
    expect(ok.ok).toBe(true);
    const reloaded = loadFavorites(storage)[0];
    expect(reloaded.id).toBe('em');
    expect(reloaded.savedAt).toBe(12345);
    expect(reloaded.sampleId).toBe('custom-s');
    expect(reloaded.note).toBe('原备注');
    expect(reloaded.reading).toEqual(switchableEmFixture);
    expect(reloaded.title).toBe('二刷：分区电磁场');
    expect(reloaded.categoriesManual).toBe(true);
    expect(reloaded.difficultyManual).toBe(true);

    const meta = resolveFavoriteMeta(reloaded);
    expect(meta.categories).toEqual(['电磁场']);
    expect(meta.difficulty).toBe('中档');
    expect(meta.isEstimatedDifficulty).toBe(false);
  });

  it('存储写入失败时 saveFavoriteWithResult 与 updateFavorite 返回 ok: false 且不提示成功', () => {
    const seed = [{ id: 'a', title: '甲', savedAt: 1 }];
    const broken: Storage = {
      ...createFakeStorage({ [KEY]: JSON.stringify(seed) }),
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    expect(saveFavoriteWithResult({ id: 'b', title: '乙', savedAt: 2 }, broken).ok).toBe(false);
    expect(updateFavorite('a', { title: '改名' }, broken).ok).toBe(false);
  });
});