# VisualLab · 协作说明

三个人用 AI 并行开发同一个仓库。**这份文件是所有 AI 会话的入口，动手前先读完。**

项目：学生上传一张高中力学题图片，网站把题目里的运动过程生成可播放的动画。
参赛：2026 Qoder 高校创造力大赛 StudyHack 学习科研赛道。截止 11 月 30 日 18:00。

## 第一步：确认你是谁

**先问用户是 A、B 还是 C，然后只在该角色的目录里工作。** 不确定就问，不要猜。

| 角色 | 负责 | 允许改动的路径 |
|---|---|---|
| **A** · 前端与联调 | 上传、条件表、Canvas 绘制、播放器、内置示例 | `src/ui/`、`index.html`、根配置（`package.json`、`tsconfig.json`、`vite.config.*`） |
| **B** · 动画库 | 场景装配、分段运动、关键事件、物理验收值 | `src/physics/` |
| **C** · AI 与部署 | 读图 Skill、模型调用、接口回包、部署 | `src/api/`、`skills/`、`scripts/` |

## 动手前必读

1. `README.md` — 项目是什么、交付边界
2. `CONTRACTS.md` — **接口契约，优先级最高**，任何代码都要服从它
3. `PROJECT_PLAN_FINAL.md` 第 3 节 — 主演示题与验收数值
4. `AGENTS.md` — 实现约定（TypeScript、中文注释、英文命名）

## 硬规则

1. **不跨目录。** 改别人的文件前必须先问用户，并且说明为什么非改不可。
2. **不动契约。** `CONTRACTS.md` 和 `fixtures/incline-spring.reading.json` 是三人共用的。要改就单独提一个 PR，先合并，再改代码。
3. **不动 `package.json`**（A 除外）。需要依赖就告诉 A，让他加。
4. **不提交 `.env`。** 密钥只在服务端环境变量里，前端只拿接口地址。
5. **不编数字。** 所有物理量以 `PROJECT_PLAN_FINAL.md` 第 3 节为准，改完必须能对上验收数值。
6. 代码注释和协作说明用简体中文；变量名、函数名、文件名用英文。
7. 一次只做一件能验证的事。不要"顺手重构"别人的模块。

## 契约速查

`Reading` = `templateId` + 8 个条件 + 4 个事实。数值一律 SI，读不到填 `null`，**不许猜**。

| 条件字段 | 单位 | 范围 |
|---|---|---|
| `gravityMps2` | m/s² | > 0 |
| `inclineAngleDeg` | 度 | 0 < θ < 90 |
| `inclineLengthM` | m | > 0 |
| `kineticFrictionCoefficient` | — | ≥ 0 |
| `initialSpeedMps` | m/s | 首版必须为 0 |
| `blockMassKg` | kg | > 0 |
| `springGapM` | m | > 0，坡底到弹簧原长接触端 |
| `springConstantNpm` | N/m | > 0 |

事实字段：`slidesAfterRelease`、`losslessTurn`、`horizontalIsFrictionless`、`springIsUnattached`，取值 `true` / `false` / `null`。

接口：`POST /api/animation/plan`，`multipart/form-data`，图片字段名 `image`。
回包三种 200（`ok` / `needs_input` / `unsupported`）+ 三种错误码（400 / 502 / 504），详见 `CONTRACTS.md` 第 2 节。

## 验收数值（不能改）

| 时刻 | 事件 | 数值 |
|---|---|---|
| 0 s | 释放 | 斜面加速度 ≈ 2.0250 m/s² |
| 1.9876 s | 到达坡底并转向 | 速率 ≈ 4.0249 m/s，位置连续 |
| 2.2361 s | 接触弹簧 | 已水平前进 1.00 m |
| 2.3146 s | 压缩最短 | 压缩量 ≈ 0.2012 m，速度 0，弹力 ≈ 80.50 N |
| 2.3932 s | 恢复原长脱离 | 水平速度 ≈ −4.0249 m/s |

变式：`k` 改 100 N/m → 最大压缩 ≈ 0.4025 m；`springGapM` 改 2 → 接触时刻 ≈ 2.4845 s。

## 常用命令

```bash
npx --yes tsx src/api/server.ts           # 起识别服务，默认 8787（C）
npx --yes tsx scripts/check-contract.ts   # 契约自检，不需要 API Key
npx --yes tsx scripts/smoke.ts <图片>     # 真实照片跑一遍接口
```

## 提交

```bash
git pull --rebase origin main   # 开工和提交前都要做
git add -A
git commit -m "feat(api): 接入百炼读图与校验"
git push
```

前缀：`feat(ui)` / `feat(physics)` / `feat(api)` / `fix(...)` / `docs(...)` / `chore(...)`。
一次提交只做一件事，提交信息说清"哪个角色、改了什么"。
