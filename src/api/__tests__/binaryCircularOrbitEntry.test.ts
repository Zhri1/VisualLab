import {describe,it,expect,beforeEach,afterEach,vi} from "vitest";
import {readFileSync} from "node:fs";
import {handlePlan} from "../plan.ts";
import {handler} from "../../../functions/handler.ts";
import {assembleStageScene} from "../../physics/index.ts";
const upstream=vi.fn<typeof fetch>();
beforeEach(()=>{vi.stubEnv("DASHSCOPE_API_KEY","mock-only");vi.stubEnv("DASHSCOPE_FALLBACK_MODEL","");vi.stubEnv("API_CONTRACT_MODE","stage_plan");vi.stubGlobal("Deno",{env:{get:(k:string)=>process.env[k]}});vi.stubGlobal("fetch",upstream);vi.spyOn(console,"log").mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();upstream.mockReset();});
const reply=(plan:unknown)=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(plan)}}]}),{status:200,headers:{"Content-Type":"application/json"}});
const request=(image:boolean)=>{const f=new FormData();f.set("text","孤立双星绕共同质心做圆周运动，请保留题给质量与星间距");if(image){const png=readFileSync(new URL("../../../fixtures/binary-circular-orbit.png",import.meta.url));f.set("image",new Blob([png],{type:"image/png"}),"synthetic.png");}return new Request("http://local/api/animation/plan",{method:"POST",body:f});};
describe("双星：Node/Qoder标准入口（模拟上游，不计真实识图）",()=>{
 for(const image of [false,true])it(`${image?"图片multipart":"文字"}两端同源回包并重装配为两星`,async()=>{
  const plan=JSON.parse(readFileSync(new URL("../../../fixtures/binary-circular-orbit.reading.json",import.meta.url),"utf8"));upstream.mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(plan));
  const a=await (await handlePlan(request(image))).json(),b=await (await handler(request(image))).json();expect(a.status).toBe("ok");expect(b).toEqual(a);
  const built=assembleStageScene(a.reading);expect(built.ok).toBe(true);if(built.ok)expect(Object.keys(built.scene.motion.sampleAt(0).bodies!)).toEqual(["star1","star2"]);
 });
 it("缺质量比时返回总质量与缺项，题给周期保留供改值重算",async()=>{
  const plan={kind:"stage_plan",schemaVersion:1,stages:[{kind:"binary_circular_orbit",separationM:8e8,periodSeconds:86400}]};upstream.mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(plan));
  const a=await (await handlePlan(request(false))).json(),b=await (await handler(request(false))).json();expect(a.status).toBe("needs_input");expect(b).toEqual(a);expect(a.reading.stages[0].totalMassKg).toBeGreaterThan(0);expect(a.missingKeys).toContain("/stages/0/massRatioM1OverM2");expect(a.reading.derivedCalculations[0].rule).toBe("binary_period_mass");
 });
});
