import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePlan } from '../plan';
import { handler } from '../../../functions/handler';
import { motionLibrary } from '../../adapters';
import { truncateStagePlan } from '../../physics';
import type { StagePlanDraft } from '../../physics';
import { PHYSICS_RAG_CORPUS } from '../../rag/corpus';
import complete from '../../../fixtures/incline-projectile.reading.json';
import plane from '../../../fixtures/incline-projectile-fixed-plane.reading.json';
import stopBefore from '../../../fixtures/incline-projectile-stop-before.reading.json';
import stopAt from '../../../fixtures/incline-projectile-stop-at.reading.json';
import table from '../../../fixtures/stage-composition.reading.json';
import arc from '../../../fixtures/vertical-arc-composition.reading.json';

function build(reading: StagePlanDraft) {
  const a = motionLibrary.assembleScene(reading); if (!a.ok) throw Error(JSON.stringify(a.errors));
  const b = motionLibrary.buildMotion(a.scene); if (!b.ok) throw Error(b.message);
  return b.motion;
}
describe.each([['Node', handlePlan], ['Qoder', handler]] as const)('%s 斜面直接斜抛正常入口', (_name, entry) => {
  const upstream = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubEnv('DASHSCOPE_API_KEY', 'mock-only'); vi.stubEnv('DASHSCOPE_FALLBACK_MODEL', '');
    vi.stubEnv('API_CONTRACT_MODE', 'stage_plan');
    vi.stubGlobal('Deno', { env: { get: (key: string) => process.env[key] } });
    vi.stubGlobal('fetch', upstream); vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { upstream.mockReset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  async function recognize(raw: unknown, image: boolean) {
    upstream.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(raw) } }] }));
    const form = new FormData(); form.set('text', '积雪沿斜面切向离开檐口，题给檐口到地面高度');
    // 合成PNG头只验证上传分派，不代表真实模型能识别题图。
    if (image) form.set('image', new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 'synthetic.png');
    const response = await entry(new Request('http://localhost/api/animation/plan', { method: 'POST', body: form }));
    return { response, body: await response.json() };
  }
  for (const image of [false, true]) {
    it.each([[complete, 'landed'], [plane, 'landed'], [stopBefore, 'stop_before_target'], [stopAt, 'stop_at_target']] as const)(`${image ? '图文' : '文字'}完整/停止回包可由工作区入口播放`, async (reading, reason) => {
      const { response, body } = await recognize(reading, image);
      expect(response.status).toBe(200); expect(body.status).toBe('ok');
      expect(body.reading.stages.map((s: { kind: string }) => s.kind)).toEqual(['incline_slide', 'projectile']);
      const m = build(body.reading); expect(m.endReason).toBe(reason);
      expect(m.events.some(e => e.eventKind === 'leave_table' || e.eventKind === 'lossless_turn')).toBe(false);
      expect(upstream).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(String(upstream.mock.calls[0][1]?.body)), skill = sent.messages[0].content[0].text;
      expect(skill).toContain('檐口离地1.95'); expect(skill).toContain('INCLINE_PROJECTILE.md');
      expect(skill).not.toContain('斜面直接接抛体（中间缺水平段）');
      expect(skill).not.toContain('斜面直接接抛体或直接接弹簧');
    });
    it(`${image ? '图文' : '文字'}缺檐口高度只补该项即可重建`, async () => {
      const p = structuredClone(complete) as StagePlanDraft; p.stages[1].dropHeightM = null;
      const { body } = await recognize(p, image);
      expect(body.status).toBe('needs_input'); expect(body.missingKeys).toEqual(['/stages/1/dropHeightM']);
      expect(body.reading.stages[0]).toEqual(p.stages[0]);
      body.reading.stages[1].dropHeightM = 1.95;
      expect(build(body.reading).durationSeconds).toBeCloseTo(1.3928203230275509, 12);
      expect(upstream).toHaveBeenCalledTimes(1);
    });
  }
  it('同一足够长粗糙斜面用一段上滑计划播放折返，母题提示与 Skill 一致', async () => {
    const source = PHYSICS_RAG_CORPUS.find(item => item.id === 'gk-incline-up-return-asymmetric-05')!;
    const raw = {
      kind: 'stage_plan', schemaVersion: 1, gravityMps2: 10, massKg: 1,
      initial: { speedMps: 8 },
      stages: [{
        kind: 'incline_slide', direction: 'up', lengthM: null, angleDeg: Math.atan2(3, 4) * 180 / Math.PI,
        kineticFrictionCoefficient: 0.25, staticFrictionCoefficient: 0.25,
      }],
    };
    upstream.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(raw) } }] }));
    const form = new FormData(); form.set('text', source.stem);
    const response = await entry(new Request('http://localhost/api/animation/plan', { method: 'POST', body: form }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.reading.stages.map((stage: { kind: string }) => stage.kind)).toEqual(source.stageSignature);
    const motion = build(body.reading);
    expect(motion.segments.map(({ kind }) => kind)).toEqual(['incline']);
    expect(motion.events.map(({ eventKind }) => eventKind)).toEqual(['release', 'incline_turn', 'reach_bottom']);
    expect(motion.durationSeconds).toBeCloseTo(1 + Math.SQRT2, 12);
    const apex = motion.sampleAt(1);
    expect(Math.hypot(apex.position.x, apex.position.y)).toBeCloseTo(4, 12);
    const end = motion.sampleAt(motion.durationSeconds);
    expect(end.position).toEqual({ x: 0, y: 0 });
    expect(Math.hypot(end.velocity.x, end.velocity.y)).toBeCloseTo(4 * Math.SQRT2, 12);
    expect(source.planHint).toContain("direction:'up'");
    expect(source.planHint).not.toContain('->');
    const messages = JSON.parse(String(upstream.mock.calls[0][1]?.body)).messages;
    expect(messages[0].content[0].text).toContain('整段只输出一个 `incline_slide`');
    expect(messages[1].content.map((part: { text: string }) => part.text).join(' ')).toContain(source.planHint);
  });

  it('真实指令分派截到斜面，保留斜向末速度且不调用模型', async () => {
    const form = new FormData(); form.set('command', '只看斜面'); form.set('currentPlan', JSON.stringify(complete));
    const response = await entry(new Request('http://localhost/api/animation/plan', { method: 'POST', body: form }));
    const body = await response.json(); expect(body.intent).toEqual({ type: 'truncate_stages', throughStageIndex: 0 });
    const m = build(truncateStagePlan(complete as StagePlanDraft, body.intent.throughStageIndex));
    expect(m.endReason).toBe('prefix_end'); expect(m.sampleAt(Infinity).velocity.y).toBeCloseTo(-3, 12);
    expect(m.events.map(e => e.eventKind)).toEqual(['release', 'reach_bottom']);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([table, arc])('旧桌面平抛和圆弧后抛体仍经过相同handler与适配器', async raw => {
    const { response, body } = await recognize(raw, false);
    expect(response.status).toBe(200); expect(body.status).toBe('ok');
    const m = build(body.reading); expect(m.endReason).toBe('landed');
    expect(m.events.some(e => e.label === '离开檐口')).toBe(false);
  });
});
