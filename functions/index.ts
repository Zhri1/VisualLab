/**
 * Qoder Sites 云函数入口。
 *
 * 平台约定：functions/index.ts 在 ZIP 根，逻辑名 app，运行时 edge，
 * 浏览器同源调用路径固定为 /functions/v1/app。
 * 这里只做 Deno HTTP 服务注册，业务逻辑在 ./handler.ts。
 */

import { handler } from "./handler.ts";

declare const Deno: {
  serve(handler: (request: Request) => Promise<Response>): unknown;
};

Deno.serve(handler);
