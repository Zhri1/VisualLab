# 首版接口契约

动态组合的接口见 [运动阶段组合契约](STAGE_COMPOSITION.md)。

斜面末端沿切线直接斜抛的接续、两种地面输入与离檐事件见 [斜面斜抛扩展契约](INCLINE_PROJECTILE.md)。该增量先联审，合并后再实现；不改变旧转向、桌面或圆弧路径。

竖直内侧圆弧的新增字段与接续见 [圆弧扩展契约](VERTICAL_ARC.md)，实现须在该契约联审合并后接入。

预压弹簧释放、能量反求和部分精确播放的增量见 [预压弹簧契约](PRECOMPRESSED_SPRING.md)。该增量独立联审，合并前不改变运行时支持范围。

固定支点轻绳摆、最低点正碰、多物体同步状态与松绳边界见 [摆与碰撞契约](PENDULUM_COLLISION.md)。该增量先联审；保留现有单物体入口，尚未登记的新阶段不作为当前可播放能力。

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

浏览器用 `POST /api/animation/plan` 发送 `multipart/form-data`，图片字段为 `image`，支持单张 JPG 或 PNG。可选字段 `text` 为文字模式下学生补充的题目描述（≤ 2000 字），提供时与图片一起送给模型，与图中标注冲突时以文字为准。

| HTTP | 响应体 | 页面处理 |
|---|---|---|
| 200 | `{ "status": "ok", "reading": { ... }, "message": "已按 g=10 m/s²、μ=0.5 计算", "assumptions": ["g=10 m/s²", "μ=0.5"] }` | 展示原图与识别值，计算并播放。 |
| 200 | `{ "status": "needs_input", "reading": { ... }, "missingKeys": ["springGapM"], "message": "请确认水平间距", "assumptions": ["g=10 m/s²", "μ=0.5"] }` | 保留已解析字段，提示补值，已识别部分的假设条目照常展示。无法识别题型时 `reading` 可为 `null`，提示重拍。 |
| 200 | `{ "status": "unsupported", "message": "当前版本支持斜面接光滑水平面与弹簧的运动" }` | 提示支持范围，提供内置示例入口。 |
| 400、502 或 504 | `{ "message": "..." }` | 分别对应无效图片、识别服务失败、超时。保留图片并允许重试。 |

三种 200 回包都带 `message`，页面把它显示在对话区：`ok` 时是本次计算的假设摘要（由 `assumptions` 拼成，没有假设时给一句“已按题面条件识别完成”），`needs_input` 与 `unsupported` 时是给用户的提示。

`assumptions` 在 `ok` 和 `needs_input` 两种回包里都有，0–3 条字符串，原样透传模型的说明条目。缺项回包把它挂在同一条助手消息上，页面复用 `ok` 的假设胶囊，不再区分状态；该字段可省略，前端按「没有假设」处理。`unsupported` 只有 `message`，不带 `assumptions`。

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

## 4. 播放器适配入口

播放器从 `src/adapters/index.ts` 取得 `motionLibrary`，共享类型沿用 `src/types/index.ts`。适配层复用 `src/physics` 的校验和计算，纯计算公共导出保持可供服务端使用。

| 纯计算结果 | 播放器结果 |
|---|---|
| 段 `id` | `kind`，保留 incline、horizontal、spring |
| turn、spring_contact、spring_detach | reach_bottom、contact_spring、detach_spring |
| beforeVelocity、afterVelocity | velocityBefore、velocityAfter，分量映射为 x、y |
| explanation | caption 和 detail，数值随求解结果更新 |
| xM、yM、vxMps、vyMps | position 和 velocity 的 x、y |
| NEEDS_INPUT | MISSING |
| INCONSISTENT_CONDITIONS | PRECONDITION_CONFLICT |
| UNSUPPORTED | 题型字段映射为 UNSUPPORTED_TEMPLATE，其他前提映射为 PRECONDITION_CONFLICT |
| INVALID_READING | 非有限数字映射为 NOT_FINITE，其他格式或范围错误映射为 RANGE |

错误保留原字段名。转向事件归水平段，接触事件归弹簧段。水平与弹簧取样的 position.y 均为 0，画布自行计算滑块中心。弹簧接触事件的 position.x 等于 springContactX，固定端使用物理库预留最大压缩空间的示意位置，blockSizeM 为 0.3。μ 只用于斜面。

适配场景为本地对象，装配时保存一次求解结果以确定绘制几何，buildMotion 映射播放器字段。用户改值后重新装配场景。超出区间的时间取最近端点，播放器适配层将 NaN 时间按释放时刻处理。

验收执行 `npm run test`（含真实公开入口的 19 项用例）、`node --test "src/physics/*.test.ts"`（14 项）和 `npm run build`。构建配置启用 TypeScript 扩展名导入，开发依赖补齐 Node 测试类型。Vitest 排除物理层原生 Node 测试文件，继续使用默认规则发现其余测试。
