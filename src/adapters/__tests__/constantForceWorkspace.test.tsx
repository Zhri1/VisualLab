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

describe("常力与分段匀变速：工作区与条件表", () => {
  it("基准题与折返变式正常渲染且保留现有播放器读数结构", () => {
    const motion = toMotion(read("constant-force-benchmark.reading.json"));
    const html2 = renderToStaticMarkup(<StagePhysicsCanvas motion={motion} time={2} />);
    expect(html2).toContain("4.00 米每秒");
    const html6 = renderToStaticMarkup(<StagePhysicsCanvas motion={motion} time={6} />);
    expect(html6).toContain("结束原因 stopped");
  });

  it("常力定距回包可在条件表保留距离结束条件",()=>{
    const draft=read("uniform-constraints.reading.json") as StagePlanDraft;
    const html=renderToStaticMarkup(<StagePlanEditor draft={draft} onChange={()=>{}} missingKeys={[]} fieldErrors={[]} />);
    expect(html).toContain('value="distance" selected=""');expect(html).toContain("常力段距离");expect(html).toContain("/stages/0/end/distanceM");
  });
  it("StagePlanEditor：展示常力段合力、结束条件与作用时长输入", () => {
    const draft = read("constant-force-benchmark.reading.json") as StagePlanDraft;
    const html = renderToStaticMarkup(<StagePlanEditor draft={draft} onChange={() => {}} missingKeys={[]} fieldErrors={[]} />);
    expect(html).toContain("常力匀变速");
    expect(html).toContain("水平恒定合力 F");
    expect(html).toContain("常力段结束条件");
    expect(html).toContain("作用时长 t");
    expect(html).toContain("/stages/0/netForceXN");
    expect(html).toContain("/stages/0/end/durationSeconds");
  });
});
