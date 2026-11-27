# 光滑竖直内侧圆弧扩展契约

后续完整内轨及非最低点入口见 [CIRCULAR_TRACK.md](CIRCULAR_TRACK.md)。新显式 `path` 与本文件旧 `endAngleDeg` 输入互斥，须先联审再实现；以下最低点、右半圆和旧回滑停界条款继续定义原兼容模式，不能套到新路径的观察终点。

本文件是 [阶段组合契约](STAGE_COMPOSITION.md) 的增量，按规划第 8.1 项先交字段与共享样例，再实现 B 的校验和运动。当前 PR 只含契约及数据，主分支的求解器尚不支持本扩展；A、B、C 联审合并后进入实现。预压弹簧、能量反求及计时起点说明属于下一增量，本次不伪造弹簧参数或前段时间。

## 1. 输入、单位与范围

沿用 `kind: "stage_plan"`、`schemaVersion: 1` 和现有入口，不增加整题模板。登记新阶段：

```ts
type VerticalArcStage = {
  kind: "vertical_arc";
  radiusM: number;
  endAngleDeg: number;
  side: "inside" | "rod";
  frictionless: true;
};
```

- `radiusM` 是质点运动轨迹半径，单位 m，有限且大于零。圆弧从最低点开始，入射切线水平向右；沿右半圆向上，到 `endAngleDeg` 所定端点结束。角度从最低点量起，单位度，有限且 `0 < endAngleDeg <= 180`。180° 是最高点，90° 是最右端。
- `side: "inside"` 确认只有朝圆心的支撑力，允许失去接触；`frictionless: true` 确认光滑。`side: "rod"` 表示质点受固定半径的双向径向约束，例如理想轻杆、双面光滑圆管或等效双轨。物体按不转动的质点计算。外侧单面凸轨、摩擦圆弧、转动或变半径的约束超范围；任意起始角与更长圆轨见 [显式圆轨增量](CIRCULAR_TRACK.md)。
- 含圆弧时，顶层 `gravityMps2`、`massKg` 都必需且为有限正数。质量用于输出法向力，不能由画面尺寸猜测。圆弧为首段时，`initial` 用 `{ speedMps }`，允许零；不得给速度分量。后续圆弧从上一段继承位置和速度。
- 新增接续为：`horizontal_slide(distance) → vertical_arc → projectile`，或 `lossless_turn → vertical_arc`；圆弧可独立或作为前缀末段。进入圆弧必须是水平向右的切向状态。水平提前停或恰停时沿用旧停止分支，不执行圆弧，也不生成圆弧或抛体的实际运动几何。暂不接第二个圆弧或反向执行前序水平段。
- 新阶段初始零速且位于最低点时保持静止，零时长结束，原因 `stopped`。不得产生回滑、脱轨或飞行事件。

字段错误沿用共享校验唯一入口。已识别阶段缺值或 `null` 放入 `missingKeys`，例如 `/stages/0/radiusM`、`/stages/0/side`、`/massKg`。错误字段类型为 `TYPE / INVALID_READING`；非有限数为 `NOT_FINITE`，数值不在约定区间为 `RANGE`，均沿用已有可修正错误口径；已知字符串 `side` 不在 `inside`、`rod` 中或明确 `frictionless: false` 为 `UNSUPPORTED`。初态形状或接续速度不相容为 `PRECONDITION_CONFLICT`，定位 `/initial` 或相应阶段路径。缺项、错误值及其他已知阶段的数据按已有草稿规则保留。

## 2. 接抛体时固定地面

保留旧的 `{ kind: "projectile", dropHeightM }`，含义仍是相对实际发射点的非负落差。另允许 `{ kind: "projectile", landingPlaneYM }`，表示同一世界坐标系中的固定落地平面 y 坐标，单位 m，须有限。两个键互斥，不能同时提供（包括其中一个为 `null`）；同时提供定位阶段整块为 `PRECONDITION_CONFLICT`。

圆弧后接抛体必须使用 `landingPlaneYM`，使提前脱轨时地面仍固定。仅给 `dropHeightM` 时提示该阶段前提冲突；两者都缺时在 `/stages/i/landingPlaneYM` 提示补齐。其他抛体保留旧默认缺项路径 `/stages/i/dropHeightM`，也可显式选用固定平面。装配时若固定平面高于实际发射点，定位 `landingPlaneYM` 为前提冲突，不计算穿越上方平面的运动。

圆弧为首段时最低点 B 是 `(0, 0)`，原题的落地平面取 `landingPlaneYM: 0`。绝不能把最高点的 0.8 m 落差直接用于提前脱轨分支。

## 3. 物理状态、分支与时间

设入口位置为 B = `(xB, yB)`，入口速率为 u，R 为半径，φ 为从最低点量起的弧角。以下公式内部用弧度，输入输出角度用度。沿上行方向的有符号切向速度为 q，上行 q > 0，回滑 q < 0。

```text
x = xB + R sinφ
y = yB + R (1 − cosφ)
v² = u² − 2gR (1 − cosφ)
(vx, vy) = q (cosφ, sinφ)
N = m (v²/R + g cosφ)
dφ/dt = q/R
dq/dt = −g sinφ
```

能量和法向力给出实际边界；圆弧时间由上述运动方程或等价积分得到，不能用弧长除以入口速率。到转折点的积分须处理可积端点，不能把数值 NaN 当作物理停止。只需本模块的专用积分/求根，不引入任意规则求解器。能量与向心力依据可核对 [OpenStax 的竖直圆轨道例题](https://openstax.org/books/university-physics-volume-1/pages/7-3-work-energy-theorem)。

| 实际先发生的边界 | 行为 |
|---|---|
| 正速到计划端点，途中 N 没有先变负 | 记录 `arc_endpoint`，沿端点切线离开；有下一抛体段时接续。端点在最高点时向左平抛。 |
| 上行途中 N 首次降至 0，继续沿圆弧需要 N < 0 | 记录 `arc_contact_lost`，立即按实际位置及切向速度接抛体；不再假装经过计划端点。 |
| 下半圆或最右端先到 v = 0，随后能沿原轨返回 | 记录非终止事件 `arc_turn`，q 连续经过零并变负，沿圆弧回到入口；记录 `arc_return_entry` 后结束本次计算范围，不执行计划中的抛体。 |

半圆端点情况下可独立核对：`0 < u² <= 2gR` 为转折回滑，`cosφturn = 1 − u²/(2gR)`；`2gR < u² < 5gR` 为提前脱轨，`cosφloss = (2gR − u²)/(3gR)`；`u² >= 5gR` 可到最高点。小于半圆的轨道还须比较计划端点是否更早到达。

相同边界的优先级必须明确：v = 0 时优先转折回滑，包含恰在计划端点或 φ = 90° 且 N = 0 的情形，不凭零速生成飞行；正速端点与 N = 0 同刻时端点优先。临界 `u² = 5gR` 因而记录端点到达，不记提前脱轨。能量比较采用相对机器精度容差并在已命中的边界钉住解析位置、速度和 N；不得用宽容差把真实早脱轨改成到顶。

新终止原因增加 `arc_detached`（实际离弧但计划没有抛体后缀）和 `returned_to_entry`（回滑到入口，计算范围结束）。计划有抛体且实际离弧时，最终仍为 `landed`。`returned_to_entry` 的末速度水平向左，保持入口速率；末帧及越界样本钳制到此状态，不能清零成静止，也不声称已模拟返回粗糙水平面后的过程。`termination`、`endReason` 继续同源同值。

### 轻杆与双轨的零速极限

`side: "rod"` 表示双向径向约束，有符号法向力为正时指向圆心，为负时背离圆心。由最低点出发时，`u² = 4gR` 使最高点的速度极限为零、约束力极限为 `−mg`。设当前离前方最高点的角距为 δ，则该能量下 `|v| = 2√(gR) sin(δ/2)`，运动满足 `tan(δ(t)/4) = tan(δ(0)/4) exp(−t√(g/R))`。有限时间内 δ 始终为正，达到或穿过最高点需要无限时间。

若计划到达或越过这个顶点，旧半圆和显式路径都播放入弧后 `6√(R/g)` 的真实运动前缀，以 `arc_range_end`、`actualExit.reason = "range_end"` 和 `endReason = "prefix_end"` 结束。观察末帧及越界取样保留实际角度、非零速度和约束力，计划端点仍按题设保留。该顶点及其后续离轨、飞出和落地事件均未发生。实际顶点以前的计划端点仍可照常正速到达。能量略低且先到转折时回滑，略高时才可在有限时间越过顶点；原单内轨 `u² = 5gR` 的顶点仍以非零速度到达。

[轻杆临界共用样例](fixtures/vertical-arc-rod-critical.reading.json) 的 `R = 0.4 m`、`g = 10 m/s²`、`m = 0.1 kg`、`u = 4 m/s`。入弧 1.2 s 时，角度约 179.4319°、速率约 0.01983 m/s、有符号法向力约 −0.99985 N。

## 4. 绘图、取样和事件的增量

带圆弧的场景使用 `geometry.positionReference: "particle"`，所有阶段位置都表示同一质点参考点。旧场景仍为 `front_bottom`。`blockSizeM` 继续只是绘图尺寸，不计入半径或离地高度；A 可画质点或小滑块，不能移动物理参考点来补偿图形尺寸。

```ts
// StageGeometry 增量：仅实际进入圆弧后生成；计划端点在提前离弧时仍保留。
verticalArc?: {
  stageIndex: number;
  entry: Point;
  center: Point;                 // { xM: entry.xM, yM: entry.yM + radiusM }
  radiusM: number;
  startAngleDeg: 0;
  endAngleDeg: number;
  plannedEnd: Point;
  actualExit: {
    position: Point;
    angleDeg: number;
    reason: "endpoint" | "contact_lost" | "returned_to_entry" | "stationary" | "range_end";
  };
};

// StageMotion.sampleAt 的可选增量；旧 MotionSample 字段保持原值与原调用路径。
constraint?: {
  kind: "vertical_arc";
  stageIndex: number;
  angleDeg: number;
  angularVelocityRadps: number;  // q/R，回滑为负
  normalForceN: number;         // 非负标量，方向指向圆心
};

// StageEvent 增量：以下三项在本模块的圆弧事件上必填，旧事件可省略。
position?: Point;
normalForceBeforeN?: number;
normalForceAfterN?: number;
```

- 圆弧状态的法向方向为 `(-sinφ, cosφ)`。转折点仍有 `constraint`，速度向量为零而法向力可非零；离弧后的样本不再带 `constraint`。静止最低点保留约束与 N = mg。
- 圆弧计划图形保持完整，`actualExit` 标示真实离弧点或返回点；回滑分支不生成 `geometry.projectile`。有抛体时其 `launch` 是真实离弧点，`landingPlane.yM` 使用固定平面。
- 事件新增 `arc_enter`、`arc_endpoint`、`arc_contact_lost`、`arc_turn`、`arc_return_entry`、`projectile_launch`。`projectile_launch` 用于圆弧后发射；桌面后发射仍用旧 `leave_table`，不得给圆弧分支配“离开桌沿”字幕。飞行最高点沿用 `apex`，只在发射与落地之间实际出现时生成。
- 首段仍在 t = 0 有 `release`，其后同刻有 `arc_enter`。非首段 `arc_enter` 排在前段到达事件之后。端点/脱轨事件后同刻才是 `projectile_launch`，两事件位置及速度一致，无瞬时速度跳变。端点/脱轨事件法向力后值为 0。转折事件的前后速度均为零，前后法向力相等；返回入口事件保留向左速度，法向力后值为 0（结束圆弧约束）。
- 圆弧事件的法向力元数据专指圆轨道的约束力。非首段 `arc_enter` 的前值为 0、后值为入口 N；首段的进入事件前后值都取已给定圆弧初态的 N。它不覆盖或否认前序水平面的支撑力。
- `segments` 可用一个 `vertical_arc` 段覆盖上行和回滑，转折是段内事件。依旧只输出有正时长的实际段，`stageIndex` 保留计划下标，`order` 全程递增。
- 精确事件时刻按同刻最终事件后的状态取样。测试用 ε = 1e-7 s 比较事件前后；转折后速度须反向，脱轨后只受重力，位置和速度连续。落地保留入射速度，所有非弹簧段 `springCompressionM` 均为 0。

## 5. 共享输入及独立数值基准

三个输入分别为 [到顶飞出](fixtures/vertical-arc-endpoint.reading.json)、[提前脱轨](fixtures/vertical-arc-contact-loss.reading.json)、[停下回滑](fixtures/vertical-arc-return.reading.json)。机器可读的对照值见 [验收数据](fixtures/vertical-arc.acceptance.json)。这些输入从 B 点开始，初速度分别为 √20、4、2 m/s；它们是下一增量的能量题在 AB = 2、3、6 m 时的圆弧后缀，不表示前段计时已实现。

入口速度的独立来源为 `u² = 2(E − μmg·AB)/m`，固定 `E = 1.4 J`、`m = 0.1 kg`、`μ = 0.2`、`g = 10 m/s²`。原题“恰好通过最高点”给出 `vC² = gR = 4`、`uB² = 5gR = 20`、`NB = 6 N`，再加水平摩擦功得到 1.4 J。此反求是样例的明确来源，不能由 AI 自行补成未知劲度系数或压缩量。

| 样例 | 圆弧边界 | 后续及终点 |
|---|---|---|
| 对应 AB = 2 m | 约 0.403781164 s 到 C = (0, 0.8) m，速度 (−2, 0) m/s，N = 0；B 点 N = 6 N | 飞行 0.4 s，总时长约 0.803781164 s；落点 (−0.8, 0) m，入射速度 (−2, −4) m/s，原因 `landed`。无内部 `apex`。 |
| 对应 AB = 3 m | 约 0.308896990 s，φ ≈ 131.810314896°，位置 (0.298142397, 0.666666667) m，速度 (−1.088662108, 1.217161239) m/s，N = 0 | 飞行约 0.506616303 s，实际有内部 `apex`；总时长约 0.815513294 s，落点 x ≈ −0.253391576 m。无 `arc_endpoint`。 |
| 对应 AB = 6 m | 约 0.337150071 s 在 φ = 60°、(0.346410162, 0.2) m 瞬时静止，N = 0.5 N | 约 0.674300142 s 回到 B，速度 (−2, 0) m/s，原因 `returned_to_entry`；没有飞行、最高点或落地事件，计划 C 仍保留。 |

位置、速度、法向力先用能量与向心力手算；上述时间另以能量积分的复合 Simpson 求积核对（200000 等分），回滑转折使用 `φ = 2 asin(k sinψ)`、`k = u/(2√gR)` 去掉端点奇异性。实现不能直接复制这些时间。验收时间误差 <= 1e-6 s，位置/速度/力误差 <= 1e-6（各自 SI 单位）；精确事件处解析边界另作严格断言。

供 A 对照的首样例输出摘要如下（仅列关键字段，是契约预期，不是已实现函数的回包）：

```json
{
  "geometry": {
    "positionReference": "particle",
    "blockSizeM": 0.3,
    "verticalArc": {
      "stageIndex": 0,
      "entry": { "xM": 0, "yM": 0 },
      "center": { "xM": 0, "yM": 0.4 },
      "radiusM": 0.4, "startAngleDeg": 0, "endAngleDeg": 180,
      "plannedEnd": { "xM": 0, "yM": 0.8 },
      "actualExit": { "position": { "xM": 0, "yM": 0.8 }, "angleDeg": 180, "reason": "endpoint" }
    },
    "projectile": { "launch": { "xM": 0, "yM": 0.8 }, "landingPlane": { "yM": 0 } }
  },
  "durationSeconds": 0.8037811639956822,
  "segments": [
    { "stageIndex": 0, "kind": "vertical_arc", "startSeconds": 0, "endSeconds": 0.40378116399568226 },
    { "stageIndex": 1, "kind": "projectile", "startSeconds": 0.40378116399568226, "endSeconds": 0.8037811639956822 }
  ],
  "termination": { "reason": "landed", "eventId": "1:land:4", "stageIndex": 1 },
  "endReason": "landed"
}
```

该样例 `sampleAt(0)` 为 `{ xM: 0, yM: 0, vxMps: √20, vyMps: 0, springCompressionM: 0, constraint: { kind: "vertical_arc", stageIndex: 0, angleDeg: 0, angularVelocityRadps: √20/0.4, normalForceN: 6 } }`。在端点事件的精确时间，返回 `(0, 0.8, −2, 0)` 且没有 `constraint`；法向力转变和发生原因从 `arc_endpoint` 事件读取。

除三样例外，B 实现验收还包括：独立圆弧无抛体后缀、零初速、`u² = 2gR` 在 90° 回滑、临界 5gR 两侧、端点提前截断、同刻事件顺序、缺半径/质量/重力/事实、非法或非有限数、落地平面冲突。现有斜面→桌面→平抛五类与旧 `incline_spring` 全量回归不得改变。

### 5.1 非零世界坐标的阶段组合联调

另加 [水平段接圆弧再飞行](fixtures/vertical-arc-composition.reading.json)，完整顺序为 `horizontal_slide → vertical_arc → projectile`。从水平起点 `(0, 0)` 以 √28 m/s 向右运动，μ = 0.2，水平段长 2 m；其他条件仍为 m = 0.1 kg、g = 10 m/s²、R = 0.4 m、圆弧到 180°，固定落地平面 `landingPlaneYM: 0`。该样例从已给定速度起算，不包含弹簧释放过程；原三条独立圆弧样例原样保留。

能量给出 `vB² = 28 − 2×0.2×10×2 = 20`，水平用时 `2L/(vA + vB) ≈ 0.409683333565 s`。圆弧入口 B = `(2, 0)`，圆心 `(2, 0.4)`，最高点 C = `(2, 0.8)`；圆弧时长沿用独立样例的约 0.403781163996 s。约 0.813464497560 s 从 C 以 `(−2, 0)` m/s 发射，再飞 0.4 s，落在 `(1.2, 0)`，总时长约 1.213464497560 s。新增机器可读对照位于验收数据的 `compositionCases`，与原三条 `cases` 分开。

契约合并后的实际接入测试必须通过 `validateStagePlan → assembleScene → buildMotion → sampleAt` 全链路断言：

1. 在交接时刻 T，`reach_target` 属于 stageIndex = 0、order = 1，`arc_enter` 属于 stageIndex = 1、order = 2，两者 `timeSeconds` 同值。所有前后速度均为 `(√20, 0)`，入弧事件位置为 `(2, 0)`；不能生成 `leave_table`。入弧事件的圆轨道法向力从 0 变为 6 N。
2. `sampleAt(T−ε)` 在水平面，`sampleAt(T)` 已含圆弧 `constraint`，`sampleAt(T+ε)` 位于以 `(2, 0.4)` 为圆心的圆上（ε = 1e-7 s）；三者位置、速度在交接处连续。所有阶段使用 `particle` 参考点，圆弧不得重置到 `(0, 0)`。抛体 launch 为 `(2, 0.8)`，固定地面为 y = 0。
3. 完整事件顺序为 `release → reach_target → arc_enter → arc_endpoint → projectile_launch → land`。端点事件与发射事件同刻且依次发生。落地时间、位置、入射速度及越界钳制按 `compositionCases` 核对。
4. 只把同一输入的水平距离改为 8 m：约 2.645751311065 s 停在 `(7, 0)`，计划水平目标仍为 `(8, 0)`，原因为 `stop_before_target`。实际事件只有 `release → stop`，不存在 `arc_enter`、任何圆弧后续事件或飞行事件；`geometry.verticalArc` 和 `geometry.projectile` 都不生成，末帧及越界样本静止。还可用距离 7 m 回归恰停优先、原因 `stop_at_target`。

上述时间与几何属于独立计算的契约基准；本契约 PR 中的检查不代替圆弧实现后的全链路验收。

## 6. A、C 接入及提交顺序

1. 本契约与三条独立输入、一条组合输入及验收数据单独 PR 联审合并；本 PR 不改变运行时支持范围。第 8 节规划的原链接提交为 `ac794b36f2abdd077d8a0fe725b4cdd10f64e5a6`，本契约不把尚未合入 main 的规划改动捎带进来。
2. B 随后实现 `src/physics/stagePlan.ts` 的登记和校验、圆弧专用求解及 `stageMotion.ts` 的装配，继续从 `src/physics/index.ts` 导出公共入口。固定平面抛体复用现有重力公式；修正当前“任何非首段抛体都标记 leave_table”的假设。新增结构状态时，数值有效性检查须只检查数值字段，不能把约束对象送入 `Number.isFinite`。
3. `StageKind` 扩展会影响 `src/adapters/stageMotionAdapter.ts` 的完整映射及 `src/ui/components/workspace/StagePlanEditor.tsx` 的标签表；A 需同步接入，不能仅放宽类型后误用水平阶段的兜底画面。`StagePhysicsCanvas.tsx` 需识别圆弧几何和 particle 参考点，适配层需透传约束和新事件元数据。B 纯计算提交与 A 类型接线的共同构建边界应在实现 PR 明示。
4. C 需沿用 `validateStagePlan`，用现有 `scripts/sync-functions.mjs` 同步 `functions/stagePlan.ts`，更新 Skill 对新阶段、角度和固定落地平面的提取说明，Node 与 Qoder 用同一批输入。错误结构的重试继续由独立修复 PR #23 处理，本增量不合并或改写它。
5. 圆弧三分支通过后，再单独定预压弹簧/已知能量反求/示意前段/精确计时起点契约与样例，并接 AB 改值。定轴摆、碰撞及斜面直接斜抛继续按规划顺序交付，不与本契约混成一次字段变更。
