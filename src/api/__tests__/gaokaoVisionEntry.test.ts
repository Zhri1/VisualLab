import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { handlePlan } from '../plan';
import { handler } from '../../../functions/handler';
import { SKILL_TEXT } from '../../../functions/skill';

const ROOT = resolve(__dirname, '../../..');
const readFixture = (name: string) =>
  JSON.parse(readFileSync(resolve(ROOT, 'fixtures', name), 'utf8'));

const answer = (payload: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

function makeRequest(text = '高考多过程力学题') {
  const form = new FormData();
  form.set('text', text);
  return new Request('http://local/api/animation/plan', { method: 'POST', body: form });
}

describe.each([
  ['Node', handlePlan],
  ['Qoder', handler],
] as const)('%s 识图链路升级（max_tokens 扩容 + 定向自修正重试）', (_name, entry) => {
  const upstream = vi.fn<typeof fetch>();

  beforeEach(() => {
    upstream.mockReset();
    vi.stubEnv('DASHSCOPE_API_KEY', 'mock-only');
    vi.stubEnv('DASHSCOPE_VISION_MODEL', 'mock-model');
    vi.stubEnv('DASHSCOPE_FALLBACK_MODEL', '');
    vi.stubEnv('API_CONTRACT_MODE', 'stage_plan');
    vi.stubGlobal('Deno', { env: { get: (k: string) => process.env[k] } });
    vi.stubGlobal('fetch', upstream);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('默认 max_tokens 扩容为 2048，且支持 VISION_MAX_TOKENS 环境变量覆盖', async () => {
    const valid = readFixture('vertical-arc-endpoint.reading.json');
    upstream.mockResolvedValueOnce(answer(valid));
    const res1 = await entry(makeRequest());
    expect(res1.status).toBe(200);
    const body1 = JSON.parse(String(upstream.mock.calls[0][1]?.body));
    expect(body1.max_tokens).toBe(2048);

    upstream.mockReset();
    vi.stubEnv('VISION_MAX_TOKENS', '3072');
    upstream.mockResolvedValueOnce(answer(valid));
    const res2 = await entry(makeRequest());
    expect(res2.status).toBe(200);
    const body2 = JSON.parse(String(upstream.mock.calls[0][1]?.body));
    expect(body2.max_tokens).toBe(3072);
  });

  it('首次输出含 fieldErrors 冲突时，携带 repairContext 发起 1 次定向修正并返回 200 ok', async () => {
    const valid = readFixture('constant-force-benchmark.reading.json');
    const conflict = structuredClone(valid);
    // 末段 end.kind = "stop" 但合力同向为正，触发 PRECONDITION_CONFLICT
    conflict.stages[1].netForceXN = 2;

    upstream.mockResolvedValueOnce(answer(conflict)).mockResolvedValueOnce(answer(valid));
    const res = await entry(makeRequest('2kg物体先受4N作用2s再受-2N直至静止'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(upstream).toHaveBeenCalledTimes(2);

    const retryPayload = JSON.parse(String(upstream.mock.calls[1][1]?.body));
    const retryUserTexts = retryPayload.messages[1].content
      .filter((part: { type?: string }) => part.type === 'text')
      .map((part: { text?: string }) => part.text ?? '')
      .join('\n');
    expect(retryUserTexts).toContain('上一次输出的 JSON');
    expect(retryUserTexts).toContain('PRECONDITION_CONFLICT');
    expect(retryUserTexts).toContain('/stages/1/end');
  });

  it('首次输出为 invalid_reading（502）时，携带 repairContext 修正成功返回 200 ok', async () => {
    const valid = readFixture('circular-track-critical.reading.json');
    const broken = structuredClone(valid);
    broken.stages[0].path.end.kind = true;

    upstream.mockResolvedValueOnce(answer(broken)).mockResolvedValueOnce(answer(valid));
    const res = await entry(makeRequest('光滑整圆轨道'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(upstream).toHaveBeenCalledTimes(2);

    const retryPayload = JSON.parse(String(upstream.mock.calls[1][1]?.body));
    const retryText = retryPayload.messages[1].content
      .filter((part: { type?: string }) => part.type === 'text')
      .map((part: { text?: string }) => part.text ?? '')
      .join('\n');
    expect(retryText).toContain('INVALID_READING');
  });

  it('首次为 needs_input（带 fieldErrors）且第 2 次纠错请求异常时，降级保留首次 200 needs_input', async () => {
    const conflict = readFixture('constant-force-benchmark.reading.json');
    conflict.stages[1].netForceXN = 2;

    upstream
      .mockResolvedValueOnce(answer(conflict))
      .mockRejectedValueOnce(new Error('network timeout'));
    const res = await entry(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('needs_input');
    expect(body.fieldErrors[0]).toMatchObject({
      path: '/stages/1/end',
      code: 'PRECONDITION_CONFLICT',
    });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('纯题面缺项（fieldErrors 为空、仅有 missingKeys）不浪费额外重试，直接返回 200 needs_input', async () => {
    const missing = readFixture('vertical-arc-endpoint.reading.json');
    missing.stages[0].radiusM = null;

    upstream.mockResolvedValueOnce(answer(missing));
    const res = await entry(makeRequest('圆弧半径未给'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('needs_input');
    expect(body.missingKeys).toEqual(['/stages/0/radiusM']);
    expect(body.fieldErrors).toEqual([]);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('明确超范围（unsupported）不触发额外重试，直接返回 200 unsupported', async () => {
    const unsupported = {
      kind: 'stage_plan',
      schemaVersion: 1,
      gravityMps2: null,
      initial: { speedMps: null },
      stages: [],
      unsupportedReason: '本题为带电粒子在磁场中的偏转，不在力学支持范围内',
      assumptions: [],
    };
    upstream.mockResolvedValueOnce(answer(unsupported));
    const res = await entry(makeRequest('带电粒子在匀强磁场中做圆周运动'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('unsupported');
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});

describe('Skill 文案与 functions/skill.ts 同步及高考多过程规则', () => {
  it('skills/vision-reading.v2.md 与 functions/skill.ts 完全一致且包含路由表与声明式字段', () => {
    const skillSource = readFileSync(resolve(ROOT, 'skills/vision-reading.v2.md'), 'utf8');
    expect(SKILL_TEXT).toBe(skillSource);

    // 快速路由决策表
    expect(skillSource).toContain('快速路由决策表');
    expect(skillSource).toContain('单物体多过程');
    expect(skillSource).toContain('轻绳摆');
    expect(skillSource).toContain('滑块-木板');

    // 高考多过程串联与声明式几何规则
    expect(skillSource).toContain('GAOKAO_MULTI_STAGE.md');
    expect(skillSource).toContain('tangent_to_next_arc');
    expect(skillSource).toContain('verticalDropM');
    expect(skillSource).toContain('critical_arc_top');
    expect(skillSource).toContain('startLabel');
    expect(skillSource).toContain('endLabel');
    expect(skillSource).toContain('应省略 `center`');
  });
});
