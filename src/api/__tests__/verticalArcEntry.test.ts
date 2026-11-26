import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePlan } from '../plan';
import { handler } from '../../../functions/handler';
import { motionLibrary } from '../../adapters';
import endpoint from '../../../fixtures/vertical-arc-endpoint.reading.json';
import loss from '../../../fixtures/vertical-arc-contact-loss.reading.json';
import returning from '../../../fixtures/vertical-arc-return.reading.json';
import composition from '../../../fixtures/vertical-arc-composition.reading.json';

describe.each([['Node', handlePlan], ['Qoder', handler]] as const)('%s 圆弧正常识别入口', (_name, entry) => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubEnv('DASHSCOPE_API_KEY', 'mock-only'); vi.stubEnv('DASHSCOPE_VISION_MODEL', 'mock-model');
    vi.stubEnv('DASHSCOPE_FALLBACK_MODEL', ''); vi.stubEnv('API_CONTRACT_MODE', 'stage_plan');
    vi.stubGlobal('Deno', { env: { get: (key: string) => process.env[key] } });
    vi.stubGlobal('fetch', fetchMock); vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { fetchMock.mockReset(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it.each([
    ['到端点', endpoint, 'landed'], ['提前脱轨', loss, 'landed'],
    ['回滑', returning, 'returned_to_entry'], ['水平组合', composition, 'landed'],
  ] as const)('%s 模型回包经真实校验和播放器入口可播放', async (_label, raw, reason) => {
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(raw) } }] }));
    const form = new FormData(); form.set('text', '共享圆弧题');
    const response = await entry(new Request('http://localhost/api/animation/plan', { method: 'POST', body: form }));
    expect(response.status).toBe(200);
    const result = await response.json(); expect(result.status).toBe('ok');
    const scene = motionLibrary.assembleScene(result.reading); if (!scene.ok) throw new Error(JSON.stringify(scene.errors));
    const built = motionLibrary.buildMotion(scene.scene); if (!built.ok) throw new Error(built.message);
    expect(built.motion.endReason).toBe(reason);
    expect(built.motion.stageGeometry?.verticalArc).toBeDefined();
    expect(built.motion.sampleAt(0).constraint?.normalForceN ?? built.motion.sampleAt(.5).constraint?.normalForceN).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).messages[0].content[0].text).toContain('vertical_arc');
  });

  it('缺半径保留草稿与路径，不误报超范围', async () => {
    const input = structuredClone(endpoint); input.stages[0].radiusM = null as never;
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(input) } }] }));
    const form = new FormData(); form.set('text', '圆弧半径未给');
    const response = await entry(new Request('http://localhost/api/animation/plan', { method: 'POST', body: form }));
    expect(await response.json()).toMatchObject({ status: 'needs_input', missingKeys: ['/stages/0/radiusM'], reading: { stages: [{ kind: 'vertical_arc', radiusM: null }, { kind: 'projectile', landingPlaneYM: 0 }] } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    '小球固定在长 0.4 m 的理想轻杆上，绕固定轴在竖直平面转动',
    '小球沿半径为 0.4 m 的双面光滑圆管在竖直平面运动',
  ])('%s：按双向约束播放，最高点保持约束', async (stem) => {
    const rodRaw = {
      kind: 'stage_plan', schemaVersion: 1, gravityMps2: 10, massKg: 0.1,
      initial: { speedMps: Math.sqrt(18) },
      stages: [{ kind: 'vertical_arc', radiusM: 0.4, endAngleDeg: 180, side: 'rod', frictionless: true }],
    };
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(rodRaw) } }] }));
    const form = new FormData(); form.set('text', `${stem}。质量 0.1 kg，从最低点沿切线以 √18 m/s 入射，g=10 m/s²，求到半圆最高点时受到的径向力。`);
    const response = await entry(new Request('http://localhost/api/animation/plan', { method: 'POST', body: form }));
    expect(response.status).toBe(200);
    const result = await response.json(); expect(result.status).toBe('ok');
    const scene = motionLibrary.assembleScene(result.reading); if (!scene.ok) throw new Error(JSON.stringify(scene.errors));
    const built = motionLibrary.buildMotion(scene.scene); if (!built.ok) throw new Error(built.message);
    expect(built.motion.stageGeometry?.verticalArc?.side).toBe('rod');
    expect(built.motion.events.some(e => e.id.includes('arc_contact_lost'))).toBe(false);
    expect(built.motion.events.find(e => e.id.includes('arc_endpoint'))?.normalForceBeforeN).toBeCloseTo(-0.5, 6);
    const skill = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).messages[0].content[0].text;
    expect(skill).toContain('双面光滑且固定半径的圆管或等效双轨');
    expect(skill).toContain('外侧单面凸轨、粗糙圆弧');
    expect(skill).not.toContain('外侧、双面卡槽或粗糙圆弧暂不支持');
  });

  it('单面凸轨仍由共享校验判为超范围', async () => {
    const raw = {
      kind: 'stage_plan', schemaVersion: 1, gravityMps2: 10, massKg: 0.1,
      initial: { speedMps: 2 },
      stages: [{ kind: 'vertical_arc', radiusM: 0.4, endAngleDeg: 90, side: 'outside', frictionless: true }],
    };
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(raw) } }] }));
    const form = new FormData(); form.set('text', '小球从光滑单面圆弧凸轨的外侧顶部滑下。');
    const response = await entry(new Request('http://localhost/api/animation/plan', { method: 'POST', body: form }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'unsupported' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
