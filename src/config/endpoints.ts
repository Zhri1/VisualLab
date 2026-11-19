/**
 * 接口地址。成员 C 的服务定下来后只改环境变量，不碰代码。
 *
 * .env.local:
 *   VITE_API_BASE=http://192.168.1.20:8787
 *   VITE_USE_MOCK_API=false
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

/**
 * 识别接口路径。
 * - 本地 Node 服务 / vite 代理：`/api/animation/plan`（默认）
 * - Qoder Sites 云函数：`/functions/v1/app`（由 `.env.production` 指定）
 */
export const PLAN_PATH = `/${(import.meta.env.VITE_PLAN_PATH ?? "/api/animation/plan").replace(/^\/+/, "")}`;

/** 识别接口完整路径（契约 2 节） */
export const PLAN_ENDPOINT = `${API_BASE}${PLAN_PATH}`;

/** Mock 识别的人工延时范围，用于走查加载态 */
export const MOCK_LATENCY_MS: [number, number] = [720, 1100];
