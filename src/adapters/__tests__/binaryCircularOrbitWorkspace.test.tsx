import {describe,it,expect} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import {StagePlanEditor} from "../../ui/components/workspace/StagePlanEditor.tsx";
import {MultiBodyPhysicsCanvas,MultiBodyReadouts} from "../../ui/components/workspace/MultiBodyPhysicsCanvas.tsx";
import {assembleStageScene} from "../../physics/index.ts";
import {adaptStageMotion} from "../stageMotionAdapter.ts";
describe("双星工作区复用",()=>{
 it("条件表给出质量比方向与G，画布复用多体状态和轨道读数",()=>{
  const p=JSON.parse(readFileSync(new URL("../../../fixtures/binary-circular-orbit.reading.json",import.meta.url),"utf8"));const a=assembleStageScene(p);expect(a.ok).toBe(true);if(!a.ok)return;
  const editor=renderToStaticMarkup(<StagePlanEditor draft={a.scene.reading} onChange={()=>{}} missingKeys={[]} fieldErrors={[]} />);
  expect(editor).toContain("未给（可选）");expect(editor).toContain("质量比 m₁/m₂");expect(editor).toContain("两星间距 d");expect(editor).toContain("万有引力常量 G");expect(editor).not.toContain("初始速率 v₀");expect(editor).not.toContain("重力加速度 g");
  const motion=adaptStageMotion(a.scene.motion,a.scene.reading);const canvas=renderToStaticMarkup(<MultiBodyPhysicsCanvas motion={motion} time={0}/>);expect(canvas).toContain("star1");expect(canvas).toContain("star2");
  const values=renderToStaticMarkup(<MultiBodyReadouts motion={motion} time={0}/>);expect(values).toContain("甲星");expect(values).toContain("乙星");expect(values).toContain("共同周期");expect(values).toContain("固定质心");
 });
});
