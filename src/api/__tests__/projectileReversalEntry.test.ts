import {describe,it,expect,beforeEach,afterEach,vi} from "vitest";
import {readFileSync} from "node:fs";
import {handlePlan} from "../plan.ts";
import {handler} from "../../../functions/handler.ts";
import {assembleScene,buildMotion} from "../../physics/index.ts";
const upstream=vi.fn<typeof fetch>();
beforeEach(()=>{vi.stubEnv("DASHSCOPE_API_KEY","mock-only");vi.stubEnv("DASHSCOPE_FALLBACK_MODEL","");vi.stubEnv("API_CONTRACT_MODE","stage_plan");vi.stubGlobal("Deno",{env:{get:(k:string)=>process.env[k]}});vi.stubGlobal("fetch",upstream);vi.spyOn(console,"log").mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();upstream.mockReset();});
describe("等速反向：Node与云函数同源入口（模拟上游）",()=>{
 it("保留明确反向条件并由公开运动入口求冲量",async()=>{
  const p=JSON.parse(readFileSync(new URL("../../../fixtures/projectile-reversal.reading.json",import.meta.url),"utf8"));
  const response=()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(p)}}]}),{status:200,headers:{"Content-Type":"application/json"}});
  upstream.mockResolvedValueOnce(response()).mockResolvedValueOnce(response());
  const request=()=>{const f=new FormData();f.set("text","小球平抛到指定高度后总速度等大反向，观察到碰后瞬间");return new Request("http://local/api/animation/plan",{method:"POST",body:f});};
  const a=await (await handlePlan(request())).json(),b=await (await handler(request())).json();expect(a.status).toBe("ok");expect(b).toEqual(a);expect(a.reading.stages[0].reversal).toEqual(p.stages[0].reversal);
  const scene:any=assembleScene(a.reading);expect(scene.ok).toBe(true);const motion:any=buildMotion(scene.scene).motion;expect(motion.events.at(-1).impulseNs.magnitudeNs).toBeCloseTo(Math.sqrt(52),10);
 });
});
