# 运动阶段组合契约（供 A、B、C 联审）

独立水平正碰的待联审扩展见 [HORIZONTAL_COLLISION.md](HORIZONTAL_COLLISION.md)：新增按bodyId给定的两物体初态和horizontal_approach，collision_1d增加horizontal_meeting接触来源；碰后复用并行轨道。不能把本文件旧单物体initial或摆的targetApproach套入新入口。

本契约对应 [参赛规划](PROJECT_PLAN_FINAL.md) 的动态组合要求。B 维护校验、装配与运动接口，A 核对绘图、时间轴和编辑，C 核对识别、指令与两套后端的回包。三方先用第 5 节的开发样例联调，正式五道真题另选。

新增 `vertical_arc`、固定落地平面及圆弧状态的约定见 [圆弧扩展契约](VERTICAL_ARC.md)。该扩展单独联审，旧阶段和本文件第 5 节的基准保持兼容。

完整内轨与任意入口圆弧的显式 `path` 分支见 [圆轨增量](CIRCULAR_TRACK.md)：圆心、入口角、方向及实体端点/观察范围必须区分；该分支先联审，旧半圆输入不变。下表与几何示例中“最低点水平向右”仅指旧模式，新模式按实际切线/世界坐标接续，观察结束仍保留约束和非零速度。

新增 `spring_release`、跨释放位移的水平距离基准、能量反求与示意/精确播放范围见 [预压弹簧扩展契约](PRECOMPRESSED_SPRING.md)，独立联审后接入。

新增轻绳摆、最低点正碰、受控并行和按bodyId同步取样见 [摆与碰撞扩展契约](PENDULUM_COLLISION.md)。本文件以下单物体描述继续适用于旧计划；新增body表、初态、坐标、几何和事件快照以该扩展为准，待联审合并后实现。

斜面末端直接沿切向进入抛体的增量见 [斜面斜抛扩展契约](INCLINE_PROJECTILE.md)。该扩展先联审，明确正速离檐、停止优先、地面坐标和同刻事件；不将斜面后的速度默认转为水平。

## 1. 图文输入、指令与计划格式

`POST /api/animation/plan` 接收 `multipart/form-data`。Qoder 云函数采用相同字段与回包。两种请求模式互斥。

| 模式 | 请求字段 | 成功回包 |
|---|---|---|
| 识别新题 | `image` 或 `text` 至少一个。`text` 用于题面或题设补充。 | `{ status: "ok", reading }` |
| 修改当前运动 | `command` 为修改指令，`currentPlan` 为当前有效阶段计划的 JSON 字符串。 | `{ status: "ok", intent }` |

例如「只看斜面」通过 `command` 提交，识别接口的 `text` 继续承载题设。混用两种模式或指令缺少当前计划时返回 400。指令无法确认时返回 `needs_input` 及澄清提示，明确超出范围时返回 `unsupported`。图片格式或上游异常沿用已有 HTTP 状态。

旧题用 `templateId` 标记，沿用 [首版契约](CONTRACTS.md) 的输入与回包。新题的 `reading` 使用 `kind: "stage_plan"`、`schemaVersion: 1`，并按题意给出可用模块的有序 `stages`。数值使用米制，角度用度。

| 计划字段 | 约定 |
|---|---|
| `massKg` | 位于计划顶层。含 `spring_contact`、`vertical_arc`、`magnetic_deflection` 或扩展 `spring_release` 的计划需给出有限正质量；圆弧用其输出法向力，预压释放及能量推导见 [预压弹簧契约](PRECOMPRESSED_SPRING.md)。其他阶段可省略。 |
| `gravityMps2` | 位于计划顶层。斜面、含动摩擦的水平滑动或预压释放、抛体及竖直圆弧需要有限正值，未给出时以 `/gravityMps2` 提示补齐。仅有光滑水平运动、光滑弹簧接触或匀强磁场偏转时可省略。圆弧约定见 [扩展契约](VERTICAL_ARC.md#1-输入单位与范围)。 |
| `initial` | 初段为斜面、水平、弹簧或竖直圆弧时用 `{ speedMps }`，方向由阶段确定；预压释放本批为静止，圆弧从最低点水平向右入射。初段为抛体时用 `{ vxMps, vyMps }`。初段为磁场偏转时，水平向右入射可用 `{ speedMps }`，也可用带符号的 `{ vxMps, vyMps }`。两种形状互斥，后续段从前一段继承速度。 |
| `constraints`、`energy`（扩展） | 预压释放的活动题面条件及规范化后保留的能量来源记录，见 [预压弹簧契约第4节](PRECOMPRESSED_SPRING.md#4-题面约束固定能量与缺参处理)。由B推导，AB编辑保留已固定能量，不重施原临界条件。 |
| `stages` | 非空的有序阶段列表。阶段特有的事实放在相应阶段内，组合计划无需全局 `facts`。 |
| `bodies`、`primaryBodyId`（待实现扩展） | [摆与碰撞契约第1节](PENDULUM_COLLISION.md#1-范围坐标和物体标识)定义稳定ID和各自质量；旧无body表的单物体计划保持原值。新摆初态、碰后并行规则不能按旧单物体的顺序速度继承猜测。 |

已知结构中的未知必填值取 `null`，可选且未被阶段使用的字段可省略。重力加速度使用题面或用户提供的值。静止释放等前提由题面确认。

## 2. 校验与错误定位

B 从 `src/physics/index.ts` 导出纯函数 `validateStagePlan(input: unknown)`，供 C 校验模型回包，也供 `assembleScene` 复用。同一份验收样例在 Node 服务和 Qoder 云函数中应得到一致的结果。

```ts
type FieldError = { path: string; code: string; message: string };

type StagePlanDraft = {
  kind: "stage_plan";
  schemaVersion: 1;
  gravityMps2?: number | null;
  massKg?: number | null;
  initial: { speedMps: number | null } | { vxMps: number | null; vyMps: number | null };
  stages: Array<Record<string, unknown>>;
};

type StagePlanValidation =
  | { ok: true; reading: ResolvedStagePlan }
  | {
      ok: false;
      code: "NEEDS_INPUT" | "INVALID_READING" | "INCONSISTENT_CONDITIONS" | "UNSUPPORTED";
      message: string;
      reading: StagePlanDraft | null;
      missingKeys: string[];
      fieldErrors: FieldError[];
    };
```

Node 服务与 Qoder 云函数识别新题时使用同一张映射表。

| 校验结果 | HTTP | 回包 `status` | 回包内容 |
|---|---|---|---|
| `ok: true` | 200 | `ok` | 返回已校验的 `reading`。 |
| `NEEDS_INPUT` | 200 | `needs_input` | 返回部分 `reading`、`missingKeys`、`fieldErrors` 和 `message`。 |
| `INCONSISTENT_CONDITIONS` | 200 | `needs_input` | 返回部分 `reading`、`missingKeys`、`fieldErrors` 和 `message`，提示修正已定位的条件。 |
| `UNSUPPORTED` | 200 | `unsupported` | 返回 `message`，说明不支持的模块或接续前提。 |
| `INVALID_READING` | 502 | — | 模型回包结构损坏时重试识别一次。重试仍无效，返回包含 `message` 的服务错误。 |

- 新阶段计划统一使用以 `reading` 为根的零基 JSON Pointer。`/stages/2/end/distanceM` 表示第 3 段的距离，`/stages/2/end` 表示整块结束条件缺失，界面高亮整块。播放器同时兼容旧模板的裸字段名。
- `missingKeys` 只收录待补条件。超出范围、非有限值或可修正的物理前提冲突分别用 `fieldErrors` 返回，代码例如 `RANGE`、`NOT_FINITE`、`PRECONDITION_CONFLICT`。同一路径有字段错误时通过 `fieldErrors` 定位。非有限数传输时转为 `null` 并带错误原因。
- 对两种 `needs_input` 回包，后端直接透传校验函数返回的 `reading`。部分计划保留已识别的阶段 `kind`、结束条件 `end.kind` 和已知值，未知必填值用 `null`。题意模糊到无法确认计划结构时用 `reading: null`，提示重拍或补充。两种问题列表都可为空。
- 可识别并能定位的非法题设归入 `INCONSISTENT_CONDITIONS`。`INVALID_READING` 用于模型回复的结构无法解析或归一化为阶段计划。实际先发生哪个运动事件由物理库计算。

所有已知数值须有限。斜长、指定距离和劲度系数大于零，斜面倾角在 0° 与 90° 之间，动摩擦因数和落差可为零。标量初速应为非负值，弹簧压缩需正向入射。抛体初速度的两个分量可以带符号。同一个 `initial` 同时提交标量和分量时，错误定位到 `/initial`。

## 3. 阶段及其接续

| 阶段 `kind` | 题设字段 | 求解结果 |
|---|---|---|
| `incline_slide` | `lengthM`、`angleDeg`、`kineticFrictionCoefficient`。静止释放需要 `slidesAfterRelease: true`。冲上斜面用 `direction: "up"`，已知足够长时 `lengthM: null`。 | 计算到端点或先停止。沿同一斜面上滑再返回时，一段内计算静止点、折返与返回坡底；扩展的正速末端直接接抛体见 [斜面斜抛约定](INCLINE_PROJECTILE.md#1-范围与输入)。 |
| `lossless_turn` | `lossless: true` 为常量，表示题设支持光滑且近似无高度差的转向。未知填 `null` 并提示核对，明确为 `false` 时返回超范围。 | 坡底位置和速率连续，速度转为水平。输出瞬时事件；还可按 [圆弧接续约定](VERTICAL_ARC.md#1-输入单位与范围) 接 `vertical_arc`。 |
| `horizontal_slide` | `kineticFrictionCoefficient`，以及旧 `end: { kind: "distance", distanceM }` / `{ kind: "stop" }`；[预压扩展](PRECOMPRESSED_SPRING.md#2-距离和合法接续)另有 `distance_from_stage_start`。 | 旧 `distance` 只从本水平段起点量起，新引用距离可从A量总AB；摩擦停止可能先于目标。正速到达后还可按 [圆弧接续约定](VERTICAL_ARC.md#1-输入单位与范围) 接 `vertical_arc`。 |
| `spring_contact` | `springConstantNpm`、`frictionless: true`、`unattached: true`，质量读计划顶层。 | 水平正速入射，计算接触、最大压缩和恢复原长后脱离。 |
| `spring_release`（扩展） | `springConstantNpm`、`initialCompressionM`、`kineticFrictionCoefficient`、`unattached`、`slidesAfterRelease`；缺参后缀另需可确认的 `releaseCompleteByM`，见 [预压弹簧契约](PRECOMPRESSED_SPRING.md)。 | 预压后释放，仍压缩时也受摩擦；比较恢复原长与先停止。与旧 `spring_contact` 独立。 |
| `vertical_arc` | `radiusM`、`endAngleDeg` 或显式 `path`、`side` 为 `"inside"` 或 `"rod"`、`frictionless: true`，质量与重力读计划顶层；完整范围见 [圆弧扩展契约](VERTICAL_ARC.md#1-输入单位与范围)。 | 计算到端点飞出、提前失去接触或停下回滑，输出圆弧几何、约束状态和关键事件。 |
| `projectile` | 旧 `dropHeightM` 继续表示发射点到落地平面的非负落差，平面为 `launch.yM - dropHeightM`。扩展允许互斥的固定世界坐标 `landingPlaneYM`；圆弧后抛体必须选固定平面，详见 [固定地面约定](VERTICAL_ARC.md#2-接抛体时固定地面)。斜面末端直接抛出可选上述一种输入，详见 [檐口与地面坐标](INCLINE_PROJECTILE.md#2-坐标地面及绘图参考点)。可选 `bounce: { normalRestitution, stopAt: "first_apex", apexHeightM? }` 支持首次水平面反弹至最高点及由 `h` 反求 `H = h / e²`，详见 [预压弹簧契约第 8 节](PRECOMPRESSED_SPRING.md#8-增量扩展光滑桌面能量发射直连平抛与首次落地反弹)。 | 自实际发射状态起算，记录实际发生的最高点与落地；含 `bounce` 且 `e > 0` 时记录 `ground_bounce`（位置连续、`vx+ = vx−`、`vy+ = −e·vy−`）并追踪至 `bounce_apex`。斜面接续保留向下竖直分量，不产生内部最高点。 |
| `pendulum_swing` / `collision_1d` / `parallel_motion`（待实现扩展） | 具体字段、张力/松绳、两质量、带符号速度和碰后约束见 [摆与碰撞契约第2至4节](PENDULUM_COLLISION.md#2-有序阶段与受控并行)。 | 一根轻绳的非线性摆动、最低点瞬时正碰及碰后同钟轨道；不新增整题模板或任意规则求解器。 |
| `magnetic_deflection` | `magneticTeslaB`（T，正值）、`chargeC`（C，非零带符号）、`regionWidthM`（m，正值）、`fieldDirection`（`into_page` / `out_of_page`，默认向里）、`exitKind`（`region_edge` / `half_circle`，默认按竖直边界出射）。 | 单粒子在垂直纸面的匀强磁场中忽略重力，按洛伦兹力求半径、实际出射位置和切向速度，记录 `magnetic_enter` 与 `magnetic_exit`。 |
| `movable_arc` | `radiusM`、`grooveMassKg`、可选 `entryMode`（`"top"` 默认 / `"bottom"`）、`exitDirection`（-1/1，顶入）、`entryDirection`（-1/1，底入）、`criticalTopRelativeRest`（底入恰好在槽顶相对静止）、`entryGapM`（底入前已知间距）；球质量读顶层 `massKg` 或多体 `bodies`。顶入首段须 `initial.speedMps: 0`（非零报 `PRECONDITION_CONFLICT`）；底入须正速率入槽（或由 `criticalTopRelativeRest: true` 反求）。 | 四分之一光滑槽静置光滑地面可自由滑动：水平动量守恒 + 机械能守恒。顶入 RK4 积分至离槽（球速 `√(2gRM/(M+m))`、槽速反向 `m·v/M`）；底入自适应积分至槽顶/转折点相对静止并对称返回槽底分离（返回球速 `(m−M)/(m+M)·v₀`、槽速 `2m/(m+M)·v₀`、槽底支持力 `mg + m v₀²/R`）。 |
| `movable_semicircle` | `radiusM`、`grooveMassKg`、`direction`、`frictionless`、`groundFrictionless`，详情见 [可平动半圆轨道契约](MOVABLE_SEMICIRCLE.md)。 | 正速从底部切向进入初静止的可平动半圆内轨，取样同时包含滑块与轨道运动，记录实际到顶、提前失去接触或首个转折点。 |
| `spring_pair` | `springConstantNpm`、`targetMassKg`（可 null）、`separationSpeedMps`（可 null）、可选 `gapM`；入射球质量读顶层 `massKg`。 | 弹簧不锚墙的弹性双球作用：匀速走完 gap → 压缩 → 共速（Ep 最大）→ 恢复原长分离。`targetMassKg` 缺而给 `separationSpeedMps` 时反求 m₂ = m₁(u+s)/(u−s)。末段。 |

`horizontal_slide.end` 原有 `distance/stop` 两种互斥分支保持兼容。指定距离时，库比较到达目标与因摩擦停止两个事件。停止更早时返回 `stop_before_target`，恰好同时发生时停止优先，返回 `stop_at_target`。只指定 `stop` 时，以停止为目标。光滑面上有正初速且要求因摩擦停止，返回可定位的前提冲突。

[预压弹簧扩展](PRECOMPRESSED_SPRING.md#2-距离和合法接续) 另登记 `end.kind: "distance_from_stage_start"`：从指定预压释放阶段的初始 A 点量总距离，完整释放后的实际水平余程扣掉已发生的释放位移。旧 `distance` 仍只从本水平段起点量起。新释放阶段可以独立运行或接合法后缀，不要求后缀一定是圆弧。

V1 支持斜面到坡底接无损转向，转向接水平滑动或弹簧，水平正速到达指定距离后接弹簧或抛体。按 [圆弧扩展契约](VERTICAL_ARC.md#1-输入单位与范围)，无损转向和水平定距段还都可以接竖直圆弧，圆弧实际离弧后可以接固定 `landingPlaneYM` 的抛体。单段可以独立运行。水平段直接接抛体时，距离目标就是题设桌沿，只有正速到达才产生离桌事件；接圆弧时目标是圆弧入口，水平提前停或恰停均不执行圆弧及其抛体后缀。弹簧脱离及落地为原有终止事件，圆弧的脱离和返回入口等终止口径见 [扩展分支约定](VERTICAL_ARC.md#3-物理状态分支与时间)。

[斜面斜抛扩展](INCLINE_PROJECTILE.md)另允许 `incline_slide → projectile`，不要求转向或水平过渡。斜面正速到末端才离檐；提前停和恰停均不执行抛体。已有 `reach_bottom` 后同刻依序输出 `projectile_launch`，保留两个带符号速度分量，不输出 `leave_table`；完整范围见扩展第3、4节。

[分区电磁场复合阶段](SWITCHABLE_EM_COLLISION.md) 统一处理先电后磁、定点正碰、乙穿越竖线撤场与按回旋圆外切恢复磁场。

`magnetic_deflection` 可独立成题、接在水平定距段之后，也可接 `projectile`。抛体从 `magnetic_exit` 的同一时间、位置和两个速度分量起算，此后仅受重力。接收平台若相对入射地面给出高度，识别填世界坐标 `landingPlaneYM`。首段水平贴地入射时入口为 (0,0)，地面下 h 米的平台填 `-h`。若题面明确给的是从实际出射点向下的落差，可用互斥的 `dropHeightM`。只登记当前单粒子磁场模型，交叠的电场、不可忽略的区内重力和会改变出射的未登记边界不在此模型范围。

传送带后缀只在实际离开固定带端时开始。题面给定接续端时使用 `continuationExitEdge`，实际从另一端离开则止于离带事件。定长匀速且题未给时长时由物理库求实际边界，不设固定观察时长。入带端、离带事件与两种位移参考系见 [传送带契约](CONVEYOR_BELT.md)。

动量守恒扩展另允许 `movable_arc → spring_pair` 与 `movable_arc → horizontal_slide`（μ=0）；`spring_pair` 为末段。识别文案见 [vision-reading.v2 第17、18节](skills/vision-reading.v2.md)。「恰好不能再次滑上槽」一类临界条件写成 `separationSpeedMps`（= 槽速），由库反求靶球质量，识别端不代算答案。多体阶段的系统能量把槽与靶球计入，耗散按守恒校验而非单体质点初末差。

## 4. 装配结果、绘图与阶段修改

### 4.1 几何与取样参考点

`assembleScene → buildMotion` 输出同一坐标系中的几何和运动。世界坐标 x 向右、y 向上。斜面起始的场景以坡底为原点，其他场景以第一段起点为原点。后续阶段继承上一段末位。

```ts
type Point = { xM: number; yM: number };

type StageGeometry = {
  incline?: { start: Point; end: Point };
  horizontal?: { start: Point; plannedEnd: Point | null };
  spring?: { contact: Point; anchor: Point };
  projectile?: { launch: Point; landingPlane: { yM: number } };
  verticalArc?: VerticalArcGeometry; // 完整字段见 VERTICAL_ARC.md 第 4 节
  blockSizeM: number;
  positionReference: "front_bottom" | "particle";
};
```

- 有明确距离目标时，`plannedEnd = { xM: start.xM + distanceM, yM: start.yM }`。直接接抛体时它是题设桌沿，接圆弧时它是计划圆弧入口。提前停止也必须保留这个计划目标，真实停止位置读取 `sampleAt(durationSeconds)`；此时不生成实际圆弧或抛体几何。
- `end.kind === "stop"` 且题设未声明距离目标时，`plannedEnd` 为 `null`。A 可按实际运动范围画出支撑面。抛体几何只在实际离桌或发射后生成。
- `front_bottom` 表示运动物体的固定前下沿参考点。斜面上是沿下坡方向的前侧贴面角，水平、弹簧与抛体阶段用右下角。速度反向时沿用同一角，画布按支撑方向将方块向后并向上绘制。恰停桌沿时参考点与桌沿重合，方块底边留在桌面一侧。方块尺寸为绘图值。
- 含圆弧的场景全程使用 `particle`，前段水平、圆弧与后段抛体都继承同一质点位置；旧场景继续使用 `front_bottom`。上例中的 `VerticalArcGeometry` 完整字段、实际离弧点及可选约束取样见 [圆弧绘图约定](VERTICAL_ARC.md#4-绘图取样和事件的增量)。圆弧入口继承前段的实际世界坐标，不能重置到原点；抛体 `landingPlane.yM` 使用 `landingPlaneYM`，原 `dropHeightM` 路径保持原计算口径。
- [斜面直接斜抛计划](INCLINE_PROJECTILE.md#2-坐标地面及绘图参考点)也全程使用 `particle`，停止分支保持这一参考点。檐口为斜面计划末端 `(0,0)`，两种地面输入均相对同一世界坐标；只看斜面的旧前缀仍用 `front_bottom`，计算位置和斜向速度一致。
- 预压弹簧扩展也使用 `particle`。其 `springRelease` 几何、A/B/C 标记、未计时的 `schematic` 前段以及 `timing` 元数据见 [预压弹簧输出约定](PRECOMPRESSED_SPRING.md#5-公开输出坐标和精确播放范围)。已有几何字段继续仅表示实际算过的阶段，未知前段不得冒充已求出的轨迹。
- 摆场景以最低点而非首段释放点为原点，支点=(0,L)，全程particle。新增bodies/pendulums/bodyTracks、sample的body/constraint表及主物体兼容投影见 [摆与碰撞输出约定](PENDULUM_COLLISION.md#5-状态几何事件和兼容投影)，不能将目标轨迹混进主物体的旧geometry。

### 4.2 时间轴、事件与终点口径

下列类型展示原有阶段的共同字段；圆弧增加的终止原因、事件元数据与 `sampleAt` 可选约束状态见 [圆弧状态与事件约定](VERTICAL_ARC.md#4-绘图取样和事件的增量)。

摆与碰撞的新路径另有稳定bodyId、完整碰前后快照和MotionStatus，见 [扩展第5节](PENDULUM_COLLISION.md#5-状态几何事件和兼容投影)。最低点事件先于同刻碰撞，精确时刻原子地取所有body的碰后状态；旧顶层位置/速度继续投影主物体。转折不等于永久静止，并行目标尚未完成时摆须继续反向取样；真正超出模型的再次张紧须说明有限范围。

```ts
type Velocity = { vxMps: number; vyMps: number };

type EndReason =
  | "stop_before_target"
  | "stop_at_target"
  | "stopped"
  | "landed"
  | "spring_detached"
  | "prefix_end";

type MotionSegment = {
  stageIndex: number;
  kind: string;
  startSeconds: number;
  endSeconds: number;
};

type MotionEvent = {
  id: string;
  stageIndex: number;
  kind: string;
  timeSeconds: number;
  order: number;
  velocityBefore: Velocity;
  velocityAfter: Velocity;
  label: string;
  explanation: string;
};

type StageMotion = {
  geometry: StageGeometry;
  durationSeconds: number;
  segments: MotionSegment[];
  events: MotionEvent[];
  termination: { reason: EndReason; eventId: string; stageIndex: number };
  readonly endReason: EndReason;
  sampleAt(timeSeconds: number): Point & Velocity & { springCompressionM: number };
};
```

- `stageIndex` 是原计划中的零基下标，画面可按 `kind` 显示中文名称并用下标关联阶段和事件。同一个阶段可包含多个事件。`segments` 只含实际发生且有正时长的段。`lossless_turn` 只产生零时长转向事件，前后速度必填。
- `order` 是事件的零基执行序号。事件先按 `timeSeconds` 升序排列，同刻再按 `order` 严格排序。事件前后速度都要填写，连续事件可相等。精确用 `event.timeSeconds` 取样时，先计及早于该时刻的事件，再按顺序应用同刻事件，返回最后一个事件后的状态。超出时间区间时取相邻端点。
- `termination` 指向最后一个实际发生的事件。`endReason` 与 `termination.reason` 同源同值，供字幕读取。无距离目标的正常停止用 `stopped`，落地用 `landed`，弹簧脱离用 `spring_detached`，按给定阶段播完且无其他物理终止事件时用 `prefix_end`。事件类型至少包括 `release`、`reach_bottom`、`lossless_turn`、`reach_target`、`stop`、`leave_table`、`apex`、`land`、`spring_contact`、`max_compression` 与 `spring_detach`。
- 扩展的 `projectile_launch` 除圆弧切向飞出外，也用于 [正速离檐](INCLINE_PROJECTILE.md#4-事件时间轴与终止)。显示文案按真实前驱区分；斜面末端正速接续不能套用桌面平抛或圆弧的说明。
- `stop_before_target` 和 `stop_at_target` 两种结局的最后一个事件都是 `stop`，均不输出 `projectile` 段和 `leave_table`、`apex`、`land` 事件。终点及其后的取样均为静止。字幕使用实际停止结局。落地末帧保留首次接地速度。

### 4.3 「只看斜面」的提交方式

C 从 `command` 解析并返回意图，`throughStageIndex` 是包含该阶段的零基下标。

```json
{ "type": "truncate_stages", "throughStageIndex": 0 }
```

A 检查下标和当前有效计划，按下面的方式构造完整前缀，再调用同一条装配及计算路径。原计划的 `kind`、`schemaVersion`、`gravityMps2`、`initial`、`massKg` 等字段通过展开保留。处理失败时保留原输入与最近一次有效结果。

```ts
const nextPlan = {
  ...originalPlan,
  stages: originalPlan.stages.slice(0, throughStageIndex + 1),
};
```

这一步沿用已识别题设。标准斜面弹簧预设可由程序转换成对应阶段计划。截到斜面末尾的结果在坡底结束，终止原因为 `prefix_end`，末速度保持斜向。转向阶段只有在前缀包含它时才执行。

## 5. 共享开发样例与五条自测

滑块从 3.6 m、30° 的光滑斜面顶端静止释放，过坡底无损转向后进入动摩擦因数 0.2 的水平桌面。桌沿距坡底 5 m，桌面离地 1.25 m，取重力加速度 10 m/s²。该完整阶段顺序用于开发联调。

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

| 自测 | 对照结果 |
|---|---|
| 1. 完整新组合 | 1.2 s 到坡底。转向前的速度趋近 (3√3, −3) m/s，在转向事件精确时刻为 (6, 0) m/s，随后进入水平减速。2.2 s 以 4 m/s 离桌，2.7 s 落在 x = 7 m、y = −1.25 m。末帧速度为 (4, −5) m/s，原因 `landed`。 |
| 2. 桌沿改至距坡底 10 m | 4.2 s 停在 x = 9 m，速度为零。桌沿仍画在 x = 10 m，原因 `stop_before_target`。 |
| 3. 桌沿恰距坡底 9 m | 4.2 s 停在 `plannedEnd`，速度为零。方块在桌面一侧，原因 `stop_at_target`。 |
| 4. 只看斜面 | 保留题设，1.2 s 播到坡底，末速度为 (3√3, −3) m/s，原因 `prefix_end`。画面只保留斜面及滑块，事件中没有转向。 |
| 5. 原斜面弹簧 | 第 3 节 [规划书](PROJECT_PLAN_FINAL.md) 的原题和数值回归通过。原题约 2.2361 s 接触、2.3146 s 压缩最短，最大压缩量约 0.2012 m，脱离速率约 4.0249 m/s。 |

对第 1、4 条读取斜面末端附近的 `t−ε`、`t` 和 `t+ε`。完整计划在 `t+ε` 进入减速，速度为 (6 − 2ε, 0) m/s。前缀计划在 `t+ε` 钳制到保留斜向速度的末帧。对第 2、3 条检查最后事件为 `stop`，越界取样仍为静止，播放列表与字幕中均无飞行和落地。A、C 联调时另测缺少整块 `end`、缺少距离以及距离非法这三种回包。
