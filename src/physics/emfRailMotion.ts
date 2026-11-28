import { solveEmfRail, type EmfRailGeometry, type EmfRailStage } from "./emfRail.ts";
import type { DerivedCalculation } from "./gaokaoConstraints.ts";
import type { StageEvent, StageMotion } from "./stageMotion.ts";

/**
 * 电磁感应导轨的运动装配：把解析解包装成可播放的 StageMotion。
 * 位移沿 +x，导轨平面为 y ∈ [0, L]，电阻固定在 x = 0 一端。
 */
export function computeEmfRailMotion(stage: EmfRailStage, derived: DerivedCalculation[] = []): StageMotion {
  const solved = solveEmfRail(stage);
  const g: EmfRailGeometry = solved.geometry;
  const ids = ["rod"];
  const y = 0;
  const velocity = (v: number) => ({ vxMps: v, vyMps: 0 });

  const events: StageEvent[] = solved.events.map((ev, index) => {
    const state = { xM: ev.sample.xM, yM: y, vxMps: ev.sample.vMps, vyMps: 0, springCompressionM: 0 };
    return {
      id: `0:${ev.kind}:${index}`,
      stageIndex: 0,
      kind: ev.kind,
      timeSeconds: ev.timeSeconds,
      order: index,
      bodyIds: ids,
      label: ev.label,
      explanation: ev.explanation,
      velocityBefore: velocity(ev.sample.vMps),
      velocityAfter: velocity(ev.sample.vMps),
      bodyStatesBefore: { rod: { bodyId: "rod", massKg: g.rodMassKg, ...state, status: "moving" as const } },
      bodyStatesAfter: { rod: { bodyId: "rod", massKg: g.rodMassKg, ...state, status: "moving" as const } },
      position: { xM: ev.sample.xM, yM: y },
    };
  });
  const last = events[events.length - 1];

  const calculations = [
    ...derived.map((c) => ({ ...c })),
    { quantity: "emf_travel", value: solved.travelM, unit: "m", source: "derived" as const, rule: "emf_rail", inputPaths: ["/stages/0"] },
    { quantity: "emf_charge", value: solved.chargeC, unit: "C", source: "derived" as const, rule: "q_BLx_over_R", inputPaths: ["/stages/0"] },
    { quantity: "emf_joule_heat", value: solved.jouleHeatJ, unit: "J", source: "derived" as const, rule: "Q_work_energy", inputPaths: ["/stages/0"] },
    { quantity: "emf_terminal_speed", value: solved.terminalSpeedMps, unit: "m/s", source: "derived" as const, rule: "v_t_FR_over_B2L2", inputPaths: ["/stages/0"] },
    { quantity: "emf_damping_time", value: 1 / solved.dampingRatePerS, unit: "s", source: "derived" as const, rule: "tau_mR_over_B2L2", inputPaths: ["/stages/0"] },
  ];

  return {
    primaryBodyId: "rod",
    durationSeconds: solved.durationSeconds,
    geometry: {
      blockSizeM: 0.12,
      positionReference: "particle",
      linearTrack: { minXM: 0, maxXM: Math.max(solved.travelM, g.railSpacingM * 0.5), yM: y },
      emfRail: g,
    },
    segments: [{ stageIndex: 0, kind: "emf_rail", bodyIds: ids, startSeconds: 0, endSeconds: solved.durationSeconds }],
    events,
    termination: { reason: "emf_end", eventId: last.id, stageIndex: 0 },
    endReason: "emf_end",
    motionStatus: {
      state: "range_end",
      reason: "emf_end",
      message: `导体棒在导轨上运动 ${solved.durationSeconds.toFixed(3)} s，位移 ${solved.travelM.toFixed(4)} m，通过回路电荷量 ${solved.chargeC.toFixed(4)} C。`,
      bodyIds: ids,
    },
    calculations,
    sampleAt: (dt: number) => {
      const s = solved.at(dt);
      return {
        xM: s.xM,
        yM: y,
        vxMps: s.vMps,
        vyMps: 0,
        springCompressionM: 0,
        emfRail: { emfV: s.emfV, currentA: s.currentA, ampereForceN: s.ampereForceN },
      };
    },
  };
}
