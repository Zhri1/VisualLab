import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {handlePlan} from '../plan';
import {handler} from '../../../functions/handler';
import {assembleScene,buildMotion,truncateStagePlan} from '../../physics';
const read=(name:string)=>JSON.parse(readFileSync(new URL(`../../../fixtures/circular-track-${name}.reading.json`,import.meta.url),'utf8'));
const build=(p:unknown)=>{const a=assembleScene(p);if(!a.ok)throw Error(JSON.stringify(a));if(!('kind'in a.scene))throw Error();return buildMotion(a.scene).motion;};
describe.each([['Node',handlePlan],['Qoder',handler]] as const)('%s圆轨实际图文handler',(_name,entry)=>{
 const upstream=vi.fn<typeof fetch>();
 beforeEach(()=>{vi.stubEnv('DASHSCOPE_API_KEY','mock-only');vi.stubEnv('DASHSCOPE_FALLBACK_MODEL','');vi.stubEnv('API_CONTRACT_MODE','stage_plan');vi.stubGlobal('Deno',{env:{get:(key:string)=>process.env[key]}});vi.stubGlobal('fetch',upstream);vi.spyOn(console,'log').mockImplementation(()=>{});});
 afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();upstream.mockReset();});
 const answer=(p:unknown)=>Response.json({choices:[{message:{content:JSON.stringify(p)}}]});
 async function request(image=false){const form=new FormData();form.set('text','按题给圆心、入口角与切线进入光滑竖直内轨，保留真实端点和观察范围');if(image)form.set('image',new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'}),'synthetic.png');const r=await entry(new Request('http://localhost/api/animation/plan',{method:'POST',body:form}));return{status:r.status,body:await r.json()};}
 for(const image of [false,true])it.each(['critical','below','above','offset','mirrored','observation','incline'])(`${image?'图文':'文字'} %s共享输入`,async name=>{
  const p=read(name);upstream.mockResolvedValueOnce(answer(p));const{status,body}=await request(image);expect(status).toBe(200);expect(body.status).toBe('ok');const m=build(body.reading);
  expect(m.geometry.verticalArc?.center).toEqual(p.stages.find((s:{kind:string})=>s.kind==='vertical_arc').path.center);
  expect(m.events.some(e=>e.kind==='projectile_launch')).toBe(['below','offset','mirrored','incline'].includes(name));
  const payload=JSON.parse(String(upstream.mock.calls[0][1]?.body));expect(payload.messages[0].content[0].text).toContain('CIRCULAR_TRACK.md');expect(payload.messages[0].content[0].text).toContain('physical_endpoint');expect(upstream).toHaveBeenCalledTimes(1);
 });
 it('缺圆心叶子只补该路径即可正常装配，不触发模型重试',async()=>{const p=read('offset');p.stages[0].path.center.xM=null;upstream.mockResolvedValueOnce(answer(p));const{body}=await request(true);expect(body.status).toBe('needs_input');expect(body.missingKeys).toEqual(['/stages/0/path/center/xM']);body.reading.stages[0].path.center.xM=2;expect(build(body.reading).endReason).toBe('landed');expect(upstream).toHaveBeenCalledTimes(1);});
 it.each([['只看圆轨','critical',0],['只看圆弧','incline',1],['只看斜面','incline',0]] as const)('命令%s仍走共享分派',async(command,name,index)=>{
  const p=read(name),form=new FormData();form.set('command',command);form.set('currentPlan',JSON.stringify(p));const r=await entry(new Request('http://localhost/api/animation/plan',{method:'POST',body:form})),body=await r.json();expect(body.intent?.throughStageIndex).toBe(index);const m=build(truncateStagePlan(p,index));expect(m.events.some(e=>e.kind==='projectile_launch')).toBe(false);expect(upstream).not.toHaveBeenCalled();
 });
 it('path判别类型坏返回现有502，修正后可识别；明确超范围200',async()=>{
  const p=read('critical'),bad=structuredClone(p);bad.stages[0].path.end.kind=true;
  // 结构重试属于独立PR #23，本增量沿用当前main的单次识别行为。
  upstream.mockResolvedValueOnce(answer(bad));expect((await request()).status).toBe(502);expect(upstream).toHaveBeenCalledTimes(1);upstream.mockReset();
  upstream.mockResolvedValueOnce(answer(p));expect((await request()).body.status).toBe('ok');expect(upstream).toHaveBeenCalledTimes(1);upstream.mockReset();
  bad.stages[0].path.end.kind='repeat_forever';upstream.mockResolvedValueOnce(answer(bad));expect((await request()).body.status).toBe('unsupported');expect(upstream).toHaveBeenCalledTimes(1);
 });
});
