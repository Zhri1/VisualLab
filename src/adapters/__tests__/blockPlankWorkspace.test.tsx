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

describe("滑块与可移动木板：多物体工作区与条件表", () => {
  it("MultiBodyPhysicsCanvas 正常渲染双体状态与读数", () => {
    const motion = toMotion(read("block-plank-common.reading.json"));
    const html = renderToStaticMarkup(<MultiBodyPhysicsCanvas motion={motion} time={1} />);
    expect(html).toContain("block");
    expect(html).toContain("plank");
  });

  it("MultiBodyPlanEditor 展示木板长度、动/静摩擦与共速后外力输入", () => {
    const draft = read("block-plank-force-reslide.reading.json") as StagePlanDraft;
    const html = renderToStaticMarkup(<MultiBodyPlanEditor draft={draft} onChange={() => {}} missingKeys={[]} fieldErrors={[]} />);
    expect(html).toContain("滑块与可移动木板");
    expect(html).toContain("/stages/0/plankLengthM");
    expect(html).toContain("/stages/0/kineticFrictionCoefficient");
    expect(html).toContain("/stages/0/staticFrictionCoefficient");
    expect(html).toContain("/stages/0/postCommonForce/plankForceXN");
  });
});
