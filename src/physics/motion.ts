import type { PhysicsFailure } from "./reading.ts";
import type { Point, Scene } from "./scene.ts";
import { springMetrics, springState } from "./kinematics.ts";

type Velocity = {
  vxMps: number;
  vyMps: number;
};

export type MotionSample = Point & Velocity & {
  springCompressionM: number;
};

type MotionSegment = {
  id: "incline" | "horizontal" | "spring";
  startSeconds: number;
  endSeconds: number;
};

type EventText = {
  timeSeconds: number;
  label: string;
  explanation: string;
};

export type MotionEvent = EventText & (
  | { id: "release" | "spring_contact" | "max_compression" | "spring_detach" }
  | { id: "turn"; beforeVelocity: Velocity; afterVelocity: Velocity }
);

export type Motion = {
  geometry: {
    templateId?: "incline_spring";
    incline: { start: Point; end: Point };
    horizontal: { start: Point; end: Point };
    spring: { contact: Point; anchor: Point };
  };
  durationSeconds: number;
  segments: MotionSegment[];
  events: MotionEvent[];
  sampleAt(timeSeconds: number): MotionSample;
};

function sampleHorizontal(xM: number, vxMps: number, springCompressionM = 0): MotionSample {
  return { xM, yM: 0, vxMps, vyMps: 0, springCompressionM };
}

export function buildMotion(scene: Scene): { ok: true; motion: Motion } | PhysicsFailure {
  const { start: inclineStart, end: inclineEnd } = scene.geometry.incline;
  const { xM: springGapM } = scene.geometry.spring.contact;
  const { lengthM, accelerationMps2, direction } = scene.incline;
  const { blockMassKg, constantNpm } = scene.spring;

  // 分开取平方根，避免输入仍有限时中间的乘积或比值过早溢出。
  const sqrtLength = Math.sqrt(lengthM);
  const sqrtAcceleration = Math.sqrt(accelerationMps2);
  const turnSeconds = Math.SQRT2 * (sqrtLength / sqrtAcceleration);
  const turnSpeed = Math.SQRT2 * sqrtLength * sqrtAcceleration;
  const contactSeconds = turnSeconds + springGapM / turnSpeed;
  if (!Number.isFinite(turnSpeed) || !(turnSeconds > 0 && contactSeconds > turnSeconds && Number.isFinite(contactSeconds))) {
    return {
      ok: false,
      code: "INVALID_READING",
      message: "当前数值无法生成有效的斜面或水平运动。请核对题设数值。",
      fields: ["inclineLengthM", "inclineAngleDeg", "gravityMps2", "kineticFrictionCoefficient", "springGapM"],
    };
  }

  const { angularFrequency, quarterPeriod, maxCompressionM } = springMetrics(turnSpeed, blockMassKg, constantNpm);
  const maxCompressionSeconds = contactSeconds + quarterPeriod;
  const durationSeconds = contactSeconds + 2 * quarterPeriod;
  const maxForceN = constantNpm * maxCompressionM;
  const maxCompressionXM = springGapM + maxCompressionM;
  // 题面没有给原长。固定端在最大压缩位置以右保留一段绘制空间。
  const anchorXM = maxCompressionXM + Math.max(1, maxCompressionM / 4);
  const hasSpringTimes = maxCompressionSeconds > contactSeconds
    && durationSeconds > maxCompressionSeconds && Number.isFinite(durationSeconds);
  const hasSpringGeometry = maxCompressionXM > springGapM
    && anchorXM > maxCompressionXM && Number.isFinite(anchorXM);
  if (!hasSpringTimes || !hasSpringGeometry || !Number.isFinite(maxForceN)) {
    return {
      ok: false,
      code: "INVALID_READING",
      message: "当前数值无法生成有效的弹簧运动。请核对题设数值。",
      fields: ["blockMassKg", "springConstantNpm", "springGapM"],
    };
  }

  const beforeVelocity = { vxMps: turnSpeed * direction.x, vyMps: turnSpeed * direction.y };
  const afterVelocity = { vxMps: turnSpeed, vyMps: 0 };
  const contact = { xM: springGapM, yM: 0 };
  const anchor = { xM: anchorXM, yM: 0 };
  const segments: MotionSegment[] = [
    { id: "incline", startSeconds: 0, endSeconds: turnSeconds },
    { id: "horizontal", startSeconds: turnSeconds, endSeconds: contactSeconds },
    { id: "spring", startSeconds: contactSeconds, endSeconds: durationSeconds },
  ];
  const events: MotionEvent[] = [
    {
      id: "release",
      timeSeconds: 0,
      label: "释放",
      explanation: `滑块从静止释放，沿斜面向下的加速度约为 ${accelerationMps2.toFixed(4)} m/s²。`,
    },
    {
      id: "turn",
      timeSeconds: turnSeconds,
      label: "到达坡底并转向",
      explanation: `滑块经光滑圆弧转为水平向右，速率保持约 ${turnSpeed.toFixed(4)} m/s。`,
      beforeVelocity,
      afterVelocity,
    },
    {
      id: "spring_contact",
      timeSeconds: contactSeconds,
      label: "接触弹簧",
      explanation: `滑块在光滑水平面上匀速前进 ${springGapM} m，接触处于原长的弹簧，开始压缩。`,
    },
    {
      id: "max_compression",
      timeSeconds: maxCompressionSeconds,
      label: "压缩最短",
      explanation: `弹簧压缩约 ${maxCompressionM.toFixed(4)} m，滑块瞬时速度为零，弹力约 ${maxForceN.toFixed(2)} N，达到最大并指向左。`,
    },
    {
      id: "spring_detach",
      timeSeconds: durationSeconds,
      label: "恢复原长并脱离",
      explanation: `弹簧恢复原长，弹力为零，滑块以约 ${turnSpeed.toFixed(4)} m/s 的速率向左脱离。`,
    },
  ];

  function sampleAt(timeSeconds: number): MotionSample {
    const time = Number.isNaN(timeSeconds) ? 0 : Math.max(0, Math.min(durationSeconds, timeSeconds));
    if (time === 0) {
      return { ...inclineStart, vxMps: 0, vyMps: 0, springCompressionM: 0 };
    }
    if (time < turnSeconds) {
      const elapsedFraction = time / turnSeconds;
      const remainingFraction = 1 - elapsedFraction ** 2;
      return {
        xM: inclineStart.xM * remainingFraction,
        yM: inclineStart.yM * remainingFraction,
        vxMps: beforeVelocity.vxMps * elapsedFraction,
        vyMps: beforeVelocity.vyMps * elapsedFraction,
        springCompressionM: 0,
      };
    }
    if (time < contactSeconds) {
      return sampleHorizontal((time - turnSeconds) * turnSpeed, turnSpeed);
    }
    // 关键点直接使用边界状态，避免三角函数的舍入误差。
    if (time === maxCompressionSeconds) {
      return sampleHorizontal(maxCompressionXM, 0, maxCompressionM);
    }
    if (time === durationSeconds) {
      return sampleHorizontal(springGapM, -turnSpeed);
    }
    return springState(springGapM, turnSpeed, angularFrequency, maxCompressionM, time - contactSeconds);
  }

  return {
    ok: true,
    motion: {
      geometry: { templateId: "incline_spring", incline: { start: inclineStart, end: inclineEnd }, horizontal: { start: inclineEnd, end: anchor }, spring: { contact, anchor } },
      durationSeconds,
      segments,
      events,
      sampleAt,
    },
  };
}
