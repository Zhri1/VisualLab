import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { assembleScene, buildMotion } from "../../physics/index.ts";
import { adaptStageMotion } from "../stageMotionAdapter.ts";
import { StagePhysicsCanvas } from "../../ui/components/workspace/StagePhysicsCanvas.tsx";
import { StagePlanEditor } from "../../ui/components/workspace/StagePlanEditor.tsx";
import type { StagePlanDraft } from "../../physics/stagePlan.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"));
const toMotion = (plan: unknown) => {
  const assembled: any = assembleScene(plan);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled));
  return adaptStageMotion(buildMotion(assembled.scene).motion as any, assembled.scene.reading);
};

describe("传送带与滑块：工作区与条件表", () => {
  it("StagePhysicsCanvas 正常渲染传送带场景且保留播放器读数", () => {
    const motion = toMotion(read("conveyor-uniform.reading.json"));
    const html = renderToStaticMarkup(<StagePhysicsCanvas motion={motion} time={1} />);
    expect(html).toContain("2.00 米每秒");
  });

  it("StagePlanEditor 展示带面初速、μk、μs 与带速分段编辑项", () => {
    const draft = read("conveyor-reslide.reading.json") as StagePlanDraft;
    const html = renderToStaticMarkup(<StagePlanEditor draft={draft} onChange={() => {}} missingKeys={[]} fieldErrors={[]} />);
    expect(html).toContain("传送带与滑块");
    expect(html).toContain("/stages/0/initialBeltSpeedMps");
    expect(html).toContain("/stages/0/staticFrictionCoefficient");
    expect(html).toContain("/stages/0/segments/1/accelerationMps2");
  });
});
