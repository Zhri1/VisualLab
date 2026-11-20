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

## 5. 批量模型第一阶段契约

本节登记纯物理模板。首题的字段、数值及播放器调用路径继续兼容。新增 Reading 使用 templateId 判别条件和事实，几何也携带 templateId。统一入口仍为 src/physics/index.ts 的 validateReading → assembleScene → buildMotion，成功形状分别为 { ok: true, reading/scene/motion }，失败为 { ok: false, code, message, fields }。

数值均为 SI，倾角用度。下列数值均须有限，缺字段或 null 返回 NEEDS_INPUT 及原字段名。事实取 true、false 或 null，必要事实为 null 时提示补齐，false 时返回 UNSUPPORTED。类型或范围错误返回 INVALID_READING，静止下滑与非正加速度冲突返回 INCONSISTENT_CONDITIONS。新增字段不接受字符串数字，由识图层负责归一化。额外字段不参与计算。

### 5.1 模板字段

| templateId | conditions（括号内为范围） | 必须为真的 facts |
|---|---|---|
| horizontal_spring | initialSpeedMps（>0）、blockMassKg（>0）、springGapM（>0）、springConstantNpm（>0） | horizontalIsFrictionless、springIsUnattached |
| incline_to_stop | gravityMps2（>0）、inclineAngleDeg（0–90，不含端点）、inclineLengthM（>0）、kineticFrictionCoefficient（≥0，仅斜面）、initialSpeedMps（=0）、horizontalKineticFrictionCoefficient（>0） | slidesAfterRelease、losslessTurn |
| table_edge_projectile | gravityMps2（>0）、initialSpeedMps（>0，朝右侧桌沿）、kineticFrictionCoefficient（≥0，仅桌面）、tableHeightM（>0）、distanceToEdgeM（>0） | airResistanceIsNegligible |
| projectile_motion | gravityMps2（>0）、initialVxMps（任意有限数）、initialVyMps（任意有限数）、initialHeightM（≥0） | airResistanceIsNegligible |

horizontal_spring 的水平面光滑，至第一次脱离结束。incline_to_stop 的水平摩擦须为正，零摩擦无法在有限时间停下，按 UNSUPPORTED 提示；非零正初速也超出该模板。table_edge_projectile 以停止或首次落地结束。projectile_motion 的坐标起点横坐标为 0，竖直向上为正，以首次接触 y=0 的地面结束。

### 5.2 阶段、事件和几何

| 模板 | geometry 的字段（点均为 {xM,yM}） | segments 的 id | events 的 id |
|---|---|---|---|
| horizontal_spring | templateId、horizontal:{start,end}、spring:{contact,anchor} | horizontal、spring | release、spring_contact、max_compression、spring_detach |
| incline_to_stop | templateId、incline:{start,end}、horizontal:{start,end} | incline、horizontal | release、turn、stop |
| table_edge_projectile | templateId、table:{start,edge}、ground:{start,end} | table，可接 projectile | release，随后 stop 或 table_edge、land |
| projectile_motion | templateId、start、ground:{start,end} | projectile（零时长边界允许空数组） | release，可选 apex，land |

首题运行时 scene.templateId 和 geometry.templateId 为 incline_spring，保留所有原字段。旧调用方手工构造的首题 Scene 可省略判别字段。新增 Scene 包含 templateId、已验证 reading 和 geometry，并保存一次求解的 motion 供 buildMotion 返回；题设变更后重新 assembleScene，沿用第 4 节的本地场景约定。Motion 包含上述 geometry、durationSeconds、segments、events、sampleAt，样本仍为 {xM,yM,vxMps,vyMps,springCompressionM}。事件带 timeSeconds、label、explanation，turn 带 beforeVelocity 和 afterVelocity。弹簧固定端为示意位置，须在最大压缩点右侧。

各段 startSeconds/endSeconds 首尾相接，位置连续，事件取样采用阶段后的状态。所有时间均从 release 开始，重合事件按 release、终止事件排序。有限越界时间夹至端点，NaN 视为起点，正负无穷分别夹至终点和起点。停止后速度为零。落地后以接触地面瞬间的入射速度结束，位置 y=0，随后取样保持该状态，不模拟碰撞。弹簧脱离时压缩量恰为 0、水平速度向左。只有严格处于飞行开始与落地之间的最高点才生成 apex。地面静止、水平或向下起始时，释放即落地，总时长为 0，终点速度取初速度。

桌面以停止距离 v₀²/(2μg) 与距桌沿距离比较。停止距离小于或等于桌沿距离时生成 stop，恰在边沿也无平抛段；浮点比较容差为 16×Number.EPSILON×两距离较大值，仅用于判定相等。μ=0 时始终以正速离桌。飞行段从桌沿继承位置和水平速度，竖直初速度为 0。

### 5.3 独立验收基准

| 模板/变式 | 输入 | 手算预期 |
|---|---|---|
| horizontal_spring | m=1、v₀=2、gap=1、k=100 | 接触 0.5 s，ω=10，最大压缩 0.2 m，最大压缩 0.6570796327 s，脱离 0.8141592654 s、vx=−2 |
| incline_to_stop | g=10、θ=30°、L=4、斜面 μ=0、水平 μ=0.25 | a=5，坡底 t=√1.6≈1.2649110641 s、v=√40≈6.3245553203 m/s，水平距离 40/5=8 m，总时长≈3.7947331922 s |
| table_edge_projectile | g=10、μ=0.2、v₀=6、h=1.25、距边沿5 | 1 s 离桌、vx=4，飞行√(2h/g)=0.5 s，距桌沿2 m落地，总时长1.5 s |
| 同上，距边沿10 | 其他相同 | 3 s 停在起点右侧9 m，无 table_edge/land |
| 同上，距边沿9 | 其他相同 | 3 s 恰停边沿，无飞行段 |
| projectile_motion 自由落体 | g=10、h=5、vx=0、vy=0 | 1 s 落地 |
| 同上，平抛 | h=1.25、vx=4、vy=0 | 0.5 s 落地、x=2 m |
| 同上，竖直上抛 | h=0、vx=0、vy=10 | 1 s 达5 m最高点、2 s 落地 |
| 同上，斜抛 | h=0、vx=4、vy=10 | 1 s 最高点、2 s 落地、x=8 m |

上表坡底速度的精确手算是 6.3245553203 m/s，展示四位小数为 6.3246。样例见 fixtures/horizontal-spring.reading.json、incline-to-stop.reading.json、table-edge-projectile.reading.json、projectile-motion.reading.json。

### 5.4 本批兼容与后续接入

- 首题继续由原 reading.ts、scene.ts、motion.ts 的兼容接口供既有调用方使用，统一 index.ts 按模板分派。原 Reading、Scene、Motion 的首题类型保留别名，新增类型不强迫首题 UI 消费新几何。
- 播放器后续需同步 src/types/index.ts、src/adapters/physicsMotionAdapter.ts、条件表、画布几何和对话字段。当前适配器继续明确走首题路径，新增模板本批通过纯物理入口验收。
- 识图 API 后续需同步 src/api/contract.ts、validate.ts 和 skills/vision-reading.v1.md 的模板登记、字段归一化及样例。其读取 reading.ts 的首题兼容校验暂保留。
- Qoder functions/handler.ts 仍有独立物理字段校验，后续须同步模板、字段和缺项规则，并统一复用规则。functions/skill.ts 及构建读图说明也需同步。本批不发布线上模型。
- 本地批次测试执行 node --test "src/physics/*.test.ts"。现有 npm run test:physics 显式列出两份旧测试，新增用例须用上述通配命令执行；后续工程集成时可同步脚本。旧 npm run test 和 npm run build 仍须通过。
