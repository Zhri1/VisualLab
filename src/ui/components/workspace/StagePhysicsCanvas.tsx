import { useCallback, useEffect, useRef } from "react";
import type { Motion, Vec2 } from "../../../types";
import { formatSpeed } from "./playback";

const INK = "#1c1c1c";
const SOFT = "#8e8e88";
const HAIR = "#d6d6d1";
const PAPER = "#fbfbf9";
const FILL = "#eaeae6";
const MATH = '"Cambria", "Cambria Math", Georgia, serif';
const SANS = '-apple-system, "Segoe UI", "PingFang SC", sans-serif';

function hasInclineLaunch(motion: Motion): boolean {
  return !!motion.stagePlan?.stages.some((stage, i, stages) => stage.kind === "incline_slide" && stages[i + 1]?.kind === "projectile");
}
const componentText = (value: number) => Math.abs(value) < .005 ? "0" : value.toFixed(2);

interface Props {
  motion: Motion;
  time: number;
  isPlaying?: boolean;
}

type Bounds = { x1: number; x2: number; y1: number; y2: number };

export function drawStageScene(ctx: CanvasRenderingContext2D, W: number, H: number, motion: Motion, time: number) {
  const g = motion.stageGeometry!;
  const inclineLaunch = hasInclineLaunch(motion);
  const displayArc = g.verticalArc ?? g.schematic?.verticalArc;
  const size = g.blockSizeM;
  const sample = motion.sampleAt(time);
  const first = motion.sampleAt(0);
  const last = motion.sampleAt(motion.durationSeconds);
  const points: Vec2[] = [first.position, last.position];
  for (const landmark of g.landmarks ?? []) points.push({ x: landmark.position.xM, y: landmark.position.yM });
  if (g.incline) points.push({ x: g.incline.start.xM, y: g.incline.start.yM }, { x: g.incline.end.xM, y: g.incline.end.yM });
  if (g.horizontal) {
    points.push({ x: g.horizontal.start.xM, y: g.horizontal.start.yM });
    if (g.horizontal.plannedEnd) points.push({ x: g.horizontal.plannedEnd.xM, y: g.horizontal.plannedEnd.yM });
  }
  if (g.spring) points.push({ x: g.spring.contact.xM, y: g.spring.contact.yM }, { x: g.spring.anchor.xM, y: g.spring.anchor.yM });
  if (g.projectile) points.push({ x: g.projectile.launch.xM, y: g.projectile.launch.yM }, { x: last.position.x, y: g.projectile.landingPlane.yM });
  if (displayArc) {
    const arc = displayArc;
    points.push({ x: arc.entry.xM, y: arc.entry.yM }, { x: arc.plannedEnd.xM, y: arc.plannedEnd.yM },
      { x: arc.center.xM + arc.radiusM * Math.sin(Math.min(90, arc.endAngleDeg) * Math.PI / 180), y: arc.center.yM });
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const bounds: Bounds = {
    x1: Math.min(...xs) - size * 2,
    x2: Math.max(...xs) + size * 2,
    y1: Math.min(...ys) - size * 2.2,
    y2: Math.max(...ys) + size * 2.3,
  };
  const bw = Math.max(1, bounds.x2 - bounds.x1);
  const bh = Math.max(1, bounds.y2 - bounds.y1);
  const pad = Math.max(22, Math.min(W, H) * 0.09);
  const S = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh);
  const ox = pad + ((W - pad * 2) - bw * S) / 2 - bounds.x1 * S;
  const oy = pad + ((H - pad * 2) - bh * S) / 2 + bounds.y2 * S;
  const X = (x: number) => ox + x * S;
  const Y = (y: number) => oy - y * S;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  if (g.schematic?.horizontal) {
    const { start, plannedEnd } = g.schematic.horizontal;
    ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = SOFT;
    ctx.beginPath(); ctx.moveTo(X(start.xM), Y(start.yM)); ctx.lineTo(X(plannedEnd.xM), Y(plannedEnd.yM)); ctx.stroke(); ctx.restore();
    ctx.fillStyle = SOFT; ctx.font = `12px ${SANS}`; ctx.fillText("前段示意 · 未计时", Math.max(8, X(start.xM)), Y(start.yM) + 36);
  }
  const release = g.springRelease;
  const springIcon = release?.start ?? g.schematic?.springIconAt;
  if (springIcon) {
    if (release) { ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(X(release.start.xM), Y(release.start.yM)); ctx.lineTo(X(release.naturalContact.xM), Y(release.naturalContact.yM)); ctx.stroke(); }
    const left = X(springIcon.xM) - 34, right = X(release ? release.naturalContact.xM - sample.springCompressionM : springIcon.xM);
    ctx.strokeStyle = SOFT; ctx.beginPath(); ctx.moveTo(left, Y(springIcon.yM) - 5);
    for (let i = 1; i <= 12; i++) ctx.lineTo(left + (right - left) * i / 12, Y(springIcon.yM) - 5 + (i % 2 ? -5 : 5)); ctx.stroke();
  }

  const active = [...motion.segments].reverse().find((segment) => time >= segment.startSeconds - 1e-9)
    ?? motion.segments[0];

  // 斜面：几何来自 StageGeometry，而不是由当前位置反推。
  if (g.incline) {
    const { start, end } = g.incline;
    ctx.beginPath();
    ctx.moveTo(X(start.xM), Y(start.yM));
    ctx.lineTo(X(end.xM), Y(end.yM));
    ctx.lineTo(X(start.xM), Y(end.yM));
    ctx.closePath();
    ctx.fillStyle = FILL;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = active?.kind === "incline" ? 2.4 : 1.6;
    ctx.stroke();
    ctx.fillStyle = SOFT;
    ctx.font = `500 12px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("AB", X((start.xM + end.xM) / 2), Y((start.yM + end.yM) / 2) - 10);
    if (inclineLaunch) {
      ctx.textAlign = "right";
      ctx.fillText("檐口 B", X(end.xM) - 10, Y(end.yM) + 20);
    }
  }

  // 水平支撑总是延伸到题设目标，提前停住也不裁掉桌沿。
  let horizontalEndX: number | null = null;
  let horizontalY = 0;
  if (g.horizontal) {
    const start = g.horizontal.start;
    horizontalY = start.yM;
    horizontalEndX = g.horizontal.plannedEnd?.xM
      ?? g.spring?.contact.xM
      ?? (active?.kind === "horizontal" ? last.position.x : start.xM);
    ctx.strokeStyle = INK;
    ctx.lineWidth = active?.kind === "horizontal" ? 2.4 : 1.6;
    ctx.beginPath();
    ctx.moveTo(X(start.xM), Y(start.yM));
    ctx.lineTo(X(horizontalEndX), Y(start.yM));
    ctx.stroke();
    ctx.strokeStyle = HAIR;
    ctx.lineWidth = 1;
    for (let x = start.xM + 0.15; x < horizontalEndX; x += 0.25) {
      ctx.beginPath();
      ctx.moveTo(X(x), Y(start.yM));
      ctx.lineTo(X(x - 0.12), Y(start.yM) + 6);
      ctx.stroke();
    }
  }

  const horizontalIndex = motion.stagePlan?.stages.findIndex((stage) => stage.kind === "horizontal_slide") ?? -1;
  const hasPlannedProjectile = horizontalIndex >= 0 && motion.stagePlan?.stages[horizontalIndex + 1]?.kind === "projectile";
  const hasPlannedArc = horizontalIndex >= 0 && motion.stagePlan?.stages[horizontalIndex + 1]?.kind === "vertical_arc";
  const plannedEnd = g.horizontal?.plannedEnd;
  if (plannedEnd && hasPlannedProjectile) {
    const floorY = g.projectile?.landingPlane.yM ?? plannedEnd.yM - size * 4;
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = SOFT;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(X(plannedEnd.xM), Y(plannedEnd.yM));
    ctx.lineTo(X(plannedEnd.xM), Y(floorY));
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = SOFT;
    ctx.font = `500 12px ${SANS}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("桌沿", X(plannedEnd.xM) + 7, Y(plannedEnd.yM) - 5);
  }

  // 圆弧使用质点轨迹；真实入口与计划端点均来自米制几何，不按画布缩放反推。
  if (displayArc) {
    const arc = displayArc;
    ctx.save(); if (!g.verticalArc) ctx.setLineDash([5, 5]);
    ctx.strokeStyle = INK;
    ctx.lineWidth = sample.constraint ? 2.4 : 1.6;
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const phi = arc.endAngleDeg * Math.PI / 180 * i / 80;
      const x = X(arc.entry.xM + arc.radiusM * Math.sin(phi));
      const y = Y(arc.entry.yM + arc.radiusM * (1 - Math.cos(phi)));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.restore();
    ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = HAIR; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(arc.center.xM), Y(arc.center.yM));
    ctx.lineTo(X(arc.center.xM + arc.radiusM), Y(arc.center.yM)); ctx.stroke(); ctx.restore();
    ctx.font = `500 12px ${SANS}`; ctx.fillStyle = SOFT; ctx.textAlign = "center";
    ctx.fillText("R", X(arc.center.xM + arc.radiusM / 2), Y(arc.center.yM) - 7);
    if (!g.landmarks?.length) ctx.fillText(arc.endAngleDeg === 180 ? "C" : "端点", X(arc.plannedEnd.xM) - 10, Y(arc.plannedEnd.yM) - 12);
  }
  const arcEntry = g.verticalArc?.entry ?? (hasPlannedArc ? plannedEnd : undefined);
  if (arcEntry && !g.landmarks?.length) {
    ctx.font = `500 12px ${SANS}`; ctx.fillStyle = SOFT; ctx.textAlign = "center";
    ctx.fillText("B", X(arcEntry.xM), Y(arcEntry.yM) + 19);
    if (g.horizontal) ctx.fillText("A", X(g.horizontal.start.xM), Y(g.horizontal.start.yM) + 19);
  }

  // 只有实际进入抛体阶段才画轨迹与落地面。
  const projectileSegment = motion.segments.find((segment) => segment.kind === "projectile");
  if (g.projectile && (projectileSegment || inclineLaunch)) {
    const floorY = g.projectile.landingPlane.yM;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(X(Math.min(g.projectile.launch.xM, last.position.x) - size), Y(floorY));
    ctx.lineTo(X(Math.max(g.projectile.launch.xM, last.position.x) + size), Y(floorY));
    ctx.stroke();
    if (inclineLaunch) {
      const launch = g.projectile.launch;
      ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = HAIR; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(launch.xM), Y(launch.yM)); ctx.lineTo(X(launch.xM), Y(floorY)); ctx.stroke(); ctx.restore();
      ctx.font = `12px ${SANS}`; ctx.fillStyle = SOFT; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText(`h = ${Number((launch.yM - floorY).toPrecision(6))} m`, X(launch.xM) - 8, Y((launch.yM + floorY) / 2));
    }
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = HAIR;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let index = 0; projectileSegment && index <= 36; index += 1) {
      const t = projectileSegment.startSeconds
        + (projectileSegment.endSeconds - projectileSegment.startSeconds) * (index / 36);
      const point = motion.sampleAt(t).position;
      if (index === 0) ctx.moveTo(X(point.x), Y(point.y));
      else ctx.lineTo(X(point.x), Y(point.y));
    }
    ctx.stroke();
    ctx.restore();
  }

  // 弹簧与原长接触端。
  if (g.spring) {
    const compression = Math.max(0, sample.springCompressionM);
    const plateX = Math.min(g.spring.anchor.xM - 0.02, g.spring.contact.xM + compression);
    const span = Math.max(0.02, g.spring.anchor.xM - plateX);
    const coilY = g.spring.contact.yM + size * 0.55;
    ctx.strokeStyle = INK;
    ctx.lineWidth = compression > 0.004 ? 2 : 1.5;
    ctx.beginPath();
    ctx.moveTo(X(plateX), Y(g.spring.contact.yM));
    ctx.lineTo(X(plateX), Y(g.spring.contact.yM + size * 1.35));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(X(plateX), Y(coilY));
    for (let index = 0; index < 18; index += 1) {
      const ratio = (index + 0.5) / 18;
      ctx.lineTo(X(plateX + span * ratio), Y(coilY + (index % 2 === 0 ? size * 0.32 : -size * 0.32)));
    }
    ctx.lineTo(X(g.spring.anchor.xM), Y(coilY));
    ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(X(g.spring.anchor.xM), Y(g.spring.anchor.yM));
    ctx.lineTo(X(g.spring.anchor.xM), Y(g.spring.anchor.yM + size * 1.5));
    ctx.stroke();
    ctx.fillStyle = SOFT;
    ctx.font = `italic 500 13px ${MATH}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("k", X((plateX + g.spring.anchor.xM) / 2), Y(coilY + size * 0.55));
  }

  const inclineAngle = g.incline
    ? Math.atan2(g.incline.start.yM - g.incline.end.yM, g.incline.end.xM - g.incline.start.xM)
    : 0;
  const onIncline = active?.kind === "incline";
  const rotation = onIncline ? inclineAngle : 0;
  const half = size / 2;
  const tx = Math.cos(rotation);
  const ty = -Math.sin(rotation);
  const nx = Math.sin(rotation);
  const ny = Math.cos(rotation);

  const block = (point: Vec2, ghost: boolean) => {
    if (g.positionReference === "particle") {
      ctx.save(); ctx.beginPath(); ctx.arc(X(point.x), Y(point.y), 6, 0, 2 * Math.PI);
      if (ghost) { ctx.setLineDash([2, 3]); ctx.strokeStyle = SOFT; ctx.stroke(); }
      else { ctx.fillStyle = INK; ctx.fill(); }
      ctx.restore(); return point;
    }
    const centerX = point.x + nx * half - tx * half;
    const centerY = point.y + ny * half - ty * half;
    ctx.save();
    ctx.translate(X(centerX), Y(centerY));
    ctx.rotate(rotation);
    const pixels = half * S;
    ctx.beginPath();
    ctx.rect(-pixels, -pixels, pixels * 2, pixels * 2);
    if (ghost) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "#cbcbc5";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `italic 500 ${Math.max(10, pixels * 0.85)}px ${MATH}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("m", 0, 0);
    }
    ctx.restore();
    return { x: centerX, y: centerY };
  };

  block(first.position, true);
  const center = block(sample.position, false);

  // 末帧停止点与 plannedEnd 分开标记。
  if (time >= motion.durationSeconds - 1e-9 && motion.endReason?.startsWith("stop")) {
    ctx.fillStyle = SOFT;
    ctx.font = `500 12px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("停止点", X(last.position.x), Y(last.position.y) + size * S + 10);
  }

  const speed = Math.hypot(sample.velocity.x, sample.velocity.y);
  if (speed > 0.08) {
    const ux = sample.velocity.x / speed;
    const uy = sample.velocity.y / speed;
    const length = Math.min(1.4, 0.45 + speed * 0.08);
    const startX = center.x + ux * size * 0.8;
    const startY = center.y + uy * size * 0.8;
    const endX = startX + ux * length;
    const endY = startY + uy * length;
    ctx.strokeStyle = "#3a3a36";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(X(startX), Y(startY));
    ctx.lineTo(X(endX), Y(endY));
    ctx.stroke();
    const angle = Math.atan2(Y(endY) - Y(startY), X(endX) - X(startX));
    ctx.fillStyle = "#3a3a36";
    ctx.beginPath();
    ctx.moveTo(X(endX), Y(endY));
    ctx.lineTo(X(endX) - 8 * Math.cos(angle) + 3 * Math.sin(angle), Y(endY) - 8 * Math.sin(angle) - 3 * Math.cos(angle));
    ctx.lineTo(X(endX) - 8 * Math.cos(angle) - 3 * Math.sin(angle), Y(endY) - 8 * Math.sin(angle) + 3 * Math.cos(angle));
    ctx.closePath();
    ctx.fill();
  }

  const speedText = formatSpeed(speed);
  for (const landmark of g.landmarks ?? []) {
    ctx.fillStyle = SOFT; ctx.font = `12px ${SANS}`; ctx.textAlign = "center";
    ctx.fillText(landmark.label, X(landmark.position.xM) - 9, Y(landmark.position.yM) + (landmark.label === "C" || landmark.label === "端点" ? -12 : 19));
  }
  ctx.fillStyle = INK;
  ctx.font = `500 13px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const label = `v = ${speedText} m/s`;
  const labelWidth = ctx.measureText(label).width;
  const preferredX = g.positionReference === "particle" ? X(center.x) + labelWidth / 2 + 16 : X(center.x);
  const labelX = Math.min(W - labelWidth / 2 - 8, Math.max(labelWidth / 2 + 8, preferredX));
  const labelY = Math.min(H - 28, Math.max(20, Y(center.y) - (g.positionReference === "particle" ? 18 : half * S + 9)));
  ctx.fillStyle = PAPER; ctx.fillRect(labelX - labelWidth / 2 - 3, labelY - 15, labelWidth + 6, sample.constraint ? 35 : 18);
  ctx.fillStyle = INK; ctx.fillText(label, labelX, labelY);
  if (sample.constraint) {
    ctx.fillStyle = SOFT; ctx.fillText(`N = ${sample.constraint.normalForceN.toFixed(2)} N`, labelX, labelY + 18);
  }
  if (inclineLaunch) {
    ctx.font = `12px ${SANS}`; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = SOFT;
    ctx.fillText(`vₓ = ${componentText(sample.velocity.x)}，vᵧ = ${componentText(sample.velocity.y)} m/s`, 12, 12);
  }
}

export function StagePhysicsCanvas({ motion, time, isPlaying = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const stateRef = useRef({ motion, time });
  stateRef.current = { motion, time };

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { motion: currentMotion, time: currentTime } = stateRef.current;
    const { w, h } = sizeRef.current;
    if (!w || !h) return;
    const ctx = canvas.getContext("2d");
    if (ctx) drawStageScene(ctx, w, h, currentMotion, currentTime);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w: rect.width, h: rect.height };
    };
    resize();
    paint();
    const observer = new ResizeObserver(() => { resize(); paint(); });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [paint]);

  useEffect(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(paint);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [motion, time, paint]);

  const velocity = motion.sampleAt(time).velocity;
  const constraint = motion.sampleAt(time).constraint;
  const speedText = formatSpeed(Math.hypot(velocity.x, velocity.y));
  return (
    <figure className="physics-figure" data-renderer="stage">
      <canvas ref={canvasRef} aria-label="有序物理阶段动画" aria-describedby="player-speed" role="img" />
      <figcaption id="player-speed" className="player-sr-only" aria-live={isPlaying ? "off" : "polite"}>
        当前速度大小 {speedText.startsWith("<") ? "小于 0.01" : speedText} 米每秒；
        {hasInclineLaunch(motion) && `檐口为坐标原点；水平速度 ${componentText(velocity.x)}，竖直速度 ${componentText(velocity.y)} 米每秒；`}
        {constraint && `圆弧角度 ${constraint.angleDeg.toFixed(2)} 度，法向力 ${constraint.normalForceN.toFixed(2)} 牛顿；`}
        结束原因 {motion.endReason ?? "进行中"}
      </figcaption>
    </figure>
  );
}
