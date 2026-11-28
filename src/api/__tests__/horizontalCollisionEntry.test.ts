import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {handlePlan} from '../plan';
import {handler} from '../../../functions/handler';
import {motionLibrary} from '../../adapters';
import {truncateStagePlan} from '../../physics';
import type {StagePlanDraft} from '../../physics';
import pendulum from '../../../fixtures/pendulum-elastic.reading.json';
import incline from '../../../fixtures/stage-composition.reading.json';
import pendulumSceneEnd from '../../../fixtures/pendulum-scene-end.reading.json';
const read=(name:string)=>JSON.parse(readFileSync(new URL(`../../../fixtures/horizontal-collision-${name}.reading.json`,import.meta.url),'utf8'));
const build=(p:StagePlanDraft)=>{const a=motionLibrary.assembleScene(p);if(!a.ok)throw Error(JSON.stringify(a.errors));const b=motionLibrary.buildMotion(a.scene);if(!b.ok)throw Error(b.message);return b.motion;};
describe.each([['Node',handlePlan],['Qoder',handler]] as const)('%s水平正碰正常图文入口',(_name,entry)=>{
 const upstream=vi.fn<typeof fetch>();
 beforeEach(()=>{vi.stubEnv('DASHSCOPE_API_KEY','mock-only');vi.stubEnv('DASHSCOPE_FALLBACK_MODEL','');vi.stubEnv('API_CONTRACT_MODE','stage_plan');vi.stubGlobal('Deno',{env:{get:(key:string)=>process.env[key]}});vi.stubGlobal('fetch',upstream);vi.spyOn(console,'log').mockImplementation(()=>{});});
 afterEach(()=>{upstream.mockReset();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
 async function recognize(input:unknown,image=false){upstream.mockResolvedValueOnce(Response.json({choices:[{message:{content:JSON.stringify(input)}}]}));const form=new FormData();form.set('text','两个质点由题给初位、带方向初速开始水平运动，按题设碰撞');if(image)form.set('image',new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'}),'synthetic.png');const r=await entry(new Request('http://localhost/api/animation/plan',{method:'POST',body:form}));return{response:r,body:await r.json()};}
 for(const image of [false,true])it.each(['elastic','sticky','catch-after-stop','no-contact','slides','flight','pendulum'])(`${image?'图文':'文字'} %s正常回包由共享入口可装配`,async name=>{
  const p=read(name),{response,body}=await recognize(p,image);expect(response.status).toBe(200);expect(body.status).toBe('ok');expect(body.reading.initial).toEqual(p.initial);const m=build(body.reading);expect(m.sampleAt(0).bodies).toBeDefined();if(name==='flight')expect(m.sampleAt(Infinity).bodies!.two.status).toBe('landed');if(name==='no-contact')expect(m.events.some(e=>e.eventKind==='collision')).toBe(false);
  const payload=JSON.parse(String(upstream.mock.calls[0][1]?.body));expect(payload.messages[0].content[0].text).toContain('HORIZONTAL_COLLISION.md');expect(payload.messages[0].content[0].text).toContain('horizontal_meeting');expect(upstream).toHaveBeenCalledTimes(1);
 });
 it('光滑反弹与另一体离桌、落地使用同一物理时钟',async()=>{
  const {body}=await recognize(read('scene-end'),true);
  expect(body.status).toBe('ok');
  const motion=build(body.reading);
  const launch=motion.events.find(e=>e.eventKind==='leave_table')!;
  const land=motion.events.find(e=>e.eventKind==='land')!;
  expect(launch.timeSeconds).toBeCloseTo(0.4,10);
  expect(land.timeSeconds).toBeCloseTo(0.9,10);
  expect(motion.durationSeconds).toBe(land.timeSeconds);
  const launchBodies=motion.sampleAt(launch.timeSeconds).bodies!;
  const end=motion.sampleAt(Infinity).bodies!;
  expect(end.two.position.x-launchBodies.two.position.x).toBeCloseTo(2,10);
  expect(end.two.status).toBe('landed');
  expect(end.one.position.x).toBeCloseTo(-0.2,10);
  expect(end.one.velocity.x).toBeCloseTo(-2,10);
  expect(end.one.status).toBe('moving');
  expect(motion.events.some(e=>e.eventKind==='stop')).toBe(false);
  expect(upstream).toHaveBeenCalledTimes(1);
 });
 it('摆锤首转折结束时水平目标仍匀速运动',async()=>{
  const {body}=await recognize(pendulumSceneEnd);
  expect(body.status).toBe('ok');
  const motion=build(body.reading);
  const end=motion.sampleAt(Infinity).bodies!;
  expect(motion.durationSeconds).toBeCloseTo(0.983654,6);
  expect(motion.events[motion.events.length-1]?.eventKind).toBe('pendulum_turn');
  expect(end.bob.position.y).toBeCloseTo(0.2,10);
  expect(end.bob.status).toBe('turning');
  expect(end.target.position.x).toBeCloseTo(0.918485,6);
  expect(end.target.velocity.x).toBeCloseTo(2,10);
  expect(upstream).toHaveBeenCalledTimes(1);
 });
 it.each([
  ['两个光滑水平跟随轨道',()=>{const p=read('scene-end');p.stages[2].tracks[1].stages=structuredClone(p.stages[2].tracks[0].stages);return p;}],
  ['摆和光滑水平轨道都跟随',()=>{const p=structuredClone(pendulumSceneEnd);p.stages[2].end!.kind='all_finite_tracks';return p;}],
 ])('%s须明确共同终点',async(_title,plan)=>{
  const {body}=await recognize(plan());
  expect(body.status).toBe('needs_input');
  expect(body.missingKeys).toContain('/stages/2/end');
  expect(upstream).toHaveBeenCalledTimes(1);
 });
 it('缺初位只补对应字段，不调用第二次模型识别',async()=>{const p=read('elastic');p.initial.bodies[1].xM=null;const{body}=await recognize(p,true);expect(body.status).toBe('needs_input');expect(body.missingKeys).toEqual(['/initial/bodies/1/xM']);body.reading.initial.bodies[1].xM=6;expect(build(body.reading).events.some(e=>e.eventKind==='collision')).toBe(true);expect(upstream).toHaveBeenCalledTimes(1);});
 it.each([['只看碰前',0],['只看碰撞前',0],['只看正碰前',0],['只看接近阶段',0],['只看碰撞',1],['只看碰撞前',1,pendulum],['只看斜面',0,incline]] as const)('真实命令%s保留正确前缀',async(command,index,given?)=>{
  const p=(given??read('elastic')) as StagePlanDraft,form=new FormData();form.set('command',command);form.set('currentPlan',JSON.stringify(p));const r=await entry(new Request('http://localhost/api/animation/plan',{method:'POST',body:form})),body=await r.json();expect(body.intent).toEqual({type:'truncate_stages',throughStageIndex:index});const m=build(truncateStagePlan(p,index));if(!given)expect(m.events.some(e=>e.eventKind==='collision')).toBe(index===1);expect(upstream).not.toHaveBeenCalled();
 });
 it('共有桌沿矛盾走字段错误，不假装识别坏结构而重试',async()=>{vi.stubEnv('VISION_REPAIR_RETRY','0');const p=read('flight');p.bodies[0].massKg=3;p.bodies[1].massKg=1;const{body}=await recognize(p);expect(body.status).toBe('needs_input');expect(body.fieldErrors).toEqual(expect.arrayContaining([expect.objectContaining({path:'/stages/2/tracks/0/stages/0'})]));expect(upstream).toHaveBeenCalledTimes(1);});
});
