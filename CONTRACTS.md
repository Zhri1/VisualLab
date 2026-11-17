# 首版接口契约

首版模板为 `incline_spring`。主演示题、物理前提和验收数值见 [参赛最终方案](PROJECT_PLAN_FINAL.md)。

## 1. 识别数据 `Reading`

AI 返回结构化 `reading`。样例是 [incline-spring.reading.json](fixtures/incline-spring.reading.json)，前端、动画库和识别服务共用这一份。

| 条件字段 | 单位和要求 |
|---|---|
| `gravityMps2` | m/s²，有限正数 |
| `inclineAngleDeg` | 度，大于 0° 且小于 90° |
| `inclineLengthM` | m，有限正数 |
| `kineticFrictionCoefficient` | 无量纲，有限非负数 |
| `initialSpeedMps` | m/s，首版为 0 |
| `blockMassKg` | kg，有限正数 |
| `springGapM` | m，坡底到弹簧原长接触端的水平距离，为有限正数 |
| `springConstantNpm` | N/m，有限正数 |

`facts` 记录「释放后下滑」「无损转向」「水平面光滑」「滑块与弹簧不连接」，字段名依次为 `slidesAfterRelease`、`losslessTurn`、`horizontalIsFrictionless` 和 `springIsUnattached`。事实用 `true`、`false` 或 `null` 表示。无法确认的数值也用 `null`，保留给用户补齐。题面明确违背模板前提时返回超范围。

## 2. 上传接口

浏览器用 `POST /api/animation/plan` 发送 `multipart/form-data`，图片字段为 `image`，支持单张 JPG 或 PNG。

| HTTP | 响应体 | 页面处理 |
|---|---|---|
| 200 | `{ "status": "ok", "reading": { ... } }` | 展示原图与识别值，计算并播放。 |
| 200 | `{ "status": "needs_input", "reading": { ... }, "missingKeys": ["springGapM"], "message": "请确认水平间距" }` | 保留已解析字段，提示补值。无法识别题型时 `reading` 可为 `null`，提示重拍。 |
| 200 | `{ "status": "unsupported", "message": "当前版本支持斜面接光滑水平面与弹簧的运动" }` | 提示支持范围，提供内置示例入口。 |
| 400、502 或 504 | `{ "message": "..." }` | 分别对应无效图片、识别服务失败、超时。保留图片并允许重试。 |

`missingKeys` 使用 `reading` 中的原字段名，例如 `springGapM`。后端负责校验模型回包，浏览器负责根据本地编辑后的数据重新生成场景。

## 3. 场景装配与播放

`assembleScene(reading)` 检查必填字段、单位范围和模板前提。成功时返回场景，失败时给出字段及说明。坐标原点为斜面底端，水平向右、竖直向上。倾角、斜长或弹簧间距发生修改时，重新装配图形和阶段。静止释放且下坡加速度小于或等于零时，提示用户核对矛盾的条件。

`buildMotion(scene)` 成功时返回以下本地对象，失败时返回可展示的 `code` 和 `message`。

| 字段或方法 | 内容 |
|---|---|
| `geometry` | 米制斜面端点、水平面、弹簧原长接触端和固定端。未给弹簧原长时按示意画，压缩位移按计算值。 |
| `durationSeconds`、`segments` | 总物理时长，以及斜面滑动、水平匀速、弹簧接触三段的起止时间。 |
| `events` | 从释放开始计的事件时间、名称和字幕。转向事件可带前后速度向量。 |
| `sampleAt(timeSeconds)` | 同一坐标系下滑块的位置、速度和弹簧压缩量。在事件时间取样时采用事件后的状态。 |

用户点击「应用条件」后在浏览器依次调用 `assembleScene` 和 `buildMotion`。暂停、重播和跳转只改变播放器时间。画面、字幕和下一关键点共用 `events` 与同一时间轴。

把样例中的 `springGapM` 从 1 改为 2，弹簧接触位置应右移 1 m，首次接触时刻从约 2.2361 s 变为 2.4845 s。
