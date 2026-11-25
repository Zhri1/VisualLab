import type { ResolvedStagePlan, StagePlanFailure } from './stagePlan.ts';
import type { StageMotion, StageEvent, StageGeometry, EndReason } from './stageMotion.ts';
import type { BodySnapshot, BodyState, MotionStatus } from './multiBodyTypes.ts';
import type { BlockPlankStage } from './blockPlankTypes.ts';
import type { HorizontalInitial } from './horizontalTypes.ts';

type Phase = {
  start: number;
  end: number;
  xb0: number; vb0: number; ab: number;
  xp0: number; vp0: number; ap: number;
};

function solveEdgeTime(s0: number, vRel0: number, aRel: number, targetS: number): number {
  const c = s0 - targetS;
  const tol = 32 * Number.EPSILON * Math.max(1, Math.abs(s0), Math.abs(targetS));
  if (Math.abs(c) <= tol) {
    // 已在边缘：若相对速度或加速度向外则立即离开，否则不立即离开
    const outward = targetS > 0 ? (vRel0 > 0 || (vRel0 === 0 && aRel > 0)) : (vRel0 < 0 || (vRel0 === 0 && aRel < 0));
    return outward ? 0 : Infinity;
  }
  if (Math.abs(aRel) < 1e-15) {
    if (Math.abs(vRel0) < 1e-15) return Infinity;
    const t = -c / vRel0;
    return t > 0 ? t : Infinity;
  }
  const disc = vRel0 * vRel0 - 2 * aRel * c;
  if (disc < 0) return Infinity;
  const r = Math.sqrt(disc);
  const roots = [(-vRel0 - r) / aRel, (-vRel0 + r) / aRel].filter((t) => t > 0);
  return roots.length ? Math.min(...roots) : Infinity;
}

export function computeBlockPlankMotion(plan: ResolvedStagePlan): StageMotion | StagePlanFailure {
  const stage = plan.stages[0] as BlockPlankStage;
  const bodies = plan.bodies!;
  const blockDef = bodies.find((b) => b.bodyId === stage.blockBodyId)!;
  const plankDef = bodies.find((b) => b.bodyId === stage.plankBodyId)!;
  const initBodies = (plan.initial as HorizontalInitial).bodies;
  const initBlock = initBodies.find((b) => b.bodyId === stage.blockBodyId)!;
  const initPlank = initBodies.find((b) => b.bodyId === stage.plankBodyId)!;

  const m = blockDef.massKg, M = plankDef.massKg, g = plan.gravityMps2!;
  const L = stage.plankLengthM, fk = stage.kineticFrictionCoefficient * m * g;
  const bId = blockDef.bodyId, pId = plankDef.bodyId;
  const primaryId = plan.primaryBodyId ?? bId;

  const makeSnap = (xb: number, vb: number, xp: number, vp: number, statusB: BodyState['status'], statusP: BodyState['status']): BodySnapshot => ({
    bodies: {
      [bId]: { bodyId: bId, massKg: m, xM: xb, yM: 0, vxMps: vb === 0 ? 0 : vb, vyMps: 0, springCompressionM: 0, status: statusB },
      [pId]: { bodyId: pId, massKg: M, xM: xp, yM: 0, vxMps: vp === 0 ? 0 : vp, vyMps: 0, springCompressionM: 0, status: statusP },
    },
    constraints: {},
  });

  const phases: Phase[] = [];
  const events: StageEvent[] = [];
  const eventSnaps: BodySnapshot[] = [];
  const addEvent = (kind: string, timeSeconds: number, before: BodySnapshot, after: BodySnapshot, label: string, explanation: string) => {
    const order = events.length;
    const pb = before.bodies[primaryId], pa = after.bodies[primaryId];
    events.push({
      id: `0:${kind}:${order}`,
      stageIndex: 0,
      stagePath: '/stages/0',
      bodyIds: [bId, pId],
      kind,
      timeSeconds,
      order,
      velocityBefore: { vxMps: pb.vxMps, vyMps: pb.vyMps },
      velocityAfter: { vxMps: pa.vxMps, vyMps: pa.vyMps },
      bodyStatesBefore: before.bodies,
      bodyStatesAfter: after.bodies,
      constraintsBefore: before.constraints,
      constraintsAfter: after.constraints,
      label,
      explanation,
    });
    eventSnaps.push(after);
  };

  let t = 0, xb = initBlock.xM, vb = initBlock.vxMps, xp = initPlank.xM, vp = initPlank.vxMps;
  let endReason: EndReason = 'prefix_end';
  let statusMessage = '已按题设完成滑块与木板运动范围。';
  let leftEdge = false;

  const startSnap = makeSnap(xb, vb, xp, vp, Math.abs(vb) > 0 ? 'moving' : 'resting', Math.abs(vp) > 0 ? 'moving' : 'resting');
  addEvent('release', 0, startSnap, startSnap, '开始接触滑行', `滑块初速 ${vb.toFixed(2)} m/s，木板初速 ${vp.toFixed(2)} m/s，板长 ${L.toFixed(2)} m。`);

  // 第一段：相对滑动（v_rel != 0）
  const vRel0 = vb - vp;
  if (Math.abs(vRel0) > 1e-12) {
    const d = Math.sign(vRel0);
    const ab = -d * fk / m;
    const ap = d * fk / M;
    const aRel = ab - ap;
    const tc = fk > 0 ? -vRel0 / aRel : Infinity;
    const s0 = xb - xp;
    const sTol = 64 * Number.EPSILON * Math.max(1, L, Math.abs(s0));
    const sAtTc = Number.isFinite(tc) ? s0 + vRel0 * tc + 0.5 * aRel * tc * tc : NaN;
    const reachesCommonOnPlank = Number.isFinite(tc) && sAtTc >= -sTol && sAtTc <= L + sTol;
    const tEdge = reachesCommonOnPlank ? Infinity : (d > 0 ? solveEdgeTime(s0, vRel0, aRel, L) : solveEdgeTime(s0, vRel0, aRel, 0));

    if (!reachesCommonOnPlank && tEdge < tc) {
      const xb1 = xb + vb * tEdge + 0.5 * ab * tEdge * tEdge;
      const vb1 = vb + ab * tEdge;
      const xp1 = xp + vp * tEdge + 0.5 * ap * tEdge * tEdge;
      const vp1 = vp + ap * tEdge;
      if (tEdge > 0) phases.push({ start: t, end: t + tEdge, xb0: xb, vb0: vb, ab, xp0: xp, vp0: vp, ap });
      t += tEdge; xb = xb1; vb = vb1; xp = xp1; vp = vp1;
      const snap = makeSnap(xb, vb, xp, vp, 'model_boundary', Math.abs(vp) > 0 ? 'moving' : 'resting');
      addEvent('plank_edge_leave', t, snap, snap, '滑块到达板边', `在共速前到达木板${d > 0 ? '右' : '左'}端，块速 ${vb.toFixed(4)} m/s、板速 ${vp.toFixed(4)} m/s；未给板高与落地面，仅算到离板边界。`);
      endReason = 'plank_edge_leave';
      statusMessage = '滑块在共速前滑离木板边缘；保留离板瞬间的双体状态，不伪造未给出的落地过程。';
      leftEdge = true;
    } else if (Number.isFinite(tc)) {
      const xb1 = xb + vb * tc + 0.5 * ab * tc * tc;
      const xp1 = xp + vp * tc + 0.5 * ap * tc * tc;
      const vc = (m * vb + M * vp) / (m + M);
      if (tc > 0) phases.push({ start: t, end: t + tc, xb0: xb, vb0: vb, ab, xp0: xp, vp0: vp, ap });
      t += tc; xb = xb1; vb = vc; xp = xp1; vp = vc;
      const st: BodyState['status'] = Math.abs(vc) > 0 ? 'moving' : 'resting';
      const snap = makeSnap(xb, vb, xp, vp, st, st);
      const relDisp = (xb - xp) - s0;
      addEvent('common_velocity', t, snap, snap, '达到共速', `经过 ${tc.toFixed(4)} s 达到共速 v = ${vc.toFixed(4)} m/s，相对木板位移 ${relDisp.toFixed(4)} m。`);
    }
  } else {
    const st: BodyState['status'] = Math.abs(vb) > 0 ? 'moving' : 'resting';
    const snap = makeSnap(xb, vb, xp, vp, st, st);
    addEvent('common_velocity', 0, snap, snap, '初始即共速', `滑块与木板初始共速 v = ${vb.toFixed(4)} m/s。`);
  }

  // 第二段：共速后外力或继续观察
  if (!leftEdge && stage.postCommonForce) {
    const { blockForceXN: Fb, plankForceXN: Fp, durationSeconds: dur } = stage.postCommonForce;
    const aCo = (Fb + Fp) / (m + M);
    const fsReq = (m * Fp - M * Fb) / (m + M);
    const fsMax = (stage.staticFrictionCoefficient ?? 0) * m * g;
    const fsTol = 64 * Number.EPSILON * Math.max(1, fsMax, Math.abs(m * Fp), Math.abs(M * Fb));
    const staysTogether = Math.abs(fsReq) <= fsMax + fsTol;
    const beforeSnap = makeSnap(xb, vb, xp, vp, Math.abs(vb) > 0 ? 'moving' : 'resting', Math.abs(vp) > 0 ? 'moving' : 'resting');

    if (staysTogether) {
      addEvent('common_force_together', t, beforeSnap, beforeSnap, '共速后受外力共同运动', `所需静摩擦 ${Math.abs(fsReq).toFixed(4)} N ≤ 上限 ${fsMax.toFixed(4)} N，共同加速度 a = ${aCo.toFixed(4)} m/s²。`);
      const xb1 = xb + vb * dur + 0.5 * aCo * dur * dur;
      const vb1 = vb + aCo * dur;
      const xp1 = xp + vp * dur + 0.5 * aCo * dur * dur;
      const vp1 = vp + aCo * dur;
      phases.push({ start: t, end: t + dur, xb0: xb, vb0: vb, ab: aCo, xp0: xp, vp0: vp, ap: aCo });
      t += dur; xb = xb1; vb = vb1; xp = xp1; vp = vp1;
      const endSnap = makeSnap(xb, vb, xp, vp, Math.abs(vb) > 0 ? 'moving' : 'resting', Math.abs(vp) > 0 ? 'moving' : 'resting');
      addEvent('force_segment_end', t, endSnap, endSnap, '观察范围结束', `共速共同加速结束，双体速度均为 ${vb.toFixed(4)} m/s。`);
      statusMessage = '共速后外力未超过静摩擦上限，滑块与木板保持相对静止共同运动。';
    } else {
      const r = -Math.sign(fsReq); // 块相对木板的滑动趋势方向
      const ab = (Fb - r * fk) / m;
      const ap = (Fp + r * fk) / M;
      const aRel = ab - ap;
      addEvent('reslide_start', t, beforeSnap, beforeSnap, '超过静摩擦上限重新滑动', `所需静摩擦 ${Math.abs(fsReq).toFixed(4)} N > 上限 ${fsMax.toFixed(4)} N；块加速度 ${ab.toFixed(4)} m/s²、板加速度 ${ap.toFixed(4)} m/s²，块相对板向${r < 0 ? '后' : '前'}滑动。`);
      const sNow = xb - xp;
      const tEdge = aRel < 0 ? solveEdgeTime(sNow, 0, aRel, 0) : solveEdgeTime(sNow, 0, aRel, L);
      const dt = Math.min(dur, tEdge);
      const xb1 = xb + vb * dt + 0.5 * ab * dt * dt;
      const vb1 = vb + ab * dt;
      const xp1 = xp + vp * dt + 0.5 * ap * dt * dt;
      const vp1 = vp + ap * dt;
      if (dt > 0) phases.push({ start: t, end: t + dt, xb0: xb, vb0: vb, ab, xp0: xp, vp0: vp, ap });
      t += dt; xb = xb1; vb = vb1; xp = xp1; vp = vp1;
      if (tEdge <= dur + 32 * Number.EPSILON * Math.max(1, dur)) {
        const snap = makeSnap(xb, vb, xp, vp, 'model_boundary', Math.abs(vp) > 0 ? 'moving' : 'resting');
        addEvent('plank_edge_leave', t, snap, snap, '重新滑动后到达板边', `滑块相对木板向${r < 0 ? '左' : '右'}滑离板边，块速 ${vb.toFixed(4)} m/s、板速 ${vp.toFixed(4)} m/s。`);
        endReason = 'plank_edge_leave';
        statusMessage = '共速后外力超过静摩擦上限，滑块重新滑动并到达木板边缘。';
      } else {
        const snap = makeSnap(xb, vb, xp, vp, Math.abs(vb) > 0 ? 'moving' : 'resting', Math.abs(vp) > 0 ? 'moving' : 'resting');
        addEvent('force_segment_end', t, snap, snap, '观察范围结束', `观察结束时仍在板上相对滑动，块速 ${vb.toFixed(4)} m/s、板速 ${vp.toFixed(4)} m/s。`);
        statusMessage = '共速后外力超过静摩擦上限，滑块与木板发生相对滑动。';
      }
    }
  } else if (!leftEdge && stage.postCommonDurationSeconds && stage.postCommonDurationSeconds > 0) {
    const dur = stage.postCommonDurationSeconds;
    phases.push({ start: t, end: t + dur, xb0: xb, vb0: vb, ab: 0, xp0: xp, vp0: vp, ap: 0 });
    t += dur; xb += vb * dur; xp += vp * dur;
    const snap = makeSnap(xb, vb, xp, vp, Math.abs(vb) > 0 ? 'moving' : 'resting', Math.abs(vp) > 0 ? 'moving' : 'resting');
    addEvent('force_segment_end', t, snap, snap, '共速观察结束', `共速匀速运动 ${dur.toFixed(2)} s 后结束观察。`);
  }

  const finalSnap = eventSnaps[eventSnaps.length - 1];
  const lastEvent = events[events.length - 1];
  const termination = { reason: endReason, eventId: lastEvent.id, stageIndex: 0 };
  const motionStatus: MotionStatus = {
    state: 'range_end',
    reason: endReason,
    bodyIds: [bId, pId],
    message: statusMessage,
  };
  const geometry: StageGeometry = {
    blockSizeM: 0.3,
    positionReference: 'particle',
    bodies,
    plank: { blockBodyId: bId, plankBodyId: pId, plankLengthM: L },
  };
  const segments: StageMotion['segments'] = t > 0
    ? [{ stageIndex: 0, kind: 'block_plank', startSeconds: 0, endSeconds: t, bodyIds: [bId, pId], stagePath: '/stages/0' }]
    : [];

  const copySnap = (s: BodySnapshot): BodySnapshot => ({
    bodies: Object.fromEntries(Object.entries(s.bodies).map(([k, v]) => [k, { ...v }])),
    constraints: {},
  });

  return {
    primaryBodyId: primaryId,
    motionStatus,
    geometry,
    durationSeconds: t,
    segments,
    events,
    termination,
    get endReason() { return termination.reason; },
    sampleAt(timeSeconds) {
      const q = Number.isNaN(timeSeconds) ? 0 : Math.min(t, Math.max(0, timeSeconds));
      let snap: BodySnapshot | null = null;
      let nearestIdx = -1, nearestDist = Infinity;
      for (let i = events.length - 1; i >= 0; i--) {
        const et = events[i].timeSeconds;
        if (et === q) { snap = copySnap(eventSnaps[i]); break; }
        const dist = Math.abs(et - q);
        const tol = 8 * Number.EPSILON * Math.max(Math.abs(et), Math.abs(q), Number.MIN_VALUE);
        if (dist <= tol && dist < nearestDist) { nearestIdx = i; nearestDist = dist; }
      }
      if (!snap && nearestIdx >= 0) snap = copySnap(eventSnaps[nearestIdx]);
      if (!snap) {
        const ph = phases.find((item) => q >= item.start && q < item.end);
        if (ph) {
          const dt = q - ph.start;
          const xbn = ph.xb0 + ph.vb0 * dt + 0.5 * ph.ab * dt * dt;
          const vbn = ph.vb0 + ph.ab * dt;
          const xpn = ph.xp0 + ph.vp0 * dt + 0.5 * ph.ap * dt * dt;
          const vpn = ph.vp0 + ph.ap * dt;
          snap = makeSnap(xbn, vbn, xpn, vpn, Math.abs(vbn) > 0 ? 'moving' : 'resting', Math.abs(vpn) > 0 ? 'moving' : 'resting');
        } else {
          snap = copySnap(finalSnap);
        }
      }
      const p = snap.bodies[primaryId];
      return { xM: p.xM, yM: p.yM, vxMps: p.vxMps, vyMps: p.vyMps, springCompressionM: 0, ...snap };
    },
  };
}
