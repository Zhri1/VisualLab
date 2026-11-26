import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Motion, StageGeometry, Vec2 } from "../../../types";
import type { VerticalArcGeometry } from "../../../physics/stageMotion";
import { formatSpeed } from "./playback";
import { EnergyReadout, energyText, showsEnergy } from "./EnergyReadout";
import { forcesAt } from "../../../features/forces/forceModel";
import { drawForceArrows } from "../../../features/forces/drawForces";
import { computeWorldBounds, fitViewport, type WorldBounds } from "./canvasViewport";

type DisplayArc = VerticalArcGeometry | NonNullable<NonNullable<StageGeometry["schematic"]>["verticalArc"]>;

function getInclines(g: StageGeometry) {
  if (g.inclines?.length) return g.inclines;
  return g.incline ? [{ stageIndex: -1, ...g.incline }] : [];
}
function getHorizontals(g: StageGeometry) {
  if (g.horizontals?.length) return g.horizontals;
  return g.horizontal ? [{ stageIndex: -1, ...g.horizontal }] : [];
}
function getSprings(g: StageGeometry) {
  if (g.springs?.length) return g.springs;
  return g.spring ? [{ stageIndex: -1, ...g.spring }] : [];
}
function getProjectiles(g: StageGeometry) {
  if (g.projectiles?.length) return g.projectiles;
  return g.projectile ? [{ stageIndex: -1, ...g.projectile }] : [];
}
function getVerticalArcs(g: StageGeometry): DisplayArc[] {
  if (g.verticalArcs?.length) return g.verticalArcs;
  if (g.verticalArc) return [g.verticalArc];
  return g.schematic?.verticalArc ? [g.schematic.verticalArc] : [];
}

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
const normalText=(value:number,explicit:boolean)=>explicit&&value>0&&value<.01?value.toPrecision(2):value.toFixed(2);

interface Props {
  motion: Motion;
  time: number;
  isPlaying?: boolean;
  forces?: boolean;
  decompose?: boolean;
}

export function stageWorldBounds(motion: Motion): WorldBounds {
  const g = motion.stageGeometry!;
  const verticalArcs = getVerticalArcs(g);
  const inclines = getInclines(g);
  const horizontals = getHorizontals(g);
  const springs = getSprings(g);
  const projectiles = getProjectiles(g);
  const first = motion.sampleAt(0);
  const last = motion.sampleAt(motion.durationSeconds);
  const points: Vec2[] = [first.position, last.position];
  for (const seg of motion.segments) {
    points.push(motion.sampleAt(seg.startSeconds).position, motion.sampleAt(seg.endSeconds).position);
  }
  for (const landmark of g.landmarks ?? []) points.push({ x: landmark.position.xM, y: landmark.position.yM });
  for (const inc of inclines) {
    points.push({ x: inc.start.xM, y: inc.start.yM }, { x: inc.end.xM, y: inc.end.yM });
  }
  for (const hor of horizontals) {
    points.push({ x: hor.start.xM, y: hor.start.yM });
    if (hor.plannedEnd) points.push({ x: hor.plannedEnd.xM, y: hor.plannedEnd.yM });
  }
  if (g.linearTrack) {
    points.push({ x: g.linearTrack.minXM, y: g.linearTrack.yM }, { x: g.linearTrack.maxXM, y: g.linearTrack.yM });
  }
  if (g.conveyor) {
    const rad = ((g.conveyor.angleDeg ?? 0) * Math.PI) / 180;
    const dirSign = g.conveyor.inclineDirection === "down" ? -1 : 1;
    const ux = Math.cos(rad);
    const uy = dirSign * Math.sin(rad);
    const ox = g.conveyor.originXM ?? 0;
    const oy = g.conveyor.originYM ?? 0;
    points.push(
      { x: ox + g.conveyor.minXM * ux, y: oy + g.conveyor.minXM * uy },
      { x: ox + g.conveyor.maxXM * ux, y: oy + g.conveyor.maxXM * uy },
    );
  }
  for (const mg of g.magnetics ?? (g.magnetic ? [g.magnetic] : [])) {
    points.push(
      { x: mg.entry.xM, y: mg.center.yM + mg.radiusM },
      { x: mg.entry.xM + mg.regionWidthM, y: mg.center.yM - mg.radiusM },
      { x: mg.exit.xM, y: mg.exit.yM },
    );
  }
  for (const sp of springs) {
    points.push({ x: sp.contact.xM, y: sp.contact.yM }, { x: sp.anchor.xM, y: sp.anchor.yM });
  }
  if (g.movableArc) {
    const ma = g.movableArc;
    const drift = Math.max(0, motion.durationSeconds - ma.exitTimeSeconds) * ma.exitGrooveVX;
    points.push(
      { x: ma.entryXM - ma.radiusM, y: ma.entryYM },
      { x: ma.entryXM + ma.radiusM, y: ma.entryYM },
      { x: ma.exitGrooveXM - ma.radiusM + Math.min(0, drift), y: 0 },
      { x: ma.exitGrooveXM + ma.radiusM + Math.max(0, drift), y: 0 },
    );
  }
  if (g.springPair) {
    const pair = g.springPair;
    const d = pair.incomingDir ?? -1;
    const restLen = pair.restLengthM ?? 0.36;
    const initX2 = pair.targetEntryXM + d * restLen;
    const endTarget = motion.springPairAt?.(motion.durationSeconds);
    points.push(
      { x: Math.min(pair.targetEntryXM, initX2, endTarget?.x2M ?? initX2) - 0.35, y: pair.yM },
      { x: Math.max(pair.targetEntryXM, initX2, endTarget?.x2M ?? initX2) + 0.35, y: pair.yM },
    );
  }
  if (g.springRelease) {
    points.push({ x: g.springRelease.start.xM, y: g.springRelease.start.yM }, { x: g.springRelease.naturalContact.xM, y: g.springRelease.naturalContact.yM });
    if (g.springRelease.anchor) points.push({ x: g.springRelease.anchor.xM, y: g.springRelease.anchor.yM });
  }
  if (g.schematic?.horizontal) {
    points.push({ x: g.schematic.horizontal.start.xM, y: g.schematic.horizontal.start.yM });
    if (g.schematic.horizontal.plannedEnd) points.push({ x: g.schematic.horizontal.plannedEnd.xM, y: g.schematic.horizontal.plannedEnd.yM });
  }
  for (const proj of projectiles) {
    points.push({ x: proj.launch.xM, y: proj.launch.yM }, { x: proj.launch.xM, y: proj.landingPlane.yM });
    const projSeg = proj.stageIndex >= 0
      ? motion.segments.find((s) => s.kind === "projectile" && s.stageIndex === proj.stageIndex)
      : motion.segments.find((s) => s.kind === "projectile");
    if (projSeg) {
      for (let i = 1; i <= 6; i += 1) {
        const pt = motion.sampleAt(projSeg.startSeconds + (projSeg.endSeconds - projSeg.startSeconds) * (i / 6)).position;
        points.push(pt);
        if (i === 6) points.push({ x: pt.x, y: proj.landingPlane.yM });
      }
    } else {
      points.push({ x: last.position.x, y: proj.landingPlane.yM });
    }
  }
  for (const arc of verticalArcs) {
    points.push({ x: arc.entry.xM, y: arc.entry.yM }, { x: arc.plannedEnd.xM, y: arc.plannedEnd.yM });
    if ("actualExit" in arc && arc.actualExit) {
      points.push({ x: arc.actualExit.position.xM, y: arc.actualExit.position.yM });
    }
    const start = arc.startAngleDeg ?? 0, low = Math.min(start, arc.endAngleDeg), high = Math.max(start, arc.endAngleDeg);
    for (let a = Math.ceil(low / 90) * 90; a <= high; a += 90) {
      points.push({
        x: arc.center.xM + arc.radiusM * Math.sin(a * Math.PI / 180),
        y: arc.center.yM - arc.radiusM * Math.cos(a * Math.PI / 180),
      });
    }
  }
  return computeWorldBounds(points);
}

export function drawStageScene(ctx: CanvasRenderingContext2D, W: number, H: number, motion: Motion, time: number, precomputedBounds?: WorldBounds, forceArrows?: import("../../../features/forces/forceModel").ForceArrow[]) {
  const g = motion.stageGeometry!;
  const inclineLaunch = hasInclineLaunch(motion);
  const verticalArcs = getVerticalArcs(g);
  const inclines = getInclines(g);
  const horizontals = getHorizontals(g);
  const projectiles = getProjectiles(g);
  const springs = getSprings(g);
  const hasArc = verticalArcs.length > 0;
  const explicitArc = verticalArcs.some((arc) => arc.direction !== undefined);
  const size = g.blockSizeM;
  const sample = motion.sampleAt(time);
  const first = motion.sampleAt(0);
  const last = motion.sampleAt(motion.durationSeconds);
  const worldBounds = precomputedBounds ?? stageWorldBounds(motion);
  const narrow = W < 420;
  const hasTopHud = inclineLaunch || explicitArc || !!g.conveyor || !!g.linearTrack;
  const vp = fitViewport(W, H, worldBounds, {
    top: hasTopHud ? 48 : 34,
    right: narrow ? 30 : 48,
    bottom: showsEnergy(motion) ? 44 : 38,
    left: narrow ? 30 : 48,
  });
  const { S, X, Y } = vp;

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
  const constrainedStageIndex = sample.constraint?.kind === "vertical_arc" ? sample.constraint.stageIndex : undefined;
  const currentArc = constrainedStageIndex !== undefined
    ? verticalArcs.find((arc) => ("stageIndex" in arc ? arc.stageIndex === constrainedStageIndex : verticalArcs.length === 1))
    : undefined;

  // 斜面：几何来自 StageGeometry（支持多段斜面），而不是由当前位置反推。
  for (const inc of inclines) {
    const { start, end } = inc;
    const isActiveIncline = active?.kind === "incline" && (inc.stageIndex < 0 || active.stageIndex === inc.stageIndex);
    ctx.beginPath();
    ctx.moveTo(X(start.xM), Y(start.yM));
    ctx.lineTo(X(end.xM), Y(end.yM));
    ctx.lineTo(X(start.xM), Y(end.yM));
    ctx.closePath();
    ctx.fillStyle = FILL;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = isActiveIncline ? 2.4 : 1.6;
    ctx.stroke();
    if (inclines.length === 1 && !g.landmarks?.length) {
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
  }

  // 水平支撑总是延伸到题设目标，支持多段水平面。
  const horizontalIndex = motion.stagePlan?.stages.findIndex((stage) => stage.kind === "horizontal_slide") ?? -1;
  const hasPlannedProjectile = horizontalIndex >= 0 && motion.stagePlan?.stages[horizontalIndex + 1]?.kind === "projectile";
  const hasPlannedArc = horizontalIndex >= 0 && motion.stagePlan?.stages[horizontalIndex + 1]?.kind === "vertical_arc";
  for (const hor of horizontals) {
    const start = hor.start;
    const nextSpring = springs.find((sp) => hor.stageIndex < 0 || sp.stageIndex === hor.stageIndex + 1);
    const horSeg = hor.stageIndex >= 0
      ? motion.segments.find((s) => s.kind === "horizontal" && s.stageIndex === hor.stageIndex)
      : undefined;
    const isActiveHor = active?.kind === "horizontal" && (hor.stageIndex < 0 || active.stageIndex === hor.stageIndex);
    const endX = hor.plannedEnd?.xM
      ?? nextSpring?.contact.xM
      ?? (horSeg ? motion.sampleAt(horSeg.endSeconds).position.x : isActiveHor ? last.position.x : start.xM);
    ctx.strokeStyle = INK;
    ctx.lineWidth = isActiveHor ? 2.4 : 1.6;
    ctx.beginPath();
    ctx.moveTo(X(start.xM), Y(start.yM));
    ctx.lineTo(X(endX), Y(start.yM));
    ctx.stroke();
    ctx.strokeStyle = HAIR;
    ctx.lineWidth = 1;
    const minHX = Math.min(start.xM, endX);
    const maxHX = Math.max(start.xM, endX);
    for (let x = minHX + 0.15; x < maxHX; x += 0.25) {
      ctx.beginPath();
      ctx.moveTo(X(x), Y(start.yM));
      ctx.lineTo(X(x - 0.12), Y(start.yM) + 6);
      ctx.stroke();
    }
    const horHasPlannedProjectile = hor.stageIndex >= 0
      ? motion.stagePlan?.stages[hor.stageIndex + 1]?.kind === "projectile"
      : hasPlannedProjectile;
    if (hor.plannedEnd && horHasPlannedProjectile) {
      const nextProj = projectiles.find((p) => hor.stageIndex < 0 || p.stageIndex === hor.stageIndex + 1) ?? projectiles[0];
      const floorY = nextProj?.landingPlane.yM ?? hor.plannedEnd.yM - size * 4;
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = SOFT;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(X(hor.plannedEnd.xM), Y(hor.plannedEnd.yM));
      ctx.lineTo(X(hor.plannedEnd.xM), Y(floorY));
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = SOFT;
      ctx.font = `500 12px ${SANS}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText("桌沿", X(hor.plannedEnd.xM) + 7, Y(hor.plannedEnd.yM) - 5);
    }
  }
  if (g.movableArc) {
    const ma = g.movableArc;
    const gs = motion.movableArcAt?.(time) ?? { grooveXM: ma.entryXM + ma.exitDirection * ma.radiusM, grooveVX: 0 };
    // grooveXM 为槽圆心横坐标：初始圆心 = entryXM + s·R。
    const d = gs.grooveXM - (ma.entryXM + ma.exitDirection * ma.radiusM);
    const cx = ma.entryXM + ma.exitDirection * ma.radiusM + d;
    ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(X(worldBounds.minX), Y(0)); ctx.lineTo(X(worldBounds.maxX), Y(0)); ctx.stroke();
    ctx.strokeStyle = HAIR; ctx.lineWidth = 1;
    for (let x = worldBounds.minX + 0.15; x < worldBounds.maxX; x += 0.25) {
      ctx.beginPath(); ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x - 0.12), Y(0) + 6); ctx.stroke();
    }
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 24; i += 1) {
      const th = (Math.PI / 2) * (i / 24);
      const px = cx - ma.exitDirection * ma.radiusM * Math.cos(th);
      const py = ma.entryYM - ma.radiusM * Math.sin(th);
      if (i === 0) ctx.moveTo(X(px), Y(py)); else ctx.lineTo(X(px), Y(py));
    }
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(cx - ma.exitDirection * ma.radiusM), Y(ma.entryYM)); ctx.lineTo(X(cx - ma.exitDirection * ma.radiusM), Y(0)); ctx.stroke();
    ctx.fillStyle = SOFT; ctx.font = `500 12px ${SANS}`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(`M = ${ma.grooveMassKg} kg`, X(cx - ma.exitDirection * ma.radiusM * 0.4), Y(0) - 6);
  }
  if (g.springPair) {
    const pair = g.springPair;
    const d = pair.incomingDir ?? -1;
    const restLen = pair.restLengthM ?? 0.36;
    const ps = motion.springPairAt?.(time) ?? { x2M: pair.targetEntryXM + d * restLen, vx2Mps: 0, compressionM: 0 };
    ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(X(worldBounds.minX), Y(pair.yM)); ctx.lineTo(X(worldBounds.maxX), Y(pair.yM)); ctx.stroke();
    // 弹簧固定在靶球朝向入射球的一侧（sideSign = -d），自由端坐标严格为 x2 + sideSign·(restLen − compressionM)，
    // 接触瞬间与压缩期间与 m1 坐标 1:1 贴合，绝不穿模。
    const sideSign = -d;
    const curLen = Math.max(0.05, restLen - ps.compressionM);
    const springAnchor = ps.x2M + sideSign * 0.03;
    const springTip = ps.x2M + sideSign * curLen;
    ctx.strokeStyle = SOFT; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(springAnchor), Y(pair.yM));
    for (let i = 1; i <= 12; i += 1) ctx.lineTo(X(springAnchor + (springTip - springAnchor) * i / 12), Y(pair.yM) + (i % 2 ? -5 : 5));
    ctx.lineTo(X(springTip), Y(pair.yM)); ctx.stroke();
    // 自由端小挡片，便于看清弹簧接触端位置
    ctx.beginPath(); ctx.moveTo(X(springTip), Y(pair.yM) - 6); ctx.lineTo(X(springTip), Y(pair.yM) + 6); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.arc(X(ps.x2M), Y(pair.yM), 6, 0, 2 * Math.PI); ctx.fillStyle = "#8e8e88"; ctx.fill(); ctx.restore();
    ctx.fillStyle = SOFT; ctx.font = `500 12px ${SANS}`; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(`m₂ = ${pair.mass2Kg} kg`, X(ps.x2M), Y(pair.yM) + 10);
  }
  if (g.conveyor) {
    const angleDeg = g.conveyor.angleDeg ?? 0;
    const rad = (angleDeg * Math.PI) / 180;
    const dirSign = g.conveyor.inclineDirection === "down" ? -1 : 1;
    const ux = Math.cos(rad);
    const uy = dirSign * Math.sin(rad);
    const ox = g.conveyor.originXM ?? 0;
    const oy = g.conveyor.originYM ?? 0;
    const sMin = g.conveyor.minXM - size;
    // 右端齐平物理出口 maxXM，避免抛体离带后穿过右侧多余带体与滚轮。
    const sMax = g.conveyor.maxXM;
    const p1x = X(ox + sMin * ux), p1y = Y(oy + sMin * uy);
    const p2x = X(ox + sMax * ux), p2y = Y(oy + sMax * uy);
    const beltLenPx = Math.max(24, Math.hypot(p2x - p1x, p2y - p1y));
    const beltH = 14, r = beltH / 2;
    const canvasRot = Math.atan2(p2y - p1y, p2x - p1x);
    ctx.save();
    ctx.translate(p1x, p1y);
    ctx.rotate(canvasRot);
    ctx.fillStyle = FILL;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(0, 0, beltLenPx, beltH, r);
    ctx.fill();
    ctx.stroke();
    // 两端滚轮
    ctx.fillStyle = PAPER;
    for (const cx of [r, beltLenPx - r]) {
      ctx.beginPath(); ctx.arc(cx, r, Math.max(3, r - 2), 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
    // 随带面位移移动的刻度线，直观体现带面参考系
    const cState = motion.conveyorAt?.(time);
    const shiftPx = ((cState?.beltDisplacementM ?? 0) * S) % 24;
    ctx.strokeStyle = SOFT;
    ctx.lineWidth = 1;
    for (let px = r + ((shiftPx % 24) + 24) % 24; px < beltLenPx - r; px += 24) {
      ctx.beginPath(); ctx.moveTo(px, 2); ctx.lineTo(px, beltH - 2); ctx.stroke();
    }
    ctx.restore();
    // 倾斜传送带绘制水平参考线与倾角标注
    if (angleDeg > 0) {
      const lowX = p1y >= p2y ? p1x : p2x;
      const lowY = Math.max(p1y, p2y) + beltH / 2;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = HAIR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.min(p1x, p2x), lowY);
      ctx.lineTo(Math.max(p1x, p2x), lowY);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = SOFT;
      ctx.font = `12px ${SANS}`;
      ctx.textAlign = p1y >= p2y ? "left" : "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(`θ = ${Number(angleDeg.toFixed(1))}°`, lowX + (p1y >= p2y ? 14 : -14), lowY - 3);
    }
  }
  if (g.linearTrack) {
    const { minXM, maxXM, yM } = g.linearTrack;
    ctx.strokeStyle = INK;
    ctx.lineWidth = active?.kind === "horizontal" ? 2.2 : 1.6;
    ctx.beginPath();
    ctx.moveTo(X(minXM - size), Y(yM));
    ctx.lineTo(X(maxXM + size), Y(yM));
    ctx.stroke();
  }

  // 圆弧使用质点轨迹；支持多段圆弧/整圆，半径虚线在多圆弧时仅显示当前受约束圆弧避免杂乱重叠。
  const isSchematicArc = !g.verticalArc && !g.verticalArcs?.length;
  for (const arc of verticalArcs) {
    const arcExplicit = arc.direction !== undefined;
    const isRodArc = "side" in arc && arc.side === "rod";
    const isCurrentArc = currentArc === arc;
    ctx.save(); if (isSchematicArc) ctx.setLineDash([5, 5]);
    if (isRodArc) {
      // 双轨/光滑管样式：内外两条平行圆弧 + 当前受约束时绘制轻杆与支点。
      const halfGap = 4 / S;
      ctx.strokeStyle = SOFT;
      ctx.lineWidth = 1.2;
      for (const dr of [-halfGap, halfGap]) {
        const rr = Math.max(0.02, arc.radiusM + dr);
        ctx.beginPath();
        for (let i = 0; i <= 80; i++) {
          const phi = ((arc.startAngleDeg ?? 0) + (arc.endAngleDeg - (arc.startAngleDeg ?? 0)) * i / 80) * Math.PI / 180;
          const x = X(arc.center.xM + rr * Math.sin(phi));
          const y = Y(arc.center.yM - rr * Math.cos(phi));
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      if (isCurrentArc) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(X(arc.center.xM), Y(arc.center.yM));
        ctx.lineTo(X(sample.position.x), Y(sample.position.y));
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(X(arc.center.xM), Y(arc.center.yM), 3.5, 0, 2 * Math.PI);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = INK;
      ctx.lineWidth = isCurrentArc ? 2.4 : 1.6;
      ctx.beginPath();
      for (let i = 0; i <= 80; i++) {
        const phi = ((arc.startAngleDeg ?? 0) + (arc.endAngleDeg - (arc.startAngleDeg ?? 0)) * i / 80) * Math.PI / 180;
        const x = X(arc.center.xM + arc.radiusM * Math.sin(phi));
        const y = Y(arc.center.yM - arc.radiusM * Math.cos(phi));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    const fullCircle = arcExplicit && Math.abs(Math.abs(arc.endAngleDeg - (arc.startAngleDeg ?? 0)) - 360) < 1e-9;
    if (verticalArcs.length === 1 || isCurrentArc) {
      const radiusRad = (!arcExplicit || fullCircle ? 90 : ((arc.startAngleDeg ?? 0) + arc.endAngleDeg) / 2) * Math.PI / 180;
      const radEndX = arc.center.xM + arc.radiusM * Math.sin(radiusRad);
      const radEndY = arc.center.yM - arc.radiusM * Math.cos(radiusRad);
      ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = HAIR; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(arc.center.xM), Y(arc.center.yM));
      ctx.lineTo(X(radEndX), Y(radEndY)); ctx.stroke(); ctx.restore();
      ctx.font = `500 12px ${SANS}`; ctx.fillStyle = SOFT; ctx.textAlign = "center";
      ctx.fillText("R", X((arc.center.xM + radEndX) / 2), Y((arc.center.yM + radEndY) / 2) - 7);
    }
    const fullObservation = fullCircle && arc.endMode === "observation";
    if (!g.landmarks?.length) {
      ctx.font = `500 12px ${SANS}`; ctx.fillStyle = SOFT; ctx.textAlign = "center";
      ctx.fillText(
        fullObservation ? "入口 · 观察一圈" : arcExplicit ? (arc.endMode === "observation" ? "观察终点" : "实体端点") : arc.endAngleDeg === 180 ? "C" : "端点",
        X(arc.plannedEnd.xM) - (fullObservation ? 0 : 10),
        Y(arc.plannedEnd.yM) + (fullObservation ? 22 : -12),
      );
    }
    if (arcExplicit && "actualExit" in arc && arc.actualExit.reason === "contact_lost") {
      const end = arc.actualExit.position;
      ctx.font = `500 12px ${SANS}`; ctx.fillStyle = SOFT; ctx.textAlign = "center";
      ctx.fillText("实际脱轨", X(end.xM) + 12, Y(end.yM) + 20);
    }
  }
  const singleArc = verticalArcs.length === 1 ? verticalArcs[0] : undefined;
  const plannedEnd = g.horizontal?.plannedEnd;
  const arcEntry = (singleArc && !isSchematicArc ? singleArc.entry : undefined) ?? (hasPlannedArc ? plannedEnd : undefined);
  if (arcEntry && !g.landmarks?.length && !(explicitArc && singleArc?.endMode === "observation" && Math.abs(Math.abs(singleArc.endAngleDeg - (singleArc.startAngleDeg ?? 0)) - 360) < 1e-9)) {
    ctx.font = `500 12px ${SANS}`; ctx.fillStyle = SOFT; ctx.textAlign = "center";
    ctx.fillText(explicitArc ? "入口" : "B", X(arcEntry.xM), Y(arcEntry.yM) + 19);
    if (g.horizontal) ctx.fillText("A", X(g.horizontal.start.xM), Y(g.horizontal.start.yM) + 19);
  }

  // 只有实际进入抛体阶段才画轨迹与落地面，支持多段抛体。
  for (const proj of projectiles) {
    const projSeg = proj.stageIndex >= 0
      ? motion.segments.find((segment) => segment.kind === "projectile" && segment.stageIndex === proj.stageIndex)
      : motion.segments.find((segment) => segment.kind === "projectile");
    const isInclineProj = inclineLaunch && (proj.stageIndex < 0 || motion.stagePlan?.stages[proj.stageIndex - 1]?.kind === "incline_slide");
    if (!projSeg && !isInclineProj) continue;
    const floorY = proj.landingPlane.yM;
    const projEndX = projSeg ? motion.sampleAt(projSeg.endSeconds).position.x : last.position.x;
    const isIntermediateProj = proj.stageIndex >= 0 && !!motion.stagePlan && proj.stageIndex + 1 < motion.stagePlan.stages.length;
    ctx.save();
    if (isIntermediateProj) {
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = HAIR;
      ctx.lineWidth = 1.1;
    } else {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6;
    }
    ctx.beginPath();
    ctx.moveTo(X(Math.min(proj.launch.xM, projEndX) - size), Y(floorY));
    ctx.lineTo(X(Math.max(proj.launch.xM, projEndX) + size), Y(floorY));
    ctx.stroke();
    ctx.restore();
    if (isInclineProj) {
      const launch = proj.launch;
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
    for (let index = 0; projSeg && index <= 36; index += 1) {
      const t = projSeg.startSeconds + (projSeg.endSeconds - projSeg.startSeconds) * (index / 36);
      const pt = motion.sampleAt(t).position;
      if (index === 0) ctx.moveTo(X(pt.x), Y(pt.y));
      else ctx.lineTo(X(pt.x), Y(pt.y));
    }
    ctx.stroke();
    ctx.restore();
  }

  // 弹簧与原长接触端，支持多段弹簧。
  for (const sp of springs) {
    const isThisSpring = sp.stageIndex < 0 || active?.stageIndex === sp.stageIndex;
    const compression = isThisSpring ? Math.max(0, sample.springCompressionM) : 0;
    const plateX = Math.min(sp.anchor.xM - 0.02, sp.contact.xM + compression);
    const span = Math.max(0.02, sp.anchor.xM - plateX);
    const coilY = sp.contact.yM + size * 0.55;
    ctx.strokeStyle = INK;
    ctx.lineWidth = compression > 0.004 ? 2 : 1.5;
    ctx.beginPath();
    ctx.moveTo(X(plateX), Y(sp.contact.yM));
    ctx.lineTo(X(plateX), Y(sp.contact.yM + size * 1.35));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(X(plateX), Y(coilY));
    for (let index = 0; index < 18; index += 1) {
      const ratio = (index + 0.5) / 18;
      ctx.lineTo(X(plateX + span * ratio), Y(coilY + (index % 2 === 0 ? size * 0.32 : -size * 0.32)));
    }
    ctx.lineTo(X(sp.anchor.xM), Y(coilY));
    ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(X(sp.anchor.xM), Y(sp.anchor.yM));
    ctx.lineTo(X(sp.anchor.xM), Y(sp.anchor.yM + size * 1.5));
    ctx.stroke();
    ctx.fillStyle = SOFT;
    ctx.font = `italic 500 13px ${MATH}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("k", X((plateX + sp.anchor.xM) / 2), Y(coilY + size * 0.55));
  }

  const activeIncline = active?.kind === "incline"
    ? (inclines.find((inc) => inc.stageIndex === active.stageIndex) ?? inclines[0])
    : inclines[0];
  const inclineAngle = activeIncline
    ? Math.atan2(activeIncline.start.yM - activeIncline.end.yM, activeIncline.end.xM - activeIncline.start.xM)
    : 0;
  const onIncline = active?.kind === "incline";
  const conveyorAngleRad = g.conveyor?.angleDeg
    ? (g.conveyor.inclineDirection === "down" ? 1 : -1) * ((g.conveyor.angleDeg * Math.PI) / 180)
    : 0;
  const onConveyor = !!g.conveyor && (active?.kind === "horizontal" || motion.stagePlan?.stages[active?.stageIndex ?? 0]?.kind === "conveyor_belt");
  const rotation = onIncline ? inclineAngle : onConveyor ? conveyorAngleRad : 0;
  const half = size / 2;
  const tx = Math.cos(rotation);
  const ty = -Math.sin(rotation);
  const nx = Math.sin(rotation);
  const ny = Math.cos(rotation);

  const halfPx = Math.max(9, Math.min(22, half * S));
  const block = (point: Vec2, ghost: boolean) => {
    if (g.positionReference === "particle") {
      ctx.save(); ctx.beginPath(); ctx.arc(X(point.x), Y(point.y), 6, 0, 2 * Math.PI);
      if (ghost) { ctx.setLineDash([2, 3]); ctx.strokeStyle = SOFT; ctx.stroke(); }
      else { ctx.fillStyle = INK; ctx.fill(); }
      ctx.restore(); return point;
    }
    const effHalf = halfPx / S;
    const centerX = point.x + nx * effHalf - tx * effHalf;
    const centerY = point.y + ny * effHalf - ty * effHalf;
    ctx.save();
    ctx.translate(X(centerX), Y(centerY));
    ctx.rotate(rotation);
    const pixels = halfPx;
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

  if (currentArc && sample.constraint?.normalDirection && Math.abs(sample.constraint.normalForceN) > 1e-9) {
    const n = sample.constraint.normalDirection, len = 30, sx = X(center.x) + n.x * 10, sy = Y(center.y) - n.y * 10, ex = sx + n.x * len, ey = sy - n.y * len, a = Math.atan2(ey - sy, ex - sx);
    const isRodCurrent = "side" in currentArc && currentArc.side === "rod";
    const arrowLabel = isRodCurrent ? (sample.constraint.normalForceN < 0 ? "支持力" : "拉力") : "N";
    ctx.save(); ctx.strokeStyle = "#386e8a"; ctx.fillStyle = "#386e8a"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.moveTo(ex - 6 * Math.cos(a - 0.45), ey - 6 * Math.sin(a - 0.45)); ctx.lineTo(ex, ey); ctx.lineTo(ex - 6 * Math.cos(a + 0.45), ey - 6 * Math.sin(a + 0.45)); ctx.stroke(); ctx.font = `12px ${SANS}`; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(arrowLabel, ex + 7, ey); ctx.restore();
  }

  // 末帧停止点与 plannedEnd 分开标记。
  if (time >= motion.durationSeconds - 1e-9 && motion.endReason?.startsWith("stop")) {
    ctx.fillStyle = SOFT;
    ctx.font = `500 12px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("停止点", X(last.position.x), Math.min(H - 16, Y(last.position.y) + halfPx + 8));
  }

  const speed = Math.hypot(sample.velocity.x, sample.velocity.y);
  if (speed > 0.08) {
    const ux = sample.velocity.x / speed;
    const uy = sample.velocity.y / speed;
    const length = Math.min(1.4, 0.45 + speed * 0.08, (hasArc ? 38 : 46) / S);
    const offset = hasArc ? 9 / S : (halfPx + 4) / S;
    let startX = center.x + ux * offset;
    let startY = center.y + uy * offset;
    let endX = startX + ux * length;
    let endY = startY + uy * length;
    const landingPlanes = projectiles.map((p) => p.landingPlane.yM);
    const hitGroundBelow =
      uy < -0.05 &&
      (Y(endY) > H - 10 || landingPlanes.some((planeY) => center.y >= planeY - 1e-4 && endY < planeY - 1e-4));
    if (hitGroundBelow) {
      // 落地瞬间或贴近底边时，将速度矢量改为指向物块入射侧，方向不变且不穿入地面/裁出画布。
      endX = center.x - ux * offset;
      endY = center.y - uy * offset;
      startX = endX - ux * length;
      startY = endY - uy * length;
    }
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
  const placedLandmarks: Array<{ x: number; y: number; w: number }> = [];
  const landmarkMinY = hasTopHud ? 44 : 18;
  const landmarkMaxY = H - 8;
  ctx.fillStyle = SOFT;
  ctx.font = `12px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (const landmark of g.landmarks ?? []) {
    const px = X(landmark.position.xM);
    const py = Y(landmark.position.yM);
    const measuredW = ctx.measureText(landmark.label).width || landmark.label.length * 8;
    const halfW = Math.max(8, measuredW / 2 + 4);
    const preferAbove = landmark.label === "C" || landmark.label === "端点" || py > H - 28;
    const dy1 = preferAbove ? -12 : 19;
    const dy2 = preferAbove ? 19 : -12;
    const candidates: Array<[number, number]> = [
      [px - 9, py + dy1],
      [px + 11, py + dy1],
      [px, py + dy2],
      [px - 14, py + dy2],
      [px + 14, py + dy2],
    ];
    const clamp = (cx: number, cy: number): [number, number] => [
      Math.min(W - halfW - 4, Math.max(halfW + 4, cx)),
      Math.min(landmarkMaxY, Math.max(landmarkMinY, cy)),
    ];
    let chosen = clamp(candidates[0][0], candidates[0][1]);
    for (const [cx, cy] of candidates) {
      const [clampedX, clampedY] = clamp(cx, cy);
      const overlaps = placedLandmarks.some(
        (p) => Math.abs(clampedX - p.x) < (measuredW + p.w) / 2 + 4 && Math.abs(clampedY - p.y) < 14,
      );
      if (!overlaps) {
        chosen = [clampedX, clampedY];
        break;
      }
    }
    placedLandmarks.push({ x: chosen[0], y: chosen[1], w: measuredW });
    ctx.fillText(landmark.label, chosen[0], chosen[1]);
  }
  ctx.fillStyle = INK;
  ctx.font = `500 13px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const label = `v = ${speedText} m/s`;
  const labelWidth = ctx.measureText(label).width;
  const preferredX = g.positionReference === "particle" ? X(center.x) + labelWidth / 2 + 16 : X(center.x);
  const labelX = explicitArc?W-labelWidth/2-12:Math.min(W - labelWidth / 2 - 8, Math.max(labelWidth / 2 + 8, preferredX));
  const labelY = explicitArc?20:Math.min(H - 28, Math.max(20, Y(center.y) - (g.positionReference === "particle" ? 18 : halfPx + 9)));
  if(!explicitArc){ctx.fillStyle = PAPER; ctx.fillRect(labelX - labelWidth / 2 - 3, labelY - 15, labelWidth + 6, sample.constraint ? 35 : 18);}
  ctx.fillStyle = INK; ctx.fillText(label, labelX, labelY);
  if (sample.constraint) {
    const isRodCurrent = currentArc && "side" in currentArc && currentArc.side === "rod";
    const nVal = sample.constraint.normalForceN;
    const forceLabel = isRodCurrent
      ? (nVal < -1e-9 ? `支持力 ${normalText(Math.abs(nVal), explicitArc)} N` : nVal > 1e-9 ? `拉力 ${normalText(nVal, explicitArc)} N` : "杆力 0.00 N")
      : `N = ${normalText(nVal, explicitArc)} N`;
    ctx.fillStyle = SOFT; ctx.fillText(forceLabel, labelX, labelY + 18);
  }
  if (inclineLaunch||explicitArc) {
    ctx.font = `12px ${SANS}`; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = SOFT;
    ctx.fillText(`vₓ = ${componentText(sample.velocity.x)}，vᵧ = ${componentText(sample.velocity.y)} m/s`, 12, 12);
  } else if (g.conveyor) {
    const cState = motion.conveyorAt?.(time);
    const rad = ((g.conveyor.angleDeg ?? 0) * Math.PI) / 180;
    const dirSign = g.conveyor.inclineDirection === "down" ? -1 : 1;
    const vBlockAlong = g.conveyor.angleDeg ? sample.velocity.x * Math.cos(rad) + sample.velocity.y * dirSign * Math.sin(rad) : sample.velocity.x;
    ctx.font = `12px ${SANS}`; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = SOFT;
    ctx.fillText(`对地 x = ${componentText(sample.position.x)} m，相对带面 Δs = ${componentText(cState?.relativeDisplacementM ?? 0)} m${g.conveyor.angleDeg ? `（θ=${g.conveyor.angleDeg}°）` : ""}`, 12, 12);
    ctx.fillText(`v块 = ${componentText(vBlockAlong)} m/s，v带 = ${componentText(cState?.beltSpeedMps ?? 0)} m/s`, 12, 28);
  } else if (g.linearTrack) {
    ctx.font = `12px ${SANS}`; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = SOFT;
    ctx.fillText(`x = ${componentText(sample.position.x)} m，vₓ = ${componentText(sample.velocity.x)} m/s`, 12, 12);
  } else if (g.movableArc || g.springPair) {
    const gs = motion.movableArcAt?.(time);
    const ps = motion.springPairAt?.(time);
    ctx.font = `12px ${SANS}`; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = SOFT;
    ctx.fillText(`v₁ = ${componentText(sample.velocity.x)} m/s${gs ? `，V槽 = ${componentText(gs.grooveVX)} m/s` : ""}`, 12, 12);
    if (ps) ctx.fillText(`v₂ = ${componentText(ps.vx2Mps)} m/s，弹簧压缩 = ${componentText(ps.compressionM)} m`, 12, 28);
  }
  for (const mg of g.magnetics ?? (g.magnetic ? [g.magnetic] : [])) {
    const x0 = mg.entry.xM;
    const x1 = mg.entry.xM + mg.regionWidthM;
    const yTop = mg.center.yM + mg.radiusM;
    const yBot = mg.center.yM - mg.radiusM;
    ctx.save();
    ctx.fillStyle = "rgba(56,110,138,0.07)";
    ctx.fillRect(X(x0), Y(yTop), (x1 - x0) * S, (yTop - yBot) * S);
    ctx.strokeStyle = "#386e8a";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(X(x0), Y(yTop), (x1 - x0) * S, (yTop - yBot) * S);
    ctx.setLineDash([]);
    ctx.fillStyle = "#386e8a";
    ctx.font = `11px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const glyph = mg.fieldDirection === "into_page" ? "×" : "·";
    for (let ix = x0 + 0.25; ix < x1; ix += 0.5) {
      for (let iy = yBot + 0.25; iy < yTop; iy += 0.5) ctx.fillText(glyph, X(ix), Y(iy));
    }
    ctx.strokeStyle = "#b42318";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const sweep = mg.exitAngleRad - mg.entryAngleRad;
    for (let i = 0; i <= 48; i += 1) {
      const a = mg.entryAngleRad + (sweep * i) / 48;
      const px = mg.center.xM + mg.radiusM * Math.cos(a);
      const py = mg.center.yM + mg.radiusM * Math.sin(a);
      if (i === 0) ctx.moveTo(X(px), Y(py));
      else ctx.lineTo(X(px), Y(py));
    }
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`B ${mg.fieldDirection === "into_page" ? "⊗" : "⊙"}　R = ${mg.radiusM.toFixed(2)} m`, X(x0) + 6, Y(yTop) - 6);
    ctx.restore();
  }
  if (forceArrows?.length) drawForceArrows(ctx, forceArrows, X, Y);
}

export function StagePhysicsCanvas({ motion, time, isPlaying = false, forces = false, decompose = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const stableBounds = useMemo(() => stageWorldBounds(motion), [motion]);
  const stateRef = useRef({ motion, time, stableBounds, forces, decompose });
  stateRef.current = { motion, time, stableBounds, forces, decompose };

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { motion: currentMotion, time: currentTime, stableBounds: bounds, forces: showForces, decompose: split } = stateRef.current;
    const { w, h } = sizeRef.current;
    if (!w || !h) return;
    const ctx = canvas.getContext("2d");
    if (ctx) drawStageScene(ctx, w, h, currentMotion, currentTime, bounds, showForces ? forcesAt(currentMotion, currentTime, split) : undefined);
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
  }, [motion, time, forces, decompose, paint]);

  const velocity = motion.sampleAt(time).velocity;
  const constraint = motion.sampleAt(time).constraint;
  const explicit=motion.stagePlan?.stages.some(s=>s.kind==='vertical_arc'&&s.path);
  const speedText = formatSpeed(Math.hypot(velocity.x, velocity.y));
  return (
    <figure className="physics-figure" data-renderer="stage">
      <canvas ref={canvasRef} aria-label="有序物理阶段动画" aria-describedby="player-speed" role="img" />
      <EnergyReadout motion={motion} time={time} />
      <figcaption id="player-speed" className="player-sr-only" aria-live={isPlaying ? "off" : "polite"}>
        当前速度大小 {speedText.startsWith("<") ? "小于 0.01" : speedText} 米每秒；
        {hasInclineLaunch(motion) && `檐口为坐标原点；水平速度 ${componentText(velocity.x)}，竖直速度 ${componentText(velocity.y)} 米每秒；`}
        {explicit&&`水平速度 ${componentText(velocity.x)}，竖直速度 ${componentText(velocity.y)} 米每秒；${constraint?'保持圆轨接触，支持力指向圆心；':'当前无圆轨约束；'}`}
        {constraint && `圆弧角度 ${constraint.angleDeg.toFixed(2)} 度，法向力 ${normalText(constraint.normalForceN,!!explicit)} 牛顿；`}
        {showsEnergy(motion) && energyText(motion, time) ? `${energyText(motion, time)}；` : ""}
        结束原因 {motion.endReason ?? "进行中"}
      </figcaption>
    </figure>
  );
}
