import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePlan } from '../plan';
import { handler } from '../../../functions/handler';
import { motionLibrary } from '../../adapters';
import full from '../../../fixtures/precompressed-spring-complete.reading.json';
import critical from '../../../fixtures/precompressed-spring-critical.reading.json';
import fixed from '../../../fixtures/precompressed-spring-fixed-energy.reading.json';
describe.each([['Node', handlePlan], ['Qoder', handler]] as const)('%s 预压题正常图文入口', (_name, entry) => {
  const upstream = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubEnv('DASHSCOPE_API_KEY', 'mock-only'); vi.stubEnv('DASHSCOPE_FALLBACK_MODEL', ''); vi.stubEnv('API_CONTRACT_MODE', 'stage_plan');
    vi.stubGlobal('Deno', { env: { get: (key: string) => process.env[key] } }); vi.stubGlobal('fetch', upstream); vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { upstream.mockReset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  for (const image of [false, true]) it.each([['full', full], ['suffix', critical]] as const)(`%s ${image ? '图文' : '文字'}使用共享能量校验`, async (mode, reading) => {
    upstream.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(reading) } }] }));
    const form = new FormData(); form.set('text', '预压弹簧题');
    if (image) form.set('image', new Blob([new Uint8Array([137,80,78,71,13,10,26,10])], { type: 'image/png' }), 'fixture.png');
    const response = await entry(new Request('http://localhost/api/animation/plan', { method: 'POST', body: form }));
    const body = await response.json(); expect(response.status).toBe(200); expect(body.status).toBe('ok');
    expect(body.reading.energy.elasticEnergyJ).toBeCloseTo(1.4, 12); expect(body.reading.constraints).toBeUndefined();
    const scene = motionLibrary.assembleScene(body.reading); if (!scene.ok) throw Error(JSON.stringify(scene.errors));
    const built = motionLibrary.buildMotion(scene.scene); if (!built.ok) throw Error(built.message);
    expect(built.motion.timing?.mode).toBe(mode);
    expect(body.message).toContain(mode === 'suffix' ? 'B点' : 'A点');
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it('缺参静止范围提示来自共享结果', async () => {
    const p = structuredClone(fixed); p.stages[1].end!.distanceM = 8;
    upstream.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(p) } }] }));
    const form = new FormData(); form.set('text', '静止位置');
    const body = await (await entry(new Request('http://localhost/api/animation/plan', { method:'POST', body:form }))).json();
    expect(body.status).toBe('ok'); expect(body.message).toContain('用时未知');
  });
});
