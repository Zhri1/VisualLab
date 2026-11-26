# 完整竖直内轨与任意入口圆弧契约

本文件扩展 [VERTICAL_ARC.md](VERTICAL_ARC.md)，对应 [首批第 5 项](PROJECT_PLAN_FINAL.md#81-第一批的制作和验收顺序)。本 PR 只交契约、共享输入和独立复算，不改变运行时能力；审核合并后才修改校验、计算、工作区和识别接线。已有半圆、预压弹簧、摆与两套正碰继续回归。复用 `validateStagePlan → assembleScene → buildMotion → sampleAt`，不注册整题模板。

## 1. 新旧输入的判别与适用范围

阶段仍叫 `vertical_arc`。保留现有 `{ radiusM, endAngleDeg, side:"inside", frictionless:true }` 原含义、原点、事件和回滑终点，不把旧半圆自动升级成完整圆轨。新增互斥的显式路径分支：

```ts
type ExplicitArcPath = {
  center: { xM: number; yM: number };
  startAngleDeg: number;
  direction: "positive" | "negative";
  end: {
    kind: "physical_endpoint" | "observation";
    sweepAngleDeg: number;
  };
};
type ExplicitVerticalArc = {
  kind: "vertical_arc";
  radiusM: number;
  side: "inside" | "rod";
  frictionless: true;
  path: ExplicitArcPath;
  endAngleDeg?: never;
};
```

- SI 单位；输入角度为度。圆心是固定世界坐标，不随物体或脱轨点重置。R、顶层 `gravityMps2`、`massKg` 均为有限正数，质量用于真实支持力。
- `startAngleDeg` 从最低点量，0° 在最低点，90° 在最右，180° 在最高，270° 在最左。输入须在 `[-180,180]`；输出角度按实际行进连续展开，可越过 180°、360°。`direction` 指初始沿角增大/减小方向运动，不等同于始终向右/向左。
- `sweepAngleDeg` 是从入口沿指定方向到计划终点的角程，有限且 >0。`physical_endpoint` 要求 <360°，表示题设轨道在该端确实终止；`observation` 要求 ≤360°，表示该处仍有轨道，只结束有限观察。完整圆轨用后者和360°，不能因开始和结束位置相同而捏造缺口。
- 光滑内轨用 `side: "inside"`，仅有指向圆心的单面支持力。理想轻杆、光滑圆管或等效双轨允许沿径向双向作用，用 `side: "rod"`。外侧单面凸轨、运动体需要考虑转动、摩擦圆弧及移动圆心均超范围。约束类型缺值时待补。
- 以 `path` 自有键判新分支，哪怕值是 `null` 也不回退旧模式。`path` 和 `endAngleDeg` 同时出现（包括null）是字段矛盾。只有旧模式才要求 `/stages/i/endAngleDeg`，新模式不得误报这个旧字段。

## 2. 入口状态与阶段接续

设入口角 φ₀、方向符号 d=±1，圆心 C=(cx,cy)。首段继续用非负 `initial:{speedMps:u}`，从显式几何得到入口与带方向速度：

```text
P₀ = (cx + R sinφ₀, cy − R cosφ₀)
q₀ = d u
(vx₀,vy₀) = q₀ (cosφ₀,sinφ₀)
φplanned = φ₀ + d · sweep
```

不新增可与这些条件冲突的首段坐标/速度分量。非首段必须继承前段的真实位置和两速度分量：位置等于 P₀、速度沿同一切线且投影方向与 d 相同；不能平移圆心、把速度压成水平或加一个未给定的转向来凑接续。支持原有 `horizontal_slide(distance)`、`lossless_turn`、`spring_release` 正速接入，也允许明确题设的 `incline_slide` 末端正速切向入弧。斜面提前/恰停均不执行圆弧，保留题设几何；相应地面/圆弧字段仍须校验。

本批不新增 `projectile → vertical_arc` 的入轨冲量，也不接连续第二段圆弧、摆转圆轨或多物体轨道中的圆弧；这些接续明确超范围，不假装无损。弹簧/水平段的现有速度方向限制不因圆弧而放宽。旧半圆后的接续原样保留。

新模式入口须可保持接触，按 §3 核对所需 N。初态已需负 N 是 `/stages/i/path` 的前提冲突，不悄悄当成已贴轨，也不猜此前自由飞行。N=0 是否立即脱轨由实际前向趋势判断。u=0 时：最低点平衡可静止；非平衡位置仅在重力切向加速度指向声明的 direction、且可接触时从静止起动；若相反，方向与释放条件矛盾，定位 direction，不要求填一套虚构初速。其余静止/不稳定初态按真实受力给矛盾，不用小角近似。

### 2.1 物理端点与观察终点

| 实际最早结局 | 新显式路径行为 |
|---|---|
| 正速到 `physical_endpoint` | `arc_endpoint → projectile_launch` 同刻；按真实切线接后缀。无后缀时 `arc_detached`，速度保留、约束移除。 |
| 到 `observation` 目标角程 | `arc_range_end`，`prefix_end/range_end`；保留切向速度、角速度、支持力和 constraint。即使计划带抛体，也不能执行没有发生的发射。 |
| N 首次降至0，继续需要负 N | `arc_contact_lost → projectile_launch`；不论目标是观察还是端点，均从真实脱轨状态接后缀。无后缀时 `arc_detached`。 |
| 先到 v=0 后反向、未能达到目标角程 | 生成非终止 `arc_turn`，沿原路真实返回。固定光滑内轨且仅重力时，同位置的q²与N与来程相同；若转折前未脱轨，返程不会首次脱轨，包含90°零速、N=0后仍贴轨的临界。到入口时以 `arc_return_entry`、`returned_to_entry/range_end` 结束已求范围，保留约束与反向速度，不猜沿前序轨道返回的运动。path只声明目标端是否终止，不能据此把入口当作断口或执行抛体。 |
| 最低点静止平衡 | 0时长 `stopped/complete`，保留 N=mg 和约束；无转折、脱轨或飞行。 |

`prefix_end/range_end` 表示 `termination.reason === endReason === "prefix_end"`，且 `motionStatus.state === "range_end"`，不是清零末速度。其他事件/结局仍按真实原因；落地保留首次入射速度。旧模式的转折回入口仍按 VERTICAL_ARC.md 停界且不接抛体，不改变旧样例数值。

当零速与物理端点同刻且可反向时，先 `arc_turn` 而非发射；支持力的符号不能凭“零速”跳过。正速的物理端点与 N=0同刻时端点优先。观察终点不凌驾于实际脱轨：若从该刻继续已需负 N，仍以脱轨结束；若只是临界过顶瞬时 N=0、前后均非负，则保留约束。

## 3. 方程、接触判据与数值边界

φ 用弧度求解，q=Rφ̇ 是相对角增大方向的有符号速度；反向时 q 自然变号：

```text
x = cx + R sinφ               y = cy − R cosφ
vx = q cosφ                  vy = q sinφ
q² = u² + 2gR(cosφ − cosφ₀)
φ̇ = q/R                     q̇ = −g sinφ
Nrequired = m(q²/R + g cosφ)
normalDirection = (−sinφ, cosφ)
a = (−g sinφ)(cosφ,sinφ) − (q²/R)(sinφ,−cosφ)
```

单面内轨中 N 为非负支持力。双向约束中 N 为径向力的带符号分量，正值朝圆心、负值背离圆心，不能按 N 变负判脱轨。上述关系由能量守恒及径向牛顿第二定律直接得到，可核对 [OpenStax 圆周运动](https://openstax.org/books/university-physics-volume-1/pages/6-3-centripetal-force)。时间用真实非线性方程/专用积分求解，不能弧长除初速。只复用/扩展现有圆弧和摆的低层数值工具，不构建任意规则求解器。

Nrequired 的负值不得被 `max(0,…)` 掩盖后继续贴轨。圆内低点出发 u²=5gR 时，最高点 N=0，但两侧 N>0，故继续完整绕行；u²略低时会在顶点之前脱轨；略高时过顶 N>0。从任意入口还须比较目标端点、转折与接触失效的先后，不能套“入口速率必须 √(5gR)”的低点特例。

临界比较仅吸收按量级缩放的舍入误差；用 u²=5gR±0.004 的可分辨两侧验收。精确已解析边界钉住位置、速度和 N；判断零速、负 N、几何匹配及时间可表示性使用各自量纲，不能用同一绝对 epsilon。能量比、角速度、力或累计时长不可表示时报对应字段 RANGE，不让 Infinity 命中临界吸附。

## 4. 几何、读数、事件与取样

新模式沿用单物体 `StageGeometry.verticalArc` 和 `sample.constraint`，不替换稳定 bodyId 的多物体接口。全程 `positionReference:"particle"`，所有阶段用同一参考点。计划图形不因提前脱轨被截短：

```ts
// 新模式的 VerticalArcGeometry 增量；旧模式保留原值。
startAngleDeg: number;             // 不再是字面量0
endAngleDeg: number;               // 连续展开的计划角，含负角和大于180°
direction?: "positive" | "negative";
endMode?: "physical_endpoint" | "observation";
// center/radiusM/entry/plannedEnd/stageIndex 仍存在。
// actualExit 保留旧字段名；新 reason 加 "range_end"，此时是范围末点，不代表离轨。
// sample.constraint 保留 angleDeg/angularVelocityRadps/normalForceN；可新增：
normalDirection?: { x: number; y: number }; // 新显式圆弧必填，单位向量
```

新模式实际进入后才生成实际圆弧几何。尚未到达的题设弧形可在单独的 `geometry.schematic.verticalArc` 中给出，不能冒充已发生段/事件；沿用该块 stageIndices/reason 说明，既有预压示意 A/B/C 和计时说明原样保留。该示意结构为新路径增加 `startAngleDeg`、`direction`、`endMode`（旧示意可省略）；不能继续用旧Omit类型丢掉新入口角。绘图按圆心及展开弧段生成并把经过的四个极值角纳入视野，不能仍假设右半圆。完整圈的 plannedEnd 可以与 entry 重合，画面须标“观察一圈”，不得标“离轨端点”。

新增事件 `arc_top`、`arc_lowest`（入口时不重复发极值事件），以及 `arc_range_end`。仅实际经过这些位置才发；圆弧顶点不是自由飞行的 `apex`。它们保留 position、前后速度和法向力，top/lowest/range_end前后约束不变。转折仍保留 constraint，不能标持续静止。

- 首段 `release → arc_enter`；后续前段到达事件在 `arc_enter` 之前。沿途极值事件在同刻端点/转折/脱轨/范围事件之前。实际发射在实体端点/脱轨之后；离轨事件后 N=0，约束移除。临界顶点不生成 contact_lost、projectile_launch 或假落地。
- `arc_enter` 的法向力元数据仍只代表圆轨的力：首段前后同取初态N；从斜面/水平等接入时圆轨前值0、后值入口N。这不表示前序表面没有自己的支持力。
- 一圈终点顺序 `arc_lowest → arc_range_end`，两者同刻同状态。既然轨道没有终止，法向力前后均6 N。`segments` 只含正时长的实际运动；观察终点不制造零长抛体。
- 精确事件时间优先；近似匹配选绝对距离最近，同刻或同距歧义才逆序取最后事件后状态。相邻可表示事件不得并成同刻。保留既有十进制1.2及1e-16 m微弧反例。
- t<0返真正初态；t≥duration钳制实际末态，非有限时间沿用现有处理。范围末态仍可运动并保有支持力。普通落地仍保留入射速度；非弹簧段压缩量为0。
- 离轨 T±1e-7 s 用1e-10 SI绝对精度核对位置/速度，或独立核对两侧加速度：轨道侧用 §3，飞行侧(0,−g)。不能用1e-6容差掩盖错段。临界top前后均有constraint，精确top N=0而前后N>0。

供 A 对照的临界一圈末态摘要（是契约预期，不是当前运行时回包）：

```json
{
  "durationSeconds": 0.807562327991372,
  "endReason": "prefix_end",
  "termination": { "reason": "prefix_end", "eventId": "0:arc_range_end:4", "stageIndex": 0 },
  "motionStatus": { "state": "range_end", "reason": "prefix_end", "bodyIds": [], "message": "观察一圈结束；仍沿圆轨运动，支持力未消失。" },
  "geometry": {
    "positionReference": "particle", "blockSizeM": 0.3,
    "verticalArc": {
      "stageIndex": 0, "entry": { "xM": 0, "yM": 0 }, "center": { "xM": 0, "yM": 0.4 },
      "radiusM": 0.4, "startAngleDeg": 0, "endAngleDeg": 360,
      "direction": "positive", "endMode": "observation", "plannedEnd": { "xM": 0, "yM": 0 },
      "actualExit": { "position": { "xM": 0, "yM": 0 }, "angleDeg": 360, "reason": "range_end" }
    }
  }
}
```

该末帧 `sampleAt(durationSeconds)` 的位置为(0,0)、速度为(√20,0)，`constraint` 为 `{kind:"vertical_arc",stageIndex:0,angleDeg:360,angularVelocityRadps:√20/.4,normalForceN:6,normalDirection:{x:0,y:1}}`。顶点精确帧则为(0,.8)、速度(−2,0)、normalDirection=(0,−1)、N=0，仍有constraint。单物体无body表时motionStatus.bodyIds为空，不创造假ID。数据中的 `boundary.normalForceN` 是边界**之前**的支持力；`hasConstraintAtBoundary` 指该刻最终事件**之后**，故正速实体端点可在前值非零时仍离轨，而观察终点保留前后同值。不得把acceptance里的边界前值当作离轨后还受力。

## 5. 固定地面、预压兼容与轻绳边界

圆弧后抛体继续只用 `landingPlaneYM`，是世界固定平面；从正速实体端点或早脱轨发射时均原样继承实际(x,y,vx,vy)，不改成水平。`dropHeightM` 保留用于旧桌面/斜面等路径，但圆弧后单给它仍报前提冲突。地面高于真实发射点时报相应字段矛盾，不猜向上穿面。观察结束或转折回入口停界不发射，题设固定地面可以保留为计划事实，但不生成实际 projectile 几何。

旧 `critical_arc_top` 和1.4 J原题继续按 VERTICAL_ARC/PRECOMPRESSED_SPRING 的低点到180°路径工作，不能把完整一圈或新入口的半径/高度套入旧能量基准。当前活动临界约束若指向显式 path，本增量明确超范围；已规范化的固定energy按既有输入/出处处理，不重推或覆盖basis。原题 B/C、编辑AB后的后缀/仅状态结局、计时原因和补一项切全程均须回归。

轻绳已有真实非线性摆、T=0继续/松绳、切向自由飞行及再次张紧前停界，本项不重复造字段。继续按 [PENDULUM_COLLISION.md](PENDULUM_COLLISION.md#3-非线性摆张力和松绳)：

1. L=1、g=10、低点q=√30，在109.471220634491°、T=0松绳；真实切向(-.608580619,1.721325932)接自由段，无地面不发land。约1.166142972343 s到再次张紧前边界，保留入射状态和slack/T=0，不求未知冲量。
2. 低点q²=5gL的临界全圈过顶 T=0仍张紧；2gL的90°零速转折也不松绳。两侧真实分支均测。
3. 初始released_at_length已松绳的顺序是release→string_slack→projectile_launch，无pendulum_enter；已有松绳无后续时在实际松绳处有限停界。转折不能冻结另一个仍运动的物体。

接口现已有这些绳字段；本项尚需把新圆轨路径接入共享校验、几何/适配、编辑器、支持力向量与观察末态字幕，并用同一时钟回归绳状态和两碰撞路径。圆轨不能被画成绳，N不能写成T；不接再次张紧之后的运动。

## 6. 共享输入与独立对照

机器数据见 [circular-track.acceptance.json](fixtures/circular-track.acceptance.json)，输入全部为共享阶段计划。`node scripts/check-circular-track-contract.mjs` 用闭式能量/力、复合Simpson和独立RK4复算，不导入生产求解器。主要锚点：

| 共享输入 | 独立结果 |
|---|---|
| [临界一圈](fixtures/circular-track-critical.reading.json) | R=.4,g=10,m=.1,u=√20；.403781163995683 s到顶(0,.8)，v=(-2,0)、N=0仍贴轨；.807562327991372 s回低点，v=(√20,0)、N=6，prefix_end/range_end、constraint保留。 |
| [略低](fixtures/circular-track-below.reading.json) | u²=19.996，在顶点前实际N=0且将变负，先脱轨再飞向固定y=0；无完整一圈事件。 |
| [略高](fixtures/circular-track-above.reading.json) | u²=20.004，顶点速率√4.004、N=.001 N，继续一圈；观察结束无发射。 |
| [非最低入口](fixtures/circular-track-offset.reading.json) | 圆心(2,.4)，φ₀=30°，u=4，正向到120°实体端点；.197687524263752 s，位移(+.146410161513776,+.546410161513775)，v=(-1.126032500610494,1.950345502031210)，离弧前N=.767949192431124 N，再接固定y=0抛体。 |
| [镜像入口](fixtures/circular-track-mirrored.reading.json) | 圆心(-2,.4)，φ₀=-30°，负向到-120°；与上一题同时间、反号x/vx、同y/vy/N，验证不是只会向右的整题分支。 |
| [同弧只观察](fixtures/circular-track-observation.reading.json) | 与非最低入口同物理参数，但120°仅是观察终点；相同位置/速度/用时，仍有N=.767949192431124和constraint，无飞行，prefix_end/range_end。 |
| [斜面切向入弧](fixtures/circular-track-incline.reading.json) | 无摩擦30°斜面长1.6 m，静止释放，.8 s到世界(0,0)，速度(2√3,−2)。圆心(.2,.2√3)、入口−30°，正向到60°实体端点；入弧后.157243989317621 s，末点(.546410161513775,.146410161513775)，速度(1.807746993478657,3.131109639934917)，离弧前N=3.767949192431123 N，再接固定y=0。 |

数值验收通常≤1e-6 SI，给定锚点独立复算≤1e-10；精确事件和两侧差异按 §4 更严格核对。实现必须另外覆盖：新旧互斥/缺整块path及叶子草稿往返、TYPE/NOT_FINITE/RANGE与UNSUPPORTED分类；入口位置/切线/初态负N冲突；两方向跨顶、先脱轨与先转折后真实返回入口的不同分支、90°零速零力仍贴轨；零速平衡/下坡起动；物理端点与N=0/零速的同刻优先级；水平或斜面提前与恰停无假圆弧；观察一圈末帧与越界；实际发射才接地面；旧半圆三分支和非零x组合、预压完整/缺参A/B/C、旧桌面/斜抛、摆和两套正碰。

斜面组合运行时须另断言 `release → reach_bottom → arc_enter → arc_lowest → arc_endpoint → projectile_launch → apex → land`；reach_bottom/arc_enter在T=.8同刻前后速度均(2√3,−2)，无lossless_turn/leave_table。在T±1e-7 s按1e-10 SI精度核对斜面与圆弧各自方程，T精确已有constraint；保留原世界(0,0)，不挪至圆轨最低点。圆弧端点与发射同刻，用入弧后的相对用时加.8得到全局时刻，末帧保留入射速度。改μ使坡上提前/恰停，不生成入弧或飞行事件，仍保留题设斜面末端和圆弧示意。

## 7. 共享校验、接线与交付顺序

缺值用null并仅报真实叶路径，如 `/stages/0/path/center/xM`、`/stages/0/path/end/kind`；整块缺失报整块，保留其他已识别几何与阶段。判别字段类型错误走TYPE/INVALID_READING，未登记字符串走UNSUPPORTED，非有限数NOT_FINITE与范围RANGE沿用现有可修正字段错误。缺方向不从图片箭头猜；缺end.kind不把题给全圆当成实体断口。模型回包重试继续由既有Node/Qoder入口处理。

1. 契约与样例先独立PR，原运行时测试/构建通过不等于新path已支持。规划审核合并后才做实现。
2. B更新stagePlan/verticalArc/stageMotion及公共导出；新旧字段分支归一化到专用圆轨低层状态，复用重力公式。同步scripts/sync-functions.mjs覆盖的同源校验依赖，Node/Qoder不可各写一套范围或力公式。
3. Adapter、共享Motion类型透传direction/endMode/连续角度/normalDirection/motionStatus；StagePlanEditor支持path补值与模式切换，保留旧半圆；StagePhysicsCanvas按center和弧段绘图，不再用entry作为圆心替身。PhysicsExplanation/时间轴显示真实支持力、切线和观察范围，保留现有播放器结构。原多物体画布和ID接口不改。
4. Skill只提取圆心/半径/角程/方向/接触侧/实体端点还是观察/固定地面等题设，模糊时待补；实际速度、力、脱轨点及用时由B推导。Node与Qoder实际文字/图文handler用同fixtures、模拟上游验收，再做正常工作区浏览器375/750/桌面走查。无部署。
