import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePlan } from '../plan';
import { handler as qoderHandler } from '../../../functions/handler';

function chatRequest(message: string, context?: unknown, extra?: Record<string, string | Blob>) {
  const form = new FormData();
  form.append('chatMessage', message);
  if (context !== undefined) form.append('chatContext', typeof context === 'string' ? context : JSON.stringify(context));
  for (const [k, v] of Object.entries(extra ?? {})) form.append(k, v);
  return new Request('http://127.0.0.1:8787/functions/v1/app', { method: 'POST', body: form });
}

describe('真实 AI 物理助教对话入口（Node 与 Qoder 双端一致）', () => {
  const originalKey = process.env.DASHSCOPE_API_KEY;
  const originalModel = process.env.DASHSCOPE_VISION_MODEL;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    process.env.DASHSCOPE_API_KEY = 'test-tutor-key';
    process.env.DASHSCOPE_VISION_MODEL = 'deepseek-chat';
    vi.stubGlobal('Deno', { env: { get: (key: string) => process.env[key] } });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.DASHSCOPE_VISION_MODEL;
    else process.env.DASHSCOPE_VISION_MODEL = originalModel;
    vi.unstubAllGlobals();
  });

  it.each([
    ['Node handlePlan', handlePlan],
    ['Qoder handler', qoderHandler],
  ])('%s 透传真实物理上下文与历史记录，返回 200 ok 及助教回答', async (_name, fn) => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '在最高点 E 处支持力 N = 0，重力完全提供向心力：mg = mv²/R，因此 v_E = √(gR)。' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const req = chatRequest('为什么最高点 E 的支持力是 0？', {
      problemText: '质量 m=2kg 滑块平抛入弧后进入圆轨道 DE...',
      currentTimeSeconds: 2.85,
      events: [{ timeSeconds: 2.8471, label: '经过圆轨最高点', normalForceAfterN: 0 }],
      history: [{ role: 'user', text: '这题分几段？' }, { role: 'assistant', text: '共 4 段。' }],
    });

    const res = await fn(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; reply: string };
    expect(body.status).toBe('ok');
    expect(body.reply).toContain('mg = mv²/R');

    expect(fetchMock).toHaveBeenCalledOnce();
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(sent.messages[0].role).toBe('system');
    expect(sent.messages[0].content).toContain('经过圆轨最高点');
    expect(sent.messages.slice(1).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(sent.messages[sent.messages.length - 1].content).toBe('为什么最高点 E 的支持力是 0？');
  });

  it('空提问或混用图片字段时返回 400', async () => {
    const emptyRes = await handlePlan(chatRequest('   '));
    expect(emptyRes.status).toBe(400);

    const mixedRes = await handlePlan(
      chatRequest('讲一下这题', undefined, { image: new Blob(['abc'], { type: 'image/png' }) }),
    );
    expect(mixedRes.status).toBe(400);
  });
});
