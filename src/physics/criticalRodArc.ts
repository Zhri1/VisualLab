const FULL_TURN = 2 * Math.PI;
const OBSERVATION_SCALES = 6;

/** 轻杆处在最高点零速的能量极限时，该角度的无量纲速度平方。 */
export function rodLimitSpeedRatio(angle: number): number {
  const nearestTop = Math.PI + FULL_TURN * Math.round((angle - Math.PI) / FULL_TURN);
  return 4 * Math.sin((angle - nearestTop) / 2) ** 2;
}

/** 解析求解临界轻杆趋近前方最高点的运动。 */
export function criticalRodArc(startAngle: number, plannedAngle: number, scale: number, speedUnit: number) {
  const direction = plannedAngle > startAngle ? 1 : -1;
  const nextTopIndex = 1 + Math.floor((direction * startAngle - Math.PI) / FULL_TURN);
  const top = direction * (Math.PI + nextTopIndex * FULL_TURN);
  const entryQuarterGap = direction * (top - startAngle) / 4;
  const entryTangent = Math.tan(entryQuarterGap);
  const approachingTop = direction * (top - plannedAngle) <= 0;
  const timeAt = (angle: number) => {
    const quarterGap = direction * (top - angle) / 4;
    const quarterSpan = direction * (angle - startAngle) / 4;
    return scale * Math.log1p(Math.sin(quarterSpan) / (Math.cos(entryQuarterGap) * Math.sin(quarterGap)));
  };
  const duration = approachingTop ? OBSERVATION_SCALES * scale : timeAt(plannedAngle);
  const angleAt = (time: number) => {
    const scaledTime = -time / scale;
    const quarterSpan = Math.atan2(-entryTangent * Math.expm1(scaledTime), 1 + entryTangent ** 2 * Math.exp(scaledTime));
    return startAngle + direction * 4 * quarterSpan;
  };
  const endAngle = approachingTop ? angleAt(duration) : plannedAngle;
  const speedAt = (angle: number) => direction * speedUnit * Math.sqrt(rodLimitSpeedRatio(angle));
  return { approachingTop, duration, endAngle, angleAt, speedAt, timeAt, lowestAngle: top - direction * Math.PI };
}
