# B · 物理动画库开工说明

B 负责把题设变成可播放的运动。首个交付是 `incline_spring`。A 用库返回的几何和运动状态做界面，C 用同一份识别数据规则做接口。首版范围、物理假设和分工见 [最终方案](PROJECT_PLAN_FINAL.md)。上传 API 和识别数据见 [接口契约](CONTRACTS.md)，标准输入见 [联调样例](fixtures/incline-spring.reading.json)。

## 开工前对齐

| 对接人 | 要确认的内容 | 开工默认值 |
|---|---|---|
| A · 前端 | B 的模块入口、坐标、取样和字幕事件 | 从 `src/physics/index.ts` 导入。米制坐标向右、向上为正，坡底为原点。A 负责像素映射和播放时钟。 |
| C · 读图接口 | 标准 `Reading`、缺条件和不适用模板的处理 | 共用 `validateReading`。题设数字统一单位，缺项保留 `null`，物理前提须由题面支持。 |
| A 与 C | 改值后的重算入口 | A 在浏览器调用 `assembleScene → buildMotion`。C 的 HTTP 回包携带 `reading`。 |

下面的字段名作为 B 首次联调约定。A、C 可以据此先接样例。有改动先同步到同一份契约和样例。

## 导出接口

- `Reading` 沿用标准 JSON 的 `templateId`、`conditions` 和 `facts`。数值字段可为 `null`，事实为布尔值或 `null`。`Scene` 表示装配完成的内部场景。
- `validateReading(input: unknown)` 和 `assembleScene(input: unknown)` 成功时分别返回 `{ ok: true, reading }` 和 `{ ok: true, scene }`。预期失败统一返回 `{ ok: false, code, message, fields }`。`fields` 为原字段名数组，例如 `["springGapM"]`。缺项对应 `NEEDS_INPUT`，题型或题设前提明确不适用对应 `UNSUPPORTED`，格式或范围有误对应 `INVALID_READING`，零初速且下坡加速度不为正对应 `INCONSISTENT_CONDITIONS`。
- `buildMotion(scene: Scene)` 成功返回 `{ ok: true, motion }`，失败沿用上述结果形状。A 只依赖以下输出，场景装配细节由 B 维护。

| `motion` 字段 | 结构与约定 |
|---|---|
| `geometry` | `incline: { start, end }`、`horizontal: { start, end }`、`spring: { contact, anchor }`。各点为 `{ xM, yM }`，含滑块位置的坐标均以质点为准。`contact` 是弹簧原长时的接触点，固定端 `anchor` 位于最大压缩位置右方，弹簧原始长度为绘制示意。 |
| `durationSeconds` | 从释放到第一次脱离弹簧的物理时长。 |
| `segments` | 每项为 `{ id, startSeconds, endSeconds }`。三段 ID 为 `incline`、`horizontal`、`spring`。 |
| `events` | 每项至少有 `{ id, timeSeconds, label, explanation }`，按时间排序。事件 ID 为 `release`、`turn`、`spring_contact`、`max_compression`、`spring_detach`。`turn` 另提供 `beforeVelocity` 和 `afterVelocity`，均为 `{ vxMps, vyMps }`。 |
| `sampleAt(timeSeconds)` | 返回 `{ xM, yM, vxMps, vyMps, springCompressionM }`。播放器输入有限时间，超出区间的有限值取最近端点。事件时刻采用事件后的状态。 |

转向作为一个瞬时事件，坡底位置连续，速率大小保持，竖直分量归零。弹簧接触后的运动使用接触时的水平速度，最大压缩对应弹簧段内的事件。脱离时压缩量回到 0，水平速度向左。三个阶段在同一时间轴上。原理说明由库根据计算值生成，避免改值后字幕失真。

## 两个实现提交

| 节点 | 交付 | 验收 |
|---|---|---|
| **1 · 读数校验与场景装配** | `Reading`、`validateReading`、`assembleScene`、共用入口及针对性测试。提交后 A、C 可先接类型和字段。 | 标准 JSON 可装配。缺 `springGapM` 保留具体字段提示。无损转向为假时判不适用。动摩擦因数为 0 合法，负数非法。将间距改成 2 m 后接触点右移 1 m。 |
| **2 · 分段运动与联调交付** | 斜面加速、无损转向、水平匀速、弹簧压缩与反弹，输出三段和事件。更新验收结果，提交后开一份合并请求。 | 基准数值及端点、转向前后连续性、两种改值场景通过。 |

每个节点自测后提交到 GitHub 的 `feat/b-physics-mvp`，修复审核发现的问题再集中提交。通过合并请求与 A、C 联调。P1 平抛按 [最终方案](PROJECT_PLAN_FINAL.md) 在公网主链验收后单独安排。

## 审核用例

| 用例 | 预期 |
|---|---|
| 标准读数 | 到坡底约 `1.9876 s`、速率约 `4.0249 m/s`，在 `2.2361 s` 接触弹簧。 |
| 最大压缩 | 约 `2.3146 s`，压缩量约 `0.2012 m`，速度约 0，弹力约 `80.50 N` 且向左。 |
| 脱离弹簧 | 约 `2.3932 s`，压缩量为 0、水平速度约 `−4.0249 m/s`，位置为原长接触点。 |
| 调整间距 | `springGapM=2` 时接触点右移 1 m，约 `2.4845 s` 接触，最大压缩量保持。 |
| 调整劲度系数 | `springConstantNpm=100` 时最大压缩约 `0.4025 m`，接触时刻保持。 |
| 模板前提冲突 | 把动摩擦因数改为 0.9，同时保留从静止开始下滑。提示核对条件。 |

测试用时间和位置的数值容差，按事件返回的原始时间验收取样。审查时同时看导出是否符合约定、结果是否与算例一致，以及提交是否只涉及 B 的范围。
