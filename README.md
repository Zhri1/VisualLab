# VisualLab · 物理题动画生成器

VisualLab 是面向高中力学的学习工具，参加 2026 Qoder 高校创造力大赛 StudyHack 学习科研赛道。学生上传一道题的图片，核对 AI 识别的条件，然后观看由物理模型计算出的运动过程。

## 首版目标

[最终方案](PROJECT_PLAN_FINAL.md)以斜面下滑、无损转向、水平匀速、压缩弹簧和反弹为主演示。页面提供播放、暂停、重播和关键点跳转。在弹簧压缩到最短时，动画同步显示速度为零、弹力大小达到最大。

学生可修改识别条件并在浏览器中重算。例如把劲度系数从 400 N/m 改为 100 N/m，最大压缩量从约 0.2012 m 增至约 0.4025 m。

## 开工入口

| 文件 | 用途 |
|---|---|
| [PROJECT_PLAN_FINAL.md](PROJECT_PLAN_FINAL.md) | 产品范围、物理原理、七天排期和验收用例 |
| [CONTRACTS.md](CONTRACTS.md) | 图片接口、识别 JSON、场景装配和播放器接口 |
| [INCLINE_PROJECTILE.md](INCLINE_PROJECTILE.md) | 待联审的斜面末端直接斜抛接续、共享输入和独立数值基准 |
| [AGENTS.md](AGENTS.md) | 三人协作边界和 Qoder 开发约定 |
| [共享识别样例](fixtures/incline-spring.reading.json) | 标准题的 `reading`，前端、物理库和 AI 接口共同使用 |

当前里程碑是搭建上传、识别和播放的完整链路。第一轮联调用共享样例驱动播放器，第二轮用真实上传返回同一格式的数据。改条件和补条件都走同一条本地重算路径。

## 三人分工

- **A · 前端与联调**负责输入、核对表、播放和绘制，组织端到端验收。
- **B · 动画库**负责场景装配、分段运动、坐标和关键事件，维护共享字段与数值基准。
- **C · AI 接口与部署**负责题图识别、模板说明、接口校验和 Qoder Sites 公网访问。

提交版以公网未预置题图可播放、改值重算以及缺项和超范围反馈为验收条件。

## 本地验证

```bash
npm ci
npm run typecheck                 # tsc --noEmit，0 错误
npm test                          # vitest 46 条
npm run test:physics              # node --test 物理库 14 条
npx --yes tsx scripts/check-contract.ts   # 契约自检 8 例
npm run build
```

浏览器真机走查需要先起预览服务和一个带远程调试端口的 Edge/Chromium（`npm run preview` → 4173，`--remote-debugging-port=9222`），再跑 `npm run test:ui`，共 22 条断言。截图与报告默认写到 `artifacts/ui`。这条不是 CI 步骤，只在本机执行；逐条说明见 [ACCEPTANCE.md](ACCEPTANCE.md) 第 0 节。
