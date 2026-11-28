import type { Point } from './geometryTypes.ts';
import type { BodyState } from './multiBodyTypes.ts';
import type { StageEvent, StageMotion } from './stageMotion.ts';
import type { MagneticState } from './magneticDeflection.ts';
import { solveMagneticReencounter, type MagneticReencounterStage } from './magneticReencounter.ts';

const primaryBodyId = '甲';
const targetBodyId = '乙';
const bodyIds = [primaryBodyId, targetBodyId];

export type MagneticReencounterGeometry = {
  scaleMode: MagneticReencounterStage['scaleMode'];
  fieldDirection: MagneticReencounterStage['fieldDirection'];
  contact: Point;
  circles: Array<{ bodyId: string; center: Point; radiusM: number }>;
  collisionCount: number;
};

const pos = ({ xM, yM }: Point): Point => ({ xM, yM });
const vel = ({ vxMps, vyMps }: MagneticState) => ({ vxMps, vyMps });
const fmt = (value: number) => Math.abs(value) < 1e-10 ? 0 : Number(value.toPrecision(4));

export function computeMagneticReencounterMotion(stage: MagneticReencounterStage): StageMotion {
  const solved = solveMagneticReencounter(stage);
  const bodies = [
    { bodyId: primaryBodyId, massKg: solved.massA },
    { bodyId: targetBodyId, massKg: solved.massB },
  ];

  const snapshot = (a: MagneticState, b: MagneticState) => {
    const bodyStates = Object.fromEntries(
      [a, b].map((state, i): [string, BodyState] => [
        bodies[i].bodyId,
        {
          ...bodies[i],
          ...state,
          springCompressionM: 0,
          status: state.vxMps || state.vyMps ? 'moving' : 'resting',
        },
      ]),
    );
    return { ...a, springCompressionM: 0, bodies: bodyStates, constraints: {} };
  };

  const events: StageEvent[] = [];
  function addEvent(
    id: string,
    kind: string,
    timeSeconds: number,
    label: string,
    explanation: string,
    a: MagneticState,
    b: MagneticState,
    beforeA = a,
    beforeB = b,
  ) {
    events.push({
      id,
      stageIndex: 0,
      kind,
      timeSeconds,
      order: events.length,
      label,
      explanation,
      bodyIds,
      position: pos(a),
      velocityBefore: vel(beforeA),
      velocityAfter: vel(a),
      bodyStatesBefore: snapshot(beforeA, beforeB).bodies,
      bodyStatesAfter: snapshot(a, b).bodies,
    });
  }

  const startState = solved.at(0);
  addEvent(
    'release',
    'release',
    0,
    '双粒子同时在磁场中运动',
    `甲从 (${fmt(solved.entryPointA.xM)}, ${fmt(solved.entryPointA.yM)}) 出发，乙初态由首次正碰逆推得出，位于 (${fmt(solved.entryPointB.xM)}, ${fmt(solved.entryPointB.yM)})。`,
    startState.a,
    startState.b,
  );

  for (const col of solved.collisions) {
    const piMultiple = col.timeSeconds / (Math.PI * solved.tauSeconds);
    addEvent(
      `magnetic_collision_${col.index}`,
      'magnetic_collision',
      col.timeSeconds,
      `第 ${col.index} 次弹性正碰`,
      `t ≈ ${fmt(piMultiple)}πτ，两粒子同时回到接触点 O(${fmt(solved.contactPoint.xM)}, ${fmt(solved.contactPoint.yM)}) 沿切线发生弹性正碰。碰前切向速度 (${fmt(col.uA)}, ${fmt(col.uB)})，碰后 (${fmt(col.vA)}, ${fmt(col.vB)}) m/s；动量 ${fmt(col.momentumBeforeKgMps)} → ${fmt(col.momentumAfterKgMps)} kg·m/s，动能 ${fmt(col.energyBeforeJ)} → ${fmt(col.energyAfterJ)} J。`,
      col.afterA,
      col.afterB,
      col.beforeA,
      col.beforeB,
    );
  }

  const endPiMultiple = solved.durationSeconds / (Math.PI * solved.tauSeconds);
  addEvent(
    'observation_end',
    'observation_end',
    solved.durationSeconds,
    '到达观察时刻',
    `t ≈ ${fmt(endPiMultiple)}πτ，共发生 ${solved.collisions.length} 次弹性正碰。甲位于 (${fmt(solved.finalA.xM)}, ${fmt(solved.finalA.yM)})，乙位于 (${fmt(solved.finalB.xM)}, ${fmt(solved.finalB.yM)})，乙自首次碰后累计路程约 ${fmt(solved.distanceBAfterFirstCollisionM)} m（${fmt(solved.distanceBAfterFirstCollisionM / (Math.PI * stage.lengthScaleM))}πa）。`,
    solved.finalA,
    solved.finalB,
  );

  // 收集去重后的典型回旋圆用于画布虚线参考
  const circleMap = new Map<string, { bodyId: string; center: Point; radiusM: number }>();
  for (const seg of solved.intervals) {
    for (const [id, orb] of [[primaryBodyId, seg.orbitA], [targetBodyId, seg.orbitB]] as const) {
      const key = `${id}:${orb.center.xM.toFixed(4)}:${orb.center.yM.toFixed(4)}:${orb.radiusM.toFixed(4)}`;
      if (!circleMap.has(key)) circleMap.set(key, { bodyId: id, center: pos(orb.center), radiusM: orb.radiusM });
    }
  }

  const firstCol = solved.collisions[0];
  const calculations: NonNullable<StageMotion['calculations']> = [
    { quantity: 'target_mass', value: solved.massB, unit: 'kg', source: 'derived', rule: 'period_ratio_mass', inputPaths: ['/stages/0/massScaleKg', '/stages/0/periodRatioAOverB'] },
    ...(firstCol ? [
      { quantity: 'first_collision_time', value: firstCol.timeSeconds, unit: 's', source: 'derived' as const, rule: 'magnetic_arc_time', inputPaths: ['/stages/0/entryOverLength', '/stages/0/contactOverLength'] },
      { quantity: 'pre_collision_speed_a', value: Math.abs(firstCol.uA), unit: 'm/s', source: 'derived' as const, rule: 'lorentz_orbit_radius', inputPaths: ['/stages/0/entryOverLength', '/stages/0/contactOverLength'] },
      { quantity: 'post_collision_speed_b', value: Math.abs(firstCol.vB), unit: 'm/s', source: 'derived' as const, rule: 'elastic_1d_collision', inputPaths: ['/stages/0/postFirstCollisionSpeedRatioA', '/stages/0/periodRatioAOverB'] },
    ] : []),
    { quantity: 'collision_count', value: solved.collisions.length, unit: '', source: 'derived', rule: 'periodic_reencounter_count', inputPaths: ['/stages/0/periodRatioAOverB', '/stages/0/observationTimeOverPiTau'] },
    { quantity: 'target_distance_after_first_collision', value: solved.distanceBAfterFirstCollisionM, unit: 'm', source: 'derived', rule: 'segment_arc_length_sum', inputPaths: ['/stages/0/observationTimeOverPiTau'] },
  ];

  const segments = solved.intervals.map((seg, i) => ({
    stageIndex: 0,
    kind: stage.kind,
    startSeconds: seg.startSeconds,
    endSeconds: seg.endSeconds,
    bodyIds,
    stagePath: `/stages/0/interval/${i}`,
  }));

  return {
    primaryBodyId,
    durationSeconds: solved.durationSeconds,
    segments,
    events,
    calculations,
    endReason: 'prefix_end',
    termination: { reason: 'prefix_end', eventId: 'observation_end', stageIndex: 0 },
    geometry: {
      blockSizeM: 0.3,
      positionReference: 'particle',
      bodies,
      magneticReencounter: {
        scaleMode: stage.scaleMode,
        fieldDirection: stage.fieldDirection,
        contact: pos(solved.contactPoint),
        circles: [...circleMap.values()],
        collisionCount: solved.collisions.length,
      },
      landmarks: [
        { label: 'P', position: pos(solved.entryPointA) },
        { label: 'O', position: pos(solved.contactPoint) },
      ],
    },
    sampleAt(timeSeconds) {
      const { a, b } = solved.at(timeSeconds);
      return snapshot(a, b);
    },
  };
}
