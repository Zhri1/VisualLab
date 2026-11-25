import { describe, expect, it } from 'vitest';
import type { AnnotationStroke } from '../types';
import {
  deserializeStrokes,
  pruneLaser,
  serializeStrokes,
  strokeToPath,
  strokesVisibleAt,
} from '../annotationMath';

function makeStroke(
  id: string,
  times: number[],
  overrides: Partial<AnnotationStroke> = {},
): AnnotationStroke {
  return {
    id,
    color: '#ff3b30',
    width: 3,
    points: times.map((t, i) => ({ x: i / 10, y: i / 20, t })),
    ...overrides,
  };
}

describe('strokesVisibleAt / pruneLaser', () => {
  it('laser 笔画只保留最近 holdSeconds 内的点（默认 2.5s）', () => {
    const laser = makeStroke('laser-a', [0, 1, 2, 3]);
    const visible = strokesVisibleAt([laser], 4);
    expect(visible).toHaveLength(1);
    // cutoff = 4 - 2.5 = 1.5 → 保留 t=2、t=3
    expect(visible[0].points.map((p) => p.t)).toEqual([2, 3]);
  });

  it('laser 点全部过期时整条笔画被剔除', () => {
    const laser = makeStroke('laser-a', [0, 1, 2]);
    expect(strokesVisibleAt([laser], 10)).toEqual([]);
  });

  it('draw 笔画永久保留，即使点很旧', () => {
    const draw = makeStroke('draw-a', [0, 0.5, 1]);
    const visible = strokesVisibleAt([draw], 999);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toBe(draw);
    expect(visible[0].points).toHaveLength(3);
  });

  it('draw 与 laser 混合时互不影响', () => {
    const draw = makeStroke('draw-a', [0, 1]);
    const laser = makeStroke('laser-b', [5, 6]);
    const visible = strokesVisibleAt([draw, laser], 6.5, 2.5);
    expect(visible.map((s) => s.id)).toEqual(['draw-a', 'laser-b']);
    expect(visible[0].points).toHaveLength(2);
    expect(visible[1].points.map((p) => p.t)).toEqual([5, 6]);
  });

  it('自定义 holdSeconds 生效', () => {
    const laser = makeStroke('laser-a', [0, 1, 2, 3, 4]);
    const visible = strokesVisibleAt([laser], 4, 1);
    expect(visible[0].points.map((p) => p.t)).toEqual([3, 4]);
  });

  it('pruneLaser 显式传 holdSeconds，且不修改入参', () => {
    const laser = makeStroke('laser-a', [0, 1, 2]);
    const input = [laser];
    const pruned = pruneLaser(input, 2, 1);
    expect(pruned[0].points.map((p) => p.t)).toEqual([1, 2]);
    expect(laser.points.map((p) => p.t)).toEqual([0, 1, 2]);
    expect(input).toHaveLength(1);
  });

  it('空输入返回空数组', () => {
    expect(strokesVisibleAt([], 5)).toEqual([]);
    expect(pruneLaser([], 5, 2.5)).toEqual([]);
  });
});

describe('strokeToPath', () => {
  it('归一化坐标映射为像素坐标', () => {
    const path = strokeToPath(
      [
        { x: 0, y: 0, t: 0 },
        { x: 0.5, y: 0.25, t: 0.1 },
        { x: 1, y: 1, t: 0.2 },
      ],
      800,
      600,
    );
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 400, y: 150 },
      { x: 800, y: 600 },
    ]);
  });

  it('空点列返回空路径', () => {
    expect(strokeToPath([], 800, 600)).toEqual([]);
  });
});

describe('serializeStrokes / deserializeStrokes', () => {
  it('往返序列化保持数据一致', () => {
    const strokes = [
      makeStroke('draw-a', [0, 0.5]),
      makeStroke('laser-b', [1, 1.2], { color: '#0a84ff', width: 6 }),
    ];
    const restored = deserializeStrokes(serializeStrokes(strokes));
    expect(restored).toEqual(strokes);
  });

  it('空数组往返', () => {
    expect(deserializeStrokes(serializeStrokes([]))).toEqual([]);
  });

  it('损坏的 JSON 返回 []', () => {
    expect(deserializeStrokes('not json at all')).toEqual([]);
    expect(deserializeStrokes('')).toEqual([]);
    expect(deserializeStrokes('[{"id":')).toEqual([]);
  });

  it('合法 JSON 但结构不对时返回 []', () => {
    expect(deserializeStrokes('null')).toEqual([]);
    expect(deserializeStrokes('42')).toEqual([]);
    expect(deserializeStrokes('{"strokes":[]}')).toEqual([]);
    expect(deserializeStrokes('"hello"')).toEqual([]);
  });

  it('过滤非法笔画与非法点，保留合法部分', () => {
    const json = JSON.stringify([
      null,
      { id: 123, color: '#f00', width: 2, points: [] },
      { id: 'draw-ok', color: '#f00', width: 2, points: [{ x: 0.1, y: 0.2, t: 0 }] },
      {
        id: 'draw-mixed',
        color: '#00f',
        width: 3,
        points: [
          { x: 0.3, y: 0.4, t: 1 },
          { x: 'bad', y: 0.5, t: 2 },
          { x: 0.6, y: 0.7 },
          null,
        ],
      },
    ]);
    const restored = deserializeStrokes(json);
    expect(restored.map((s) => s.id)).toEqual(['draw-ok', 'draw-mixed']);
    expect(restored[0].points).toEqual([{ x: 0.1, y: 0.2, t: 0 }]);
    expect(restored[1].points).toEqual([{ x: 0.3, y: 0.4, t: 1 }]);
  });

  it('serializeStrokes 对循环引用容错', () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(serializeStrokes(cyclic as unknown as AnnotationStroke[])).toBe('[]');
  });
});
