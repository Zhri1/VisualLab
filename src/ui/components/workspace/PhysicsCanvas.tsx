/**
 * 物理示意图渲染。只做「世界坐标 → 屏幕坐标」和绘制，
 * 不含任何物理计算，运动数据全部来自 motion.sampleAt。
 *
 * 视觉规则（与 global.css 共用同一套语言）：
 * · 几何线 1.6px 墨色；尺寸线、引出线、剖面线 1px 淡灰。
 * · 物理量符号（h、θ、k、v、x、m）一律数学衬线斜体；
 *   测量数值用系统无衬线表格数字，符号与数值不混排。
 * · 字号先按世界尺度换算，再夹到 10.5–14px，窗口缩放时排版不失控。
 */
import { useCallback, useEffect, useRef } from "react";
import type { Motion, Vec2 } from "../../../types";

const INK = "#1c1c1c";
const SOFT = "#8e8e88";
const HAIR = "#d6d6d1";
const PAPER = "#fbfbf9";
const FILL = "#eaeae6";

/* 线宽：几何 / 尺寸线 / 弹簧 */
const W_EDGE = 1.6;
const W_HAIR = 1;
const W_COIL = 1.5;

const MATH = '"Cambria", "Cambria Math", Georgia, "Times New Roman", serif';
const SANS = '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

interface Props {
  motion: Motion | null;
  time: number;
}

interface Transform {
  S: number;
  ox: number;
  oy: number;
}

/** 一段文字：symbol 用数学斜体，其余用无衬线 */
interface Seg {
  t: string;
  symbol?: boolean;
}

function buildTransform(
  W: number,
  H: number,
  bounds: { x1: number; x2: number; y1: number; y2: number },
  pad: number
): Transform {
  const bw = bounds.x2 - bounds.x1;
  const bh = bounds.y2 - bounds.y1;
  const S = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh);
  const ox = pad + ((W - pad * 2) - bw * S) / 2 - bounds.x1 * S;
  const oy = pad + ((H - pad * 2) - bh * S) / 2 + bounds.y2 * S;
  return { S, ox, oy };
}

/** 按世界尺度换算字号，再夹到可读区间 */
function labelPx(S: number, k: number, min = 10.5, max = 14) {
  return Math.max(min, Math.min(max, S * k));
}

function fontOf(seg: Seg, px: number, weight = 500) {
  return seg.symbol
    ? `italic ${weight} ${px}px ${MATH}`
    : `${weight} ${px}px ${SANS}`;
}

/** 混排测量 */
function measureRich(ctx: CanvasRenderingContext2D, segs: Seg[], px: number) {
  let w = 0;
  for (const s of segs) {
    ctx.font = fontOf(s, px);
    w += ctx.measureText(s.t).width;
  }
  return w;
}

/** 混排绘制：符号斜体、数值正体，整体按 align 对齐 */
function drawRich(
  ctx: CanvasRenderingContext2D,
  segs: Seg[],
  x: number,
  y: number,
  px: number,
  align: "left" | "center" | "right" = "center"
) {
  const total = measureRich(ctx, segs, px);
  let cur = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  ctx.textAlign = "left";
  for (const s of segs) {
    ctx.font = fontOf(s, px);
    ctx.fillText(s.t, cur, y);
    cur += ctx.measureText(s.t).width;
  }
}

/** 实心箭头，ang 为箭头指向 */
function arrowHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  len: number,
  half: number
) {
  const bx = x - len * Math.cos(ang);
  const by = y - len * Math.sin(ang);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(bx - half * Math.sin(ang), by + half * Math.cos(ang));
  ctx.lineTo(bx + half * Math.sin(ang), by - half * Math.cos(ang));
  ctx.closePath();
  ctx.fill();
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  motion: Motion,
  time: number
) {
  const g = motion.geometry;
  const size = g.blockSizeM;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // 边界只留「标注必须占用的白」：高度尺寸线在左、尺寸线在下、
  // 压缩量标注在弹簧上方，其余一律收紧，让图形填满画布。
  const bounds = {
    x1: g.inclineTop.x - size * 2.15,
    x2: g.springAnchorX + size * 1.35,
    y1: -size * 2.05,
    y2: Math.max(g.inclineTop.y + size * 1.65, size * 2.6),
  };

  const pad = Math.max(20, Math.min(W, H) * 0.08);
  const { S, ox, oy } = buildTransform(W, H, bounds, pad);
  const X = (x: number) => ox + x * S;
  const Y = (y: number) => oy - y * S;

  const LBL = labelPx(S, 0.18);

  /* ---------- 地面 ---------- */
  const groundLeft = g.inclineTop.x - size * 1.7;
  ctx.strokeStyle = INK;
  ctx.lineWidth = W_EDGE;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(X(groundLeft), Y(0));
  ctx.lineTo(X(g.springAnchorX), Y(0));
  ctx.stroke();

  // 剖面线：按屏幕等距排列，窗口缩放时疏密不变
  ctx.strokeStyle = HAIR;
  ctx.lineWidth = W_HAIR;
  ctx.beginPath();
  const gx0 = X(groundLeft);
  const gx1 = X(g.springAnchorX);
  for (let sx = gx0 + 5; sx < gx1 - 2; sx += 9) {
    ctx.moveTo(sx, Y(0));
    ctx.lineTo(sx - 5.5, Y(0) + 6.5);
  }
  ctx.stroke();

  /* ---------- 斜面 ---------- */
  ctx.beginPath();
  ctx.moveTo(X(g.inclineTop.x), Y(g.inclineTop.y));
  ctx.lineTo(X(0), Y(0));
  ctx.lineTo(X(g.inclineTop.x), Y(0));
  ctx.closePath();
  ctx.fillStyle = FILL;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = W_EDGE;
  ctx.lineJoin = "miter";
  ctx.stroke();

  /* ---------- 高度尺寸线 ---------- */
  const hxW = g.inclineTop.x - size * 1.28;
  const hLine = X(hxW);
  const yTop = Y(g.inclineTop.y);
  const yBot = Y(0);

  ctx.strokeStyle = HAIR;
  ctx.lineWidth = W_HAIR;
  ctx.beginPath();
  ctx.moveTo(X(g.inclineTop.x), yTop);
  ctx.lineTo(hLine - 4, yTop);
  ctx.moveTo(X(0), yBot);
  ctx.lineTo(hLine - 4, yBot);
  ctx.stroke();

  ctx.strokeStyle = SOFT;
  ctx.beginPath();
  ctx.moveTo(hLine, yTop);
  ctx.lineTo(hLine, yBot);
  ctx.stroke();

  ctx.fillStyle = SOFT;
  arrowHead(ctx, hLine, yTop, Math.PI / 2, 7, 2.4);
  arrowHead(ctx, hLine, yBot, -Math.PI / 2, 7, 2.4);

  ctx.save();
  ctx.translate(hLine - 11, (yTop + yBot) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = SOFT;
  ctx.textBaseline = "middle";
  drawRich(
    ctx,
    [{ t: "h", symbol: true }, { t: ` = ${g.inclineTop.y.toFixed(2)} m` }],
    0,
    0,
    LBL
  );
  ctx.restore();

  /* ---------- 倾角 ---------- */
  const theta = Math.atan2(g.inclineTop.y, -g.inclineTop.x);
  const arcR = Math.min(0.85, Math.abs(g.inclineTop.x) * 0.42);
  ctx.strokeStyle = SOFT;
  ctx.lineWidth = W_HAIR;
  ctx.beginPath();
  ctx.arc(X(0), Y(0), arcR * S, Math.PI, Math.PI + theta, false);
  ctx.stroke();

  const bis = Math.PI + theta / 2;
  ctx.fillStyle = SOFT;
  ctx.textBaseline = "middle";
  drawRich(
    ctx,
    [{ t: "θ", symbol: true }, { t: ` = ${((theta * 180) / Math.PI).toFixed(1)}°` }],
    X(0) + Math.cos(bis) * (arcR * S + 20),
    Y(0) + Math.sin(bis) * (arcR * S + 20),
    LBL
  );

  /* ---------- 弹簧 ---------- */
  const sample = motion.sampleAt(time);
  const comp = Math.max(0, sample.springCompressionM);
  const freeX = g.springContactX;
  const anchorX = g.springAnchorX;
  // 滑块推到弹簧后，接触端被压缩
  const plateX = Math.min(anchorX - 0.02, freeX + comp);
  const coilH = size * 0.42;
  const span = anchorX - plateX;
  const coils = 9;
  // 压缩阶段整体加重一档，让「正在压缩」这个状态一眼可读
  const hot = comp > 0.004;

  // 弹簧接触端（压板）
  ctx.strokeStyle = INK;
  ctx.lineWidth = hot ? W_EDGE + 0.5 : W_EDGE;
  ctx.beginPath();
  ctx.moveTo(X(plateX), Y(0));
  ctx.lineTo(X(plateX), Y(size * 1.5));
  ctx.stroke();

  // 线圈
  ctx.strokeStyle = INK;
  ctx.lineWidth = hot ? W_COIL + 0.4 : W_COIL;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(X(plateX), Y(coilH * 0.5));
  for (let i = 0; i < coils * 2; i++) {
    const t = (i + 0.5) / (coils * 2);
    ctx.lineTo(X(plateX + span * t), Y(coilH * 0.5 + (i % 2 === 0 ? coilH : -coilH)));
  }
  ctx.lineTo(X(anchorX), Y(coilH * 0.5));
  ctx.stroke();

  // 固定端墙面
  ctx.strokeStyle = INK;
  ctx.lineWidth = W_EDGE;
  ctx.beginPath();
  ctx.moveTo(X(anchorX), Y(0));
  ctx.lineTo(X(anchorX), Y(coilH + size * 1.1));
  ctx.stroke();
  ctx.strokeStyle = HAIR;
  ctx.lineWidth = W_HAIR;
  ctx.beginPath();
  for (let y = 0.05; y < coilH + size; y += size * 0.3) {
    ctx.moveTo(X(anchorX), Y(y));
    ctx.lineTo(X(anchorX + 0.15), Y(y + 0.1));
  }
  ctx.stroke();

  // k 标注
  ctx.fillStyle = SOFT;
  ctx.textBaseline = "bottom";
  drawRich(ctx, [{ t: "k", symbol: true }], X((plateX + anchorX) / 2), Y(coilH + size * 0.42), LBL);

  /* ---------- 尺寸线 ---------- */
  /** 水平尺寸线：引出线 + 双箭头 + 居中标签 */
  const hDim = (
    x1w: number,
    x2w: number,
    yw: number,
    segs: Seg[],
    extendFromWorld: number,
    labelAbove: boolean
  ) => {
    const yy = Y(yw);
    const xa = X(x1w);
    const xb = X(x2w);
    const yFrom = Y(extendFromWorld);

    ctx.strokeStyle = HAIR;
    ctx.lineWidth = W_HAIR;
    ctx.beginPath();
    ctx.moveTo(xa, yFrom);
    ctx.lineTo(xa, labelAbove ? yy + 3 : yy - 3);
    ctx.moveTo(xb, yFrom);
    ctx.lineTo(xb, labelAbove ? yy + 3 : yy - 3);
    ctx.stroke();

    ctx.strokeStyle = SOFT;
    ctx.beginPath();
    ctx.moveTo(xa, yy);
    ctx.lineTo(xb, yy);
    ctx.stroke();

    ctx.fillStyle = SOFT;
    arrowHead(ctx, xa, yy, Math.PI, 6.5, 2.2);
    arrowHead(ctx, xb, yy, 0, 6.5, 2.2);

    ctx.fillStyle = SOFT;
    ctx.textBaseline = labelAbove ? "bottom" : "top";
    drawRich(ctx, segs, (xa + xb) / 2, labelAbove ? yy - 6 : yy + 6, LBL);
  };

  hDim(0, freeX, -size * 1.5, [{ t: `${freeX.toFixed(2)} m` }], 0, false);

  /* ---------- 滑块 ---------- */
  const half = size / 2;
  const drawBlock = (cx: number, cy: number, rotation: number, ghost: boolean) => {
    ctx.save();
    ctx.translate(X(cx), Y(cy));
    ctx.rotate(rotation);
    const s = half * S;
    const r = Math.min(s, Math.max(3, s * 0.2));
    ctx.beginPath();
    ctx.moveTo(-s + r, -s);
    ctx.lineTo(s - r, -s);
    ctx.arcTo(s, -s, s, -s + r, r);
    ctx.lineTo(s, s - r);
    ctx.arcTo(s, s, s - r, s, r);
    ctx.lineTo(-s + r, s);
    ctx.arcTo(-s, s, -s, s - r, r);
    ctx.lineTo(-s, -s + r);
    ctx.arcTo(-s, -s, -s + r, -s, r);
    ctx.closePath();
    if (ghost) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "#cbcbc5";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `italic 500 ${Math.max(10, s * 0.86)}px ${MATH}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // 视觉居中：斜体 m 的字面重心略偏上，下移半像素
      ctx.fillText("m", 0, s * 0.06);
    }
    ctx.restore();
  };

  // 起点虚影：与 sampleAt(0) 的方块中心重合
  const sNx = Math.sin(theta);
  const sNy = Math.cos(theta);
  const sTx = Math.cos(theta);
  const sTy = -Math.sin(theta);
  drawBlock(
    g.inclineTop.x + sNx * half - sTx * half,
    g.inclineTop.y + sNy * half - sTy * half,
    theta,
    true
  );

  // position 是滑块「前下沿」接触点：沿运动方向的前端、贴着支撑面的一角。
  // 几何中心 = 接触点 + 法向 × half − 切向 × half。
  const onIncline = Math.abs(sample.position.y) > 1e-9;
  const rot = onIncline ? theta : 0;
  const nx = Math.sin(rot);
  const ny = Math.cos(rot);
  const tx = Math.cos(rot);
  const ty = -Math.sin(rot);
  const centerX = sample.position.x + nx * half - tx * half;
  const centerY = sample.position.y + ny * half - ty * half;
  drawBlock(centerX, centerY, rot, false);

  /* ---------- 速度箭头 ---------- */
  const vx = sample.velocity.x;
  const vy = sample.velocity.y;
  const speed = Math.hypot(vx, vy);
  if (speed > 0.08) {
    // 用全程最大速率做归一，箭头长度才在同一尺度上可比
    const vRef = Math.max(
      1e-6,
      ...motion.events.map((e) =>
        Math.max(
          e.velocityAfter ? Math.hypot(e.velocityAfter.x, e.velocityAfter.y) : 0,
          e.velocityBefore ? Math.hypot(e.velocityBefore.x, e.velocityBefore.y) : 0
        )
      )
    );
    const lenWorld = Math.min(1.5, 0.3 + (speed / vRef) * 0.9);
    const ux = vx / speed;
    const uy = vy / speed;
    // 箭头从中点沿切向外推半个边长起笔，避免压在方块上
    const ax = centerX + tx * half + ux * (half * 0.85 + 0.04);
    const ay = centerY + ty * half + uy * (half * 0.85 + 0.04);
    const bx = ax + ux * lenWorld;
    const by = ay + uy * lenWorld;

    const p0x = X(ax);
    const p0y = Y(ay);
    const p1x = X(bx);
    const p1y = Y(by);

    ctx.strokeStyle = "#3a3a36";
    ctx.lineWidth = W_EDGE;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(p0x, p0y);
    ctx.lineTo(p1x, p1y);
    ctx.stroke();

    const ang = Math.atan2(p1y - p0y, p1x - p0x);
    ctx.fillStyle = "#3a3a36";
    arrowHead(ctx, p1x, p1y, ang, Math.max(7, S * 0.08), Math.max(3.2, S * 0.035));

    // v 标签：沿箭头方向外移，避开箭头本体
    ctx.fillStyle = "#3a3a36";
    ctx.textBaseline = "bottom";
    drawRich(
      ctx,
      [{ t: "v", symbol: true }],
      p1x + ux * 13,
      p1y + uy * 13 - 3,
      LBL + 1
    );
  }

  /* ---------- 压缩量 ---------- */
  if (comp > 0.012) {
    hDim(
      freeX,
      freeX + comp,
      coilH + size * 0.92,
      [{ t: "x", symbol: true }, { t: ` = ${comp.toFixed(3)} m` }],
      coilH + size * 0.55,
      true
    );
  }
}

export function PhysicsCanvas({ motion, time }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  // 重绘需要的状态单独存一份，resize 时也能按最新状态补画
  const motionRef = useRef<Motion | null>(null);
  const timeRef = useRef(0);
  motionRef.current = motion;
  timeRef.current = time;

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const m = motionRef.current;
    if (!canvas || !m) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;
    drawScene(ctx, w, h, m, timeRef.current);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w: rect.width, h: rect.height };
    };

    resize();
    // 首帧先画一次：ResizeObserver 调整位图后不会自己触发重绘
    paint();
    const ro = new ResizeObserver(() => {
      resize();
      paint();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [paint]);

  useEffect(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => paint());
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [motion, time, paint]);

  return <canvas ref={canvasRef} aria-label="物理运动示意动画" role="img" />;
}
