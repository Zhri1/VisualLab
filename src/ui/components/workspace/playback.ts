import type { MotionSegment, Motion } from "../../../types";

// 显示选择与物理取样分开：同刻碰撞优先做教学标题，物理仍取最后事件之后。
export function displayEventAt(motion:Pick<Motion,'events'|'primaryBodyId'>,time:number){
  if(!motion.primaryBodyId)return [...motion.events].reverse().find(e=>e.timeSeconds<=time+1e-6);
  const reached=motion.events.filter(e=>e.timeSeconds<=time),last=reached[reached.length-1];
  return last&&(reached.find(e=>e.timeSeconds===last.timeSeconds&&e.eventKind==='collision')??last);
}

export function advancePlayback(
  currentTime: number,
  elapsedSeconds: number,
  rate: number,
  endSeconds: number,
  pauseEvents: readonly { timeSeconds: number }[]
): { time: number; pause: boolean } {
  const time = Math.min(endSeconds, currentTime + elapsedSeconds * rate);
  // 事件按时间排列，只检查本帧新经过的事件，继续播放时不会停在原地。
  const event = pauseEvents.find(({ timeSeconds }) => timeSeconds > currentTime && timeSeconds <= time);
  if (event) return { time: event.timeSeconds, pause: true };
  return { time, pause: time === endSeconds };
}

export function segmentAt(segments: readonly MotionSegment[], time: number): MotionSegment | undefined {
  return segments.find((segment) => time < segment.endSeconds - 1e-9) ?? segments[segments.length - 1];
}

export function formatSpeed(speed: number): string {
  return speed === 0 ? "0" : speed < 0.005 ? "<0.01" : speed.toFixed(2);
}

export function formatPace(pace: number): string {
  return Number(pace.toFixed(3)).toString();
}

export const DEFAULT_PACE_MULTIPLIER = 1.5;

/**
 * 为一整条 motion 计算固定的默认观看播放系数（仅缩放显示时钟，绝不改物理量）。
 * - 先依据总时长与「相对画幅跨度的屏幕移动速度」（frame/s）计算原自适应基数并夹限到 [0.15, 1.0]；
 * - 再统一乘以 1.5（含原 1.0 → 1.5），使所有动画的预计观看用时缩短为原来的 2/3；
 * - 整条动画的所有物体与阶段共用同一个固定系数。
 */
export function computeDefaultPace(
  motion: Pick<Motion, "durationSeconds" | "sampleAt" | "timing" | "events" | "geometry" | "stageGeometry">
): number {
  const duration = motion.durationSeconds;
  if (!Number.isFinite(duration) || duration <= 0 || motion.timing?.mode === "state_only") return 1;

  const steps = 96;
  const dt = duration / steps;
  const samples = Array.from({ length: steps + 1 }, (_, i) => motion.sampleAt((duration * i) / steps));

  // 收集全轨迹与必要几何涉及的所有点，计算相对画幅跨度（frameSpan）
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const addPt = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const s of samples) {
    if (s.bodies) {
      for (const b of Object.values(s.bodies)) addPt(b.position.x, b.position.y);
    } else {
      addPt(s.position.x, s.position.y);
    }
  }
  const sg = motion.stageGeometry;
  if (sg) {
    const springs = sg.springs?.length ? sg.springs : sg.spring ? [sg.spring] : [];
    for (const sp of springs) { addPt(sp.contact.xM, sp.contact.yM); addPt(sp.anchor.xM, sp.anchor.yM); }
    const inclines = sg.inclines?.length ? sg.inclines : sg.incline ? [sg.incline] : [];
    for (const inc of inclines) { addPt(inc.start.xM, inc.start.yM); addPt(inc.end.xM, inc.end.yM); }
    const horizontals = sg.horizontals?.length ? sg.horizontals : sg.horizontal ? [sg.horizontal] : [];
    for (const hor of horizontals) {
      addPt(hor.start.xM, hor.start.yM);
      if (hor.plannedEnd) addPt(hor.plannedEnd.xM, hor.plannedEnd.yM);
    }
    const projectiles = sg.projectiles?.length ? sg.projectiles : sg.projectile ? [sg.projectile] : [];
    for (const proj of projectiles) {
      addPt(proj.launch.xM, proj.launch.yM);
      addPt(proj.launch.xM, proj.landingPlane.yM);
    }
    const verticalArcs = sg.verticalArcs?.length ? sg.verticalArcs : sg.verticalArc ? [sg.verticalArc] : [];
    for (const arc of verticalArcs) {
      addPt(arc.center.xM - arc.radiusM, arc.center.yM - arc.radiusM);
      addPt(arc.center.xM + arc.radiusM, arc.center.yM + arc.radiusM);
    }
    if (sg.plank) {
      for (const s of samples) {
        const pb = s.bodies?.[sg.plank.plankBodyId];
        if (pb) addPt(pb.position.x + sg.plank.plankLengthM, pb.position.y);
      }
    }
    if (sg.pendulums) for (const p of sg.pendulums) { addPt(p.pivot.xM, p.pivot.yM); addPt(p.lowestPoint.xM, p.lowestPoint.yM); }
    if (sg.pulley) { addPt(sg.pulley.pulley.xM, sg.pulley.pulley.yM); addPt(sg.pulley.body1Start.xM, sg.pulley.body1Start.yM); addPt(sg.pulley.body2Start.xM, sg.pulley.body2Start.yM); }
  } else if (motion.geometry) {
    addPt(motion.geometry.inclineTop.x, motion.geometry.inclineTop.y);
    addPt(motion.geometry.springAnchorX, 0);
  }
  const spanX = Number.isFinite(minX) ? maxX - minX : 0;
  const spanY = Number.isFinite(minY) ? maxY - minY : 0;
  const frameSpan = Math.max(spanX, spanY);

  // 计算各步中相对画幅的瞬时移动速率（frame / physical-second），取 90 分位过滤瞬间跳变
  const relRates: number[] = [];
  if (frameSpan > 1e-6 && dt > 0) {
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1], curr = samples[i];
      let maxStep = 0;
      if (curr.bodies && prev.bodies) {
        for (const id of Object.keys(curr.bodies)) {
          const a = prev.bodies[id], b = curr.bodies[id];
          if (a && b) maxStep = Math.max(maxStep, Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y));
        }
      } else {
        maxStep = Math.hypot(curr.position.x - prev.position.x, curr.position.y - prev.position.y);
      }
      const rate = maxStep / (dt * frameSpan);
      if (rate > 1e-4) relRates.push(rate);
    }
  }
  relRates.sort((a, b) => a - b);
  const p90RelRate = relRates.length ? relRates[Math.min(relRates.length - 1, Math.floor(relRates.length * 0.9))] : 0;

  // 1) 屏幕移动速度约束：希望 90 分位画面速度不超过 ~0.48 frame/s（约 2.1 s 跨过全幅）
  const paceBySpeed = p90RelRate > 0.48 ? 0.48 / p90RelRate : 1;

  // 2) 短促动画时长约束：低于 4.5 s 的动画适当放慢到约 4.2~4.8 s（但不低于 minPace）
  const targetMinWatch = 4.4;
  const paceByDuration = duration < targetMinWatch ? duration / targetMinWatch : 1;

  // 3) 取两者中较慢者，钳制到 [0.15, 1.0] 并按 0.05 步进取整，最后统一乘以 1.5（不再重新夹回 1.0）
  const raw = Math.min(1, Math.max(0.15, Math.min(paceBySpeed, paceByDuration)));
  const rounded = Math.round(raw * 20) / 20;
  const basePace = rounded >= 0.95 ? 1 : Math.max(0.15, rounded);
  return Number((basePace * DEFAULT_PACE_MULTIPLIER).toFixed(4));
}
