import type { Motion } from "../../../types";
import type { ViewportTransform } from "./canvasViewport";
import { drawForceArrows } from "../../../features/forces/drawForces";
import type { ForceArrow } from "../../../features/forces/forceModel";

const INK = "#1c1c1c";
const SOFT = "#8e8e88";
const HAIR = "#d6d6d1";
const PAPER = "#fbfbf9";
const VELOCITY_ACCENT = "#2e6b5e";
const CURRENT = "#8a4b4b";
const FIELD = "#7b8fa6";
const SANS = '-apple-system, "Segoe UI", "PingFang SC", sans-serif';

/**
 * 电磁感应导轨专用绘制：两条平行导轨 + 端点电阻 + 匀强磁场符号 + 运动导体棒。
 * 与通用阶段渲染分离，避免通用「方块」与导轨语义冲突。
 */
export function drawEmfRailScene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  motion: Motion,
  time: number,
  vp: ViewportTransform,
  forceArrows?: ForceArrow[],
): void {
  const g = motion.stageGeometry?.emfRail;
  if (!g) return;
  const { S, X, Y } = vp;
  const sample = motion.sampleAt(time);
  const L = g.railSpacingM;
  const travel = Math.max(g.travelM, L * 0.5);
  const pad = Math.max(L * 0.28, travel * 0.04);

  const y0 = Y(0);
  const y1 = Y(L);
  const xLeft = X(-pad);
  const xRight = X(travel + pad);
  const rodX = X(sample.position.x);
  const v = sample.velocity.x;
  const emf = sample.emfRail?.emfV ?? g.magneticTeslaB * L * v;
  const current = sample.emfRail?.currentA ?? emf / g.totalResistanceOhm;
  const ampere = sample.emfRail?.ampereForceN ?? (g.magneticTeslaB ** 2 * L ** 2 * v) / g.totalResistanceOhm;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  ctx.lineJoin = "round";
  ctx.lineCap = "butt";

  // 磁场区域底色
  ctx.fillStyle = "rgba(123,143,166,0.06)";
  ctx.fillRect(xLeft, Math.min(y0, y1), xRight - xLeft, Math.abs(y1 - y0));

  // 磁场符号：向里 ×，向外 ·
  const intoPage = g.fieldDirection === "into_page";
  const stepX = 44;
  const stepY = 40;
  ctx.strokeStyle = FIELD;
  ctx.fillStyle = FIELD;
  ctx.lineWidth = 1.2;
  for (let px = xLeft + 22; px < xRight - 12; px += stepX) {
    if (Math.abs(px - rodX) < 16) continue;
    for (let py = Math.min(y0, y1) + 18; py < Math.max(y0, y1) - 8; py += stepY) {
      if (intoPage) {
        ctx.beginPath();
        ctx.moveTo(px - 4, py - 4); ctx.lineTo(px + 4, py + 4);
        ctx.moveTo(px + 4, py - 4); ctx.lineTo(px - 4, py + 4);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 导轨
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(xLeft, y0); ctx.lineTo(xRight, y0);
  ctx.moveTo(xLeft, y1); ctx.lineTo(xRight, y1);
  ctx.stroke();

  // 左端电阻（折线）
  const resTop = Math.min(y0, y1);
  const resBottom = Math.max(y0, y1);
  const resMid = (resTop + resBottom) / 2;
  const resHalf = Math.min(34, (resBottom - resTop) * 0.22);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(xLeft, resTop);
  ctx.lineTo(xLeft, resMid - resHalf);
  const teeth = 6;
  for (let i = 0; i < teeth; i += 1) {
    const t = i / teeth;
    ctx.lineTo(xLeft + (i % 2 === 0 ? 9 : -9), resMid - resHalf + (resHalf * 2 * (t + 0.5 / teeth)));
  }
  ctx.lineTo(xLeft, resMid + resHalf);
  ctx.lineTo(xLeft, resBottom);
  ctx.stroke();
  ctx.fillStyle = SOFT;
  ctx.font = `500 12px ${SANS}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`R = ${g.totalResistanceOhm} Ω`, xLeft + 14, resMid);

  // 导体棒
  ctx.strokeStyle = INK;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(rodX, y0);
  ctx.lineTo(rodX, y1);
  ctx.stroke();
  ctx.strokeStyle = "#c9d8ea";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(rodX, y0 + 3);
  ctx.lineTo(rodX, y1 - 3);
  ctx.stroke();

  // 电流方向：向里磁场、向右运动时，棒内正电荷受力 +y（由下向上）
  const vSign = v >= 0 ? 1 : -1;
  const rodUp = intoPage ? vSign > 0 : vSign < 0;
  if (Math.abs(current) > 1e-12) {
    ctx.strokeStyle = CURRENT;
    ctx.lineWidth = 2;
    const arrowY = rodUp ? (y1 - y0) * 0.32 + Math.min(y0, y1) : (y1 - y0) * 0.68 + Math.min(y0, y1);
    const dir = rodUp ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(rodX + 12, arrowY);
    ctx.lineTo(rodX + 12, arrowY - dir * 26);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rodX + 12, arrowY - dir * 26);
    ctx.lineTo(rodX + 8, arrowY - dir * 17);
    ctx.lineTo(rodX + 16, arrowY - dir * 17);
    ctx.closePath();
    ctx.fillStyle = CURRENT;
    ctx.fill();
    ctx.font = `500 12px ${SANS}`;
    ctx.textAlign = "left";
    ctx.fillText("I", rodX + 18, arrowY - dir * 30);
  }

  // 速度箭头
  if (Math.abs(v) > 1e-9) {
    const len = Math.min(70, Math.max(28, Math.abs(v) * S * 0.02));
    const dir = v >= 0 ? 1 : -1;
    ctx.strokeStyle = VELOCITY_ACCENT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rodX, y0 - 26);
    ctx.lineTo(rodX + dir * len, y0 - 26);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rodX + dir * len, y0 - 26);
    ctx.lineTo(rodX + dir * (len - 9), y0 - 31);
    ctx.lineTo(rodX + dir * (len - 9), y0 - 21);
    ctx.closePath();
    ctx.fillStyle = VELOCITY_ACCENT;
    ctx.fill();
    ctx.font = `500 12px ${SANS}`;
    ctx.textAlign = dir > 0 ? "left" : "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`v = ${v.toFixed(2)} m/s`, rodX + dir * (len + 6), y0 - 22);
  }

  // 安培力箭头（阻碍相对运动）
  if (Math.abs(ampere) > 1e-9) {
    const dir = -Math.sign(v || 1);
    const len = 44;
    ctx.strokeStyle = CURRENT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rodX, y1 + 24);
    ctx.lineTo(rodX + dir * len, y1 + 24);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rodX + dir * len, y1 + 24);
    ctx.lineTo(rodX + dir * (len - 9), y1 + 19);
    ctx.lineTo(rodX + dir * (len - 9), y1 + 29);
    ctx.closePath();
    ctx.fillStyle = CURRENT;
    ctx.fill();
    ctx.font = `500 12px ${SANS}`;
    ctx.textAlign = dir > 0 ? "left" : "right";
    ctx.textBaseline = "top";
    ctx.fillText(`F安 = ${Math.abs(ampere).toFixed(3)} N`, rodX + dir * (len + 6), y1 + 18);
  }

  // 顶部读数
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = INK;
  ctx.font = `600 13px ${SANS}`;
  ctx.fillText(`B = ${g.magneticTeslaB} T（${intoPage ? "垂直纸面向里" : "垂直纸面向外"}）· L = ${L} m`, 18, 14);
  ctx.font = `500 12px ${SANS}`;
  ctx.fillStyle = SOFT;
  ctx.fillText(`ε = BLv = ${emf.toFixed(3)} V　I = ε/R = ${current.toFixed(3)} A`, 18, 34);
  ctx.fillText(`位移 x = ${sample.position.x.toFixed(3)} m　收尾速度 v_t = ${g.terminalSpeedMps.toFixed(3)} m/s`, 18, 52);

  // 导轨端点刻度
  ctx.strokeStyle = HAIR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(X(0), Math.max(y0, y1) + 6);
  ctx.lineTo(X(0), Math.max(y0, y1) + 12);
  ctx.stroke();
  ctx.fillStyle = SOFT;
  ctx.font = `11px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(g.startLabel ?? "起点", X(0), Math.max(y0, y1) + 14);

  // 受力叠加层：安培力已由本渲染器常驻绘制，这里跳过 magnetic 以免重复。
  const extra = forceArrows?.filter((a) => a.kind !== "magnetic");
  if (extra?.length) {
    const rodRect = { x: rodX - 8, y: Math.min(y0, y1) - 6, w: 16, h: Math.abs(y1 - y0) + 12 };
    drawForceArrows(ctx, extra, X, Y, [rodRect], { w: W, h: H });
  }
}
