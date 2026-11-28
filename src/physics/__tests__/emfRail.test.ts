import { describe, expect, it } from "vitest";
import { solveEmfRail, type EmfRailStage } from "../emfRail";
import { validateStagePlan } from "../stagePlan";

const base = {
  kind: "emf_rail" as const,
  magneticTeslaB: 0.5,
  railSpacingM: 1,
  totalResistanceOhm: 0.5,
  rodMassKg: 0.2,
  gravityMps2: 10,
};

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(a), Math.abs(b)));

describe("电磁感应导轨：解析解", () => {
  it("无外力光滑：速度按指数衰减，总位移 = mRv₀/(B²L²)", () => {
    const stage: EmfRailStage = { ...base, initialSpeedMps: 4, end: { kind: "time", durationSeconds: 0.4 } };
    const solved = solveEmfRail(stage);
    // k = B²L²/R = 0.5, λ = k/m = 2.5, τ = 0.4
    close(solved.dampingRatePerS, 2.5);
    close(solved.terminalSpeedMps, 0);
    // t = τ 时 v = v₀/e
    close(solved.at(0.4).vMps, 4 / Math.E, 1e-9);
    // x(t) = (v₀/λ)(1 − e^(−λt))
    close(solved.at(0.4).xM, (4 / 2.5) * (1 - Math.exp(-1)), 1e-9);
    // 总位移（t→∞）= v₀/λ = 1.6 m
    close((4 / 2.5), 1.6, 1e-12);
  });

  it("通过回路的电荷量 q = BLx/R，焦耳热等于动能损失", () => {
    const stage: EmfRailStage = { ...base, initialSpeedMps: 4, end: { kind: "time", durationSeconds: 0.4 } };
    const solved = solveEmfRail(stage);
    const x = solved.travelM;
    close(solved.chargeC, (0.5 * 1 * x) / 0.5, 1e-9);
    const dEk = 0.5 * 0.2 * (solved.at(0.4).vMps ** 2 - 4 ** 2);
    close(solved.jouleHeatJ, -dEk, 1e-9);
  });

  it("恒定外力：速度指数趋近收尾速度 v_t = FR/(B²L²)", () => {
    const stage: EmfRailStage = { ...base, externalForceN: 0.4, initialSpeedMps: 0, end: { kind: "time", durationSeconds: 10 } };
    const solved = solveEmfRail(stage);
    // v_t = F/k = 0.4/0.5 = 0.8 m/s
    close(solved.terminalSpeedMps, 0.8, 1e-12);
    // 10τ 后已非常接近收尾速度
    expect(solved.at(10).vMps).toBeCloseTo(0.8, 4);
    expect(solved.at(10).vMps).toBeLessThan(0.8 + 1e-9);
  });

  it("摩擦减速：v_t < 0 时在有限时间内停止", () => {
    const stage: EmfRailStage = {
      ...base,
      initialSpeedMps: 4,
      kineticFrictionCoefficient: 0.2,
      end: { kind: "stop" },
    };
    const solved = solveEmfRail(stage);
    // f = −μmg = −0.4, k = 0.5 → v_t = −0.8；t_stop = ln((4+0.8)/0.8)/2.5
    close(solved.terminalSpeedMps, -0.8, 1e-12);
    close(solved.durationSeconds, Math.log(6) / 2.5, 1e-9);
    expect(solved.at(solved.durationSeconds).vMps).toBeCloseTo(0, 6);
  });

  it("按位移结束：x 与 v 满足指数衰减关系", () => {
    const stage: EmfRailStage = { ...base, initialSpeedMps: 4, end: { kind: "distance", distanceM: 1 } };
    const solved = solveEmfRail(stage);
    close(solved.travelM, 1, 1e-6);
    // x = (v₀/λ)(1 − e^(−λt)) = 1 → e^(−λt) = 1 − 1/1.6 = 0.375 → v = 4×0.375 = 1.5 m/s
    close(solved.at(solved.durationSeconds).vMps, 1.5, 1e-6);
  });

  it("按速度结束：反解时刻正确", () => {
    const stage: EmfRailStage = { ...base, initialSpeedMps: 4, end: { kind: "speed", speedMps: 2 } };
    const solved = solveEmfRail(stage);
    close(solved.at(solved.durationSeconds).vMps, 2, 1e-9);
    // v(t)=v₀e^(−λt) → t = ln(2)/2.5
    close(solved.durationSeconds, Math.log(2) / 2.5, 1e-9);
  });

  it("按收尾速度结束：恒力拉动时跑到 99% 收尾速度", () => {
    // k = 0.5, λ = 2.5, v_t = F/k = 0.5/0.5 = 1
    const solved = solveEmfRail({ ...base, externalForceN: 0.5, initialSpeedMps: 0, end: { kind: "terminal" } });
    close(solved.terminalSpeedMps, 1);
    close(solved.at(solved.durationSeconds).vMps, 0.99, 1e-6);
    // 从静止出发：1 − e^(−λt) = 0.99 → t = ln(100)/2.5
    close(solved.durationSeconds, Math.log(100) / 2.5, 1e-9);
    // 中间事件（95% 收尾速度）必须严格早于终点，否则事件列表会退化成一条。
    const kinds = solved.events.map((e) => e.kind);
    expect(kinds).toEqual(["emf_start", "emf_terminal", "emf_end"]);
  });

  it("非法组合被拒绝：初速为零且无外力、stop 但不会停、terminal 但没有收尾速度", () => {
    expect(() => solveEmfRail({ ...base, initialSpeedMps: 0, end: { kind: "time", durationSeconds: 1 } })).toThrow();
    expect(() => solveEmfRail({ ...base, initialSpeedMps: 4, end: { kind: "stop" } })).toThrow();
    expect(() => solveEmfRail({ ...base, initialSpeedMps: 4, end: { kind: "distance", distanceM: 99 } })).toThrow();
    // 无外力时光滑导轨 v_t = 0，不存在正收尾速度。
    expect(() => solveEmfRail({ ...base, initialSpeedMps: 4, end: { kind: "terminal" } })).toThrow();
  });
});

describe("电磁感应导轨：阶段计划校验", () => {
  const plan = (stage: Record<string, unknown>) => ({
    kind: "stage_plan",
    schemaVersion: 1,
    initial: { speedMps: 0 },
    stages: [{ kind: "emf_rail", ...stage }],
  });

  it("缺字段时列出缺项", () => {
    const result = validateStagePlan(plan({ magneticTeslaB: 0.5 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NEEDS_INPUT");
    expect(result.missingKeys).toContain("/stages/0/railSpacingM");
    expect(result.missingKeys).toContain("/stages/0/totalResistanceOhm");
    expect(result.missingKeys).toContain("/stages/0/rodMassKg");
  });

  it("完整题设通过校验并可装配", () => {
    const result = validateStagePlan(
      plan({
        magneticTeslaB: 0.5,
        railSpacingM: 1,
        totalResistanceOhm: 0.5,
        rodMassKg: 0.2,
        gravityMps2: 10,
        initialSpeedMps: 4,
        end: { kind: "distance", distanceM: 1 },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("混用顶层 massKg 会被拒绝", () => {
    const result = validateStagePlan({
      kind: "stage_plan",
      schemaVersion: 1,
      massKg: 1,
      initial: { speedMps: 0 },
      stages: [{ kind: "emf_rail", magneticTeslaB: 0.5, railSpacingM: 1, totalResistanceOhm: 0.5, rodMassKg: 0.2, end: { kind: "time", durationSeconds: 1 } }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.some((e) => e.path === "/massKg")).toBe(true);
  });
});
