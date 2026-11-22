/**
 * 构建期注入的密钥占位（Qoder 云函数专用）。
 *
 * 仓库里这个值**永远是空字符串**，真实值只在 `prepare_site` 打包的那一刻由
 * `scripts/inline-key.mjs` 从本地 `.env` 写入，打包完成后立刻还原。
 *
 * 为什么要这么绕：Qoder 平台把 CLI 上下文的 `secretValueInput` 固定为 `false`，
 * `sites operations` 里也没有 set secret 操作，密钥值只能在客户端手工填一次。
 * 在填之前，用构建期注入让函数先跑起来。
 *
 * 优先级：平台 Secret（`Deno.env`）> 本文件的构建期注入值。
 * 一旦在站点设置里填了 `DASHSCOPE_API_KEY`，Secret 会覆盖这里的值，本文件可长期留空。
 *
 * 注意：本仓库是 public，任何情况下都不要把真实 Key 提交进 git。
 */
export const INLINE_API_KEY = "";
