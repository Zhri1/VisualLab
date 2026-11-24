import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { assembleScene, buildMotion } from "../../physics/index.ts";
import { adaptStageMotion } from "../stageMotionAdapter.ts";
import { MultiBodyPhysicsCanvas } from "../../ui/components/workspace/MultiBodyPhysicsCanvas.tsx";
import { MultiBodyPlanEditor } from "../../ui/components/workspace/MultiBodyPlanEditor.tsx";
import type { StagePlanDraft } from "../../physics/stagePlan.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"));
const toMotion = (plan: unknown) => {
  const assembled: any = assembleScene(plan);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled));
  return adaptStageMotion(buildMotion(assembled.scene).motion as any, assembled.scene.reading);
};

describe("轻绳与理想定滑轮：多物体工作区与条件表", () => {
  it("MultiBodyPhysicsCanvas 展示两物体与张力读数（拉紧与松弛）", () => {
    const motion = toMotion(read("pulley-ground-slack.reading.json"));
    const htmlTaut = renderToStaticMarkup(<MultiBodyPhysicsCanvas motion={motion} time={0.4} />);
    expect(htmlTaut).toContain("绳张紧");
    expect(htmlTaut).toContain("15.00 N");
    const htmlSlack = renderToStaticMarkup(<MultiBodyPhysicsCanvas motion={motion} time={1.2} />);
    expect(htmlSlack).toContain("绳松弛");
    expect(htmlSlack).toContain("0.00 N");
  });

  it("MultiBodyPlanEditor 展示支承面、摩擦与离地高度输入", () => {
    const draft = read("pulley-incline.reading.json") as StagePlanDraft;
    const html = renderToStaticMarkup(<MultiBodyPlanEditor draft={draft} onChange={() => {}} missingKeys={[]} fieldErrors={[]} />);
    expect(html).toContain("轻绳与定滑轮");
    expect(html).toContain("/stages/0/surface/angleDeg");
    expect(html).toContain("/stages/0/surface/kineticFrictionCoefficient");
    expect(html).toContain("/stages/0/surface/staticFrictionCoefficient");
    expect(html).toContain("沿绳初速 v₀");
    expect(html).not.toContain("摆初态形式");
  });
});
