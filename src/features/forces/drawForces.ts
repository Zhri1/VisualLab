/** 把受力箭头画到已有画布坐标系上（X/Y 为世界→像素映射）。 */
import type { ForceArrow } from "./forceModel";

export function drawForceArrows(
  ctx: CanvasRenderingContext2D,
  arrows: ForceArrow[],
  X: (x: number) => number,
  Y: (y: number) => number
): void {
  for (const a of arrows) {
    const px = X(a.from.x);
    const py = Y(a.from.y);
    const len = Math.min(72, 16 + 12 * Math.log10(1 + a.magnitudeN));
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
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(`${a.label}=${a.magnitudeN >= 100 ? a.magnitudeN.toFixed(0) : a.magnitudeN.toFixed(1)}`, ex + 4 * dx + 3, ey + 4 * dy - 3);
    ctx.restore();
  }
}
