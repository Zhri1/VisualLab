/**
 * 本地与公网都能跑的 Node 服务（C · AI 接口与部署）
 *
 * 启动：npx --yes tsx src/api/server.ts
 * 健康检查：GET /healthz
 * 识别接口：POST /api/animation/plan
 *
 * 只用 node:http + Web 标准 Request/Response，没有第三方运行时依赖，
 * 方便直接搬到阿里云函数计算、ECS 或任意 Node 主机。
 */

import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';

import { handlePlan } from './plan';

/** 读 .env，已存在的环境变量优先（不覆盖线上配置） */
function loadEnvFile(path = '.env'): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) {
      process.env[match[1]] = value;
    }
  }
}

function toRequest(req: IncomingMessage, port: number): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const host = req.headers.host ?? `127.0.0.1:${port}`;

  // 经过代理时 req.url 可能是绝对地址（http://host/path），不能再拼一次 host
  const rawUrl = req.url ?? '/';
  const target = /^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${host}${rawUrl}`;

  const init = {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>) : undefined,
    duplex: 'half',
  } as unknown as RequestInit;

  return new Request(target, init);
}

loadEnvFile();

const port = Number(process.env.PORT ?? 8787);

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/')) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', model: process.env.DASHSCOPE_VISION_MODEL ?? 'qwen4-max' }));
    return;
  }

  try {
    const response = await handlePlan(toRequest(req, port));
    const body = Buffer.from(await response.arrayBuffer());

    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(body);
  } catch (error) {
    console.error('[server] 未捕获异常', error);
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: '服务内部错误' }));
  }
});

server.listen(port, () => {
  const model = process.env.DASHSCOPE_VISION_MODEL ?? 'qwen4-max';
  const hasKey = Boolean(process.env.DASHSCOPE_API_KEY);
  console.log(`[server] http://127.0.0.1:${port}  model=${model}  key=${hasKey ? '已配置' : '缺失'}`);
  if (!hasKey) console.warn('[server] 缺少 DASHSCOPE_API_KEY，识别接口会返回 502');
});
