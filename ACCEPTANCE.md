# 验收清单 · A

对照 PROJECT_PLAN_FINAL.md 第 7 节。功能与数值检查项已全部通过，无待判定项；第 2 节与第 4 节最后一行由 C 用真实模型实测。

> **部署平台迁移（2026-11-20，已完成）**：作品已发布到 **Qoder Sites** 并设为公开访问：<https://visuallab-physics-ecumfnqswpu.qoder.zone>（实测 HTTP 200、`text/html`、无登录墙）。此前 WorkBuddy Sites 链接已作废。
>
> 当前线上为**纯静态版**：页面、动画、内置示例可用；**识图接口尚未上线**——发布账号的 `backend_sites` 配额为 `0`（`used: 0, limit: 0`），Qoder Sites 云函数无法分配。云函数代码（`functions/index.ts` + `functions/handler.ts` + 内联 Skill）已就绪，开通后端配额后重新 `prepare_site` 即可切换为完整版。详见文末「附：Qoder Sites 迁移清单」。

## 0. 工程验证

| 检查项 | 命令 | 期望 | 状态 |
|---|---|---|---|
| 类型检查 | `npm run typecheck` | 0 错误 | ✅ 通过 |
| 前端与契约单测 | `npm test` | vitest **46** 条通过（3 个文件） | ✅ 通过 |
| 物理库测试 | `npm run test:physics` | `node --test` **14** 条通过 | ✅ 通过 |
| 契约自检 | `node node_modules/vite-node/vite-node.mjs scripts/check-contract.ts` | **9** 个用例通过（离线，不联网） | ✅ 通过 |
| 构建 | `npm run build` | 通过 | ✅ 通过 |
| 数值自检（`verify.html`） | 浏览器打开 | 13/13，与方案第 3 节逐位一致 | ✅ |
| 浏览器走查 | `npm run test:ui` | **22** 条断言全绿 | ✅ 手动，见下 |

单测拆分：`src/api/__tests__/validate.test.ts` 12 条、`src/services/__tests__/imageRecognition.test.ts` 15 条、`src/adapters/__tests__/acceptance.test.ts` 19 条，合计 46 条。

上述命令都可以用 node 直连本地依赖执行，避免 PowerShell 执行策略拦 `npm.ps1`，也避免 `npx` 联网：`node node_modules/typescript/bin/tsc --noEmit`、`node node_modules/vitest/vitest.mjs run`、`node --test src/physics/motion.test.ts src/physics/scene.test.ts`、`node node_modules/vite-node/vite-node.mjs scripts/check-contract.ts`、`node node_modules/vite/bin/vite.js build`。

### 浏览器走查 `npm run test:ui`

不是 CI 步骤。它需要一个真实的 Chromium 内核浏览器，CI 容器里没有，所以只在本地跑：

1. `npm run build && npm run preview`（默认 4173，可用 `UI_URL` 或第二个参数换地址）；
2. 用 `--remote-debugging-port=9222` 启动 Edge 或 Chromium，留一个标签页（可用 `CDP_URL` 换地址）；
3. `npm run test:ui`，或 `node scripts/cdp-verify.mjs [截图目录] [页面 URL]`。

端口被占用时换成任意一对空闲端口即可，例如 `vite preview --port 4174` + `--remote-debugging-port=9224`，再 `CDP_URL=http://127.0.0.1:9224 node scripts/cdp-verify.mjs artifacts/ui-final http://127.0.0.1:4174/`。

默认把截图和 `report.txt` 写到 `artifacts/ui`（已 gitignore）。22 条断言覆盖：首页渲染与入口、1440 无横向溢出、进入工作台与画布尺寸、正文条数与时间轴事件、假设胶囊展开、播放推进、430 窄屏无溢出与画布收缩、文字提交走缺项提示、缺项工作台的假设胶囊（同样带「3 条」并可展开出 `g=10` 首条）、控制台无错误。

## 1. 固定目标题

`npm test` 里的 `src/adapters/__tests__/acceptance.test.ts` 与 `npm run test:physics` 共同覆盖全部数值，同时可作为 B 的对齐基准。

| 检查项 | 期望 | 状态 |
|---|---|---|
| 斜面加速度 | 2.0250 m/s² | ✅ 用例 `release` |
| 到达坡底 | 1.9876 s，4.0249 m/s | ✅ |
| 转向位置连续 | 前后都在原点附近 | ✅ 用例 `转向位置连续` |
| 接触弹簧 | 2.2361 s，已前进 1.00 m | ✅ |
| 最大压缩 | 2.3146 s，x = 0.2012 m，v = 0，F = 80.50 N | ✅ |
| 恢复原长脱离 | 2.3932 s，v = −4.0249 m/s | ✅ |
| 字幕与画面同步 | 阶段卡随播放切换，事件后 0.6 s 显示事件字幕 | ✅ 手动 |

边界说明：`detach_spring` 的末位数字受浮点accumulation影响，用例用 `toBeCloseTo(…, 3)`，即 ±0.0005 s。如果 B 的实现与这里差在第 4 位小数，属正常，不视为缺陷。

## 2. 真实上传 ✅

**公网站点（Qoder Sites，已公开访问）**：<https://visuallab-physics-ecumfnqswpu.qoder.zone>

- 平台：Qoder Sites，个人版账号 `nick6837354573`
- projectId `01a1f4aa-fd83-7e8c-ba8d-8ba7d20aa62c`，siteId `01a1f4aa-fd87-77f6-8522-2d0f4129702e`
- 访问策略：`public`（`auth_integration_status: not_required`，评委无需登录）
- 发布 actionId `e13f6b29-5d78-4c40-9a32-8b7e1d4c6f03`，发布操作 `succeeded / committed`
- 无 Cookie 实测：HTTP 200、`text/html`、57 KB、无登录墙

旧 WorkBuddy 链接（已作废，仅作历史记录）：<https://wbapp-tm3ozhpna47stakp5egt9i.apps.workbuddy.host/?sharecode=ITSMMGMUVE>

**当前版本边界**：线上是纯静态构建，`/functions/v1/app` 返回 409（云函数未分配）。识图能力需等 `backend_sites` 配额开通后，用同一 projectId 重新 `prepare_site`（带 `functionDirectory: "functions"` 与 `secretNames: ["DASHSCOPE_API_KEY"]`）再发布。

Qoder Sites 站点直接公开访问，不需要分享码或 cookie。生产构建已关闭 Mock（`.env.production` 设 `VITE_USE_MOCK_API=false`），接口路径由 `VITE_PLAN_PATH=/functions/v1/app` 指向同源云函数（本地 `npm run dev` 仍走 `/api/animation/plan` 代理）。

| 检查项 | 期望 | 实测 |
|---|---|---|
| 标准题图 `fixtures/incline-spring-gap-1m.png` | `springGapM = 1`，其余 7 项与样例一致 | ✅ 8 项全部命中，3.7 s |
| 间距变式 `fixtures/incline-spring-gap-2m.png` | `springGapM = 2`，其余不变 | ✅ 8 项全部命中，4.3 s |
| 公网首页 | 返回前端页面 | ✅ 200，`text/html` |
| 识别模型 | 真实视觉模型，无预置结果 | ✅ `qwen4-max`，从像素读出 |

两张题图只差弹簧间距，模型分别读出 1 m 和 2 m，说明识别不是套模板。页面侧图片选择、预览、移除、加载态、四种回包、失败重试、内置示例兜底均已就绪。

## 3. 改值与补值

| 检查项 | 期望 | 状态 |
|---|---|---|
| `springGapM` 1 → 2 | 弹簧右移 1 m，接触时刻 2.4845 s | ✅ 用例 |
| `k` 400 → 100 | 最大压缩 0.4025 m，接触时刻不变 | ✅ 用例 |
| 缺必要数值 | 进核对表、标红待补、补完可播 | ✅ 联调条「缺项」 |
| 补值后重算 | 走 `assembleScene → buildMotion` | ✅ |
| 无效修改 | 保持原动画并提示字段 | ✅ 联调条「服务失败」+ 撤销路径 |

演示路径：在 AI 面板输入「把弹簧劲度系数改成 100 N/m」。卡片出现后点「撤销」可回到 400。

## 4. 超范围与失败

| 检查项 | 期望 | 状态 |
|---|---|---|
| 非本模板题目 | 提示范围并给内置示例入口 | ✅ 联调条「超范围」 |
| 识别服务失败 | 保留已选图片，可重试 | ✅ 联调条「服务失败」 |
| 图片无效 / 超时 | 400 / 504 文案区分 | ✅ 已实测：假图片 400「只支持 JPG 或 PNG 图片」；3 s 超时 504「识别超时（3000 ms）」；模型鉴权失败 502 |

## 5. 交互逐项

- 首页：文字输入、图片选择与预览、移除、发送禁用态、Cmd/Ctrl+Enter 提交 ✅
- 工作台：播放/暂停、重播、下一关键事件、时间轴点击与拖动、事件标记点击 ✅
- 事件标记与标签：来自 `motion.events`，不写死 ✅
- 阶段说明：随 `currentTime` 切换，带公式 ✅
- 查看原题：抽屉展示原图、前提、条件，可改可应用 ✅
- 对话：问答、改条件、跳转、播放控制、修改卡片、撤销 ✅
- 新建题目：清空状态回首页 ✅
- 移动端：单列、画布优先、抽屉底部弹出 ✅

## 6. 待办（依赖他人）

1. B 的 `src/physics` 已落地，`npm test` 与 `npm run test:physics` 均全绿；后续改动照此回归。
2. C 的接口代码已就绪：本地 Node 版（`src/api/server.ts`）可跑通，Qoder Sites 云函数版（`functions/`）已写好并通过 `prepare_site` 打包校验。生产构建 `VITE_USE_MOCK_API=false`、`VITE_PLAN_PATH=/functions/v1/app`。
3. **剩余唯一卡点**：Qoder 账号 `nick6837354573` 的 `backend_sites` 配额为 `0`，云函数无法分配（`sites_quota_exceeded`）。需要开通后端配额或换有配额的账号，详见下方。
4. 识图上线后，三人用无 Cookie 浏览器重做公网验收（上传两张题图，确认 `springGapM=1/2`）。

---

## 附：Qoder Sites 迁移记录（C · 部署）

### 已完成

| # | 事项 | 结果 |
|---|---|---|
| 1 | 登录 Qoder | ✅ 个人版账号 `nick6837354573`，设备码授权 |
| 2 | 创建站点 | ✅ projectId `01a1f4aa-fd83-7e8c-ba8d-8ba7d20aa62c`，siteId `01a1f4aa-fd87-77f6-8522-2d0f4129702e` |
| 3 | 静态构建 | ✅ `dist/`（`VITE_USE_MOCK_API=false`，`VITE_PLAN_PATH=/functions/v1/app`） |
| 4 | 云函数代码 | ✅ `functions/index.ts`（`Deno.serve`）+ `functions/handler.ts`（自包含校验/归一化/百炼调用）+ `functions/skill.ts`（内联 Skill，脚本生成） |
| 5 | 静态发布 | ✅ `prepare_site` → `publish_site`，`published: true / committed` |
| 6 | 公开访问 | ✅ `update_access_policy` → `public`（`confirmPublic: true`） |
| 7 | 公网验证 | ✅ `https://visuallab-physics-ecumfnqswpu.qoder.zone` HTTP 200、`text/html`、57 KB、无登录墙 |

### 卡点：后端站点配额为 0

```json
{"error":"sites_quota_exceeded","details":{"resource":"backend_sites","used":0,"limit":0,"hint":"Backend site quota exceeded: used 0, limit 0."}}
```

`prepare_site`（带 `functionDirectory`）和 `ensure_backend`（`capabilities: ["functions"]`）都返回同一错误。这不是用超了，是账号没有该能力，纯静态站点不受影响。

### 解决路径（按优先级）

1. **开通后端配额**：登录 <https://qoder.cn/pricing>，确认是否可用高校/比赛权益升级到含 Sites 后端的版本；开通后 `backend_sites` 的 `limit` 应大于 0。
2. **换有配额的账号**：团队里若有 Pro 账号，用它登录后执行同样流程；站点归属该账号，作品链接不变（域名按 slug 分配）。
3. **临时兜底（BYOK）**：百炼接口已验证支持浏览器跨域（`access-control-allow-origin: *`），可让用户在页面填自己的 Key 直连。缺点：评委开箱即用体验打折，不建议作为提交版本。

### 配额开通后的一条命令

```bash
export QODER_SESSION_ID=<会话ID> QODER_SESSION_TYPE=cli

# 1) 重新准备完整版（带云函数；不要传 spa:true，会报 sites_invalid_request）
sites prepare_site --input '{"actionId":"<新UUID>","projectRoot":"<项目绝对路径>","webDirectory":"dist","functionDirectory":"functions","secretNames":["DASHSCOPE_API_KEY"],"projectId":"01a1f4aa-fd83-7e8c-ba8d-8ba7d20aa62c"}'

# 2) 等 readiness=ready、canPublish=true
sites get_publish_status --input '{"actionId":"<新UUID>"}'

# 3) 到 Site Settings 填 DASHSCOPE_API_KEY 的值（CLI 不支持输入密钥值）

# 4) 发布
sites publish_site --input '{"actionId":"<新UUID>"}'
```

发布后用无 Cookie 浏览器打开链接，上传 `fixtures/incline-spring-gap-1m.png` 与 `gap-2m.png`，确认 `springGapM` 分别为 1 与 2。

### 平台经验（避免重复踩坑）

- `sites` 命令需要会话上下文：必须设 `QODER_SESSION_ID` + `QODER_SESSION_TYPE=cli`，且会话的项目根与 `projectRoot` 一致。
- `spa: true` 在当前 CLI 版本会触发 `sites_invalid_request`；纯静态用默认值即可。
- 新建站点用 `slug`，更新站点用 `projectId`，两者不要同时传。
- CLI 主机 `secretValueInput: false`，密钥值只能在 Sites Settings 网页填。
- 公开访问设置需要 `accessRef`（先 `get_site_access` 取）+ `requestId` + `confirmPublic: true`。
