# 运动阶段组合契约（供 A、B、C 联审）

本契约对应 [参赛规划](PROJECT_PLAN_FINAL.md) 的动态组合要求。B 起草并维护物理接口。A 核对条件表、几何绘制和播放器，C 核对识图、文字指令及两种后端的回包。先用第 4 节的开发样例联调，正式五题另选。

## 1. 输入及兼容

上传接口沿用 `POST /api/animation/plan`，接收 `image` 或 `text`。成功与部分识别的结果继续由 `reading` 承载。旧数据用 `templateId` 识别，新数据用 `kind: "stage_plan"` 和 `schemaVersion: 1` 识别。旧斜面弹簧输入、返回结构和数值基准继续用于回归。

新 `reading` 包含一个运动物体的初态、题目参数和有序的 `stages`。每段按 `kind` 选择库模块。初态直线运动用 `speedMps`，直接进入抛体时用 `vxMps` 和 `vyMps`。只有第一段使用显式初速度，后续段从前一段继承。公共 `gravityMps2` 供重力和摩擦计算，`massKg` 在求弹簧段时必需。未给定的必需参数用 `null`，可选且未被阶段使用的参数可省略。数值均为米制，角度用度。

`ok` 返回可计算计划。`needs_input` 返回能确认的部分，用 `missingKeys` 定位到字段。例如 `/stages/2/end/distanceM` 指向下标为 2 的阶段。旧数据维持原字段名定位。`unsupported` 说明缺少支持的模块或题设的连接方式。上传格式和上游异常沿用现有 HTTP 状态。

## 2. 阶段及其接续

| 阶段 `kind` | 题设字段 | 求解结果 |
|---|---|---|
| `incline_slide` | `lengthM`、`angleDeg`、`kineticFrictionCoefficient`。静止释放使用 `slidesAfterRelease: true` 确认题设支持下滑。 | 入射方向沿斜面向下，计算到坡底或提前停住的时刻和末态。 |
| `lossless_turn` | `lossless: true`，题面给出或明确支持光滑、可忽略高度差的过渡。 | 坡底位置与速率连续，速度转向水平，记为零时长事件。 |
| `horizontal_slide` | `kineticFrictionCoefficient`，以及 `end: { kind: "distance", distanceM }` 或 `end: { kind: "stop" }`。 | 距离目标和停止条件都存在时，取先发生的事件。光滑水平面上的正初速运动需有明确距离目标。 |
| `spring_contact` | `springConstantNpm`、`frictionless: true`、`unattached: true`。 | 由接触点和入射速度计算压缩、反弹和脱离。接触段终止于恢复原长。 |
| `projectile` | `dropHeightM`，表示发射点到落地平面的竖直落差。 | 自发射状态起算，输出落地和实际发生的最高点。落地样本保留首次接地速度。 |

V1 连接规则包括斜面到坡底后接无损转向，转向后接水平滑动或弹簧接触，以及水平到指定距离后接弹簧或抛体。单个滑动、弹簧或抛体阶段可以独立生成。模块根据题设检查接续前提，弹簧须水平正速入射，处于桌沿且速度仍向外才接平抛。**当停止先发生，或在桌沿恰好停住时，动画结束于停止事件。** 落地和弹簧脱离为本版的结束事件。

新场景统一用起始位置作为坐标原点，x 向右、y 向上。支撑面、接触点与落地平面由题设和前段结果定位。阶段间位置连续。方向变化通过显式事件记录，后续阶段继承事件后的速度。落差以该抛体段的发射位置为基准。水平段接抛体时，距离目标就是桌沿位置，提前停住也按题设绘制桌沿。

## 3. 播放及阶段编辑

B 的装配和构建入口保持 `assembleScene → buildMotion`。成功结果提供米制几何、总时长、已实际执行的 `segments`、`events` 和 `sampleAt(timeSeconds)`。每个段和事件可关联到原计划的阶段下标，事件标识在同一次计算中唯一。画布使用场景给出的斜面、水平面、弹簧和地面等绘制要素。采样至少包含 `xM`、`yM`、`vxMps`、`vyMps`，弹簧段附压缩量。时间越界时取最近端点，同刻事件按执行顺序输出，精确事件时刻取最后一个已执行事件后的状态。

「只看斜面」由 C 解析为截至指定阶段的修改意图，A 提交截断后的阶段前缀，B 按原参数重新装配。该场景在坡底结束，末速度沿斜面方向，画面和时间轴都按新结果生成。修改失败时保留原输入及最近一次有效结果。

## 4. 新组合的共享开发样例

这条组合在原整题预设中没有登记。斜面长 3.6 m、倾角 30°，滑块由静止下滑。坡底经过无损过渡进入动摩擦因数 0.2 的水平桌面。桌沿距坡底 5 m，桌面离地 1.25 m，取重力加速度 10 m/s²。

```json
{
  "kind": "stage_plan",
  "schemaVersion": 1,
  "gravityMps2": 10,
  "initial": { "speedMps": 0 },
  "stages": [
    { "kind": "incline_slide", "lengthM": 3.6, "angleDeg": 30, "kineticFrictionCoefficient": 0, "slidesAfterRelease": true },
    { "kind": "lossless_turn", "lossless": true },
    { "kind": "horizontal_slide", "kineticFrictionCoefficient": 0.2, "end": { "kind": "distance", "distanceM": 5 } },
    { "kind": "projectile", "dropHeightM": 1.25 }
  ]
}
```

## 5. 联调验收

| 输入或操作 | 对照结果 |
|---|---|
| 完整新组合 | 1.2 s 到坡底，转向后速率 6 m/s。2.2 s 以 4 m/s 离桌，2.7 s 落地，落点在桌沿右侧 2 m，接地速度为 (4, −5) m/s。 |
| 桌沿移至距坡底 10 m | 4.2 s 时在坡底右侧 9 m 停住，时间轴到停止为止。 |
| 桌沿恰距坡底 9 m | 4.2 s 时在桌沿停住，末速度为零。 |
| 对该计划输入「只看斜面」 | 保留原斜面条件，1.2 s 于坡底结束。末速度为 (3√3, −3) m/s。完整计划同刻转向后的取样为 (6, 0) m/s。 |
| 原斜面弹簧 | 原题的事件时刻、最大压缩量、字幕和几何回归通过。 |

A 用共享计划核对绘图、停止与飞出两条分支、阶段列表和字段定位。C 核对 Node 服务和 Qoder 云函数对同一题的字段、状态和单位一致，并用文字识别「只看斜面」。B 用解析结果审核阶段衔接、样本和事件。
