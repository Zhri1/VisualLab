# Qoder Sites 部署指令（给 Qoder Agent）

> **执行状态（2026-11-20）**：已用 Qoder CLI 完成站点创建、静态发布与公开访问，线上地址：
> **<https://visuallab-physics-ecumfnqswpu.qoder.zone>**（HTTP 200、无登录墙）。
> 云函数因发布账号的 `backend_sites` 配额为 `0` 暂未上线；`functions/` 代码已就绪。实际卡点、解决路径与开通后的一条命令，见 `ACCEPTANCE.md` 附录「Qoder Sites 迁移记录」。本文件保留为完整迁移说明与排错参考。

> 用途：本项目原部署在 WorkBuddy Sites，不符合「2026 Qoder 高校创造力大赛」作品链接要求。
> 大赛硬性要求：作品链接必须是 **Qoder Sites** 发布、且设为**公开访问**的地址（`https://<id>.qoder.zone`），评委点开即用、无需登录；不接受本地压缩包或其他托管平台。
>
> 使用方法：在 Qoder（**个人版账号**）里打开本仓库，对 Qoder 说：
> **「按 QODER_DEPLOY.md 把项目部署到 Qoder Sites，设为公开访问，并把公开链接回填到 ACCEPTANCE.md。」**
> 下面内容已自包含，Qoder 读完即可执行，无需额外背景。

---

## 1. 项目是什么

VisualLab：上传一张物理题图（斜面 + 弹簧运动），用视觉模型识别出题设条件，生成可交互动画的学习工具。三名成员协作，AI 接口与部署由成员 C 负责。

## 2. 关键文件与现状

- `src/api/plan.ts`：导出 `handlePlan(request: Request): Promise<Response>`，是识别接口 `POST /api/animation/plan` 的 handler。它**不绑定框架**——吃 Web 标准的 `Request`、吐 `Response`，可以直接注册成云函数入口。支持 `multipart/form-data`，字段 `image`（JPG/PNG，≤8MB）与可选 `text`（≤2000 字），也支持只传文字。回包状态：`ok` / `needs_input` / `unsupported`，错误码 400/502/504，带 CORS 头。
- `src/api/dashscope.ts`：调用百炼 OpenAI 兼容视觉接口。读环境变量 `DASHSCOPE_API_KEY`（必需）、`DASHSCOPE_BASE_URL`、`DASHSCOPE_VISION_MODEL`、`DASHSCOPE_FALLBACK_MODEL`、`VISION_TIMEOUT_MS`。
- `src/api/validate.ts`：复用 `src/physics/reading.ts` 的 `validateReading` 做字段校验，把结果映射成三种状态。**不要另写一套字段规则**。
- `skills/vision-reading.v1.md`：发给视觉模型的 Skill 说明（模板前提、8 个条件字段、4 个事实字段、单位换算、超范围判定、样例）。
- `src/config/endpoints.ts`：`PLAN_ENDPOINT = VITE_API_BASE + '/api/animation/plan'`；`VITE_API_BASE` 留空表示同源。
- `.env.production`：`VITE_USE_MOCK_API=false`（线上必须关 Mock）。
- `fixtures/incline-spring-gap-1m.png`、`fixtures/incline-spring-gap-2m.png`：两张验收题图，正确识别分别是 `springGapM=1` 与 `springGapM=2`。

## 3. 部署形态：静态前端 + 云函数

Qoder Sites 发布技能要求 **static 产物**，但平台支持「静态站点 + 云函数（`site-functions/`）+ Secrets」（已有同届作品用此形态跑 AI 网关并设为公开访问）。我们的识别接口有服务端密钥，必须走云函数，**不能**做成纯前端（密钥会泄露）。

1. **静态前端**：`npm run build` 产出 `dist/`，作为静态站点上传。确认 `VITE_USE_MOCK_API=false` 生效。
2. **识别接口改云函数**：新建 `site-functions/` 下的云函数入口，把 `handlePlan` 注册进去。云函数签名以 Qoder Sites 发布技能实际要求为准（本地 Node 入口见 `src/api/server.ts` 里的 `http.createServer` 适配）。
3. **Skill 文本内联**：`loadSkillText()` 目前用 `node:fs` 读本地 `skills/vision-reading.v1.md`。云函数环境不一定有工作目录文件，请把该文件内容改为内联常量或随函数一起打包，确保 `loadSkillText()` 在云端能拿到文本。
4. **密钥放 Secrets**：把 `DASHSCOPE_API_KEY` 配置到 Qoder Sites 的 Secrets（平台密钥管理），**不要**写进前端、不要进仓库、不要进静态产物。
5. **前端地址**：若云函数路由不是同源 `/api/animation/plan`，构建时把 `VITE_API_BASE` 指向云函数网关（如 `/functions/v1`）；若 Qoder 把静态与函数挂在同域且能路由到该路径，则保持留空。

## 4. 发布流程（严格按顺序）

1. 确认登录的是**个人版 Qoder 账号**。组织账号无法公开访问，设 public 会报 `sites_invalid_access_mode`，站点虽上线但评委看到登录墙。
2. 读 Qoder Sites 发布技能，确认用 static 产物。
3. `prepare_site` 打包上传为草稿 → 检查草稿就绪、无阻塞项。
4. `publish_site` 发布 → `get_publish_status` 轮询到 `published: true`。
5. 把站点访问范围改为 `public`（公开访问）。
6. 拿到公开链接 `https://<id>.qoder.zone`。

### ⚠️ 三条硬约束（2026-11-22 实测，踩过两次）

1. **发布是整站快照，`functionDirectory` 不能省。** 它可选，但不传表示「这次部署没有云函数」：`get_site.functions` 会变 `[]`，接口立刻 `409 sites_gateway_supabase_not_ready`。只想更新前端时，让 `functions/` 内容与线上一致再带上该参数。
2. **重新打包函数前必须 `key:inject`，打包后立刻 `key:restore`。** 站点 `secrets` 恒为 `[]`，密钥只存在于 `functions/inline-key.ts` 的构建期注入值里；忘了注入，线上函数就没有 `DASHSCOPE_API_KEY`。
3. **`--input-file` 必须放在项目根目录内。** 路径会被 `tL()` 做包含校验，指到项目外一律报 `sites_current_session_required`（看起来像会话问题，其实是路径问题）。CLI 还需要一条本地会话记录（`~/.qoder-cn/sites/sessions/<sha256(sessionId)>.json`），WorkBuddy 侧不会自动生成。

## 5. 上线验收（必须做，不能只跑 mock）

用**全新无 Cookie 的浏览器上下文**打开公开链接，模拟评委：

- [ ] 文档返回 HTTP 200、`content-type: text/html`、`无登录墙`（没有被分享码/登录拦截）。
- [ ] 首页能上传图片、输入文字、发送。
- [ ] 上传 `fixtures/incline-spring-gap-1m.png` → 识别结果 `springGapM=1`，8 个条件字段与 `fixtures/incline-spring.reading.json` 一致。
- [ ] 上传 `fixtures/incline-spring-gap-2m.png` → `springGapM=2`，其余不变（证明不是套模板）。
- [ ] 确认条件后能进入工作台、播放动画、时间轴与关键事件正常。
- [ ] 失败态可重试：非本模板题给 `unsupported`；无必需数值给 `needs_input` 并能补值；坏图片 400、超时 504。
- [ ] 控制台无报错、无跨域失败请求。

若云函数因运行时限制确实无法调用百炼，可退化为「纯静态 + 用户自带 Key（BYOK）」，但体验会打折，仅在无其他方案时采用，并需在验收文档注明。

## 6. 回填

部署与验收通过后：

1. 把公开链接填进 `ACCEPTANCE.md` 第 2 节的目标链接占位（替换 `https://________.qoder.zone`），删掉旧 WorkBuddy 链接或保留为历史记录。
2. 把文首「部署平台迁移」提示改为已完成。
3. 提交、推送、开 PR 合并到 main，交回成员 C 确认。

---

## 备注：当前环境的边界

成员 C 在本机使用的是 WorkBuddy AI 环境，**没有 Qoder Sites 的发布工具**（`prepare_site` / `publish_site` / `get_publish_status` 属于 Qoder 客户端能力），因此发布这一步必须在 Qoder 里完成。接口代码、Skill 说明、契约校验、验收数据均已就绪，迁移主要是部署形态适配与发布操作。
