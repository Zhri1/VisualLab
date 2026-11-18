/**
 * 物理示意图渲染。只做「世界坐标 → 屏幕坐标」和绘制，
 * 不含任何物理计算，运动数据全部来自 motion.sampleAt。
 */
import { useEffect, useRef } from "react";
import type { Motion, Vec2 } from "../../../types";

const INK = "#1c1c1c";
const SOFT = "#9a9a95";
const HAIR = "#d6d6d1";
const PAPER = "#fbfbf9";
const FILL = "#eaeae6";

interface Props {
  motion: Motion | null;
  time: number;
}

interface Transform {
  S: number;
  ox: number;
  oy: number;
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

  const bounds = {
    x1: g.inclineTop.x - size * 2.2,
    x2: g.springAnchorX + size * 1.4,
    y1: -size * 2.4,
    y2: Math.max(g.inclineTop.y + size * 2.4, size * 3),
  };

  const pad = Math.max(18, Math.min(W, H) * 0.075);
  const { S, ox, oy } = buildTransform(W, H, bounds, pad);
  const X = (x: number) => ox + x * S;
  const Y = (y: number) => oy - y * S;

  const font = (px: number, weight = 500) =>
    `${weight} ${Math.max(10, px)}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;

  /* ---------- 地面 ---------- */
  const groundLeft = g.inclineTop.x - size * 1.6;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(X(groundLeft), Y(0));
  ctx.lineTo(X(g.springAnchorX), Y(0));
  ctx.stroke();

  // 地面剖面线
  ctx.strokeStyle = HAIR;
  ctx.lineWidth = 1;
  const hatch = 0.14;
  for (let x = groundLeft + 0.06; x < g.springAnchorX; x += hatch * 1.6) {
    ctx.beginPath();
    ctx.moveTo(X(x), Y(0));
    ctx.lineTo(X(x - hatch), Y(-hatch * 1.1));
    ctx.stroke();
  }

  /* ---------- 斜面 ---------- */
  ctx.beginPath();
  ctx.moveTo(X(g.inclineTop.x), Y(g.inclineTop.y));
  ctx.lineTo(X(0), Y(0));
  ctx.lineTo(X(g.inclineTop.x), Y(0));
  ctx.closePath();
  ctx.fillStyle = FILL;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  /* ---------- 高度标注 ---------- */
  const hx = g.inclineTop.x - size * 1.15;
  ctx.strokeStyle = SOFT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(X(hx), Y(0));
  ctx.lineTo(X(hx), Y(g.inclineTop.y));
  ctx.stroke();
  // 端部短横
  [0, g.inclineTop.y].forEach((y) => {
    ctx.beginPath();
    ctx.moveTo(X(hx - 0.09), Y(y));
    ctx.lineTo(X(hx + 0.09), Y(y));
    ctx.stroke();
  });
  ctx.save();
  ctx.translate(X(hx - size * 0.55), Y(g.inclineTop.y / 2));
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#6b6b66";
  ctx.font = font(S * 0.19);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`h = ${g.inclineTop.y.toFixed(2)} m`, 0, 0);
  ctx.restore();

  /* ---------- 倾角 ---------- */
  const theta = Math.atan2(g.inclineTop.y, -g.inclineTop.x);
  const arcR = Math.min(0.85, Math.abs(g.inclineTop.x) * 0.42);
  ctx.strokeStyle = SOFT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(X(0), Y(0), arcR * S, Math.PI, Math.PI + theta, false);
  ctx.stroke();
  ctx.fillStyle = "#6b6b66";
  ctx.font = font(S * 0.17);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `θ = ${((theta * 180) / Math.PI).toFixed(1)}°`,
    X(0) - arcR * S * 0.35,
    Y(arcR * 0.55)
  );

  /* ---------- 弹簧 ---------- */
  const sample = motion.sampleAt(time);
  const comp = Math.max(0, sample.springCompressionM);
  const freeX = g.springContactX;
  const anchorX = g.springAnchorX;
  // 滑块推到弹簧后，接触端被压缩
  const plateX = Math.min(anchorX - 0.02, freeX + comp);

  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(X(plateX), Y(0));
  ctx.lineTo(X(plateX), Y(size * 1.5));
  ctx.stroke();

  const coilH = size * 0.42;
  const span = anchorX - plateX;
  const coils = 9;
  ctx.beginPath();
  ctx.moveTo(X(plateX), Y(coilH * 0.5));
  for (let i = 0; i < coils * 2; i++) {
    const t = (i + 0.5) / (coils * 2);
    ctx.lineTo(X(plateX + span * t), Y(coilH * 0.5 + (i % 2 === 0 ? coilH : -coilH)));
  }
  ctx.lineTo(X(anchorX), Y(coilH * 0.5));
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 固定端墙面
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(X(anchorX), Y(0));
  ctx.lineTo(X(anchorX), Y(coilH + size * 1.1));
  ctx.stroke();
  ctx.strokeStyle = HAIR;
  ctx.lineWidth = 1;
  for (let y = coilH * 0.1; y < coilH + size; y += size * 0.34) {
    ctx.beginPath();
    ctx.moveTo(X(anchorX), Y(y));
    ctx.lineTo(X(anchorX + 0.16), Y(y + 0.11));
    ctx.stroke();
  }

  // k 标注
  ctx.fillStyle = "#6b6b66";
  ctx.font = font(S * 0.17);
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("k", X((plateX + anchorX) / 2), Y(coilH + size * 0.5));

  /* ---------- 水平距离标注 ---------- */
  const drawDim = (x1: number, x2: number, label: string) => {
    const y = -size * 1.55;
    ctx.strokeStyle = SOFT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(x1), Y(y));
    ctx.lineTo(X(x2), Y(y));
    ctx.stroke();
    [x1, x2].forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(X(x), Y(y - 0.07));
      ctx.lineTo(X(x), Y(y + 0.07));
      ctx.stroke();
      // 引出线
      ctx.beginPath();
      ctx.moveTo(X(x), Y(y));
      ctx.lineTo(X(x), Y(-0.02));
      ctx.stroke();
    });
    ctx.fillStyle = "#6b6b66";
    ctx.font = font(S * 0.165);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, X((x1 + x2) / 2), Y(y) + 6);
  };
  drawDim(0, freeX, `${freeX.toFixed(2)} m`);

  /* ---------- 滑块 ---------- */
  const half = size / 2;
  const drawBlock = (cx: number, cy: number, rotation: number, ghost: boolean) => {
    ctx.save();
    ctx.translate(X(cx), Y(cy));
    ctx.rotate(rotation);
    const s = half * S;
    const r = Math.min(s, Math.max(3, s * 0.22));
    // 手绘圆角矩形，避免依赖 Canvas2D 的 roundRect（旧 WebView 可能缺失）
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
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "#c6c6c0";
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `italic 600 ${Math.max(11, s * 1.05)}px Cambria, Georgia, serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("m", 0, s * 0.04);
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

    ctx.strokeStyle = "#4a4a46";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(X(ax), Y(ay));
    ctx.lineTo(X(bx), Y(by));
    ctx.stroke();

    const ang = Math.atan2(Y(by) - Y(ay), X(bx) - X(ax));
    const head = Math.max(6, S * 0.07);
    ctx.beginPath();
    ctx.moveTo(X(bx), Y(by));
    ctx.lineTo(X(bx) - head * Math.cos(ang - 0.42), Y(by) - head * Math.sin(ang - 0.42));
    ctx.moveTo(X(bx), Y(by));
    ctx.lineTo(X(bx) - head * Math.cos(ang + 0.42), Y(by) - head * Math.sin(ang + 0.42));
    ctx.stroke();

    // v 标签
    ctx.fillStyle = "#4a4a46";
    ctx.font = font(S * 0.16, 600);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("v", X(bx + ux * 0.12) + (uy !== 0 ? 8 : 0), Y(by + uy * 0.12) - 4);
  }

  /* ---------- 压缩量标注 ---------- */
  if (comp > 0.012) {
    ctx.fillStyle = "#4a4a46";
    ctx.font = font(S * 0.16);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(`x = ${comp.toFixed(3)} m`, X(freeX + comp / 2), Y(-size * 0.7));
  }
}

export function PhysicsCanvas({ motion, time }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

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
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas || !motion) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { w, h } = sizeRef.current;
      if (w === 0 || h === 0) return;
      drawScene(ctx, w, h, motion, time);
    });
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [motion, time]);

  return <canvas ref={canvasRef} aria-label="物理运动示意动画" role="img" />;
}
