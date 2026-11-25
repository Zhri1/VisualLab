# 预压弹簧释放与能量反求契约

本增量承接 [阶段组合](STAGE_COMPOSITION.md) 与 [圆弧](VERTICAL_ARC.md) 契约。当前 PR 仅交文档、开发输入及独立数值基准，待联审合并后再实现。沿用 `validateStagePlan → assembleScene → buildMotion → sampleAt`；不登记截图整题模板，不改变旧 `incline_spring`、`spring_contact` 或已有字段数值。单位仍为米、千克、秒、牛顿、焦耳及度。

## 1. 释放阶段和起动前提

```ts
type SpringReleaseStage = {
  kind: "spring_release";
  springConstantNpm: number | null;
  initialCompressionM: number | null;
  kineticFrictionCoefficient: number | null;
  unattached: boolean | null;
  slidesAfterRelease: boolean | null;
  releaseCompleteByM?: number | null;
};
```

- 轻理想弹簧从预压状态沿水平向右推质点，滑块不与弹簧连接。k 和初压缩量 c 为有限正数，μ 为有限非负数。`massKg` 必需且有限正；μ>0 时 `gravityMps2` 也必需。完整模式允许弹簧作用区与脱离后的水平区使用不同 μ，分别由各自阶段提供。
- 本批释放阶段从静止开始，作为首段，`initial: { speedMps: 0 }`。弹簧段结束后可组合已有阶段，见第 2 节；非零入射的压缩反弹继续用 `spring_contact`。本增量不处理与弹簧相连、外力继续做功、变劲度或反复振动。
- `unattached: true` 必需；未知为缺项，明确相连为超范围。静止后确实开始滑动须由题设确认，不能仅用动摩擦因数猜测静摩擦阈值。`slidesAfterRelease: null` 需确认；明确为 false 时给 `timing.mode="full"`、A锚点、absoluteStartSeconds=0、durationSeconds=0、segments=[]、事件 `release → stop`、结束原因 `stopped`，保留已知初压缩量，不发 `spring_release_start`，不将动摩擦力当作静摩擦力输出。false 时若 c 未知仍需补 c 才可给包含压缩量的初态；不凭能量单独猜 c。false 与要求到达圆弧最高点的活动条件矛盾，定位该事实为前提冲突。
- 采用通常 μ静≥μ动的库模型。已滑动后第一次归零，若剩余向右弹力不超过 μ动mg，可保持静止并终止；禁止把恒向左的动摩擦公式穿过零速继续算成反向运动。若题面明确采用其他静摩擦规律，应提示超出本模块前提。
- `releaseCompleteByM` 是题设或用户确认的**释放完成位移上界**，即原长接触位置满足 c≤该值；能走到该位置时应已释放。它不单独保证改动能量/摩擦后一定发生脱离事件。有限正数，可以来自原题“在 B 前或 B 点已脱离”以及已知 AB；它不是压缩量，也不表示真实原长接触点恰在该位置。不得按示意图比例估计。完整参数模式可直接核对 c≤该上界，缺参模式则用能量与该上界共同证明实际释放完成。
- k/c 完整时从动力学精确计算；缺一项但已有足够能量条件时由 B 唯一反求；双缺且只能确定能量时保留两个 null，按第 4 节给后缀或单一状态。旧 `ResolvedStagePlan` 的“所有阶段均可精确计时”假设只对旧阶段继续成立：新增释放阶段允许未计时前段保留 null，成功表示至少可确定公开的播放范围，不表示全程已解出。

## 2. 距离和合法接续

保留旧 `horizontal_slide.end` 的 `distance` 与 `stop`，新增互斥分支：

```ts
{ kind: "distance_from_stage_start"; stageIndex: number; distanceM: number }
```

`stageIndex` 为零基整数，本批只能指向紧邻前一段的 `spring_release`。`distanceM` 为有限正数，从该释放阶段的初始 A 点量到水平目标 B，即 AB 总长。C 提取 AB 原值，B 用 `target.xM = A.xM + AB` 装配；旧 `distance` 的起点语义不变，不能把 AB 直接填进脱离后的旧相对距离而多走 c。

完整释放后滑块已从 A 走了 c，水平余程是 `AB − c`。AB>c 时产生水平段；AB=c 且原长处速度>0时，恢复原长与到达 B 同刻，允许立即入弧，**不生成零时长水平 segment**，但保留零时长交接事件及原 stageIndex；零速仍按停止优先。AB<c 与此阶段顺序不相容，定位水平目标距离为前提冲突，不能让尚受弹力的物体进入现有只受重力/法向力的圆弧模型。

k/c已知（包括由明确能量条件唯一反求后已知）、AB≥c，且动力学给出正速到原长时，**计算本身已证明B前或B点释放完成，无需再索要releaseCompleteByM**；有上界字段时只额外核对它与c不矛盾。有活动临界条件还需用实际两区摩擦计算B速度，比较是否等于√(5gR)，不能仅核对初始能量而漏掉释放阶段的实际停止。

合法结构包括独立释放、释放→水平（定距或停止）、释放→弹簧接触，以及弹簧原长接触点恰为轨道/桌沿时的释放→圆弧或抛体；水平之后沿用已有合法接续。直接接圆弧/抛体必须确认相切且脱离已发生，不加虚构过渡。新距离引用仅服务已知阶段起点，不引入任意规则求解器。缺参推导路径本批要求释放→引用 A 的水平定距段；后缀可为圆弧，也可为其他已支持且入口状态充分的模块。

## 3. 完整参数的运动、边界和事件

设 s 为从 A 向右位移，f=μmg，D=c−f/k，ω=√(k/m)。已确认开始正向滑动且尚压缩时：

```text
s(t) = D (1 − cos(ωt))
v(t) = D ω sin(ωt)
springCompressionM = c − s(t)
½mv² = ½kc² − ½k(c−s)² − fs
```

起动事实为真而 kc≤f 时，返回 `INCONSISTENT_CONDITIONS / PRECONDITION_CONFLICT`，定位释放阶段，不能得到负方向初动。D>0 后比较原长 s=c 与第一次 v=0：

| 条件 | 实际结果 |
|---|---|
| c>2f/k | `tRelease = acos(1−c/D)/ω`，正速到原长，`vRelease² = (kc²−2fc)/m`，事件 `spring_release_end`；无后缀时结束原因为 `spring_released`。 |
| f/k<c<2f/k | `tStop=π/ω`、`sStop=2D<c`，仍压缩时停止，事件 `stop`，原因为 `spring_stopped_before_release`。 |
| c=2f/k | `tStop=π/ω`，在原长处零速停止，事件 `stop`，原因为 `spring_stopped_at_release`；停止优先，不入水平、圆弧或抛体。 |

仅吸收解析比较的浮点舍入误差，保留边界两侧实际分支。已提前停止时不生成后缀运动段或入弧/飞行事件；末帧及越界样本保留停止位置、零速与残余压缩量。

全程可计时且确认起动的事件从 `release`（A 点 t=0）、同刻 `spring_release_start` 开始。正速释放后可接同刻后段事件；AB=c且原长处速度>0时，接圆弧为 `spring_release_end → reach_target → arc_enter`，同刻顺序仍用 order。各事件前后速度连续，段位置连续，精确时刻按最后一个同刻事件的后状态取样；沿用精确匹配优先、无精确命中才择最近容差事件的规则。

## 4. 题面约束、固定能量与缺参处理

### 4.1 C 提取约束，B 反求

题面“恰好能通过最高点 C”作为活动条件输入，不能由模型自己填成初速或弹性势能：

```ts
constraints?: Array<{ kind: "critical_arc_top"; stageIndex: number }>;
```

本批最多一个活动条件，索引须指向已有的光滑竖直内侧 `vertical_arc`，端点为180°。它表示从最低点沿轨到最高点恰好保持接触，B 计算 `vC²=gR`、`vB²=5gR`。必须核对静止释放、不连接、到 B 前或 B 点已释放、摩擦区域与距离定义；无法确认的前提保留缺项，不根据截图形状猜 k、c 或时间。

设释放区和随后水平区摩擦分别为 μs、μh（下标 s 仅表示 spring 区，**不是静摩擦因数**），L=AB：

```text
EB = (5/2)mgR
E0 = EB + μh mg L + (μs−μh)mg c
```

双缺 k,c 且 μs=μh=μ 时，E0=EB+μmgL 唯一可求；原题为1.4 J。μs≠μh 且 c 未知时通常不能唯一确定 E0，不将不同摩擦当作整题非法，返回待补 c 的草稿。c 已知时可算 E0 再得 k=2E0/c²；k 已知时解 `½kc²−(μs−μh)mgc−(EB+μhmgL)=0` 的唯一正根，再核对 c≤L 与释放分支。参数全给时核对题面临界条件；不满足即定位 constraints 为前提冲突，不覆盖题面数值来凑临界。

### 4.2 规范化 reading 固定已求的能量

成功校验回传规范化 reading，活动 constraints 已被核对并消费，不再原样保留为每次编辑的终点约束。保存以下可审来源：

```ts
energy?: {
  stageIndex: number;                 // 当前释放阶段索引
  elasticEnergyJ: number;             // 有限正数
  origin: "given" | "user" | "spring_parameters" | "critical_arc_top";
  basis?: Record<string, number>;     // 下述按 origin 固定的字段，不接受任意规则表达式
};
```

- `given/user` 表示题面直接给能量或用户明确编辑能量，basis可省略。`spring_parameters` 的basis必含 `springConstantNpm`、`initialCompressionM`；下次按当前k,c重新计算。`critical_arc_top` 的basis必须保留原 `massKg`、`gravityMps2`、`radiusM`、`distanceM`、`springKineticFrictionCoefficient`、`horizontalKineticFrictionCoefficient`、`releaseCompleteByM`、`arcStageIndex`；不同μ时还需 `initialCompressionM`。若原长位置已从完整参数求出，basis.releaseCompleteByM可取该c；这不是新增的用户补项。basis是原题求解快照，不随当前AB编辑覆写；energy.stageIndex为当前释放阶段引用，basis.arcStageIndex仅是历史来源，不要求编辑/截断后仍指向当前圆弧。
- `critical_arc_top/given/user` 的能量保持固定。A改AB必须把规范化energy原样保留。两段同μ时，B由当前距离重算 `vB²=2(E0−μmg·AB)/m`；完整或单缺参数且两区μ不同则用第4.1节两区实际摩擦功。不再次要求C点仍临界。新的活动constraints与energy同时出现时必须一致；明确“重新按临界条件反求”才清除原energy并重新提交条件。
- 已有固定 E，若只给 k 或 c，B 可唯一反求另一项。两者都给时核对 `½kc²=E`，冲突定位释放阶段；用户若要改变弹簧能量须同步编辑/清除固定记录。不能静默改 E。新推导数值在规范化 reading 中保留，并在公开 calculations 记来源，便于后续编辑不会丢失已求结果。
- 模型仅可填写题面 given 能量、原条件及事实。B 负责生成和核验派生记录：检查 basis 类型、单位、公式与 elasticEnergyJ 一致；结构损坏走现有 TYPE 路径，数值冲突为可修正字段错误。旧数据没有这些可选字段时沿用旧行为。

### 4.3 双缺 k,c 时能知道什么

双缺时只有在前段起动/释放完成已确认、两段 μ相同、目标不早于可确认的释放完成上界时，才能由 E 和总摩擦功确定目标状态；两个 null 不必成为后缀播放的阻塞项。对原题，已知 `releaseCompleteByM=2`，意味着 c≤2，但不能推测 c 的具体值。

| 当前输入/结果 | 状态与可播放范围 |
|---|---|
| E−μmgL>0 且能确认入弧前已释放 | `ok`，从 B 的实际坐标和计算速度精确播放后缀；前段时长未知，不输出释放/前段到达的虚构时间。 |
| 原题 AB=7 m | 可确认弹簧先于7 m已释放，B 处恰为零速。`ok`、`state_only`，仅展示 B=(7,0) 静止；无入弧、飞行事件，无 A→B 时长。 |
| 原题 AB>7 m | 原释放上界2 m<能量停止距离7 m，能确认在 A 右方7 m停止。`ok`、`state_only`，保留计划 B/C，真实静止点=(7,0)；不伪造停止用时。 |
| AB 缩短到<2 m，c仍未知且没有更紧的确认上界 | `NEEDS_INPUT`，保留 E=1.4 J 和已知字段，提示补 c（可由 E 求 k）或提供有依据的更紧 releaseCompleteByM；不能仅因 B 点形式能量为正就假定已脱离。 |
| 一般参数的 E/f 停止距离小于已知释放上界，或不能证明已恢复原长 | 不把 E/f 当作真实停止位置，可能仍有残余弹性势能；返回待补 k/c 的草稿，精确播放范围为空。 |
| 不同区段μ而缺 c，或缺质量/g/起动等必要条件 | 返回对应 NEEDS_INPUT，保留草稿与独立 fieldErrors；不虚构结果。 |

原题的7 m结论依赖“释放已在原B=2 m前或点完成”的已知事实，不能泛化到任何只有E的题。μ=0时没有E/f停止距离，按无摩擦能量继续求后缀。缺参原题编辑AB≥2及下游R/落地平面可复用上述范围；改m/g/任一μ等上游条件时，A先把当前slidesAfterRelease和releaseCompleteByM清为null，提示重新确认或补k/c；历史energy/basis仍原样保留。B验证当前提交的事实，不从历史basis自动补回已清空的前提，也不猜用户是否已重确认。完整参数模式照常支持合法的新参数，计算证明释放时不索要额外上界。

新字段沿用 JSON Pointer 定位：例如 `/stages/0/initialCompressionM`、`/stages/1/end/stageIndex`、`/constraints/0/stageIndex`、`/energy/elasticEnergyJ`。缺值为NEEDS_INPUT；已知类型损坏为TYPE/INVALID_READING；非有限数为NOT_FINITE，负数/超范围/非整数索引为RANGE；能量、引用关系或起动矛盾为PRECONDITION_CONFLICT。索引引用未来阶段、非释放阶段或不合法接续不得通过；活动条件引用不存在的阶段或非180°内侧圆弧定位约束字段。来源未知或不支持的规则种类为UNSUPPORTED，不能执行任意表达式。失败时仍保留可修正草稿、missingKeys和独立fieldErrors。结构损坏的HTTP/重试沿用既有契约，本PR不修改它。

索引须为范围内整数，非整数/越界为RANGE，索引有效但目标种类/先后关系不符为PRECONDITION_CONFLICT。枚举非字符串为TYPE，未登记字符串为UNSUPPORTED；constraints多于1条为UNSUPPORTED。basis中的质量/g/R/长度/k/c/释放上界须有限正，μ有限非负，历史arcStageIndex为非负整数；按origin核对必填键，缺则NEEDS_INPUT，不能把缺少推导依据的记录当成题面given能量。

共享校验成功结果在本增量可另带可选 `playback: { mode, startStageIndex, unresolvedKeys, reason }` 摘要，旧成功形状不变；不带sampleAt或轨迹函数。C直接用B的playback.reason形成ok的message，不另解物理。assembleScene复用同一校验/解析决定范围，再由buildMotion输出第5节完整timing与calculations；API传回规范化reading供浏览器重走同一入口，范围必须一致。失败时无可播放范围，不返回虚构运动。

## 5. 公开输出、坐标和精确播放范围

这类场景全程使用 `geometry.positionReference: "particle"`，以A=(0,0)为世界原点，所引用的水平目标B=(AB,0)。若其后接圆弧，继承入口B，中心B+(0,R)，端点角φ对应 `plannedEnd=B+(Rsinφ,R(1−cosφ))`；**仅φ=180°时**最高点标C=(AB,2R)，其他弧角标真实“端点”。即便时钟从B开始，世界原点也不改；原题AB从2改3/6/7/8时B/C随之移动，A仍为0。

新增公开元数据挂在 `StageMotion`（旧场景可省略，适配器须透传；Scene.geometry仍是同一份几何）：

```ts
timing: {
  mode: "full" | "suffix" | "state_only";
  startStageIndex: number;
  anchor: { label: string; position: Point };
  absoluteStartSeconds: number | null;
  excludedStageIndices: number[];
  unresolvedKeys: string[];
  reason: string;
};
calculations: Array<{
  quantity: "initial_elastic_energy" | "arc_entry_speed" | "release_speed" | "spring_constant" | "initial_compression";
  value: number; unit: "J" | "m/s" | "N/m" | "m";
  source: "given" | "user" | "derived";
  rule?: string;
  inputPaths: string[];               // 相对 reading 的 JSON Pointer，可指 energy/basis 中的原题快照
}>;
```

- `full`：时钟从 A 释放开始，absoluteStartSeconds=0，旧实际段/事件口径不变。
- `suffix`：时钟从可确定的后缀入口状态开始，anchor和startStageIndex取实际首个后缀段，absoluteStartSeconds=null，excludedStageIndices只列跳过的原阶段。先发归该后缀段的 `playback_start`，再按实际模块发其入口事件（圆弧为arc_enter，弹簧接触为spring_contact等）；durationSeconds只计实际后缀时长，sampleAt(0)给对应入口态。原题特例为B锚点、startStageIndex=2、排除[0,1]、playback_start→arc_enter，B的t=0不能标“A点释放”。不把非圆弧后缀强制变成入弧。
- `state_only`：无可确定的运动区间，选定唯一可求状态作显示锚点，absoluteStartSeconds=null，durationSeconds=0，segments=[]，只给 `state_anchor` 事件。AB=7/>7的静止情形归水平阶段，结束原因分别stop_at_target/stop_before_target，v=0、压缩量=0、无约束。若已知B态且计划没有可执行后缀，也用state_only展示B，结束原因为prefix_end，保留其已知速度（可非零），不捏造之后的轨迹。sampleAt任意时间钳制到选定状态。UI禁用播放，不把显示用0 s称作从A经过的时间，也不显示虚假的“停止发生于0秒”。
- suffix/state_only 的 unresolvedKeys 标明可补参数 `/stages/0/springConstantNpm`、`/stages/0/initialCompressionM`，不混入阻塞性的 missingKeys。API沿用200/ok，reading 可含这两个null，message明确可播放范围。条件不足时仍走已有 needs_input/fieldErrors；不增加新的 HTTP 状态。C须保持整个规范化 reading（尤其 energy），不能重新只拣旧字段。
- calculations 中 E=1.4来自临界约束时标 derived，指向原basis；B速度来源指向当前 E、质量、μ及AB。完整模式 E来自k,c，释放速度同时计摩擦。未知时间不生成数值型计算条目。题面值与推导值在UI分别显示，不能把B生成的数值说成AI直接识别到的题设。

几何扩展：

```ts
geometry.springRelease?: {
  stageIndex: number; start: Point; naturalContact: Point;
  initialCompressionM: number; anchor: Point | null;
};
geometry.landmarks?: Array<{ label: "A" | "B" | "C" | "端点" | "停止点"; position: Point }>;
geometry.schematic?: {
  stageIndices: number[];
  horizontal?: { start: Point; plannedEnd: Point };
  springIconAt?: Point;
  verticalArc?: { entry: Point; center: Point; radiusM: number; endAngleDeg: number; plannedEnd: Point };
  reason: string;
};
```

完整模式知道 naturalContact=A+(c,0)，但弹簧原长/固定端位置未给时 anchor=null；弹簧画法仍应标示长度示意，不能把任意图标宽度变成物理参数。缺参前段仅有 schematic 的 A→B 已知总长度与 A 附近弹簧图标，不能捏造原长接触点/初压缩位移或释放点时间。已有 `geometry.horizontal/verticalArc/projectile` 只保留实际执行的阶段，后缀模式不在其内伪造前段。

state_only保留计划轨道时放在 schematic.verticalArc，绝不生成实际 verticalArc、projectile、arc_enter、projectile_launch 或 land。A可用虚线/“前段示意，未计时”显示计划，并在画面旁固定显示timing.reason；标题仍可说明完整计划，时间轴只列实际范围。自然长度恰到 B 的完整题，同刻交接不需要一段虚假的零长水平动画。

## 6. 开发输入与独立验收

- [完整释放输入](fixtures/precompressed-spring-complete.reading.json)：k=70 N/m，c=0.2 m，m=0.1 kg，全AB μ=0.2，g=10，AB=2，R=0.4。不依赖临界条件反求。
- [缺k/c的原题输入](fixtures/precompressed-spring-critical.reading.json)：保留两个null、critical_arc_top与释放完成上界，由B求E；C不能自行填1.4或B速度。
- [固定能量后的规范化编辑输入](fixtures/precompressed-spring-fixed-energy.reading.json)：E=1.4 J及原basis，已消费constraints；A以此修改AB。此文件是契约期望，不是当前程序已能生成的产物。
- [机器可读基准](fixtures/precompressed-spring.acceptance.json)：包含完整释放、固定能量的2/3/6/7/8 m、缩短待确认、仍压缩停止、恰在原长停止与原长恰在B的同刻场景。

独立核对命令为 `node scripts/check-precompressed-spring-contract.mjs`，只检验契约数据的闭式公式和独立数值积分，不调用尚未登记的新阶段求解器；不将本命令的通过冒充运行时实现验收。

| 完整题量 | 独立基准 |
|---|---|
| 初始弹性势能 | 1.4 J |
| 原长释放 | t≈0.059918314362 s，x=0.2 m，v≈5.215361924162 m/s |
| B | t≈0.431531298944 s，x=2 m，v=√20 m/s，N=6 N |
| C | t≈0.835312462939 s，(x,y)=(2,0.8) m，速度(−2,0) |
| 落地 | t≈1.235312462939 s，位置(1.2,0)，速度(−2,−4)，原因landed |

缺参后缀的AB=2/3/6分别复用圆弧三分支独立基准并平移世界x到B，时间从B计；AB=7/8仅确定静止位置。完整模式支持不同 μ，使用释放区实际做功再接余程；不能套同μ的简式。

实现验收须覆盖：上述输入与每个分支、μ=0、不同μ、缺一参数可反求、初态/能量/活动临界条件冲突、释放前或原长处停止、AB=c的同刻交接、AB<c、AB缩短且释放未知、一般E/f小于释放上界的未知停止、非有限/类型/索引错误。对释放/目标/入弧/转折取t−ε/t/t+ε核对位置和速度；末帧钳制，旧标准题、圆弧及前端/API测试均回归。

## 7. 接入边界和交付顺序

1. 本契约与共享输入独立PR，等规划审核合并再写运行时代码；本轮不更改src、functions、Skill或部署。
2. B在stagePlan登记新阶段、受控距离引用、活动条件及能量规范化；stageMotion只装配真实可计时范围，复用已有圆弧和重力段，不另造整题switch。不可将“已解析但还缺前段时间”和“结构损坏”混为同一种错误。
3. A同步共享类型/适配器、释放几何、schematic与timing；显式区分全程、B起后缀和已知状态。编辑AB保留energy及其原basis，更新世界B/C，并提示较短距离的释放前提待确认。补入可确定的k/c后走同一入口切到全程，不能再同时保留一份错位旧后缀。
4. C只提取题设和明确条件，不解k/c/E或猜起动；通过共享validateStagePlan取得规范化reading，并使用现有脚本同步Qoder副本。新字段须在Node/Qoder/API与浏览器往返中保留；通过模拟模型入口后再安排真实图文验收。
5. 本项实现通过后依次做定轴摆与碰撞、斜面末端直接斜抛。多物体和后续学科保持各自里程碑。
