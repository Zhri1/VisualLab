import type { Vec2 } from "../../../types";

export type WorldBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type ViewportPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type ViewportTransform = {
  S: number;
  ox: number;
  oy: number;
  X: (x: number) => number;
  Y: (y: number) => number;
  bounds: WorldBounds;
  availW: number;
  availH: number;
};

/** 从有限点集计算紧致世界包围盒；空点集回退到原点。 */
export function computeWorldBounds(points: readonly Vec2[]): WorldBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { minX, maxX, minY, maxY };
}

/**
 * 统一等比取景投影：
 * - 基于像素边距（pad）保留标题、速度/张力标签与箭头空间，不再用固定世界虚高限制横长场景缩放；
 * - 横长 1D 场景占足可用横向空间并垂直居中；竖直 1D 场景占足纵向空间并水平居中；
 * - 2D 与圆形场景按限制轴等比缩放并居中；
 * - 静止或极短轨迹受 maxScale 限制，避免过度放大或出现 NaN。
 */
export function fitViewport(
  W: number,
  H: number,
  bounds: WorldBounds,
  pad: ViewportPadding,
  options?: { maxScale?: number }
): ViewportTransform {
  const availW = Math.max(40, W - pad.left - pad.right);
  const availH = Math.max(40, H - pad.top - pad.bottom);
  const spanX = Math.max(0, bounds.maxX - bounds.minX);
  const spanY = Math.max(0, bounds.maxY - bounds.minY);
  const maxScale = options?.maxScale ?? Math.min(availW, availH) * 1.1;

  const eps = 1e-6;
  let S: number;
  if (spanX < eps && spanY < eps) {
    S = Math.min(availW, availH) / 1.4;
  } else if (spanY < eps) {
    S = availW / spanX;
  } else if (spanX < eps) {
    S = availH / spanY;
  } else {
    S = Math.min(availW / spanX, availH / spanY);
  }
  S = Math.min(maxScale, Math.max(1e-9, S));

  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const targetCx = pad.left + availW / 2;
  const targetCy = pad.top + availH / 2;
  const ox = targetCx - cx * S;
  const oy = targetCy + cy * S;

  return {
    S,
    ox,
    oy,
    X: (x: number) => ox + x * S,
    Y: (y: number) => oy - y * S,
    bounds,
    availW,
    availH,
  };
}
