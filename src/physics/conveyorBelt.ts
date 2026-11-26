export type ConveyorBeltSegment = {
  accelerationMps2: number;
  durationSeconds: number | null;
};

export type ConveyorEdge = "start" | "end";

export type ConveyorBeltStage = {
  kind: "conveyor_belt";
  initialBeltSpeedMps: number;
  segments: ConveyorBeltSegment[];
  kineticFrictionCoefficient: number;
  staticFrictionCoefficient?: number | null;
  beltLengthM?: number | null;
  entryEdge?: ConveyorEdge | null;
  continuationExitEdge?: ConveyorEdge | null;
  /** 传送带倾角 θ（度），0 ≤ θ < 90；默认 0（水平传送带）。 */
  angleDeg?: number | null;
  /** 沿带正方向 +s 的倾斜朝向："up"（默认，从底端指向上端）或 "down"（从顶端指向底端）。 */
  inclineDirection?: "up" | "down" | null;
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
  angleDeg?: number;
  inclineDirection?: "up" | "down";
  originXM?: number;
  originYM?: number;
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
  exitEdge?: ConveyorEdge;
};

// 从带内出发，按指向固定滚轮外侧的一维坐标求首次穿越。
function solveExitTime(distance: number, outwardSpeed: number, outwardAcceleration: number): number {
  if (distance <= 0) {
    if (outwardSpeed > 0 || (outwardSpeed === 0 && outwardAcceleration > 0)) return 0;
    return outwardSpeed < 0 && outwardAcceleration > 0 ? -2 * outwardSpeed / outwardAcceleration : Infinity;
  }
  if (outwardAcceleration === 0) return outwardSpeed > 0 ? distance / outwardSpeed : Infinity;
  const discriminant = outwardSpeed * outwardSpeed + 2 * outwardAcceleration * distance;
  // 在滚轮处相切、随后回到带内，不构成离带。
  if (discriminant <= 0 || (outwardSpeed <= 0 && outwardAcceleration < 0)) return Infinity;
  const crossingSpeed = Math.sqrt(discriminant);
  return outwardSpeed >= 0
    ? 2 * distance / (outwardSpeed + crossingSpeed)
    : (crossingSpeed - outwardSpeed) / outwardAcceleration;
}

export function solveConveyorBelt(stage: ConveyorBeltStage, startXM: number, startVxMps: number, gravityMps2: number) {
  const angleDeg = stage.angleDeg ?? 0;
  const inclineDirection: "up" | "down" = stage.inclineDirection ?? "up";
  const rad = (angleDeg * Math.PI) / 180;
  const cos = angleDeg === 0 ? 1 : Math.cos(rad);
  const sin = angleDeg === 0 ? 0 : Math.sin(rad);
  const dirSign = inclineDirection === "down" ? -1 : 1;
  // 重力沿传送带正方向 +s 的分量加速度："up" 时 -g·sinθ，"down" 时 +g·sinθ，水平时 0。
  const ag = -dirSign * gravityMps2 * sin;
  const ak = stage.kineticFrictionCoefficient * gravityMps2 * cos;
  // 倾斜匀速传送带若未单列静摩擦因数，按高考常规取 μs = μk 以区分 μ ≥ tanθ 与 μ < tanθ。
  const effectiveStaticMu = stage.staticFrictionCoefficient != null
    ? stage.staticFrictionCoefficient
    : angleDeg > 0 ? stage.kineticFrictionCoefficient : 0;
  const asMax = effectiveStaticMu * gravityMps2 * cos;
  const L = stage.beltLengthM ?? null;

  let t = 0, x = startXM, v = startVxMps, xb = 0, vb = stage.initialBeltSpeedMps;
  let minX = x, maxX = x;
  let exitEdge: ConveyorEdge | undefined;
  let stopped = false;
  const pieces: Piece[] = [];
  const events: ConveyorEvent[] = [];

  for (const seg of stage.segments) {
    if (exitEdge || stopped) break;
    let rem = seg.durationSeconds ?? Infinity;
    const ab = seg.accelerationMps2;
    let guard = 0;
    while (rem > 0 && !exitEdge && guard++ < 16) {
      const vRel = v - vb;
      const vTol = 64 * Number.EPSILON * Math.max(1, Math.abs(v), Math.abs(vb));
      let a: number;
      let dt = rem;
      let reachesCommon = false;

      if (Math.abs(vRel) <= vTol) {
        // 保持与带共速所需的静摩擦加速度：a_g + a_f_req = a_b ⇒ a_f_req = a_b - a_g
        const aReq = ab - ag;
        const aTol = 64 * Number.EPSILON * Math.max(1, asMax, Math.abs(aReq));
        if (Math.abs(aReq) <= asMax + aTol) {
          a = ab;
        } else {
          a = ag + Math.sign(aReq) * ak;
          const inclinedUniform = angleDeg > 0 && Math.abs(ab) <= 1e-12;
          events.push({
            kind: "conveyor_reslide",
            time: t,
            xM: x,
            vxMps: v,
            label: inclinedUniform ? "μ < tanθ 摩擦力反向继续滑动" : "静摩擦不足重新滑动",
            explanation: inclinedUniform
              ? `重力沿带分量 ${Math.abs(ag).toFixed(2)} m/s² 超过静摩擦上限 ${asMax.toFixed(2)} m/s²（μ < tanθ），共速后摩擦力反向，滑块以加速度 ${a.toFixed(2)} m/s² 继续相对滑动。`
              : `维持共速所需静摩擦加速度 ${aReq.toFixed(2)} m/s² 超过上限 ${asMax.toFixed(2)} m/s²，滑块切换为动摩擦加速度 ${a.toFixed(2)} m/s²。`,
          });
        }
      } else {
        a = ag - Math.sign(vRel) * ak;
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
        const tStart = solveExitTime(x, -v, -a);
        const tEnd = solveExitTime(L - x, v, a);
        const tExit = Math.min(tStart, tEnd);
        if (Number.isFinite(tExit) && tExit <= dt + 32 * Number.EPSILON * Math.max(1, dt)) {
          dt = Math.min(dt, tExit);
          reachesCommon = false;
          exitEdge = tStart <= tEnd ? "start" : "end";
        }
      }

      if (!Number.isFinite(dt)) {
        if (v !== 0 || a !== 0) throw new RangeError("传送带离带时间超出可计算范围。");
        stopped = true;
        break;
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

      const x1 = exitEdge === "start" ? 0 : exitEdge === "end" ? L! : x + v * dt + 0.5 * a * dt * dt;
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

      if (exitEdge) {
        const side = angleDeg === 0
          ? (exitEdge === "start" ? "左端" : "右端")
          : exitEdge === "start" ? "起端" : "末端";
        events.push({
          kind: "conveyor_exit",
          time: t,
          xM: x,
          vxMps: v,
          label: "滑离传送带",
          explanation: `从传送带${side}（s = ${x.toFixed(4)} m）离开，沿带速度 ${v.toFixed(4)} m/s，相对带面位移 ${(x - startXM - xb).toFixed(4)} m。`,
          exitEdge,
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

  if (!exitEdge) {
    events.push({
      kind: stopped ? "stop" : "force_segment_end",
      time: t,
      xM: x,
      vxMps: v,
      label: stopped ? "滑块在带上静止" : "传送带观察结束",
      explanation: stopped
        ? `滑块在传送带上保持静止（s = ${x.toFixed(4)} m）。`
        : `观察结束时对地位移 ${(x - startXM).toFixed(4)} m，相对带面位移 ${(x - startXM - xb).toFixed(4)} m，块速 ${v.toFixed(4)} m/s，带速 ${vb.toFixed(4)} m/s。`,
    });
  }

  const evalPiece = (query: number) => {
    const q = Math.min(t, Math.max(0, query));
    const p = pieces.find((item) => q >= item.start && q < item.end) ?? pieces[pieces.length - 1];
    if (!p || q === t) return { xM: x, vxMps: v, beltSpeedMps: vb, beltDisplacementM: xb, relativeDisplacementM: x - startXM - xb, relativeSpeedMps: v - vb };
    const dt = q - p.start;
    const xn = p.x0 + p.v0 * dt + 0.5 * p.a * dt * dt;
    const vn = p.v0 + p.a * dt;
    const xbn = p.xb0 + p.vb0 * dt + 0.5 * p.ab * dt * dt;
    const vbn = p.vb0 + p.ab * dt;
    return { xM: xn, vxMps: vn, beltSpeedMps: vbn, beltDisplacementM: xbn, relativeDisplacementM: (xn - startXM) - xbn, relativeSpeedMps: vn - vbn };
  };

  return {
    duration: t,
    exitEdge,
    stopped,
    endX: x,
    endVx: v,
    geometry: {
      minXM: L !== null ? Math.min(0, minX) : minX,
      maxXM: L !== null ? Math.max(L, maxX) : maxX,
      beltLengthM: L,
      initialBeltSpeedMps: stage.initialBeltSpeedMps,
      ...(angleDeg > 0 ? { angleDeg, inclineDirection } : {}),
    } as ConveyorGeometry,
    events,
    evalAt: evalPiece,
  };
}
