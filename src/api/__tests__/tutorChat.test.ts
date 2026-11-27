import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePlan } from '../plan';
import { extractTutorReply, parseSimilarResponse } from '../dashscope';
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

  it('similar 模式显式关闭思考链，且思考链不会被当成正文返回', async () => {
    // 线上故障复现：思考链占满 max_tokens，content 为空，reasoning_content 是英文推导稿
    const reasoningOnly = {
      choices: [
        {
          message: {
            content: '',
            reasoning_content: 'We need to produce 2 similar problems. Current problem: incline height 1m...',
          },
        },
      ],
    };
    expect(extractTutorReply(reasoningOnly)).toContain('We need to');
    expect(extractTutorReply(reasoningOnly, { allowReasoningFallback: false })).toBe('');

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
                      title: '斜面弹簧变式',
                      tags: ['动能定理'],
                      difficulty: '基础',
                      stem: '倾角 θ=30° 长 L=2m 粗糙斜面 μ=0.2，底端接光滑水平面并压缩 k=400N/m 弹簧，g=10m/s²。',
                      focus: '改变倾角与摩擦。',
                      hint: 'mgLsinθ - μmgLcosθ = Ep。',
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

    const res = await handlePlan(chatRequest('推荐相似题', { problemText: '斜面下滑压缩弹簧' }, { chatMode: 'similar' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { similarProblems: unknown[] };
    expect(body.similarProblems).toHaveLength(1);

    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { enable_thinking?: boolean };
    expect(sent.enable_thinking).toBe(false);
  });

  it('tutor / socratic 模式不传 enable_thinking，保留原有思考链行为', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: '先看受力。' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await handlePlan(chatRequest('这题怎么想？', { problemText: '斜面滑块' }, { chatMode: 'tutor' }));
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { enable_thinking?: boolean };
    expect(sent.enable_thinking).toBeUndefined();
  });

  it('中文里混入英文双引号破坏 JSON 时自动补转义，不丢题', () => {
    const broken = `{"summary":"推荐两道","similarProblems":[
      {"title":"斜面弹簧","tags":["动能定理"],"difficulty":"基础","stem":"斜面高 1m，g=10m/s²。","focus":"形成"下滑—反弹"完整链","hint":"用动能定理。"},
      {"title":"水平弹簧","tags":["能量守恒"],"difficulty":"中档","stem":"水平面长 2m，μ=0.2。","focus":"考查"分段"核算","hint":"分段列式。"}
    ]}`;
    expect(() => JSON.parse(broken)).toThrow();

    const parsed = parseSimilarResponse(broken);
    expect(parsed.similarProblems).toHaveLength(2);
    expect(parsed.similarProblems[0].focus).toBe('形成"下滑—反弹"完整链');
    expect(parsed.similarProblems[1].stem).toContain('μ=0.2');
  });

  it('JSON 被截断时补齐括号，仍能取出已完成的题目', () => {
    const truncated = `{"summary":"推荐","similarProblems":[{"title":"斜面弹簧","tags":["动能定理"],"difficulty":"基础","stem":"斜面高 1m，g=10m/s²。","focus":"改变倾角","hint":"用动能定理。"},{"title":"第二题","stem":"水平面长`;
    const parsed = parseSimilarResponse(truncated);
    expect(parsed.similarProblems).toHaveLength(1);
    expect(parsed.similarProblems[0].title).toBe('斜面弹簧');
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
    expect(sys).toContain('严禁分情形变参题与脆弱长链');
    expect(sys).toContain('可调 / 待定 / 变化');
    expect(sys).toContain('2~4 段');
  });

  it.each([
    ['Node handlePlan', handlePlan],
    ['Qoder handler', qoderHandler],
  ])('%s 过滤 similar 中含“可调/待定”未定变参的相似题，全部不合规时自动重写恢复', async (_name, fn) => {
    // 场景 1：混合返回 1 道含“可调”变参题 + 1 道合规题 → 过滤掉“可调”题，只保留合规题
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: '推荐 2 道磁场偏转变式题',
                  similarProblems: [
                    {
                      title: '可调宽度磁场偏转（应被过滤）',
                      tags: ['匀强磁场'],
                      difficulty: '中档',
                      stem: '质量 m = 0.01 kg、电荷量 q = +0.02 C 的粒子以 4 m/s 垂直射入磁场 B = 2 T，磁场宽度 d 可调。(1) 求粒子穿出右边界时 d 的最大值；(2) 当 d = 1.5 m 时求运动时间。',
                      focus: '变参讨论',
                      hint: 'R = mv/(qB)',
                    },
                    {
                      title: '定宽匀强磁场偏转',
                      tags: ['匀强磁场', '偏转角'],
                      difficulty: '中档',
                      stem: '质量 m = 0.01 kg、电荷量 q = +0.02 C 的带电粒子以 v₀ = 8 m/s 垂直左边界射入 B = 2 T、宽度 d = 1.0 m 的垂直纸面向里匀强磁场（不计重力），求偏转角与运动时间。',
                      focus: '唯一确定宽度几何偏转。',
                      hint: 'R = mv/(qB) = 2 m，sinθ = d/R = 0.5，θ = 30°。',
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

    const mixedRes = await fn(chatRequest('推荐磁场相似题', { currentTimeSeconds: 0 }, { chatMode: 'similar' }));
    expect(mixedRes.status).toBe(200);
    const mixedBody = (await mixedRes.json()) as { status: string; similarProblems: Array<{ title: string; stem: string }> };
    expect(mixedBody.status).toBe('ok');
    expect(mixedBody.similarProblems).toHaveLength(1);
    expect(mixedBody.similarProblems[0].title).toBe('定宽匀强磁场偏转');
    expect(mixedBody.similarProblems[0].stem).not.toContain('可调');

    fetchMock.mockReset();

    // 场景 2：首轮全部为“可调”题 → 自动触发重写提示并成功返回合规变式题
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: '变参题',
                    similarProblems: [
                      {
                        title: '磁场宽度待定题',
                        tags: ['磁场'],
                        stem: '磁场宽度 d 可调，求 d 的取值范围。',
                        focus: '变参',
                        hint: 'R = mv/(qB)',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: '重写后的定参磁场偏转变式题',
                    similarProblems: [
                      {
                        title: '定宽磁场半圆出射',
                        tags: ['匀强磁场', '半圆出射'],
                        difficulty: '基础',
                        stem: '质量 m = 0.01 kg、电荷量 q = +0.02 C 的粒子以 v₀ = 4 m/s 垂直左边界射入 B = 2 T、宽度 d = 2.0 m 的垂直纸面向里匀强磁场（不计重力），求轨道半径与运动时间。',
                        focus: '固定宽度半圆出射。',
                        hint: 'R = 1 m < d，半圆出射 t = πm/(qB)。',
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

    const retryRes = await fn(chatRequest('推荐磁场相似题', { currentTimeSeconds: 0 }, { chatMode: 'similar' }));
    expect(retryRes.status).toBe(200);
    const retryBody = (await retryRes.json()) as { status: string; similarProblems: Array<{ title: string }> };
    expect(retryBody.status).toBe('ok');
    expect(retryBody.similarProblems).toHaveLength(1);
    expect(retryBody.similarProblems[0].title).toBe('定宽磁场半圆出射');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCall = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(secondCall.messages[secondCall.messages.length - 1].content).toContain('未定变参');
  });

  it('Node 与 Qoder 双端支持 chatMode=socratic（含 form 与 context.mode），系统提示词逐字一致且注入母题 RAG 与多轮历史', async () => {
    const chatContext = {
      problemText: '质量 m = 1 kg 物块从倾角 37°、长 4 m 粗糙斜面（μ = 0.25）由静止下滑后压缩轻弹簧 k = 400 N/m，g = 10 m/s²。',
      reading: {
        kind: 'stage_plan',
        schemaVersion: 1,
        stages: [
          { kind: 'incline_slide' },
          { kind: 'lossless_turn' },
          { kind: 'horizontal_slide' },
          { kind: 'spring_contact' },
        ],
      },
      history: [
        { role: 'user', text: '带我一步步做这道题' },
        { role: 'assistant', text: '这道题分斜面下滑、水平滑行和压缩弹簧三段。先看第 1 段斜面下滑：物块受哪几个力？沿斜面向下的加速度怎么列式？' },
      ],
    };

    const prompts: string[] = [];
    const refsList: unknown[] = [];

    for (const [fn, useContextMode] of [
      [handlePlan, false],
      [qoderHandler, true],
    ] as const) {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '思路很对！沿斜面方向 a = g(sin37° - μcos37°) = 4 m/s²。那滑到 4 m 坡底时速度是多少？',
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      const req = useContextMode
        ? chatRequest('沿斜面向下加速度是 g(sin37° - μcos37°)', { ...chatContext, mode: 'socratic' })
        : chatRequest('沿斜面向下加速度是 g(sin37° - μcos37°)', chatContext, { chatMode: 'socratic' });

      const res = await fn(req);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        reply: string;
        ragReferences?: Array<{ id: string; score: number }>;
      };
      expect(body.status).toBe('ok');
      expect(body.reply).toContain('4 m/s²');
      expect(Array.isArray(body.ragReferences)).toBe(true);
      expect(body.ragReferences!.length).toBeGreaterThan(0);
      refsList.push(body.ragReferences);

      const sent = JSON.parse(String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1]?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      // 保留多轮对话 history
      expect(sent.messages.slice(1).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
      prompts.push(sent.messages[0].content);
    }

    // 剥离 context 中的 mode 字段差异后比对：用相同 context 再做双端逐字一致断言
    const exactPrompts: string[] = [];
    for (const fn of [handlePlan, qoderHandler]) {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '我们先看第 1 阶段受力分析，你觉得沿斜面有哪些力？' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
      const res = await fn(chatRequest('请分步带我做这题', chatContext, { chatMode: 'socratic' }));
      expect(res.status).toBe(200);
      const sent = JSON.parse(String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1]?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      exactPrompts.push(sent.messages[0].content);
    }

    expect(exactPrompts[0]).toBe(exactPrompts[1]);
    expect(refsList[0]).toEqual(refsList[1]);
    const sys = exactPrompts[0];
    expect(sys).toContain('苏格拉底式高中物理老师（分步带练模式）');
    expect(sys).toContain('严禁一次性给出完整全过程解答');
    expect(sys).toContain('80~160 字');
    expect(sys).toContain('第 1 阶段');
    expect(sys).toContain('参考高考物理母题知识库');
  });

  it.each([
    ['Node handlePlan', handlePlan],
    ['Qoder handler', qoderHandler],
  ])('%s 圆弧后抛体误用 dropHeightM 触发定向纠错时，附带 landingPlaneYM 换算公式指引并一次修正成功', async (_name, fn) => {
    vi.stubEnv('API_CONTRACT_MODE', 'stage_plan');
    const badReading = {
      kind: 'stage_plan',
      schemaVersion: 1,
      gravityMps2: 10,
      massKg: 1,
      initial: { speedMps: 6 },
      stages: [
        { kind: 'vertical_arc', radiusM: 0.5, endAngleDeg: 180, side: 'inside', frictionless: true },
        { kind: 'projectile', dropHeightM: 1.0 },
      ],
      assumptions: [],
    };
    const fixedReading = {
      ...badReading,
      stages: [
        badReading.stages[0],
        { kind: 'projectile', landingPlaneYM: 0 },
      ],
    };

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(badReading) } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fixedReading) } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const form = new FormData();
    form.set('text', '质量 1 kg 小球以 6 m/s 从半径 0.5 m 竖直光滑半圆轨道最低点进入，从最高点飞出落回水平地面，g = 10 m/s²。');
    const res = await fn(new Request('http://127.0.0.1:8787/api/animation/plan', { method: 'POST', body: form }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retryPayload = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
    };
    const retryText = retryPayload.messages[1].content.map((c) => c.text ?? '').join('\n');
    expect(retryText).toContain('圆弧后抛体修正指引');
    expect(retryText).toContain('landingPlaneYM');
    expect(retryText).toContain('2R - h');
    vi.unstubAllEnvs();
  });

  it.each([
    ['Node handlePlan', handlePlan],
    ['Qoder handler', qoderHandler],
  ])('%s 斜面直入圆轨误填 startAngleDeg=0 触发定向纠错时，附带圆轨入口切线修正指引并一次修正成功', async (_name, fn) => {
    vi.stubEnv('API_CONTRACT_MODE', 'stage_plan');
    const badReading = {
      kind: 'stage_plan',
      schemaVersion: 1,
      gravityMps2: 10,
      massKg: 1,
      initial: { speedMps: 0 },
      stages: [
        { kind: 'incline_slide', lengthM: 2, angleDeg: 37, kineticFrictionCoefficient: 0, slidesAfterRelease: true },
        { kind: 'vertical_arc', radiusM: 0.4, side: 'inside', frictionless: true, path: { startAngleDeg: 0, direction: 'positive', end: { kind: 'observation', sweepAngleDeg: 360 } } },
      ],
      assumptions: [],
    };
    const fixedReading = {
      ...badReading,
      stages: [
        badReading.stages[0],
        { kind: 'vertical_arc', radiusM: 0.4, side: 'inside', frictionless: true, path: { startAngleDeg: -37, direction: 'positive', end: { kind: 'observation', sweepAngleDeg: 360 } } },
      ],
    };

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(badReading) } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fixedReading) } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const form = new FormData();
    form.set('text', '质量 1 kg 滑块从 37° 光滑斜面长 2 m 处静止下滑，相切进入半径 0.4 m 的光滑螺旋圆形轨道，g = 10 m/s²。');
    const res = await fn(new Request('http://127.0.0.1:8787/api/animation/plan', { method: 'POST', body: form }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; reading?: { stages?: Array<{ path?: { startAngleDeg?: number } }> } };
    expect(body.status).toBe('ok');
    expect(body.reading?.stages?.[1]?.path?.startAngleDeg).toBe(-37);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retryPayload = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
    };
    const retryText = retryPayload.messages[1].content.map((c) => c.text ?? '').join('\n');
    expect(retryText).toContain('圆轨入口切线修正指引');
    expect(retryText).toContain('-θ');
    vi.unstubAllEnvs();
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
