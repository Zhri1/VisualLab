import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import complete from '../../../fixtures/stage-composition.reading.json';
import missingDistance from '../../../fixtures/stage-missing-distance.reading.json';
import { handlePlan } from '../plan';
import { handler } from '../../../functions/handler';

const brokenVersion = () => ({ ...structuredClone(complete), schemaVersion: {} });
const brokenEnd = () => {
  const input = structuredClone(complete);
  input.stages[2].end!.kind = true as never;
  return input;
};

function modelResponse(raw: unknown): Response {
  return Response.json({ choices: [{ message: { content: JSON.stringify(raw) } }] });
}

function request(): Request {
  const form = new FormData();
  form.set('text', '斜面接粗糙桌面再平抛');
  form.set('image', new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 'fixture.png');
  return new Request('http://localhost/api/animation/plan', { method: 'POST', body: form });
}

// 只替换模型 HTTP 上游；实际执行两端的解析、共享校验、兼容桥和 HTTP 状态映射。
describe.each([['Node', handlePlan], ['Qoder', handler]] as const)('%s 识别入口结构错误重试', (_name, entry) => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv('DASHSCOPE_API_KEY', 'mock-key');
    vi.stubEnv('DASHSCOPE_BASE_URL', 'https://vision.test/v1');
    vi.stubEnv('DASHSCOPE_VISION_MODEL', 'mock-model');
    vi.stubEnv('DASHSCOPE_FALLBACK_MODEL', '');
    vi.stubEnv('API_CONTRACT_MODE', 'stage_plan');
    vi.stubGlobal('Deno', { env: { get: (key: string) => process.env[key] } });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  for (const [name, broken] of [['schemaVersion 对象', brokenVersion], ['end.kind 布尔值', brokenEnd]] as const) {
    it(`${name} 后得到好结果时成功，且第二次携带定向纠错上下文`, async () => {
      fetchMock.mockResolvedValueOnce(modelResponse(broken())).mockResolvedValueOnce(modelResponse(complete));
      const response = await entry(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: 'ok', reading: {
          kind: 'stage_plan', schemaVersion: 1, gravityMps2: 10,
          initial: complete.initial, stages: complete.stages,
        },
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toBe(fetchMock.mock.calls[0][0]);
      const retryPayload = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
      const retryText = retryPayload.messages[1].content
        .filter((part: { type?: string }) => part.type === 'text')
        .map((part: { text?: string }) => part.text ?? '')
        .join('\n');
      expect(retryText).toContain('INVALID_READING');
      expect(response.headers.get('x-vision-model')).toBe('mock-model');
    });

    it(`${name} 持续两次错误返回502，不再重试`, async () => {
      fetchMock.mockImplementation(async () => modelResponse(broken()));
      const response = await entry(request());
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ status: 'invalid_reading', message: expect.any(String) });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  }

  it.each([
    ['完整计划', complete, 'ok'],
    ['缺距离', missingDistance, 'needs_input'],
    ['版本2', { ...complete, schemaVersion: 2 }, 'unsupported'],
    ['未知结束字符串', (() => {
      const input = structuredClone(complete);
      input.stages[2].end!.kind = 'unknown';
      return input;
    })(), 'unsupported'],
  ] as const)('%s 一次结束', async (_label, raw, status) => {
    fetchMock.mockResolvedValueOnce(modelResponse(raw));
    const response = await entry(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('重试遇到上游鉴权失败时保留502处理', async () => {
    fetchMock.mockResolvedValueOnce(modelResponse(brokenVersion())).mockResolvedValueOnce(new Response('', { status: 401 }));
    const response = await entry(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('鉴权失败') });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('重试超时保留504处理', async () => {
    fetchMock.mockResolvedValueOnce(modelResponse(brokenEnd())).mockRejectedValueOnce(new DOMException('timeout', 'AbortError'));
    const response = await entry(request());
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('超时') });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
