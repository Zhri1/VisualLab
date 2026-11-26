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

  it.each([
    ['Node handlePlan', handlePlan],
    ['Qoder handler', qoderHandler],
  ])('%s 兼容推理模型空 content 回退 reasoning_content', async (_name, fn) => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: null, reasoning_content: '由机械能守恒可得底端速度 v = √(2gR)。' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const res = await fn(chatRequest('底端速度怎么求？', { currentTimeSeconds: 0.5 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; reply: string };
    expect(body.status).toBe('ok');
    expect(body.reply).toContain('√(2gR)');
  });

  it.each([
    ['Node handlePlan', handlePlan],
    ['Qoder handler', qoderHandler],
  ])('%s 过滤模型返回的字面 NULL 并自动重试恢复', async (_name, fn) => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'NULL' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '水平方向不受外力，因此系统水平动量守恒。' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const res = await fn(chatRequest('这题为什么动量守恒？', { currentTimeSeconds: 0.2 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; reply: string };
    expect(body.status).toBe('ok');
    expect(body.reply).toContain('水平动量守恒');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['Node handlePlan', handlePlan],
    ['Qoder handler', qoderHandler],
  ])('%s 支持 chatMode=similar 返回结构化相似变式题', async (_name, fn) => {
    const mockSimilarJson = JSON.stringify({
      summary: '结合当前可动圆弧槽模型，推荐 2 道动量与能量守恒变式题：',
      similarProblems: [
        {
          title: '可动圆弧槽反冲变式',
          tags: ['动量守恒', '机械能守恒'],
          difficulty: '中档',
          stem: '质量 M=3kg 半径 R=0.8m 光滑四分之一圆弧槽静置光滑地面，m=1kg 小球从槽顶静止释放，g=10m/s²。',
          focus: '改变质量比观察反冲速度分配。',
          hint: '水平动量守恒 mv₁ = Mv₂，结合机械能守恒 mgR = ½mv₁² + ½Mv₂²。',
        },
        {
          title: '自由弹簧双球碰撞变式',
          tags: ['动量守恒', '弹簧弹性势能'],
          difficulty: '拔高',
          stem: '光滑水平面上 m₁=1kg 以 6m/s 撞向静止 m₂=2kg 所连自由弹簧 k=150N/m，g=10m/s²。',
          focus: '从圆弧反冲迁移到弹簧共速最大弹性势能。',
          hint: '共速 v共 = m₁v₀/(m₁+m₂)，Ep_max = ½m₁v₀² - ½(m₁+m₂)v共²。',
        },
      ],
    });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${mockSimilarJson}\n\`\`\`` } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const res = await fn(chatRequest('推荐几道相似题', { currentTimeSeconds: 0 }, { chatMode: 'similar' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; reply: string; similarProblems: Array<{ title: string; stem: string }> };
    expect(body.status).toBe('ok');
    expect(body.similarProblems).toHaveLength(2);
    expect(body.similarProblems[0].title).toBe('可动圆弧槽反冲变式');
    expect(body.similarProblems[1].stem).toContain('k=150N/m');
  });

  it('Node 与 Qoder 双端 similar 系统提示词一致，并包含模型白名单与空间几何防冲突硬约束', async () => {
    const prompts: string[] = [];
    for (const fn of [handlePlan, qoderHandler]) {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: '推荐 1 道变式题',
                    similarProblems: [
                      {
                        title: '斜面下滑接水平平抛',
                        tags: ['斜面', '平抛'],
                        difficulty: '中档',
                        stem: '质量 m = 1 kg 滑块从倾角 30°、长 2 m 光滑斜面下滑，经底端无损转向在光滑水平面滑行 1 m 后从高 1.25 m 桌沿水平飞出，g = 10 m/s²。',
                        focus: '衔接斜面与平抛。',
                        hint: '先求底端速度再算平抛射程。',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      const res = await fn(chatRequest('推荐相似题', { currentTimeSeconds: 0 }, { chatMode: 'similar' }));
      expect(res.status).toBe(200);
      const sent = JSON.parse(String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1]?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      prompts.push(sent.messages[0].content);
    }

    expect(prompts[0]).toBe(prompts[1]);
    const sys = prompts[0];
    expect(sys).toContain('模型白名单');
    expect(sys).toContain('incline_slide');
    expect(sys).toContain('conveyor_belt');
    expect(sys).toContain('spring_contact');
    expect(sys).toContain('block_plank');
    expect(sys).toContain('pulley_system');
    expect(sys).toContain('严禁非法混拼');
    expect(sys).toContain('严禁空间几何自相矛盾');
    expect(sys).toContain('严禁遗漏必需数值与前提');
  });

  it('空提问或混用图片字段时返回 400', async () => {
    const emptyRes = await handlePlan(chatRequest('   '));
    expect(emptyRes.status).toBe(400);

    const mixedRes = await handlePlan(
      chatRequest('讲一下这题', undefined, { image: new Blob(['abc'], { type: 'image/png' }) }),
    );
    expect(mixedRes.status).toBe(400);
  });

  it('Node 与 Qoder 双端 RAG 助教与相似题注入一致，并回传 ragReferences', async () => {
    const chatContext = {
      problemText: '质量 M = 3 kg、半径 R = 0.6 m 的四分之一光滑圆弧槽静置于光滑水平面，小球 m1 = 1 kg 从槽顶静止滑下后压缩静止小球 m2 所连轻弹簧。',
      reading: {
        kind: 'stage_plan',
        schemaVersion: 1,
        stages: [{ kind: 'movable_arc' }, { kind: 'spring_pair' }],
      },
      currentTimeSeconds: 0.4,
    };

    const tutorSystemPrompts: string[] = [];
    const tutorRefs: unknown[] = [];
    for (const fn of [handlePlan, qoderHandler]) {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '系统仅水平方向合外力为零，因此水平动量守恒，竖直方向不守恒。' } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
      const res = await fn(chatRequest('为什么圆弧槽只有水平动量守恒？', chatContext));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        reply: string;
        ragReferences?: Array<{ id: string; title: string; score: number; matchedReasons: string[] }>;
      };
      expect(body.status).toBe('ok');
      expect(Array.isArray(body.ragReferences)).toBe(true);
      expect(body.ragReferences!.length).toBeGreaterThan(0);
      expect(body.ragReferences![0].score).toBeGreaterThan(0);
      expect(body.ragReferences![0].matchedReasons.some((r) => r.includes('阶段链匹配'))).toBe(true);
      tutorRefs.push(body.ragReferences);

      const sent = JSON.parse(String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1]?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      tutorSystemPrompts.push(sent.messages[0].content);
    }

    expect(tutorSystemPrompts[0]).toBe(tutorSystemPrompts[1]);
    expect(tutorSystemPrompts[0]).toContain('参考高考物理母题知识库');
    expect(tutorSystemPrompts[0]).toContain('核心规律/二级结论');
    expect(tutorRefs[0]).toEqual(tutorRefs[1]);

    // 识图链路：有匹配题面文字时双端注入母题拆段参考，无关文字时不拼接
    const formMatched = new FormData();
    formMatched.append('text', '倾角37°粗糙斜面滑下接光滑水平面压缩轻弹簧，求最大压缩量');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ kind: 'stage_plan', schemaVersion: 1, stages: [], unsupportedReason: '测试' }) } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await handlePlan(new Request('http://127.0.0.1:8787/api/animation/plan', { method: 'POST', body: formMatched }));
    const matchedPayload = JSON.parse(String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1]?.body)) as {
      messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
    };
    const matchedUserText = matchedPayload.messages[1].content.map((c) => c.text ?? '').join('\n');
    expect(matchedUserText).toContain('母题拆段参考');

    const formUnmatched = new FormData();
    formUnmatched.append('text', '有机化学苯环取代反应方程式配平');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ kind: 'stage_plan', schemaVersion: 1, stages: [], unsupportedReason: '测试' }) } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await handlePlan(new Request('http://127.0.0.1:8787/api/animation/plan', { method: 'POST', body: formUnmatched }));
    const unmatchedPayload = JSON.parse(String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1]?.body)) as {
      messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
    };
    const unmatchedUserText = unmatchedPayload.messages[1].content.map((c) => c.text ?? '').join('\n');
    expect(unmatchedUserText).not.toContain('母题拆段参考');
  });
});
