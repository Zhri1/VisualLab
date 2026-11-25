import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { assembleScene, buildMotion } from "../../physics/index.ts";
import { adaptStageMotion } from "../stageMotionAdapter.ts";
import { StagePhysicsCanvas } from "../../ui/components/workspace/StagePhysicsCanvas.tsx";
import { StagePlanEditor, updateSpringContactMode } from "../../ui/components/workspace/StagePlanEditor.tsx";
import type { StagePlanDraft } from "../../physics/stagePlan.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"));
const toMotion = (plan: unknown) => {
  const assembled: any = assembleScene(plan);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled));
  const raw: any = buildMotion(assembled.scene).motion;
  return adaptStageMotion(raw, assembled.scene.reading);
};

describe("粗糙弹簧与能量显示：工作区与条件表", () => {
  it("粗糙弹簧脱离例：同一时钟显示动能、弹性势能与累计摩擦耗能", () => {
    const motion = toMotion(read("rough-spring-detach.reading.json"));
    const tMax = motion.events.find((e) => e.eventKind === "max_compression")!.timeSeconds;
    const html0 = renderToStaticMarkup(<StagePhysicsCanvas motion={motion} time={0} />);
    expect(html0).toContain("动能 <b>2.000</b> J");
    expect(html0).toContain("弹性势能 <b>0</b> J");
    expect(html0).toContain("累计摩擦耗能 <b>0</b> J");

    const htmlMax = renderToStaticMarkup(<StagePhysicsCanvas motion={motion} time={tMax} />);
    expect(htmlMax).toContain("动能 <b>0</b> J");
    expect(htmlMax).toContain("弹性势能 <b>1.073</b> J");
    expect(htmlMax).toContain("累计摩擦耗能 <b>0.927</b> J");

    const htmlEnd = renderToStaticMarkup(<StagePhysicsCanvas motion={motion} time={motion.durationSeconds} />);
    expect(htmlEnd).toContain("动能 <b>0.147</b> J");
    expect(htmlEnd).toContain("弹性势能 <b>0</b> J");
    expect(htmlEnd).toContain("累计摩擦耗能 <b>1.853</b> J");
    expect(htmlEnd).toContain("累计摩擦耗能 1.853 J");
  });

  it("缺参预压题（suffix）：未知前段标注自此起计，不伪造前段耗能", () => {
    const motion = toMotion(read("precompressed-spring-fixed-energy.reading.json"));
    const html = renderToStaticMarkup(<StagePhysicsCanvas motion={motion} time={0} />);
    expect(html).toContain("摩擦耗能（自此起计）");
    expect(html).toContain("<b>0</b> J");
  });

  it("光滑弹簧：显示能量且全程摩擦耗能为 0", () => {
    const motion = toMotion({ kind: "stage_plan", schemaVersion: 1, massKg: 2, initial: { speedMps: 3 }, stages: [{ kind: "spring_contact", springConstantNpm: 200, frictionless: true, unattached: true }] });
    const html = renderToStaticMarkup(<StagePhysicsCanvas motion={motion} time={motion.durationSeconds} />);
    expect(html).toContain("动能 <b>9.000</b> J");
    expect(html).toContain("累计摩擦耗能 <b>0</b> J");
  });

  it("无弹簧题（圆轨）：不显示弹簧能量条，保留原有画面", () => {
    const motion = toMotion(read("circular-track-critical.reading.json"));
    const html = renderToStaticMarkup(<StagePhysicsCanvas motion={motion} time={0} />);
    expect(html).not.toContain('data-testid="energy-readout"');
  });

  it("StagePlanEditor：支持光滑 ↔ 粗糙切换且互斥字段正确清理", () => {
    const smooth: StagePlanDraft = {
      kind: "stage_plan", schemaVersion: 1, massKg: 1, gravityMps2: 10, initial: { speedMps: 2 },
      stages: [{ kind: "spring_contact", springConstantNpm: 10, frictionless: true, unattached: true }],
    };
    const toRough = updateSpringContactMode(smooth, 0, true);
    expect("frictionless" in toRough.stages[0]).toBe(false);
    expect("kineticFrictionCoefficient" in toRough.stages[0]).toBe(true);
    expect(toRough.stages[0].springConstantNpm).toBe(10);

    const html = renderToStaticMarkup(<StagePlanEditor draft={toRough} onChange={() => {}} missingKeys={["/stages/0/staticFrictionCoefficient"]} fieldErrors={[]} />);
    expect(html).toContain("接触面动摩擦因数 μₖ");
    expect(html).toContain("静摩擦因数 μₛ（上限）");
    expect(html).toContain("最大压缩处能回弹（题给事实）");
    expect(html).toContain("/stages/0/staticFrictionCoefficient");

    const back = updateSpringContactMode(toRough, 0, false);
    expect("kineticFrictionCoefficient" in back.stages[0]).toBe(false);
    expect("frictionless" in back.stages[0]).toBe(true);
  });
});
