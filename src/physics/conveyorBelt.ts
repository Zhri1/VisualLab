export type ConveyorBeltSegment = {
  accelerationMps2: number;
  durationSeconds: number;
};

export type ConveyorBeltStage = {
  kind: "conveyor_belt";
  initialBeltSpeedMps: number;
  segments: ConveyorBeltSegment[];
  kineticFrictionCoefficient: number;
  staticFrictionCoefficient?: number | null;
  beltLengthM?: number | null;
};

export type ConveyorReading = {
  beltSpeedMps: number;
  beltDisplacementM: number;
  relativeDisplacementM: number;
  relativeSpeedMps: number;
};

export type ConveyorGeometry = {
  minXM: number;
  maxXM: number;
  beltLengthM: number | null;
  initialBeltSpeedMps: number;
};

type Piece = {
  start: number;
  end: number;
  x0: number; v0: number; a: number;
  xb0: number; vb0: number; ab: number;
};

type ConveyorEvent = {
  kind: string;
  time: number;
  xM: number;
  vxMps: number;
  label: string;
  explanation: string;
};

function solveExitTime(x0: number, v0: number, a: number, targetX: number): number {
  const c = x0 - targetX;
  if (Math.abs(c) <= 32 * Number.EPSILON * Math.max(1, Math.abs(x0), Math.abs(targetX))) {
    const outward = targetX > 0 ? (v0 > 0 || (v0 === 0 && a > 0)) : (v0 < 0 || (v0 === 0 && a < 0));
    if (outward) return 0;
    // 从边缘向内进入后折返再次回到同一边缘：v0*t + 0.5*a*t^2 = 0 → t = -2*v0/a
    if (Math.abs(a) >= 1e-15) {
      const tReturn = -2 * v0 / a;
      if (tReturn > 0) return tReturn;
    }
    return Infinity;
  }
  if (Math.abs(a) < 1e-15) {
    if (Math.abs(v0) < 1e-15) return Infinity;
    const t = -c / v0;
    return t > 0 ? t : Infinity;
  }
  const disc = v0 * v0 - 2 * a * c;
  if (disc < 0) return Infinity;
  const r = Math.sqrt(disc);
  const roots = [(-v0 - r) / a, (-v0 + r) / a].filter((t) => {
    if (t <= 0) return false;
    const vAt = v0 + a * t;
    // 排除恰在边缘相切折返（速度为零且加速度指回带内）
    const leaves = targetX > 0 ? (vAt > 1e-12 || (Math.abs(vAt) <= 1e-12 && a >= 0)) : (vAt < -1e-12 || (Math.abs(vAt) <= 1e-12 && a <= 0));
    return leaves;
  });
  return roots.length ? Math.min(...roots) : Infinity;
}

export function solveConveyorBelt(stage: ConveyorBeltStage, startXM: number, startVxMps: number, gravityMps2: number) {
  const ak = stage.kineticFrictionCoefficient * gravityMps2;
  const asMax = (stage.staticFrictionCoefficient ?? 0) * gravityMps2;
  const L = stage.beltLengthM ?? null;

  let t = 0, x = startXM, v = startVxMps, xb = 0, vb = stage.initialBeltSpeedMps;
  let minX = x, maxX = x;
  let exited = false;
  const pieces: Piece[] = [];
  const events: ConveyorEvent[] = [];

  for (let idx = 0; idx < stage.segments.length && !exited; idx++) {
    const seg = stage.segments[idx];
    let rem = seg.durationSeconds;
    const ab = seg.accelerationMps2;
    let guard = 0;
    while (rem > 1e-12 && !exited && guard++ < 16) {
      const vRel = v - vb;
      const vTol = 64 * Number.EPSILON * Math.max(1, Math.abs(v), Math.abs(vb));
      let a: number;
      let dt = rem;
      let reachesCommon = false;

      if (Math.abs(vRel) <= vTol) {
        const aTol = 64 * Number.EPSILON * Math.max(1, asMax, Math.abs(ab));
        if (Math.abs(ab) <= asMax + aTol) {
          a = ab;
        } else {
          a = Math.sign(ab) * ak;
          events.push({
            kind: "conveyor_reslide",
            time: t,
            xM: x,
            vxMps: v,
            label: "静摩擦不足重新滑动",
            explanation: `带面加速度 ${ab.toFixed(2)} m/s² 超过静摩擦上限 ${asMax.toFixed(2)} m/s²，滑块切换为动摩擦加速度 ${a.toFixed(2)} m/s²。`,
          });
        }
      } else {
        a = -Math.sign(vRel) * ak;
        const aRel = a - ab;
        if (vRel * aRel < 0) {
          const tc = -vRel / aRel;
          if (tc > 0 && tc <= rem + 32 * Number.EPSILON * Math.max(1, rem)) {
            dt = Math.min(rem, tc);
            reachesCommon = true;
          }
        }
      }

      // 检查带长边界（若题面给定 beltLengthM）
      if (L !== null) {
        const tLeft = solveExitTime(x, v, a, 0);
        const tRight = solveExitTime(x, v, a, L);
        const tExit = Math.min(tLeft, tRight);
        if (tExit <= dt + 32 * Number.EPSILON * Math.max(1, dt)) {
          dt = Math.min(dt, tExit);
          reachesCommon = false;
          exited = true;
        }
      }

      // 检查段内对地速度过零折返
      if (a !== 0 && v !== 0 && v * (v + a * dt) < 0) {
        const tTurn = -v / a;
        if (tTurn > 0 && tTurn < dt) {
          const xTurn = x + v * tTurn + 0.5 * a * tTurn * tTurn;
          minX = Math.min(minX, xTurn);
          maxX = Math.max(maxX, xTurn);
          events.push({
            kind: "turn_around",
            time: t + tTurn,
            xM: xTurn,
            vxMps: 0,
            label: "对地速度为零折返",
            explanation: `对地速度在 x = ${xTurn.toFixed(4)} m 处降为零，随后沿传送带方向反向加速。`,
          });
        }
      }

      const x1 = x + v * dt + 0.5 * a * dt * dt;
      let v1 = v + a * dt;
      const xb1 = xb + vb * dt + 0.5 * ab * dt * dt;
      const vb1 = vb + ab * dt;
      if (reachesCommon || Math.abs(v1 - vb1) <= 64 * Number.EPSILON * Math.max(1, Math.abs(v1), Math.abs(vb1))) {
        v1 = vb1;
      }

      if (dt > 0) pieces.push({ start: t, end: t + dt, x0: x, v0: v, a, xb0: xb, vb0: vb, ab });
      t += dt;
      x = x1;
      v = v1;
      xb = xb1;
      vb = vb1;
      rem -= dt;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);

      if (exited) {
        events.push({
          kind: "conveyor_exit",
          time: t,
          xM: x,
          vxMps: v,
          label: "滑离传送带",
          explanation: `在 x = ${x.toFixed(4)} m 处离开传送带，离带速度 vₓ = ${v.toFixed(4)} m/s，相对带面位移 ${(x - startXM - xb).toFixed(4)} m。`,
        });
      } else if (reachesCommon) {
        events.push({
          kind: "conveyor_common_velocity",
          time: t,
          xM: x,
          vxMps: v,
          label: "与传送带共速",
          explanation: `经过 ${t.toFixed(4)} s 达到共速 v = ${v.toFixed(4)} m/s；对地位移 ${(x - startXM).toFixed(4)} m，相对带面位移 ${(x - startXM - xb).toFixed(4)} m。`,
        });
      }
    }
  }

  if (!exited) {
    events.push({
      kind: "force_segment_end",
      time: t,
      xM: x,
      vxMps: v,
      label: "传送带观察结束",
      explanation: `观察结束时对地位移 ${(x - startXM).toFixed(4)} m，相对带面位移 ${(x - startXM - xb).toFixed(4)} m，块速 ${v.toFixed(4)} m/s，带速 ${vb.toFixed(4)} m/s。`,
    });
  }

  const evalPiece = (query: number) => {
    const q = Math.min(t, Math.max(0, query));
    const p = pieces.find((item) => q >= item.start && q < item.end) ?? pieces[pieces.length - 1];
    if (!p) return { xM: x, vxMps: v, beltSpeedMps: vb, beltDisplacementM: xb, relativeDisplacementM: x - startXM - xb, relativeSpeedMps: v - vb };
    const dt = q - p.start;
    const xn = p.x0 + p.v0 * dt + 0.5 * p.a * dt * dt;
    const vn = p.v0 + p.a * dt;
    const xbn = p.xb0 + p.vb0 * dt + 0.5 * p.ab * dt * dt;
    const vbn = p.vb0 + p.ab * dt;
    return { xM: xn, vxMps: vn, beltSpeedMps: vbn, beltDisplacementM: xbn, relativeDisplacementM: (xn - startXM) - xbn, relativeSpeedMps: vn - vbn };
  };

  return {
    duration: t,
    exited,
    endX: x,
    endVx: v,
    geometry: { minXM: L !== null ? Math.min(0, minX) : minX, maxXM: L !== null ? Math.max(L, maxX) : maxX, beltLengthM: L, initialBeltSpeedMps: stage.initialBeltSpeedMps } as ConveyorGeometry,
    events,
    evalAt: evalPiece,
  };
}
