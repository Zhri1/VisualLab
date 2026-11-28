/**
 * 圆周轨道运动基础模块：固定中心天体 + 低质量单卫星做匀速圆周轨道运动。
 * 依据万有引力提供向心力：v = √(GM/r)，ω = √(GM/r³)，T = 2π√(r³/(GM))，a_c = GM/r²。
 * 暂不包含椭圆轨道或霍曼转移。
 */

export type CircularOrbitStage = {
  kind: "circular_orbit";
  /** 中心天体引力参数 μ = G·M（m³/s²，正有限数）。 */
  gravitationalParameterM3s2: number;
  /** 轨道半径 r（m，正有限数）；与 altitudeM 二选一，或与 centralBodyRadiusM 同时给出时须满足 r > R。 */
  orbitalRadiusM?: number | null;
  /** 中心天体半径 R（m，正有限数）；给出 altitudeM 时必填，仅给 orbitalRadiusM 时可选（用于按比例绘制中心天体）。 */
  centralBodyRadiusM?: number | null;
  /** 轨道高度 h（m，非负有限数）；此时 r = centralBodyRadiusM + altitudeM。 */
  altitudeM?: number | null;
  /** 绕行方向："ccw" 逆时针（默认），"cw" 顺时针。 */
  direction?: "ccw" | "cw";
  /** 初始极角（度，默认 0°，即 +x 轴方向）。 */
  initialAngleDeg?: number;
  /** 观察圈数（正有限数，默认 1 圈）。 */
  orbits?: number;
  /** 可选中心天体与卫星展示名。 */
  centralBodyLabel?: string;
  satelliteLabel?: string;
};

export interface CircularOrbitGeometry {
  stageIndex: number;
  center: { xM: number; yM: number };
  orbitalRadiusM: number;
  centralBodyRadiusM: number | null;
  altitudeM: number | null;
  gravitationalParameterM3s2: number;
  orbitalSpeedMps: number;
  periodSeconds: number;
  angularSpeedRadps: number;
  centripetalAccelerationMps2: number;
  direction: "ccw" | "cw";
  initialAngleDeg: number;
  orbits: number;
  centralBodyLabel?: string;
  satelliteLabel?: string;
}

export interface CircularOrbitSample {
  xM: number;
  yM: number;
  vxMps: number;
  vyMps: number;
  angleDeg: number;
  speedMps: number;
}

export interface CircularOrbitSolution {
  durationSeconds: number;
  orbitalRadiusM: number;
  orbitalSpeedMps: number;
  periodSeconds: number;
  angularSpeedRadps: number;
  centripetalAccelerationMps2: number;
  geometry: CircularOrbitGeometry;
  at(timeSeconds: number): CircularOrbitSample;
  events: Array<{
    kind: "orbit_start" | "orbit_half" | "orbit_complete";
    timeSeconds: number;
    sample: CircularOrbitSample;
    label: string;
    explanation: string;
  }>;
}

export function resolveOrbitalRadiusM(stage: Pick<CircularOrbitStage, "orbitalRadiusM" | "centralBodyRadiusM" | "altitudeM">): number | null {
  if (typeof stage.orbitalRadiusM === "number" && Number.isFinite(stage.orbitalRadiusM) && stage.orbitalRadiusM > 0) {
    return stage.orbitalRadiusM;
  }
  if (
    typeof stage.centralBodyRadiusM === "number" && Number.isFinite(stage.centralBodyRadiusM) && stage.centralBodyRadiusM > 0 &&
    typeof stage.altitudeM === "number" && Number.isFinite(stage.altitudeM) && stage.altitudeM >= 0
  ) {
    return stage.centralBodyRadiusM + stage.altitudeM;
  }
  return null;
}

export function solveCircularOrbit(stage: CircularOrbitStage, stageIndex = 0): CircularOrbitSolution {
  const mu = stage.gravitationalParameterM3s2;
  if (!Number.isFinite(mu) || mu <= 0) throw new RangeError("引力参数 GM 须为正有限数。");
  const r = resolveOrbitalRadiusM(stage);
  if (r == null || !Number.isFinite(r) || r <= 0) throw new RangeError("轨道半径 r 须为正有限数。");
  const bodyR = typeof stage.centralBodyRadiusM === "number" && Number.isFinite(stage.centralBodyRadiusM) ? stage.centralBodyRadiusM : null;
  if (bodyR !== null && bodyR > r) throw new RangeError("轨道半径 r 不能小于中心天体半径 R。");
  const direction: "ccw" | "cw" = stage.direction === "cw" ? "cw" : "ccw";
  const sign = direction === "ccw" ? 1 : -1;
  const initialAngleDeg = stage.initialAngleDeg ?? 0;
  const orbits = stage.orbits ?? 1;
  if (!Number.isFinite(orbits) || orbits <= 0) throw new RangeError("观察圈数 orbits 须为正有限数。");

  const speed = Math.sqrt(mu / r);
  const omega = speed / r;
  const period = (2 * Math.PI) / omega;
  const accel = mu / (r * r);
  const duration = orbits * period;
  if (![speed, omega, period, accel, duration].every(Number.isFinite) || !(duration > 0)) {
    throw new RangeError("圆周轨道速度或周期超出有限数值范围。");
  }

  const theta0 = (initialAngleDeg * Math.PI) / 180;
  const at = (timeSeconds: number): CircularOrbitSample => {
    const t = Math.min(Math.max(timeSeconds, 0), duration);
    const theta = theta0 + sign * omega * t;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const xM = r * cos;
    const yM = r * sin;
    const vxMps = -sign * speed * sin;
    const vyMps = sign * speed * cos;
    return {
      xM: Math.abs(xM) < 1e-12 * r ? 0 : xM,
      yM: Math.abs(yM) < 1e-12 * r ? 0 : yM,
      vxMps: Math.abs(vxMps) < 1e-12 * speed ? 0 : vxMps,
      vyMps: Math.abs(vyMps) < 1e-12 * speed ? 0 : vyMps,
      angleDeg: (theta * 180) / Math.PI,
      speedMps: speed,
    };
  };

  const dirText = direction === "ccw" ? "逆时针" : "顺时针";
  const fmtSci = (n: number) => (Math.abs(n) >= 1e5 || (Math.abs(n) > 0 && Math.abs(n) < 1e-2) ? n.toExponential(3) : n.toFixed(2));
  const events: CircularOrbitSolution["events"] = [
    {
      kind: "orbit_start",
      timeSeconds: 0,
      sample: at(0),
      label: "圆轨运行起点",
      explanation: `低质量卫星绕固定中心天体做${dirText}圆周轨道运动：r = ${fmtSci(r)} m，v = √(GM/r) = ${fmtSci(speed)} m/s，T = ${fmtSci(period)} s。`,
    },
  ];
  if (orbits >= 0.5) {
    const tHalf = period / 2;
    events.push({
      kind: "orbit_half",
      timeSeconds: tHalf,
      sample: at(tHalf),
      label: "运行半周",
      explanation: `经过半个周期 T/2 = ${fmtSci(tHalf)} s，卫星到达对称位置，速率恒为 ${fmtSci(speed)} m/s，方向与起点相反。`,
    });
  }
  events.push({
    kind: "orbit_complete",
    timeSeconds: duration,
    sample: at(duration),
    label: orbits === 1 ? "完成一周观察" : `完成 ${orbits} 周观察`,
    explanation: `完整绕行 ${orbits} 周（总时长 ${fmtSci(duration)} s，单周周期 T = ${fmtSci(period)} s），轨道半径与速率保持不变。`,
  });

  const altitudeM = bodyR !== null ? Math.max(0, r - bodyR) : (stage.altitudeM ?? null);
  return {
    durationSeconds: duration,
    orbitalRadiusM: r,
    orbitalSpeedMps: speed,
    periodSeconds: period,
    angularSpeedRadps: omega,
    centripetalAccelerationMps2: accel,
    geometry: {
      stageIndex,
      center: { xM: 0, yM: 0 },
      orbitalRadiusM: r,
      centralBodyRadiusM: bodyR,
      altitudeM,
      gravitationalParameterM3s2: mu,
      orbitalSpeedMps: speed,
      periodSeconds: period,
      angularSpeedRadps: omega,
      centripetalAccelerationMps2: accel,
      direction,
      initialAngleDeg,
      orbits,
      ...(stage.centralBodyLabel ? { centralBodyLabel: stage.centralBodyLabel } : {}),
      ...(stage.satelliteLabel ? { satelliteLabel: stage.satelliteLabel } : {}),
    },
    at,
    events,
  };
}
