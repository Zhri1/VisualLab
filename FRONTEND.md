# VisualLab · A 前端与联调

学生上传一道力学题的图片，页面把它变成可播放、可暂停、可跳关键点的动画。本目录是成员 A 的交付物：上传、核对、播放、绘制，以及与其他两人的接口适配层。

技术栈按 AGENTS.md 的约定用 TypeScript；框架部分方案未指定，取 React + Vite。

## 跑起来

```bash
npm install
npm run dev        # http://localhost:5173
npm run test       # 物理验收数值，对照方案第 3 节
npm run typecheck
npm run build
```

默认走 Mock 识别，不需要后端就能点完整个流程。

接成员 C 的服务时，复制 `.env.example` 为 `.env.local` 并取消那两行注释：

```
VITE_USE_MOCK_API=false
VITE_API_BASE=http://localhost:8787
```

`VITE_API_BASE` 留空时请求发到同源 `/api`，开发期由 `vite.config.ts` 的代理转发；代理目标可用 `VITE_PROXY_TARGET` 覆盖。线上部署两者都留空即可，由站点自身反代。

## 目录

```
src/
├── ui/                        ← A 的界面层（AGENTS.md 约定）
│   ├── components/
│   │   ├── home/              首屏与输入框
│   │   ├── workspace/         画布、播放器、时间轴、阶段说明、原题抽屉
│   │   ├── chat/              对话面板、消息、修改卡片
│   │   └── common/
│   └── styles/global.css      设计系统
│
├── physics/                   ← B 的动画库（本目录暂为空，用 adapters 里的参考实现过渡）
│
├── api/                       ← C 的识别服务（本目录暂为空）
│
├── adapters/
│   ├── contract.ts            动画库接口（assembleScene / buildMotion）
│   ├── mockMotionAdapter.ts   参考实现，含校验与解析解
│   ├── index.ts               ★ 接成员 B 只改这里
│   └── __tests__/             验收数值用例
│
├── services/
│   ├── imageRecognition.ts    ★ 接成员 C，USE_MOCK_API 开关在此
│   └── chatService.ts         对话接口 + Mock 意图识别
│
├── hooks/useWorkspace.ts      唯一的状态源
├── config/
│   ├── brand.ts               产品名，改名只动这里
│   └── endpoints.ts           接口地址
├── types/index.ts             与契约一一对应的类型
├── App.tsx
└── main.tsx
```

职责划分：`ui/` 只负责呈现与交互，`physics/` 只做纯计算，`api/` 只处理服务端。三者通过 `types/` 和 `adapters/contract.ts` 通信，互不 import 对方的内部文件。

## 契约落点

**识别（契约 2 节）。** `POST /api/animation/plan`，`multipart/form-data`，图片字段 `image`。四种回包都归一成 `PlanResponse`：`ok` 直接进工作台，`needs_input` 保留已解析字段并把 `missingKeys` 传进核对表（缺失项标红、可补），`unsupported` 提示范围并给内置示例入口，400/502/504 保留图片允许重试。

**动画（契约 3 节）。** UI 只调 `motionLibrary.assembleScene(reading)` 与 `buildMotion(scene)`，从返回的 `Motion` 读 `geometry`、`durationSeconds`、`segments`、`events`、`sampleAt(t)`。坐标原点在斜面底端，`position` 取滑块前下沿接触点——这一点必须和 B 对齐，否则动画会整体偏半个滑块。

**校验失败不破坏现场。** 改值走同一条 `assembleScene → buildMotion`，失败时返回逐字段错误，页面高亮对应输入框，现有动画保持不动。

## 换成真实模块

三处：

1. `src/adapters/index.ts` —— 把 `mockMotionLibrary` 换成 `src/physics` 的导出。签名见 `contract.ts`。
2. `src/services/imageRecognition.ts` —— `VITE_USE_MOCK_API=false`，并把 `VITE_API_BASE` 指向 C 的服务。
3. `src/services/chatService.ts` —— 对话服务尚未定义，`ChatService` 接口即将来要实现的形状。

## 联调条

`npm run dev` 时页面底部有一条「识别回包」切换器，可强制四种回包走查四种页面状态；右侧「重跑」用当前回包重新识别，「示例」载入内置示例。生产构建中不渲染。

内置示例不受开关影响，永远成功——它是服务失败时的兜底，如果在「服务失败」状态下点它也失败，就没有退路了。

## 已知边界

- 首版只处理「斜面 → 光滑水平面 → 弹簧」这一组合，模板名 `incline_spring`。
- `mockMotionAdapter.ts` 按方案第 3 节的解析解实现，用于跑通全链路和给 B 做数值对照，不是最终算法。
- 对话为 Mock 意图匹配，只认三件事：原理问答、带数值的条件修改、跳转/播放控制。
- `springGapM` 缺失时进入 `needs_input`，此时 `motion` 为空，画布显示占位提示，播放器隐藏。补值后走「应用条件」即可生成。
