import { describe, expect, it } from "vitest";
import { motionLibrary } from "../../adapters";
import { buildFromReading, defaultScanPath, findCriticals, getParam, outcomeOf, scanBounds, scanRange, withParam } from "../critical/scanner";
import { forcesAt } from "../forces/forceModel";
import { systemEnergyAt } from "../energy/systemEnergy";
import loop from "../../../fixtures/gaokao-proj-arc-horiz-loop.reading.json";
import incline from "../../../fixtures/gaokao-incline-arc-horiz-spring.reading.json";
import collision from "../../../fixtures/horizontal-collision-flight.reading.json";
import pendulum from "../../../fixtures/horizontal-collision-pendulum.reading.json";

function build(input: unknown) {
  const a = motionLibrary.assembleScene(input as never);
  if (!a.ok) throw new Error(JSON.stringify(a.errors));
  const b = motionLibrary.buildMotion(a.scene);
  if (!b.ok) throw new Error(b.message);
  return b.motion;
}

describe("临界扫描", () => {
  it("路径读写不破坏原 reading", () => {
    const path = defaultScanPath(loop);
    expect(path).toBeTruthy();
    const before = getParam(loop, path!);
    const next = withParam(loop, path!, (before ?? 0) + 1);
    expect(getParam(next, path!)).toBe((before ?? 0) + 1);
    expect(getParam(loop, path!)).toBe(before);
  });

  it("整圆题能扫出临界值且两侧结局不同", () => {
    const path = defaultScanPath(loop)!;
    const bounds = scanBounds(loop, path)!;
    const points = scanRange(loop, path, bounds.lo, bounds.hi, 20);
    const criticals = findCriticals(loop, path, points, 12);
    expect(criticals.length).toBeGreaterThanOrEqual(1);
    for (const c of criticals) {
      expect(c.left.key).not.toBe(c.right.key);
      expect(c.value).toBeGreaterThan(bounds.lo);
      expect(c.value).toBeLessThan(bounds.hi);
    }
  });

  it("多物体题也有可扫描初值", () => {
    const path = defaultScanPath(pendulum);
    expect(path).toEqual(["initial", "bodies", 0, "vxMps"]);
    const m = buildFromReading(withParam(pendulum, path!, 4));
    expect(m).toBeTruthy();
    expect(m!.events.some((e) => (e.eventKind ?? e.id) === "collision")).toBe(true);
    expect(outcomeOf(m!).key).toMatch(/pendulum_first_turn|collision_complete/);
  });

  it("桌沿被题设钉死的题扫描时给出装配失败而非崩溃", () => {
    const path = defaultScanPath(collision)!;
    expect(buildFromReading(withParam(collision, path, 9))).toBeNull();
  });
});

describe("受力矢量", () => {
  it("斜面段给出 G/N/f 且 N=mg·cosθ", () => {
    const motion = build(incline);
    const arrows = forcesAt(motion, 0.5);
    const g = arrows.find((a) => a.kind === "gravity")!;
    const n = arrows.find((a) => a.kind === "normal")!;
    const f = arrows.find((a) => a.kind === "friction")!;
    expect(g.magnitudeN).toBeCloseTo(10, 6);
    expect(n.magnitudeN).toBeCloseTo(10 * Math.cos((37 * Math.PI) / 180), 6);
    expect(f.magnitudeN).toBeCloseTo(0.25 * n.magnitudeN, 6);
    expect(f.dir.x * Math.cos((37 * Math.PI) / 180) + f.dir.y * -Math.sin((37 * Math.PI) / 180)).toBeLessThan(0);
  });

  it("分解模式追加两个虚线分量", () => {
    const motion = build(incline);
    const plain = forcesAt(motion, 0.5, false);
    const split = forcesAt(motion, 0.5, true);
    expect(split.filter((a) => a.dashed).length).toBe(2);
    expect(split.length).toBe(plain.length + 2);
  });

  it("碰撞题两物体都有重力箭头", () => {
    const motion = build(collision);
    const arrows = forcesAt(motion, 0.2);
    expect(arrows.filter((a) => a.kind === "gravity").length).toBe(2);
  });
});

describe("系统能量", () => {
  it("多物体碰撞前后动能+耗散守恒（弹性碰耗散≈0）", () => {
    const motion = build(collision);
    const before = systemEnergyAt(motion, 0)!;
    const after = systemEnergyAt(motion, motion.durationSeconds)!;
    expect(before.kineticJ).toBeGreaterThan(0);
    expect(after.dissipatedJ).toBeLessThan(1e-6);
  });

  it("粗糙斜面题耗散随时间单调不减", () => {
    const motion = build(incline);
    const a = systemEnergyAt(motion, 0.5)!;
    const b = systemEnergyAt(motion, 1.5)!;
    expect(b.dissipatedJ).toBeGreaterThanOrEqual(a.dissipatedJ - 1e-9);
  });
});
