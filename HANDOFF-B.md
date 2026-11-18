# 给 B：动画库对接说明

A 的播放器通过 MotionLibrary 接入 B 的纯计算库，入口为 src/adapters/index.ts。

## 替换点

`src/adapters/index.ts` 已接入：

```ts
import { physicsMotionLibrary } from "./physicsMotionAdapter";
export const motionLibrary: MotionLibrary = physicsMotionLibrary;
```

物理层仍通过以下公共入口供其他调用方使用：

```ts
import { validateReading, assembleScene, buildMotion } from "../physics";
```

播放器签名定义在 `src/adapters/contract.ts`，共享类型在 `src/types/index.ts`。适配层映射字段、错误码与事件 ID，动力学计算由 `src/physics` 完成。适配场景为本地对象，装配时保存一次完整求解结果，随后 buildMotion 只映射播放器数据。修改题设仍重新调用 assembleScene → buildMotion。

## 坐标系

原点在**斜面底端**，x 向右、y 向上，单位米。

斜面顶点是 `(-L·cosθ, L·sinθ)`，水平面是 y = 0。

**`position` 一律指滑块的前下沿接触点**，不是几何中心——就是贴着支撑面、朝运动方向的那个角。这条是最容易对不上的地方：如果两边定义不同，画面会整体偏半个滑块边长，而数值测试仍然全绿，因为测试只查时间。

所有取样沿用 B 的坐标作为绘制参考点。斜面上为前下沿，水平和弹簧段均为右下角且 y = 0。画布自行换算几何中心。springContactX 与接触事件的 position.x 相等，固定端采用 B 为最大压缩留出空间的示意位置，滑块边长沿用 0.3 m。

## 返回结构

```ts
{
  geometry: { inclineTop, inclineBottom, horizontalEnd, springContactX, springAnchorX, blockSizeM },
  durationSeconds: number,   // 总物理时长，不是动画播放时长
  segments: MotionSegment[], // 三段：incline / horizontal / spring
  events: MotionEvent[],
  sampleAt(t: number): MotionSample
}
```

几个约定：

`segments` 要有三段，`kind` 分别 `incline`、`horizontal`、`spring`，`startSeconds`/`endSeconds` 首尾相接。播放器的阶段卡按这个切。

`events` 建议至少这五个，`id` 用固定值，因为对话跳转要按 id 找：`release`、`reach_bottom`、`contact_spring`、`max_compression`、`detach_spring`。`reach_bottom` 要带 `velocityBefore` 和 `velocityAfter`，转向是瞬时事件。`caption` 是画面上同步显示的一句原理说明，控制在一行半以内。

`sampleAt(t)` 在事件时刻取样要返回**事件后**的状态。t 超出 `[0, durationSeconds]` 时请夹到边界，不要返回 NaN 或抛错——时间轴拖动会短暂越界。

## 校验

`assembleScene` 失败返回 `{ ok: false, errors: FieldError[] }`，每个 error 带 `field`（原字段名，如 `springGapM`）和 `message`。我直接用 `field` 去高亮核对表里对应的输入框，所以字段名必须是契约里的原名。

要拦的情况：缺项、非有限数、超出范围、事实为 false、静止释放时 `g(sinθ − μcosθ) ≤ 0`（μ ≥ tanθ，滑块不会自行下滑）。

## 验收基准

`npm run test` 通过公开入口运行原有 13 条与新增 6 条接入验收。物理层另运行 `node --test "src/physics/*.test.ts"` 的 14 项测试。基准值：

| 量 | 值 |
|---|---|
| a | 2.0250 m/s² |
| t₁ | 1.9876 s |
| v₁ | 4.0249 m/s |
| t₂（gap=1） | 2.2361 s |
| t₃ | 2.3146 s |
| x_max | 0.2012 m |
| F_max | 80.50 N |
| t₄ | 2.3932 s |
| k=100 时 x_max | 0.4025 m |
| gap=2 时 t₂ | 2.4845 s |

用例的容差是 ±0.0005，末位小数不同属正常。

## 一个需要你确认的点

方案说水平面光滑，我这边水平段按匀速实现。但契约允许 `kineticFrictionCoefficient` 非零，而它显然只作用于斜面。如果你的模型想让 μ 也作用在水平段（真实题目里有时如此），那和 `horizontalIsFrictionless: true` 这个前提冲突，需要先在契约里改清楚再动代码。

我按「μ 只作用于斜面、水平段匀速」实现。如果理解错了，现在改比后面改便宜。

