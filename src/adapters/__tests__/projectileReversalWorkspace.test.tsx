import {describe,it,expect} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import {StagePlanEditor} from "../../ui/components/workspace/StagePlanEditor";
describe("明确反向的条件编辑",()=>{
 it("保留触球高度及两种观察终点，不显示成竖直恢复系数",()=>{
  const p=JSON.parse(readFileSync(new URL("../../../fixtures/projectile-reversal.reading.json",import.meta.url),"utf8"));
  const html=renderToStaticMarkup(<StagePlanEditor draft={p} onChange={()=>{}} missingKeys={[]} fieldErrors={[]} />);
  expect(html).toContain("触球高度基准");expect(html).toContain("两个分量同时取反");expect(html).toContain("碰后瞬间");expect(html).toContain("反向后首个最高点");expect(html).not.toContain("竖直恢复系数");
 });
});
