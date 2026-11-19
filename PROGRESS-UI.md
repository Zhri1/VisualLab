# VisualLab 视觉打磨进度报告

**分支**: `feat/ui-polish`  
**提交**: 248c5f4  
**日期**: 2026-11-18  
**状态**: ✓ typecheck / ✓ test 19/19 / ✓ build  

---

## 界面状态对比

### 改动范围

只改了 A 角色负责的前端模块（`src/ui/`、`src/ui/styles/global.css`），未动物理计算、API 层、`src/App.tsx`、`src/ui/components/common/DevBar.tsx`。

### 【首页】桌面端 1440×900

**改动前**：
- 图片：_tool-results/mcp-Claude_Browser-blob-1795015383447-h6s33g.jpg_
- 特征：输入框、"内置示例"按钮、下方提示文案

**改动后**：
- 图片：_tool-results/mcp-Claude_Browser-blob-1795017801008-nrsaga.jpg_（回首页时截）
- 变化：样式系统全量重写，间距/圆角/字号更加明确，输入框聚焦时边框和阴影改进

### 【工作台】桌面端 1440×900 · 完整动画界面

**改动前**：
- 图片：_tool-results/mcp-Claude_Browser-blob-1795015640273-ckg5br.jpg_
- 问题：
  - 画布空白（首帧被 ResizeObserver 清空后不重绘）
  - 时间轴五条标签互相压叠、被裁掉
  - 滑块是旋转的黑色方块、白色斜体 m 很突兀
  - h 标注贴在左缘、间距不统一

**改动后**：
- 图片：_tool-results/mcp-Claude_Browser-blob-1795017801008-nrsaga.jpg_
- 改进：
  - ✓ 画布正常绘制，线条干净（W_EDGE=1.6px、W_HAIR=1px、标注用数学衬线斜体）
  - ✓ 时间轴改成刻度轨道 + 事件索引两层：轨道是真实物理比例的细竖线，下方按顺序排列五个事件标签，各自站住
  - ✓ 滑块改成圆角矩形（不旋转），m 符号成为视觉焦点而非干扰
  - ✓ 尺寸线、标注距离统一，起始虚影清晰
  - ✓ 阶段说明改成四层：编号/标题/正文/公式，公式用竖线分栏、函数名正体

### 【工作台】移动端 375×812 · 完整动画界面

**改动前**：
- 不存在（原型在 1440 宽测试）

**改动后**：
- 图片：_tool-results/mcp-Claude_Browser-blob-1795017364090-tkdjxn.jpg_
- 特征：
  - 单列布局，画布优先（aspect-ratio 5:4，自动高度）
  - 播放控件、时间轴贴在画布下
  - 事件索引两行换行展示（3列 × 2行），五个标签全可见不被硬切
  - 条件表在抽屉里、不占屏幕
  - 阶段说明换行、公式上下分离

### 【抽屉】桌面端 720px 宽

**改动前**：
- 图片：_tool-results/mcp-Claude_Browser-blob-1795015587330-99a1gx.jpg_
- 特征：基本抽屉，条件表行距紧凑

**改动后**：
- 未单独截（但在上面工作台截图背景中可见）
- 改进：条件表 td padding 优化，错误状态的红色调整为 #8a4b4b（与 INK 体系一致）

### 【抽屉】移动端 375×812 · 底部弹出

**改动前**：
- 不存在

**改动后**：
- 图片：_tool-results/mcp-Claude_Browser-blob-1795017404254-dqi95m.jpg_
- 特征：
  - 从屏幕底部往上弹，max-height: 92dvh
  - 条件表能滚动、输入框不被虚拟键盘压住
  - 按钮对齐、tap 热区充分

---

## 设计判断

### 解决的问题

#### 1. 画布首帧被 ResizeObserver 清空（真实缺陷）

**现象**：  
进入工作台时画布是空白的，直到用户拖拽进度条才出现。

**根因**：
- `PhysicsCanvas.tsx` 中 `resize()` 函数调用 `canvas.width = ...`，这会清空位图
- ResizeObserver 在挂载后的首帧之后才触发（不是同步的）
- 触发 resize 时 `time` 还是 0，paint() 被调用但位图已清空
- 暂停状态下 `time` 不变，后续再也不会重绘

**解决方案**：
- 在 ResizeObserver callback 的 resize 之后立即调用 paint()
- 用 `useCallback` 和 ref 存储 motion/time，确保 paint() 能读最新值
- RAF 监听 motion/time 变化，补画错过的帧

**改动文件**：`src/ui/components/workspace/PhysicsCanvas.tsx` 行 209-247

---

#### 2. 时间轴标签互相压叠（信息密度问题）

**现象**：
五个关键事件的时间分布极不均匀：
```
0.00 s   释放
1.99 s   到达坡底并转向
2.24 s   接触弹簧
2.31 s   压缩最短         ← 末尾 0.16 s 挤了三个
2.39 s   恢复原长并脱离
```

若用「标签径向贴在轨道旁」的传统时间轴，后三个标签必然压叠或被硬切。

**解决方案**：
拆成两层结构：
- **轨道**：真实物理比例的细竖线刻度（`.tick`），每个 2px × 9px，视觉上轻松
- **索引**：按顺序排列的五个事件标签，下方独立一行，文字各自站住

二者的对应关系是「位置真实但文字独立」，而不是「标签随时间线冗余排列」。

**改动文件**：`src/ui/components/workspace/EventTimeline.tsx`

**375 宽处理**：
- 桌面端五列硬挤会被 flex 容器硬切掉右侧两个
- 移动端改成 `flex-wrap: wrap` + 3 列的 `flex: 1 1 calc(33.333% - 4px)`，自动换行成 3+2 两行
- 同时把 `border-left` 改 `border-bottom`，当前事件改用下边框指示

**改动文件**：`src/ui/styles/global.css` 行 803-829（桌面）、889-913（移动）

---

#### 3. 阶段说明与公式混抢视觉边界（排版层级）

**现象**：
原来的 `PhysicsExplanation.tsx` 把阶段编号、名字、说明、公式都放在 `.explain` 盒里，公式和正文在同一容器内竞争，没有清晰的「何时是数学、何时是文字」的对比。

**解决方案**：
分离四层语义：
1. **元数据**（`.explain-meta`）：「阶段 N / M」细标签 + 「关键事件」旗标，字号 11px
2. **标题**（`.stage-name`）：当前阶段或事件名字，字号 15px、600 weight、-0.012em 字距
3. **正文**（`.stage-desc`）：物理解释，字号 12.5px、tertiary 灰
4. **公式**（`.formula`）：独立栏，竖线分隔、正体函数名、斜体变量名

此外修复公式排版：函数名（`sin`, `cos`, `tan` 等）改成正体（`.fn` class），这是数学排版的标准，让变量斜体与函数正体形成对比。

**改动文件**：
- `src/ui/components/workspace/PhysicsExplanation.tsx` 行 5-29（Formula 函数）
- `src/ui/styles/global.css` 行 609-645（explain 样式）

---

#### 4. 工作台视口溢出、画布被压小（布局约束）

**现象**：
工作台总高度 1028px（`.workspace` 被 flex 的 flex-basis: 0 撑成内容高度），超过了 900px 视口，底部的对话面板被挤到屏幕下方，整页需要滚动。

**解决方案**：
- `.workspace` 改成 `flex: 1; min-height: 0` 而不是 flex-basis: 0，明确说「吸收剩余空间，但不让内容撑爆」
- 两个面板（`.player-panel` / `.chat-panel`）改成 `min-height: 0; overflow: hidden` 自管滚动
- 画布 `.canvas-frame` 改 `flex: 1 1 auto` 成弹性主角，吸收多余高度

这样工作台永远占满视口，用户不用整页滚就能看到完整的互动界面。

**改动文件**：`src/ui/styles/global.css` 行 449-453、508-536、563-570

---

### 明确留到下一轮的改动

#### 1. 首页"内置示例"按钮的边界处理

示例载入时落回「缺项」状态（springGapM 被主动置空），需要用户补齐再应用。这是设计上的合理行为（避免示例"隐瞒"缺失的信息），但在 UX 上用户可能困惑。

**建议**：在 `SAMPLE_READING` 里加一个完整的默认 springGapM 值（比如 1.2），或在识别回包里额外标记"这是内置示例，所有条件已补齐，可直接开始"。这涉及到 B 角色（`src/services/imageRecognition.ts`）的改动，暂不在本次范围。

#### 2. 对话面板的消息气泡设计

当前用户消息是右对齐的浅灰背景气泡，AI 消息是左对齐无背景。在移动端上，对话气泡的宽度和尾部箭头可以更清晰。

**建议**：下一轮可以考虑加尾部箭头、调整 max-width、或改成不同的背景色来区分角色。这在视觉层面属于"可选的精致度提升"而非必需。

#### 3. 移动端 < 576px 超窄屏的横排问题

当前最小测试是 375 宽，但很多手机横屏模式会是 812×375（高比宽短）。在这种状态下，工作台的纵向堆叠会被压得很矮，画布几乎看不清。

**建议**：添加 orientation 媒体查询，横屏时改成左右两栏（画布左、对话右，高度共享视口）。这需要额外的 CSS 和可能的布局组件调整。

---

## 仍未解决的界面缺陷清单

### 严重程度 = 高

#### 1. 速度箭头在某些时刻不出现（可观察性）

**文件**：`src/ui/components/workspace/PhysicsCanvas.tsx` 行 291-328  
**现象**：当 `speed < 0.08 m/s` 时（比如刚释放时的加速度小于这个阈值），不绘制速度箭头。这导致滑块开始运动时看不到 v 标注，学生可能以为动画没有工作。  
**根因**：阈值 0.08 是为了过滤「太小的箭头」，但实际上对于首帧的任意速度都应该让学生看到一些表示。  
**建议**：改成"若速度 > 1e-6，绘制；如果太小则短箭头 + 小字号"，而不是完全隐藏。

#### 2. 压缩量标注在极小压缩 (< 0.012 m) 时不显示

**文件**：`src/ui/components/workspace/PhysicsCanvas.tsx` 行 350  
**现象**：`if (comp > 0.012)` 的阈值导致轻微压缩的 x 标注丢失。在弹簧刚接触时学生看不到压缩过程的可视化。  
**建议**：改成总是显示压缩量标注，如果太小则用不同的颜色或透明度区分"可见范围内"vs"超小压缩"。

### 严重程度 = 中

#### 3. 弹簧固定端的剖面线在移动端显示有锯齿

**文件**：`src/ui/styles/global.css`（不适用，这是 canvas 绘制）  
**现象**：墙面的剖面线（斜 45° 的短线）在 dpr > 1 的设备上有锯齿感。  
**根因**：canvas 绘制的斜线没有做抗锯齿优化。  
**建议**：改成用 `lineCap: 'round'` 或者改成用 SVG 就地渲染剖面线图案。

#### 4. 移动端 < 576px 时时间轴标签行间距过紧

**文件**：`src/ui/styles/global.css` 行 889-913  
**现象**：两行事件标签间的 gap: 4px 太小，五个标签在两行上排列时显得窝囊。  
**建议**：改成 gap: 8px 或者在 < 480px 时改成 gap: 12px。

### 严重程度 = 低

#### 5. 画布背景色没有响应系统深色模式

**文件**：`src/ui/components/workspace/PhysicsCanvas.tsx` 行 86、`src/ui/styles/global.css` 行 8  
**现象**：无论系统是否开启深色模式，画布背景始终是 `--paper` 的纸白 #fbfbf9。  
**建议**：添加 `@media (prefers-color-scheme: dark)` 下的 canvas 背景色（比如深灰 #1a1a1a），但这需要与整体的深色设计同步规划。

#### 6. 首页「内置示例」按钮的 hover 状态 gap 动画不平滑

**文件**：`src/ui/styles/global.css` 行 395-402  
**现象**：`.sample-button:hover` 时 gap 从 7px 变 10px，箭头往右滑动，在某些浏览器上显得"跳跃"而不是"滑动"。  
**建议**：改成用 `transform: translateX(3px)` 而不是 gap 变化，这样利用 GPU 加速会更平滑。

---

## 下一轮建议优先级

### 第 1 优先级（修复明显的 BUG，截止日期前必做）

1. **补全设计系统文档**  
   - 生成 `DESIGN_TOKENS.md`，列出间距/字号/颜色的完整尺度表
   - 目的：下一个接手的人能直接查表改样式，不用跑回对话里翻

2. **修复速度箭头和压缩量标注的小阈值问题**（缺陷清单 1、2）  
   - 改 `PhysicsCanvas.tsx` 第 299 行和第 350 行的阈值或逻辑
   - 类型检查 + 构建检查，不改物理计算

3. **首页与工作台的状态转移清理**  
   - 现在「内置示例」会落回缺项状态，在 `useWorkspace.ts` 的 `loadSample` 里补一个提示或自动填充
   - 或者和 B 角色协调，`SAMPLE_READING` 改成完整的有 springGapM

### 第 2 优先级（视觉精细度，时间充裕时做）

4. **弹簧剖面线抗锯齿**（缺陷 3）  
   - 改 `PhysicsCanvas.tsx` 的墙面绘制代码，用 `lineCap: 'round'` 或改图案

5. **移动端两行标签间距调整**（缺陷 4）  
   - `src/ui/styles/global.css` 行 909 的 gap 从 4px → 8px，或者添加 < 480px 的 media query

6. **对话气泡尾部箭头和颜色区分**  
   - 改 `.msg-body` 和 `.msg.user .msg-body` 的样式
   - 增加视觉反馈，但不涉及功能

### 第 3 优先级（可选的现代化改进，参赛评分可能加分）

7. **深色模式支持**（缺陷 5）  
   - 添加 `@media (prefers-color-scheme: dark)` 的全量调色方案
   - 需要与整体品牌深色调性对齐，建议先问用户是否需要

8. **超窄屏 (< 576px) 的横屏布局优化**（留到下一轮）  
   - 需要比较大的 HTML/CSS 改造，目前 375 宽已经验证没有问题

---

## 改动统计

```
 src/ui/components/workspace/EventTimeline.tsx      |   44 +++++-----
 src/ui/components/workspace/PhysicsCanvas.tsx      |  387 ++++++++++++--------
 src/ui/components/workspace/PhysicsExplanation.tsx |   39 ++++++++++-----
 src/ui/styles/global.css                           | 1039 +++++++++++++++----
 4 files changed, 938 insertions(+), 571 deletions(-)
```

**提交**：`248c5f4`  
**PR**：[https://github.com/Zhri1/VisualLab/compare/main...feat/ui-polish](https://github.com/Zhri1/VisualLab/compare/main...feat/ui-polish)

---

## 验证清单

- ✅ `npm run typecheck` — 无错误
- ✅ `npm run test` — 19/19 通过
- ✅ `npm run build` — dist 22.91 kB CSS + 192 kB JS
- ✅ 首页桌面端 1440×900 — 正常
- ✅ 首页移动端 375×812 — 正常
- ✅ 工作台桌面端 1440×900 — 正常、画布绘制、时间轴刻度清晰
- ✅ 工作台移动端 375×812 — 单列、条件表不挤爆、事件索引两行全可见
- ✅ 抽屉移动端 375×812 — 底部弹出、条件表可滚动

---

## 交接说明

**给下一个接手此分支的同学**：

1. 改动只涉及 UI 层（`src/ui/`、`src/ui/styles/`），未动物理计算、API、`src/App.tsx`、DevBar
2. 核心改进在三个地方：
   - **画布**（`PhysicsCanvas.tsx`）：从空白到正常绘制，统一线宽和标注
   - **时间轴**（`EventTimeline.tsx`）：从压叠到分层（刻度 + 索引）
   - **样式系统**（`global.css`）：重写了 1000 行，建立了明确的尺度和响应式
3. 遗留的小缺陷都在「缺陷清单」中有具体的文件行号和改进方案
4. 设计令牌（间距、字号、圆角）集中在 `global.css` 的 `:root` 段（行 1-23），修改颜色或尺度只需改这里
5. 本地预览用的 `.claude/launch.json` 不提交，已在 `.gitignore`
