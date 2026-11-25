import type { AnnotationPoint, AnnotationStroke } from './types';

/** laser 笔画的 id 前缀约定（见 types.ts）。 */
export const LASER_ID_PREFIX = 'laser-';

/** laser 点默认保留时长（秒）。 */
export const DEFAULT_LASER_HOLD_SECONDS = 2.5;

/** 判断一条笔画是否为教鞭（laser）笔画。 */
export function isLaserStroke(stroke: AnnotationStroke): boolean {
  return stroke.id.startsWith(LASER_ID_PREFIX);
}

/**
 * 剔除 laser 笔画中过期的点（t < time - holdSeconds 的点丢弃）；
 * 点全部过期的 laser 笔画整条移除。draw 笔画原样保留。
 * 不修改入参，返回新数组。
 */
export function pruneLaser(
  strokes: AnnotationStroke[],
  time: number,
  holdSeconds: number,
): AnnotationStroke[] {
  const cutoff = time - holdSeconds;
  const result: AnnotationStroke[] = [];
  for (const stroke of strokes) {
    if (!isLaserStroke(stroke)) {
      result.push(stroke);
      continue;
    }
    const points = stroke.points.filter((p) => p.t >= cutoff);
    if (points.length > 0) {
      result.push({ ...stroke, points });
    }
  }
  return result;
}

/**
 * 计算在给定动画时刻应显示的笔画：
 * draw 笔画永久保留；laser 笔画只保留最近 holdSeconds（默认 2.5s）内的点。
 */
export function strokesVisibleAt(
  strokes: AnnotationStroke[],
  time: number,
  holdSeconds: number = DEFAULT_LASER_HOLD_SECONDS,
): AnnotationStroke[] {
  return pruneLaser(strokes, time, holdSeconds);
}

/** 归一化坐标 (0..1) → 像素坐标。 */
export function strokeToPath(
  points: AnnotationPoint[],
  w: number,
  h: number,
): { x: number; y: number }[] {
  return points.map((p) => ({ x: p.x * w, y: p.y * h }));
}

/** 序列化为 JSON 字符串；异常时回退为 "[]"。 */
export function serializeStrokes(strokes: AnnotationStroke[]): string {
  try {
    return JSON.stringify(strokes);
  } catch {
    return '[]';
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function sanitizePoint(raw: unknown): AnnotationPoint | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!isFiniteNumber(o.x) || !isFiniteNumber(o.y) || !isFiniteNumber(o.t)) {
    return null;
  }
  return { x: o.x, y: o.y, t: o.t };
}

function sanitizeStroke(raw: unknown): AnnotationStroke | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.id !== 'string' ||
    typeof o.color !== 'string' ||
    !isFiniteNumber(o.width) ||
    !Array.isArray(o.points)
  ) {
    return null;
  }
  const points: AnnotationPoint[] = [];
  for (const p of o.points) {
    const point = sanitizePoint(p);
    if (point) points.push(point);
  }
  return { id: o.id, color: o.color, width: o.width, points };
}

/**
 * 容错反序列化：非法 JSON、非数组、非法笔画/点均被丢弃或过滤，
 * 任何情况下都返回一个合法的 AnnotationStroke[]（最差为 []）。
 */
export function deserializeStrokes(json: string): AnnotationStroke[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const result: AnnotationStroke[] = [];
  for (const raw of parsed) {
    const stroke = sanitizeStroke(raw);
    if (stroke) result.push(stroke);
  }
  return result;
}
