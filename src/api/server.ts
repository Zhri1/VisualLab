/**
 * 本地与公网都能跑的 Node 服务（C · AI 接口与部署）
 *
 * 一个进程同时提供两件事：
 * - `dist/` 里的前端静态站点（npm run build 的产物）
 * - `POST /api/animation/plan` 识别接口
 *
 * 同域部署，前端不需要配 CORS，也不需要 vite 代理。
 *
 * 启动：npx --yes tsx src/api/server.ts
 * 健康检查：GET /healthz
 * 识别接口：POST /api/animation/plan
 *
 * 只用 node:http + Web 标准 Request/Response，没有第三方运行时依赖，
 * 方便直接搬到 Qoder Sites、阿里云函数计算、ECS 或任意 Node 主机。
 */

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
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

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const distDir = resolve(process.env.STATIC_DIR ?? join(process.cwd(), 'dist'));
const indexFile = join(distDir, 'index.html');
const hasDist = existsSync(indexFile);

/** 托管 dist/；找不到文件就回 index.html，交给前端路由 */
function sendStatic(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (!hasDist) return false;

  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // 编码非法就按原样处理
  }

  const candidate = resolve(distDir, `.${decoded}`);
  const inside = candidate === distDir || candidate.startsWith(distDir + sep);
  const usable = inside && existsSync(candidate) && statSync(candidate).isFile();
  const file = usable ? candidate : indexFile;

  const ext = extname(file).toLowerCase();
  const headers: Record<string, string> = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // 带哈希的构建产物可以长缓存，index.html 必须每次回源
    'cache-control': file.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  };

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}

loadEnvFile();

const port = Number(process.env.PORT ?? 8787);

const server = createServer(async (req, res) => {
  const rawUrl = req.url ?? '/';
  let pathname = '/';
  try {
    pathname = new URL(rawUrl, 'http://localhost').pathname;
  } catch {
    pathname = '/';
  }

  if (pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        status: 'ok',
        model: process.env.DASHSCOPE_VISION_MODEL ?? 'qwen4-max',
        static: hasDist,
      }),
    );
    return;
  }

  if (!pathname.startsWith('/api/')) {
    if (sendStatic(req, res, pathname)) return;

    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: '前端尚未构建，先运行 npm run build 生成 dist/' }));
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
  console.log(`[server] 静态站点：${hasDist ? distDir : '未构建（先 npm run build）'}`);
  if (!hasKey) console.warn('[server] 缺少 DASHSCOPE_API_KEY，识别接口会返回 502');
});
