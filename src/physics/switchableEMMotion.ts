import type { Point } from './geometryTypes.ts';
import type { BodyState } from './multiBodyTypes.ts';
import type { StageEvent, StageMotion } from './stageMotion.ts';
import type { MagneticState } from './magneticDeflection.ts';
import { solveSwitchableEM, type SwitchableEMStage } from './switchableEMCollision.ts';

const primaryBodyId = '甲';
const targetBodyId = '乙';
const bodyIds = [primaryBodyId, targetBodyId];
type OrbitGeometry = { center: Point; radiusM: number };
export type SwitchableEMGeometry = {
  scaleMode: SwitchableEMStage['scaleMode'];
  fieldDirection: SwitchableEMStage['fieldDirection'];
  switchOffX: number;
  offSeconds: number;
  restoreSeconds: number;
  circles: [OrbitGeometry, OrbitGeometry];
  tangency: Point;
};
const position = ({ xM, yM }: Point): Point => ({ xM, yM });
const velocity = ({ vxMps, vyMps }: MagneticState) => ({ vxMps, vyMps });
const display = (value: number) => Number(value.toPrecision(4));
const degrees = (state: MagneticState) => Math.atan2(state.vyMps, state.vxMps) * 180 / Math.PI;

export function computeSwitchableEMMotion(stage: SwitchableEMStage): StageMotion {
  const solved = solveSwitchableEM(stage);
  const { start, entry, contact, incoming, aCollision, bCollision, aOff, bOff, restored, collision } = solved;
  const enterSeconds = solved.electricTime;
  const contactSeconds = enterSeconds + solved.approachTime;
  const offSeconds = contactSeconds + solved.magneticTime;
  const restoreSeconds = offSeconds + restored.time;
  const durationSeconds = restoreSeconds + solved.observationTime;
  const circles = [restored.a, restored.b].map(({ center, radiusM }) => ({ center, radiusM })) as SwitchableEMGeometry['circles'];
  const share = circles[0].radiusM / (circles[0].radiusM + circles[1].radiusM);
  const tangency = {
    xM: circles[0].center.xM + share * (circles[1].center.xM - circles[0].center.xM),
    yM: circles[0].center.yM + share * (circles[1].center.yM - circles[0].center.yM),
  };
  const bodies = [{ bodyId: primaryBodyId, massKg: stage.massScaleKg }, { bodyId: targetBodyId, massKg: solved.targetMass }];
  const snapshot = (first: MagneticState, second: MagneticState) => {
    const bodyStates = Object.fromEntries([first, second].map((state, i): [string, BodyState] => [
      bodies[i].bodyId,
      { ...bodies[i], ...state, springCompressionM: 0, status: state.vxMps || state.vyMps ? 'moving' : 'resting' },
    ]));
    return { ...first, springCompressionM: 0, bodies: bodyStates, constraints: {} };
  };
  const events: StageEvent[] = [];
  function addEvent(kind: string, timeSeconds: number, label: string, explanation: string, a: MagneticState, b: MagneticState, beforeA = a, beforeB = b) {
    events.push({
      id: kind, stageIndex: 0, kind, timeSeconds, order: events.length, label, explanation, bodyIds,
      position: position(a), velocityBefore: velocity(beforeA), velocityAfter: velocity(a),
      bodyStatesBefore: snapshot(beforeA, beforeB).bodies, bodyStatesAfter: snapshot(a, b).bodies,
    });
  }
  const { electricNPerC: E, magneticTesla: B, distanceM } = solved;
  const ratio = E / B;
  const incidentSpeed = Math.hypot(incoming.vxMps, incoming.vyMps);
  const momentumBefore = stage.massScaleKg * incidentSpeed;
  const momentumAfter = stage.massScaleKg * collision.v1 + solved.targetMass * collision.v2;
  addEvent('release', 0, '甲进入电场', '甲水平发射，电场只改变竖直速度。用实际入磁点的横、竖位移反求 E。', start, contact);
  addEvent('magnetic_enter', enterSeconds, '甲穿过场区分界', `速度方向为 ${display(degrees(entry))}°。由入射切线与入磁点至碰撞点的弦反求磁场，E ≈ ${display(E)} N/C，B ≈ ${display(B)} T，E/B ≈ ${display(ratio)} m/s。`, entry, contact);
  addEvent('em_collision', contactSeconds, '甲、乙弹性正碰', `两粒子沿入射切线正碰。该方向的总动量为 ${display(momentumBefore)} → ${display(momentumAfter)} kg·m/s，动能为 ${display(collision.energyBeforeJ)} → ${display(collision.energyAfterJ)} J。碰后切向速度为 ${display(collision.v1)}、${display(collision.v2)} m/s。`, aCollision, bCollision, incoming, contact);
  addEvent('fields_off', offSeconds, '乙首次穿过竖线，撤去磁场', '撤去下半区磁场瞬间两粒子的位置和速度连续，上半区电场保持存在，两粒子在磁区内各自沿切线匀速直行。', aOff, bOff);
  addEvent('magnetic_restored', restoreSeconds, '恢复磁场，两回旋圆外切', `首次可达的正等待时间 Δt ≈ ${display(restored.time)} s。此时圆心距等于半径之和，甲在撤场期间走过约 ${display(distanceM)} m（${display(distanceM / stage.lengthScaleM)} L）。切点是两条轨迹的外切几何交点，不表示两粒子发生再次碰撞。`, restored.aState, restored.bState);
  const finalA = restored.a.at(solved.observationTime), finalB = restored.b.at(solved.observationTime);
  addEvent('observation_end', durationSeconds, '回旋观察结束', '两粒子均已完成至少一周回旋，仍在磁场中运动。', finalA, finalB);
  const calculations: NonNullable<StageMotion['calculations']> = [
    { quantity: '电场强度 E', value: E, unit: 'N/C', source: 'derived', inputPaths: ['/stages/0/entryXOverLength'] },
    { quantity: '磁感应强度 B', value: B, unit: 'T', source: 'derived', inputPaths: ['/stages/0/collisionXOverLength', '/stages/0/collisionYOverLength'] },
    { quantity: '场强比 E/B', value: ratio, unit: 'm/s', source: 'derived', inputPaths: ['/stages/0/entryXOverLength', '/stages/0/collisionXOverLength', '/stages/0/collisionYOverLength'] },
    { quantity: '撤场至恢复的时长', value: restored.time, unit: 's', source: 'derived', inputPaths: ['/stages/0/switchOffXOverLength'] },
    { quantity: '撤场期间甲的路程', value: distanceM, unit: 'm', source: 'derived', inputPaths: ['/stages/0/switchOffXOverLength'] },
  ];
  const segments = [
    { phase: 'electric', startSeconds: 0, endSeconds: enterSeconds },
    { phase: 'approach', startSeconds: enterSeconds, endSeconds: contactSeconds },
    { phase: 'postImpact', startSeconds: contactSeconds, endSeconds: offSeconds },
    { phase: 'drift', startSeconds: offSeconds, endSeconds: restoreSeconds },
    { phase: 'restored', startSeconds: restoreSeconds, endSeconds: durationSeconds },
  ].map(({ phase, ...span }) => ({ ...span, stageIndex: 0, kind: stage.kind, bodyIds, stagePath: '/stages/0/' + phase }));
  return {
    primaryBodyId, durationSeconds, segments, events, calculations, endReason: 'prefix_end',
    termination: { reason: 'prefix_end', eventId: 'observation_end', stageIndex: 0 },
    geometry: {
      blockSizeM: 0.3, positionReference: 'particle', bodies,
      switchableEM: { scaleMode: stage.scaleMode, fieldDirection: stage.fieldDirection, switchOffX: solved.switchOffX, offSeconds, restoreSeconds, circles, tangency },
      landmarks: [{ label: 'S', position: position(start) }, { label: 'P', position: position(entry) }, { label: 'Q', position: position(contact) }],
    },
    sampleAt(timeSeconds) {
      const t = Number.isNaN(timeSeconds) ? 0 : Math.max(0, Math.min(timeSeconds, durationSeconds));
      if (t < enterSeconds) return snapshot(solved.electricAt(t), contact);
      if (t < contactSeconds) return snapshot(solved.incidentOrbit.at(t - enterSeconds), contact);
      if (t < offSeconds) return snapshot(solved.aOrbit.at(t - contactSeconds), solved.bOrbit.at(t - contactSeconds));
      if (t < restoreSeconds) return snapshot(...solved.driftAt(t - offSeconds));
      return snapshot(restored.a.at(t - restoreSeconds), restored.b.at(t - restoreSeconds));
    },
  };
}
