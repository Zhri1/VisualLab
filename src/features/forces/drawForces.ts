/** 把受力箭头画到已有画布坐标系上（X/Y 为世界→像素映射）。 */
import type { ForceArrow } from "./forceModel";

export interface ForceAvoidRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SUPERSCRIPTS: Record<string, string> = {
  "-": "⁻",
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};

/** 格式化力大小并附带单位 N：兼容宏牛、毫牛与微观带电粒子科学计数法。 */
export function formatForceMagnitude(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 N";
  if (n >= 100) return `${n.toFixed(0)} N`;
  if (n >= 0.1) return `${n.toFixed(1)} N`;
  if (n >= 0.001) return `${Number(n.toPrecision(2))} N`;
  const [mantissa, rawExp] = n.toExponential(1).split("e");
  const expStr = (rawExp ?? "0").replace(/^\+/, "");
  const sup = [...expStr].map((ch) => SUPERSCRIPTS[ch] ?? ch).join("");
  return `${mantissa}×10${sup} N`;
}

function overlapArea(a: ForceAvoidRect, b: ForceAvoidRect): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  if (ox <= 0) return 0;
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (oy <= 0) return 0;
  return ox * oy;
}

export function drawForceArrows(
  ctx: CanvasRenderingContext2D,
  arrows: ForceArrow[],
  X: (x: number) => number,
  Y: (y: number) => number,
  avoidRects?: ForceAvoidRect[],
  canvasSize?: { w: number; h: number }
): void {
  const placedRects: ForceAvoidRect[] = [...(avoidRects ?? [])];

  for (const a of arrows) {
    const px = X(a.from.x);
    const py = Y(a.from.y);
    const baseLen = Math.min(72, 16 + 12 * Math.log10(1 + a.magnitudeN));
    // 毫牛/微牛级小质量粒子受力给足可视长度，避免箭头缩成一点。
    const len = a.magnitudeN < 0.5 ? Math.max(a.kind === "magnetic" ? 32 : 28, baseLen) : baseLen;
    // 世界方向 → 屏幕方向（y 翻转）
    const dx = a.dir.x;
    const dy = -a.dir.y;
    const ex = px + dx * len;
    const ey = py + dy * len;
    ctx.save();
    ctx.strokeStyle = a.color;
    ctx.fillStyle = a.color;
    ctx.lineWidth = 1.8;
    if (a.dashed) ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    const ang = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 7 * Math.cos(ang - 0.42), ey - 7 * Math.sin(ang - 0.42));
    ctx.lineTo(ex - 7 * Math.cos(ang + 0.42), ey - 7 * Math.sin(ang + 0.42));
    ctx.closePath();
    ctx.fill();

    const text = `${a.label}=${formatForceMagnitude(a.magnitudeN)}`;
    ctx.font = "11px system-ui, sans-serif";
    const tw = ctx.measureText(text).width || text.length * 7;
    const boxW = tw + 4;
    const boxH = 14;
    // 箭头法向单位矢量，用于生成两侧候选文字位置。
    const nx = -dy;
    const ny = dx;
    const rawCandidates: Array<{ x: number; y: number }> = [
      // 优先箭头前方延长处
      { x: ex + dx * (boxW / 2 + 6) - boxW / 2, y: ey + dy * (boxH / 2 + 6) - boxH / 2 },
      // 其次箭头尖端两侧法向偏移
      { x: ex + nx * (boxW / 2 + 8) + dx * 2 - boxW / 2, y: ey + ny * (boxH / 2 + 8) + dy * 2 - boxH / 2 },
      { x: ex - nx * (boxW / 2 + 8) + dx * 2 - boxW / 2, y: ey - ny * (boxH / 2 + 8) + dy * 2 - boxH / 2 },
      // 再次箭身中段两侧
      { x: px + dx * len * 0.5 + nx * (boxW / 2 + 10) - boxW / 2, y: py + dy * len * 0.5 + ny * (boxH / 2 + 10) - boxH / 2 },
      { x: px + dx * len * 0.5 - nx * (boxW / 2 + 10) - boxW / 2, y: py + dy * len * 0.5 - ny * (boxH / 2 + 10) - boxH / 2 },
      // 兜底：箭头更远处 / 上下
      { x: ex + dx * (boxW / 2 + 20) - boxW / 2, y: ey + dy * (boxH / 2 + 20) - boxH / 2 },
      { x: ex - boxW / 2, y: ey - boxH - 8 },
      { x: ex - boxW / 2, y: ey + 8 },
    ];

    const clampRect = (pt: { x: number; y: number }): ForceAvoidRect => {
      let rx = pt.x;
      let ry = pt.y;
      if (canvasSize) {
        rx = Math.min(Math.max(4, rx), Math.max(4, canvasSize.w - boxW - 4));
        ry = Math.min(Math.max(4, ry), Math.max(4, canvasSize.h - boxH - 4));
      }
      return { x: rx, y: ry, w: boxW, h: boxH };
    };

    let bestRect = clampRect(rawCandidates[0]);
    let bestOverlap = Infinity;
    for (const cand of rawCandidates) {
      const rect = clampRect(cand);
      let total = 0;
      for (const avoid of placedRects) total += overlapArea(rect, avoid);
      if (total === 0) {
        bestRect = rect;
        bestOverlap = 0;
        break;
      }
      if (total < bestOverlap) {
        bestOverlap = total;
        bestRect = rect;
      }
    }
    placedRects.push(bestRect);

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#fbfbf9";
    ctx.strokeText(text, bestRect.x + 2, bestRect.y + boxH / 2);
    ctx.fillText(text, bestRect.x + 2, bestRect.y + boxH / 2);
    ctx.restore();
  }
}
