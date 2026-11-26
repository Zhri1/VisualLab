import type { ResolvedStagePlan, StagePlanFailure } from './stagePlan.ts';
import type { StageMotion, StageEvent, StageGeometry, EndReason } from './stageMotion.ts';
import type { BodySnapshot, BodyState, MotionStatus, StringState } from './multiBodyTypes.ts';
import type { PulleyStage } from './pulleyTypes.ts';

type Phase = {
  start: number;
  end: number;
  s1_0: number; v1_0: number; a1: number;
  s2_0: number; v2_0: number; a2: number;
  taut: boolean;
  tensionN: number;
};

function positiveRoot(d0: number, v0: number, a: number, target: number): number {
  const c = d0 - target;
  if (Math.abs(c) <= 32 * Number.EPSILON * Math.max(1, Math.abs(d0), Math.abs(target))) return 0;
  if (Math.abs(a) < 1e-15) {
    if (Math.abs(v0) < 1e-15) return Infinity;
    const t = -c / v0;
    return t > 0 ? t : Infinity;
  }
  const disc = v0 * v0 - 2 * a * c;
  if (disc < 0) return Infinity;
  const r = Math.sqrt(disc);
  const roots = [(-v0 - r) / a, (-v0 + r) / a].filter((t) => t > 0);
  return roots.length ? Math.min(...roots) : Infinity;
}

export function computePulleyMotion(plan: ResolvedStagePlan): StageMotion | StagePlanFailure {
  const stage = plan.stages[0] as PulleyStage;
  const bodies = plan.bodies!;
  const b1Def = bodies.find((b) => b.bodyId === stage.body1Id)!;
  const b2Def = bodies.find((b) => b.bodyId === stage.body2Id)!;
  const m1 = b1Def.massKg, m2 = b2Def.massKg, g = plan.gravityMps2!;
  const id1 = b1Def.bodyId, id2 = b2Def.bodyId;
  const primaryId = plan.primaryBodyId ?? id1;
  const v0 = 'speedMps' in plan.initial ? plan.initial.speedMps : 0;

  const surf = stage.surface;
  const rad = surf.kind === 'incline' ? (surf.angleDeg * Math.PI) / 180 : 0;
  const fg1 = surf.kind === 'hanging' ? -m1 * g : surf.kind === 'incline' ? -m1 * g * Math.sin(rad) : 0;
  const N1 = surf.kind === 'hanging' ? 0 : surf.kind === 'incline' ? m1 * g * Math.cos(rad) : m1 * g;
  const muk = surf.kind === 'hanging' ? 0 : surf.kineticFrictionCoefficient;
  const mus = surf.kind === 'hanging' ? null : (surf.staticFrictionCoefficient ?? null);
  const fk = muk * N1;
  const fDrive = m2 * g + fg1;

  // 初始世界坐标（定滑轮圆心在 (0, 0)）
  const rPulley = 0.25;
  const minInclineSpan = surf.kind === 'incline' && stage.body2DropToGroundM != null
    ? (stage.body2DropToGroundM + 0.8) / Math.max(0.25, Math.sin(rad))
    : 0;
  const b1Span = Math.max(3.5, (stage.body1TravelLimitM ?? 0) + 0.8, (stage.body2DropToGroundM ?? 0) + 2.0, minInclineSpan);
  const b1Start = surf.kind === 'hanging'
    ? { xM: -rPulley, yM: -b1Span }
    : surf.kind === 'horizontal'
      ? { xM: -b1Span, yM: 0 }
      : { xM: -b1Span * Math.cos(rad), yM: -b1Span * Math.sin(rad) };
  // 斜面配落地地面时，令地面与斜面底端齐平（groundYM = b1Start.yM），避免斜面穿过地面线。
  const b2StartY = surf.kind === 'incline' && stage.body2DropToGroundM != null
    ? Math.min(-0.8, b1Start.yM + stage.body2DropToGroundM)
    : -1.0;
  const b2Start = { xM: rPulley, yM: b2StartY };

  const pos1 = (s1: number) =>
    surf.kind === 'hanging' ? { xM: b1Start.xM, yM: b1Start.yM + s1 }
      : surf.kind === 'horizontal' ? { xM: b1Start.xM + s1, yM: 0 }
        : { xM: b1Start.xM + s1 * Math.cos(rad), yM: b1Start.yM + s1 * Math.sin(rad) };
  const vel1 = (v1: number) =>
    surf.kind === 'hanging' ? { vxMps: 0, vyMps: v1 }
      : surf.kind === 'horizontal' ? { vxMps: v1, vyMps: 0 }
        : { vxMps: v1 * Math.cos(rad), vyMps: v1 * Math.sin(rad) };
  const pos2 = (s2: number) => ({ xM: b2Start.xM, yM: b2Start.yM - s2 });
  const vel2 = (v2: number) => ({ vxMps: 0, vyMps: -v2 });

  const makeSnap = (s1: number, v1: number, s2: number, v2: number, taut: boolean, tensionN: number, st1: BodyState['status'], st2: BodyState['status']): BodySnapshot => {
    const p1 = pos1(s1), u1 = vel1(v1), p2 = pos2(s2), u2 = vel2(v2);
    const constraint: StringState = {
      kind: 'pulley_string',
      constraintId: 'pulley-string',
      bodyIds: [id1, id2],
      pivot: { xM: 0, yM: 0 },
      lengthM: b1Span + 1.0,
      state: taut ? 'taut' : 'slack',
      tensionN: taut ? Math.max(0, tensionN) : 0,
    };
    return {
      bodies: {
        [id1]: { bodyId: id1, massKg: m1, xM: p1.xM, yM: p1.yM, vxMps: u1.vxMps === 0 ? 0 : u1.vxMps, vyMps: u1.vyMps === 0 ? 0 : u1.vyMps, springCompressionM: 0, status: st1, constraintId: 'pulley-string' },
        [id2]: { bodyId: id2, massKg: m2, xM: p2.xM, yM: p2.yM, vxMps: 0, vyMps: u2.vyMps === 0 ? 0 : u2.vyMps, springCompressionM: 0, status: st2, constraintId: 'pulley-string' },
      },
      constraints: { 'pulley-string': constraint },
    };
  };

  const phases: Phase[] = [];
  const events: StageEvent[] = [];
  const eventSnaps: BodySnapshot[] = [];
  const addEvent = (kind: string, timeSeconds: number, before: BodySnapshot, after: BodySnapshot, label: string, explanation: string) => {
    const order = events.length;
    const pb = before.bodies[primaryId], pa = after.bodies[primaryId];
    events.push({
      id: `0:${kind}:${order}`, stageIndex: 0, stagePath: '/stages/0', bodyIds: [id1, id2],
      kind, timeSeconds, order,
      velocityBefore: { vxMps: pb.vxMps, vyMps: pb.vyMps },
      velocityAfter: { vxMps: pa.vxMps, vyMps: pa.vyMps },
      bodyStatesBefore: before.bodies, bodyStatesAfter: after.bodies,
      constraintsBefore: before.constraints, constraintsAfter: after.constraints,
      label, explanation,
    });
    eventSnaps.push(after);
  };

  // 判断静止保持 vs 滑动
  const tol = 64 * Number.EPSILON * Math.max(1, Math.abs(fDrive), fk);
  let holds = false;
  if (Math.abs(v0) <= 1e-12) {
    if (Math.abs(fDrive) <= tol) holds = true;
    else if (mus !== null) holds = Math.abs(fDrive) <= mus * N1 + tol;
    else if (surf.kind !== 'hanging' && surf.slidesAfterRelease === false) holds = true;
  }

  let t = 0, s1 = 0, v1 = v0, s2 = 0, v2 = v0;
  let endReason: EndReason = 'prefix_end';
  let statusMessage = '已按题设完成滑轮连接体观察范围。';

  if (holds) {
    const T0 = m2 * g;
    const snap = makeSnap(0, 0, 0, 0, true, T0, 'resting', 'resting');
    addEvent('release', 0, snap, snap, '释放（保持静止）', `静摩擦平衡驱动力，系统保持静止，绳张力 T = ${T0.toFixed(2)} N。`);
    addEvent('stop', 0, snap, snap, '静止平衡', '系统保持静止平衡，无相对滑动。');
    endReason = 'stopped';
    statusMessage = '静摩擦足以平衡驱动力，连接体保持静止。';
  } else {
    const d = Math.abs(v0) > 1e-12 ? Math.sign(v0) : (Math.sign(fDrive) || 1);
    const aTaut = (fDrive - d * fk) / (m1 + m2);
    const tension = m2 * (g - aTaut);
    const taut = tension >= -64 * Number.EPSILON * Math.max(1, m2 * g);
    const safeT = taut ? Math.max(0, tension) : 0;
    const a1Init = taut ? aTaut : (fg1 - d * fk) / m1;
    const a2Init = taut ? aTaut : g;

    const initSnap = makeSnap(0, v0, 0, v0, taut, safeT, Math.abs(v0) > 0 ? 'moving' : 'resting', Math.abs(v0) > 0 ? 'moving' : 'resting');
    addEvent('release', 0, initSnap, initSnap, '释放连接体', taut ? `轻绳张紧，共同加速度 a = ${aTaut.toFixed(4)} m/s²，绳张力 T = ${safeT.toFixed(4)} N。` : '张力为零，轻绳松弛，两物体各自运动。');

    const tMax = stage.durationSeconds ?? Infinity;
    const tGround = stage.body2DropToGroundM != null ? positiveRoot(0, v0, a2Init, stage.body2DropToGroundM) : Infinity;
    const tLimit = stage.body1TravelLimitM != null ? positiveRoot(0, v0, a1Init, stage.body1TravelLimitM) : Infinity;
    const tZero = taut && fk > 0 && Math.abs(v0) > 1e-12 && aTaut * v0 < 0 ? -v0 / aTaut : Infinity;
    const tEnd1 = Math.min(tMax, tGround, tLimit, tZero);

    if (!Number.isFinite(tEnd1)) {
      return {
        ok: false,
        code: 'INCONSISTENT_CONDITIONS',
        message: '当前运动方向不会到达给定地面或行程上限，请补充观察时长 durationSeconds。',
        reading: plan as unknown as import('./stagePlan.ts').StagePlanDraft,
        missingKeys: ['/stages/0/durationSeconds'],
        fieldErrors: [{ path: '/stages/0/durationSeconds', code: 'PRECONDITION_CONFLICT', message: '请补充有限观察时长。' }],
      };
    }

    if (tEnd1 > 0) {
      phases.push({ start: 0, end: tEnd1, s1_0: 0, v1_0: v0, a1: a1Init, s2_0: 0, v2_0: v0, a2: a2Init, taut, tensionN: safeT });
      s1 = v0 * tEnd1 + 0.5 * a1Init * tEnd1 * tEnd1;
      v1 = Math.abs(tEnd1 - tZero) <= 1e-12 ? 0 : v0 + a1Init * tEnd1;
      s2 = v0 * tEnd1 + 0.5 * a2Init * tEnd1 * tEnd1;
      v2 = Math.abs(tEnd1 - tZero) <= 1e-12 ? 0 : v0 + a2Init * tEnd1;
      t = tEnd1;
    }

    if (tZero < tGround - 1e-12 && tZero < tLimit - 1e-12 && tZero <= tMax + 1e-12 && Number.isFinite(tZero)) {
      const stopAtZero = mus !== null ? Math.abs(fDrive) <= mus * N1 + tol : Math.abs(fDrive) <= fk + tol;
      const zeroSnap = makeSnap(s1, 0, s2, 0, true, m2 * g, stopAtZero ? 'resting' : 'turning', stopAtZero ? 'resting' : 'turning');
      if (stopAtZero) {
        addEvent('stop', t, zeroSnap, zeroSnap, '减速至静止', '速度归零后静摩擦足以维持平衡，系统停止。');
        endReason = 'stopped';
        statusMessage = '连接体在粗糙面上减速至静止。';
      } else {
        addEvent('turn_around', t, zeroSnap, zeroSnap, '速度为零折返', '速度归零后驱动力大于静摩擦上限，随后反向加速。');
        const d2 = Math.sign(fDrive) || 1;
        const aRev = (fDrive - d2 * fk) / (m1 + m2);
        const tRevT = Math.max(0, m2 * (g - aRev));
        const remMax = Number.isFinite(tMax) ? Math.max(0, tMax - t) : Infinity;
        const tG2 = stage.body2DropToGroundM != null ? positiveRoot(s2, 0, aRev, stage.body2DropToGroundM) : Infinity;
        const tL2 = stage.body1TravelLimitM != null ? positiveRoot(s1, 0, aRev, stage.body1TravelLimitM) : Infinity;
        const dtRev = Math.min(remMax, tG2, tL2);
        if (dtRev > 0 && Number.isFinite(dtRev)) {
          phases.push({ start: t, end: t + dtRev, s1_0: s1, v1_0: 0, a1: aRev, s2_0: s2, v2_0: 0, a2: aRev, taut: true, tensionN: tRevT });
          s1 += 0.5 * aRev * dtRev * dtRev; v1 = aRev * dtRev;
          s2 += 0.5 * aRev * dtRev * dtRev; v2 = aRev * dtRev;
          t += dtRev;
        }
        const endSnap = makeSnap(s1, v1, s2, v2, true, tRevT, 'moving', 'moving');
        addEvent('force_segment_end', t, endSnap, endSnap, '观察范围结束', `折返后运动至 ${t.toFixed(2)} s，绳张力 T = ${tRevT.toFixed(4)} N。`);
        endReason = 'prefix_end';
      }
    } else if (tGround <= tMax + 1e-12 && tGround <= tLimit + 1e-12 && Number.isFinite(tGround)) {
      const beforeHit = makeSnap(s1, v1, s2, v2, taut, safeT, 'moving', 'moving');
      const afterHit = makeSnap(s1, v1, s2, 0, false, 0, Math.abs(v1) > 0 ? 'moving' : 'resting', 'landed');
      addEvent('body2_ground_hit', t, beforeHit, afterHit, '悬挂物着地', `悬挂物下降 ${stage.body2DropToGroundM!.toFixed(2)} m 着地，速度由 ${Math.abs(v2).toFixed(4)} m/s 归零。`);
      addEvent('string_slack', t, afterHit, afterHit, '轻绳松弛', '悬挂物着地后绳张力降为 0 N，支承面物体独立滑行。');
      v2 = 0;

      // 第二阶段：绳松弛（T = 0），body1 独立减速/滑行
      if (Math.abs(v1) > 1e-12) {
        const a1Slack = (fg1 - Math.sign(v1) * fk) / m1;
        const remMax = Number.isFinite(tMax) ? Math.max(0, tMax - t) : Infinity;
        const tStop = a1Slack * v1 < 0 ? -v1 / a1Slack : Infinity;
        const tLim2 = stage.body1TravelLimitM != null ? positiveRoot(s1, v1, a1Slack, stage.body1TravelLimitM) : Infinity;
        const dt2 = Math.min(remMax, tStop, tLim2);
        if (dt2 > 0 && Number.isFinite(dt2)) {
          phases.push({ start: t, end: t + dt2, s1_0: s1, v1_0: v1, a1: a1Slack, s2_0: s2, v2_0: 0, a2: 0, taut: false, tensionN: 0 });
          s1 = s1 + v1 * dt2 + 0.5 * a1Slack * dt2 * dt2;
          v1 = Math.abs(dt2 - tStop) <= 1e-12 ? 0 : v1 + a1Slack * dt2;
          t += dt2;
        }
        if (tStop <= remMax + 1e-12 && tStop <= tLim2 + 1e-12 && Number.isFinite(tStop)) {
          const staysAtRest = surf.kind === 'horizontal' || (surf.kind === 'incline' && mus !== null && Math.abs(fg1) <= mus * N1 + tol);
          if (staysAtRest) {
            const stopSnap = makeSnap(s1, 0, s2, 0, false, 0, 'resting', 'landed');
            addEvent('stop', t, stopSnap, stopSnap, '支承物体停止', `绳松弛后滑行至总位移 ${s1.toFixed(4)} m 处静止，张力保持 0 N。`);
            endReason = 'stopped';
            statusMessage = '悬挂物着地后轻绳松弛，支承面物体减速至静止。';
          } else {
            const turnSnap = makeSnap(s1, 0, s2, 0, false, 0, 'turning', 'landed');
            addEvent('turn_around', t, turnSnap, turnSnap, '到达最高点边界', `绳松弛后速度在位移 ${s1.toFixed(4)} m 处瞬时归零，随后将沿面反向滑回（未求再次张紧冲量）。`);
            endReason = 'prefix_end';
            statusMessage = '悬挂物着地后轻绳松弛，物体到达瞬时零速边界。';
          }
        } else {
          const endSnap = makeSnap(s1, v1, s2, 0, false, 0, 'model_boundary', 'landed');
          addEvent('force_segment_end', t, endSnap, endSnap, '到达行程或观察边界', `总位移 ${s1.toFixed(4)} m，速度 ${Math.abs(v1).toFixed(4)} m/s。`);
          endReason = 'prefix_end';
        }
      } else {
        endReason = 'stopped';
      }
    } else {
      const hitLimit = tLimit < tMax - 1e-12 && Number.isFinite(tLimit);
      const endSnap = makeSnap(s1, v1, s2, v2, taut, safeT, hitLimit ? 'model_boundary' : 'moving', hitLimit ? 'model_boundary' : 'moving');
      addEvent('force_segment_end', t, endSnap, endSnap, hitLimit ? '到达行程边界' : '观察范围结束', `经过 ${t.toFixed(2)} s，共同速率 ${Math.abs(v1).toFixed(4)} m/s，绳张力 T = ${safeT.toFixed(4)} N。`);
      endReason = 'prefix_end';
    }
  }

  const finalSnap = eventSnaps[eventSnaps.length - 1];
  const lastEvent = events[events.length - 1];
  const termination = { reason: endReason, eventId: lastEvent.id, stageIndex: 0 };
  const motionStatus: MotionStatus = {
    state: endReason === 'stopped' ? 'complete' : 'range_end',
    reason: endReason,
    bodyIds: [id1, id2],
    message: statusMessage,
  };
  const geometry: StageGeometry = {
    blockSizeM: 0.3,
    positionReference: 'particle',
    bodies,
    pulley: {
      body1Id: id1,
      body2Id: id2,
      pulley: { xM: 0, yM: 0 },
      surfaceKind: surf.kind,
      ...(surf.kind === 'incline' ? { angleDeg: surf.angleDeg } : {}),
      body1Start: b1Start,
      body2Start: b2Start,
      groundYM: stage.body2DropToGroundM != null ? b2Start.yM - stage.body2DropToGroundM : null,
    },
  };
  const segments: StageMotion['segments'] = t > 0
    ? [{ stageIndex: 0, kind: 'pulley_system', startSeconds: 0, endSeconds: t, bodyIds: [id1, id2], stagePath: '/stages/0' }]
    : [];

  const copySnap = (s: BodySnapshot): BodySnapshot => ({
    bodies: Object.fromEntries(Object.entries(s.bodies).map(([k, v]) => [k, { ...v }])),
    constraints: Object.fromEntries(Object.entries(s.constraints).map(([k, v]) => [k, { ...v, bodyIds: [...v.bodyIds], pivot: { ...v.pivot } }])),
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
        const tolE = 8 * Number.EPSILON * Math.max(Math.abs(et), Math.abs(q), Number.MIN_VALUE);
        if (dist <= tolE && dist < nearestDist) { nearestIdx = i; nearestDist = dist; }
      }
      if (!snap && nearestIdx >= 0) snap = copySnap(eventSnaps[nearestIdx]);
      if (!snap) {
        const ph = phases.find((item) => q >= item.start && q < item.end);
        if (ph) {
          const dt = q - ph.start;
          const curS1 = ph.s1_0 + ph.v1_0 * dt + 0.5 * ph.a1 * dt * dt;
          const curV1 = ph.v1_0 + ph.a1 * dt;
          const curS2 = ph.s2_0 + ph.v2_0 * dt + 0.5 * ph.a2 * dt * dt;
          const curV2 = ph.v2_0 + ph.a2 * dt;
          snap = makeSnap(curS1, curV1, curS2, curV2, ph.taut, ph.tensionN, Math.abs(curV1) > 0 ? 'moving' : 'resting', !ph.taut && ph.v2_0 === 0 ? 'landed' : Math.abs(curV2) > 0 ? 'moving' : 'resting');
        } else {
          snap = copySnap(finalSnap);
        }
      }
      const p = snap.bodies[primaryId];
      return { xM: p.xM, yM: p.yM, vxMps: p.vxMps, vyMps: p.vyMps, springCompressionM: 0, ...snap };
    },
  };
}
