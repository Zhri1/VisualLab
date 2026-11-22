import { describe, expect, it } from "vitest";
import { assembleScene, validateStagePlan } from "../index";
import complete from "../../../fixtures/precompressed-spring-complete.reading.json";
import critical from "../../../fixtures/precompressed-spring-critical.reading.json";
import fixed from "../../../fixtures/precompressed-spring-fixed-energy.reading.json";
import reference from "../../../fixtures/precompressed-spring.acceptance.json";
function build(p: unknown) { const r = assembleScene(p); if (!r.ok) throw Error(JSON.stringify(r)); if (!("kind" in r.scene)) throw Error("应为阶段场景"); return r.scene.motion; }
describe("预压释放与能量公共入口", () => {
  it("完整题时刻、摩擦功和末态符合独立基准", () => {
    const m = build(complete), r = reference.complete;
    expect(m.durationSeconds).toBeCloseTo(r.durationSeconds, 9);
    expect(m.events.map(e => e.kind)).toEqual(r.eventKinds);
    expect(m.events.find(e => e.kind === "spring_release_end")!.timeSeconds).toBeCloseTo(r.release.timeSeconds, 10);
    expect(m.events.find(e => e.kind === "arc_enter")!.timeSeconds).toBeCloseTo(r.entry.timeSeconds, 10);
    expect(m.sampleAt(Infinity)).toMatchObject(r.final);
    expect(m.timing?.mode).toBe("full");
    const t = r.release.timeSeconds;
    expect(m.sampleAt(t - 1e-7).springCompressionM).toBeGreaterThan(0);
    expect(m.sampleAt(t).springCompressionM).toBe(0);
    expect(m.sampleAt(t + 1e-7).vxMps).toBeCloseTo(r.release.vxMps - 2e-7, 6);
  });
  it("临界条件由B规范化，重复校验/JSON往返能量不漂移", () => {
    let r = validateStagePlan(critical); if (!r.ok) throw Error(JSON.stringify(r));
    expect(r.reading.energy?.elasticEnergyJ).toBeCloseTo(1.4, 12);
    expect(r.reading).not.toHaveProperty("constraints");
    const canonical = JSON.stringify(r.reading);
    for (let i = 0; i < 3; i++) { r = validateStagePlan(JSON.parse(canonical)); expect(r.ok).toBe(true); if (r.ok) expect(r.reading).toEqual(JSON.parse(canonical)); }
  });
  for (const row of reference.fixedEnergyEdits) it(`固定能量AB=${row.ABM}`, () => {
    const p = structuredClone(fixed); p.stages[1].end!.distanceM = row.ABM;
    const r = validateStagePlan(p);
    if (row.status === "needs_input") { expect(r).toMatchObject({ ok: false, missingKeys: row.missingKeys }); return; }
    expect(r.ok).toBe(true); const m = build(p);
    expect(m.timing?.mode).toBe(row.mode); expect(m.timing?.absoluteStartSeconds).toBeNull();
    expect(m.durationSeconds).toBeCloseTo(row.durationSeconds!, 9);
    expect(m.events.map(e => e.kind)).toEqual(row.eventKinds);
    expect(m.endReason).toBe(row.terminationReason);
    for (const key of ["xM", "vxMps", "vyMps"] as const) expect(m.sampleAt(Infinity)[key]).toBeCloseTo(row.final![key], 8);
    expect(m.sampleAt(Infinity)).toEqual(m.sampleAt(m.durationSeconds));
    if (row.mode === "state_only") { expect(m.segments).toEqual([]); expect(m.geometry.verticalArc).toBeUndefined(); expect(m.geometry.projectile).toBeUndefined(); }
  });
  it.each(["springConstantNpm", "initialCompressionM"])("补齐%s后转全程", key => {
    const p = structuredClone(fixed); (p.stages[0] as Record<string, unknown>)[key] = key === "springConstantNpm" ? 70 : .2;
    expect(build(p).timing?.mode).toBe("full"); expect(build(p).durationSeconds).toBeCloseTo(reference.complete.durationSeconds, 9);
  });
  it.each([[.075, "spring_stopped_before_release", .05], [.05, "spring_stopped_at_release", 0], [0, "spring_released", 0]])("摩擦%s释放分支", (mu, reason, remaining) => {
    const p = { ...complete, massKg: 1, stages: [{ kind: "spring_release", springConstantNpm: 10, initialCompressionM: .1, kineticFrictionCoefficient: mu, unattached: true, slidesAfterRelease: true }] };
    const m = build(p); expect(m.endReason).toBe(reason); expect(m.sampleAt(Infinity).springCompressionM).toBeCloseTo(remaining as number, 10);
    if (mu === 0) expect(m.durationSeconds).toBeCloseTo(Math.PI / (2 * Math.sqrt(10)), 10);
  });
  it("原长在B，同刻释放/到达/入弧且无零长水平段", () => {
    const p = structuredClone(complete); p.stages[1].end!.distanceM = .2;
    const m = build(p), t = m.events.find(e => e.kind === "spring_release_end")!.timeSeconds;
    expect(m.events.filter(e => e.timeSeconds === t).map(e => e.kind)).toEqual(["spring_release_end", "reach_target", "arc_enter"]);
    expect(m.segments.map(s => s.stageIndex)).toEqual([0, 2, 3]); expect(m.sampleAt(t).constraint?.stageIndex).toBe(2);
  });
  it("两区摩擦不同且只缺k可反求", () => {
    const p = structuredClone(critical); p.stages[0].initialCompressionM = .2 as never; p.stages[0].kineticFrictionCoefficient = .4;
    const r = validateStagePlan(p); if (!r.ok) throw Error(JSON.stringify(r));
    expect(r.reading.energy?.elasticEnergyJ).toBeCloseTo(1.44, 12);
    expect(r.reading.stages[0]).toMatchObject({ springConstantNpm: 72 }); expect(build(p).timing?.mode).toBe("full");
  });
  it("非圆弧后缀与无后缀不生成入弧事件，已知正速度不当停止", () => {
    const p = structuredClone(fixed); p.stages = p.stages.slice(0, 2);
    const m = build(p); expect(m.timing?.mode).toBe("state_only"); expect(m.endReason).toBe("prefix_end"); expect(m.sampleAt(0).vxMps).toBeGreaterThan(4);
    const projectile = build({ ...p, stages: [...p.stages, { kind: "projectile", dropHeightM: 1.25 }] });
    expect(projectile.events.map(e => e.kind)).not.toContain("arc_enter"); expect(projectile.durationSeconds).toBeCloseTo(.5, 10);
  });
  it("非半圆端点与前缀位移保持同一世界坐标", () => {
    const p = structuredClone(fixed); p.stages[2].endAngleDeg = 90;
    expect(build(p).geometry.verticalArc?.plannedEnd).toEqual({ xM: 2.4, yM: .4 });
    expect(build(p).geometry.landmarks?.some(p => p.label === "C")).toBe(false);
  });
  it("明确未滑动为A零时长状态，不谎称已释放", () => {
    const p = structuredClone(complete); p.stages[0].slidesAfterRelease = false;
    const m = build(p); expect(m.durationSeconds).toBe(0); expect(m.events.map(e => e.kind)).toEqual(["release", "stop"]); expect(m.sampleAt(0).springCompressionM).toBe(.2);
  });
  it("缺释放上界时保留活动条件供补值再次校验", () => {
    const p = structuredClone(critical); delete (p.stages[0] as Record<string, unknown>).releaseCompleteByM;
    const r = validateStagePlan(p); expect(r).toMatchObject({ ok: false, missingKeys: ["/stages/0/releaseCompleteByM"] });
    if (!r.ok) expect(r.reading?.constraints).toEqual(critical.constraints);
  });
  it("识图缺半径，草稿保留条件；只补半径即可从B精确播放", () => {
    const p = structuredClone(critical); p.stages[2].radiusM = null as never;
    const r = validateStagePlan(p);
    expect(r).toMatchObject({ ok: false, code: "NEEDS_INPUT", missingKeys: ["/stages/2/radiusM"] });
    if (r.ok || !r.reading) throw Error("应保留可补草稿");
    expect(r.reading.constraints).toEqual(critical.constraints);
    r.reading.stages[2].radiusM = .4;
    expect(build(r.reading).timing?.mode).toBe("suffix");
    expect(build(r.reading).sampleAt(0).vxMps).toBeCloseTo(Math.sqrt(20), 10);
  });
  it("固定能量不足但释放位置未知时不冒出停止点", () => {
    const p = { ...fixed, energy: { stageIndex: 0, elasticEnergyJ: .1, origin: "given" } };
    expect(validateStagePlan(p)).toMatchObject({ ok: false, code: "NEEDS_INPUT", missingKeys: ["/stages/0/initialCompressionM"] });
  });
  it.each(["initialCompressionM", "springConstantNpm"])("非法%s保留字段错误", key => {
    const p = structuredClone(complete); (p.stages[0] as Record<string, unknown>)[key] = Infinity;
    const r = validateStagePlan(p); expect(r).toMatchObject({ ok: false }); if (!r.ok) expect(r.fieldErrors).toContainEqual(expect.objectContaining({ path: "/stages/0/" + key, code: "NOT_FINITE" }));
  });
});
