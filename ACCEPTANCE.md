# 验收清单 · A

对照 PROJECT_PLAN_FINAL.md 第 7 节。全部检查项已通过，无待判定项；第 2 节与第 4 节最后一行由 C 在公网用真实模型实测。

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

公网站点：<https://wbapp-tm3ozhpna47stakp5egt9i.apps.workbuddy.host/?sharecode=ITSMMGMUVE>

分享码必须带上；首次打开会写入 cookie，之后同一浏览器直接刷新即可。服务端与前端同域部署，生产构建已关闭 Mock（`.env.production` 设 `VITE_USE_MOCK_API=false`），页面直接请求 `/api/animation/plan`，不经 CORS，也不经 vite 代理。

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
2. C 的接口已上线并与前端同域部署，`VITE_USE_MOCK_API=false` 已写进 `.env.production`；`vite.config.ts` 的代理只在本地 `npm run dev` 时使用，公网不走。
3. 三人一起做公网验收：第 2 节与第 4 节最后一行已由 C 用真实模型和公网地址实测通过，建议 A、B 各自用手机再走一遍确认端到端体验。
