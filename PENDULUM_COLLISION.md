# 轻绳摆与最低点正碰契约（联审稿）

后续独立水平正碰扩展见 [HORIZONTAL_COLLISION.md](HORIZONTAL_COLLISION.md)。它单独登记两物体初态、水平接近和horizontal_meeting，复用本文的状态/事件表；本文原有pendulum_lowest、targetApproach和继承摆阶段路径保持兼容。新并行中两个有限轨道、已有初态绳约束引用与首次落地的范围规则以该扩展联审版为准。

本文件扩展 [阶段组合契约](STAGE_COMPOSITION.md)，对应 [扩展规划第8节](https://github.com/Zhri1/VisualLab/blob/fb781ba169c041d71c40d7d6159b8d7245dd4884/PROJECT_PLAN_FINAL.md)。本PR只交契约、共享输入和独立计算基准；合并后再实现。当前生产入口尚未登记本文的新阶段。

## 1. 范围、坐标和物体标识

首批处理固定支点、轻且不可伸长的绳、无空气阻力的质点摆；从给定角度静止释放，也允许最低点题给的带符号切向初速。摆可独立运行，或在最低点与另一质点作一次题面指定的水平正碰。碰撞只有弹性、完全非弹性两种模式。碰后分离的摆锤继续摆动，目标走明确指定的水平/抛体路径；粘连后两物体受同一根绳约束。支点运动、杆的推力、斜碰、转动刚体和再次张紧的冲量模型不在本增量范围内。

仍用 `kind:"stage_plan"`、`schemaVersion:1` 与 `validateStagePlan → assembleScene → buildMotion → sampleAt`，不注册摆碰撞整题模板。现有无 `bodies` 的单物体reading、旧几何、数值与调用路径保持不变。新增摆场景使用以下可选扩展；即使是独立摆，也用一项body表：

```ts
bodies: Array<{ bodyId: string; massKg: number }>;
primaryBodyId: string;
```

- 本增量body表为1或2项。ID由输入给定，非空，匹配 `[A-Za-z][A-Za-z0-9_-]{0,31}`，唯一且不会因数组次序、碰撞或粘连而变更。`primaryBodyId`必须引用其中一项；切换跟踪对象只影响显示，不改物理计算。数量更多留给后续模块。
- 每个质量有限且>0。新摆路径的质量只取body表；不再提交顶层`massKg`，两套质量同时出现时定位`/massKg`为前提冲突。不能从总质量猜两物体分配，也不回退到旧顶层质量。
- `gravityMps2`有限且>0。米、千克、秒及导出单位；输入输出角度为度，内部微分/积分用弧度。
- 本场景世界原点为摆的最低点O=(0,0)，x向右、y向上；支点P=(0,L)。初始位置不是原点。θ从竖直向下方向量起，右为正，左为负：`(x,y)=(L sinθ,L(1−cosθ))`。θ=-60°的质点在左上方，向最低点运动时vx>0。
- 全场景为`particle`。两质点碰撞时可重合；绘图小球半径不参与接触位置、绳长或时间。不能为画清两个物体而修改其物理坐标；粘连可用颜色、同心轮廓和ID标识。

## 2. 有序阶段与受控并行

### 2.1 轻绳摆 `pendulum_swing`

首段显式声明几何和物理前提：

```ts
{
  kind: "pendulum_swing";
  bodyIds: [string];
  lengthM: number;
  initialAngleDeg: number;
  initialStringState: "taut" | "released_at_length";
  pivotFixed: true;
  lightInextensibleString: true;
  airResistanceNegligible: true;
  end: { kind: "lowest_point" | "first_turn" | "first_return_lowest" };
  slackContinuation?: { kind: "free_flight_until_retaut" };
}
```

绳长>0；`-180 < initialAngleDeg < 180`。静止释放沿用顶层`initial:{speedMps:0}`；对摆的首段，非零标量speedMps不能猜方向。新增互斥初态`initial:{tangentialSpeedMps:number}`，表示沿θ增大方向的带符号切向速度q；首批非零q只支持从最低点θ=0开始，其他角度带非零初速为明确超范围。两种initial形状混用定位`/initial`，未知数值为null。

`initialStringState:"taut"`是题面明确绷紧的断言，必须核对所需张力；`released_at_length`只确认释放位置距支点L、移去外部支撑，由动力学决定绳是否承担张力，不暗示有负张力。此枚举不得由图中一条直线推断成有张力。

碰后摆动复用同一模块，不重复填一套几何：

```ts
{
  kind: "pendulum_swing";
  bodyIds?: string[];                  // 顶层阶段必填；并行轨道内由轨道提供
  inheritFromStageIndex: number;       // 引用前面已定义几何的顶层摆阶段
  end: { kind: "first_turn" | "first_return_lowest" | "scene_end" };
  slackContinuation?: { kind: "free_flight_until_retaut" };
}
```

继承分支与显式length/angle/事实分支互斥，继承的是几何与前提，速度必须取碰撞后的实际状态。所引用支点和绳长不改，当前位置必须在该绳最低点、速度必须水平；不通过改坐标或速率强行接续。粘连bodyIds列两项，二者位置和速度完全相同，以质量之和计算张力。

`lowest_point`结束在实际首次到最低点；`first_turn`是开始实际运动后的第一个转折，不把静止释放的t=0算成完成；独立-60°释放因此经过最低点后到+60°。`first_return_lowest`从最低点开始时计实际运动后的首次返回；从非最低点静止释放时，先经过最低点，再计下一次返回（-60°样例为三个四分之一周期）。可经过转折返回，也可完整绕行返回。θ=q=0是持续平衡、零时长`stopped`，不输出转折或松绳。正速绕行不存在first_turn时，定位该end为可修正的前提冲突，不能用小角周期凑出转折。

### 2.2 最低点正碰 `collision_1d`

```ts
{
  kind: "collision_1d";
  bodyIds: [string, string];            // [摆锤, 目标]；与质量/速度一一关联
  mode: "elastic" | "perfectly_inelastic";
  normalXM: 1 | -1;                   // 接触法线从第一个物体指向第二个
  contact: { kind: "pendulum_lowest"; pendulumStageIndex: number };
  targetApproach: {
    kind: "uniform_horizontal";
    velocityXMps: number;
    endsAtContact: true;
    initialXM?: number;               // 题面另给时核对，未给时可由下述明确条件求得
  };
  externalImpulseNegligible: true;    // 仅指水平方向碰撞外冲量可忽略
}
```

碰撞是零时长阶段，只能紧接结束条件为lowest_point的摆段。contact引用该前序摆段。两ID不同且存在，目标不已受摆绳约束。碰撞点固定O=(0,0)，双方碰前/后vy=0；目标不是被无声加入绳上的第二个摆。

目标静止时`velocityXMps:0`，题面必须确认它位于最低点正碰位置。移动目标的`endsAtContact:true`确认题面指定它在摆锤到达最低点时恰好接触；`kind:"uniform_horizontal"`表示题面已确认接触前水平匀速（包含静止）。这不要求目标所在平面光滑；静止目标可放在碰后动摩擦因数为.2的粗糙面上，不能为了初始静止而伪造光滑前提。设碰撞绝对时刻tc、带符号目标速度u2，则目标在0≤t≤tc的真实位置为`(u2(t−tc),0)`，初始x=-u2tc。题面另给initialXM时必须与此一致；缺少匀速/同步到达前提不能反推一段虚构轨迹。目标只给“碰前瞬时速度”而没有前段运动依据时，返回具体待确认字段（例如targetApproach/kind），不把整段预碰时间画成匀速。

给定normalXM=n，必须满足`(u1−u2)n>0`，即确实接近；共速或相互远离不生成碰撞。normal与题面位置/入射侧矛盾定位对应字段。初始摆根本不能以约定路径到达最低点时，contact为前提冲突，不能虚构tc或目标初位；独立摆的已可求前缀可由用户明确截取后另走同一入口。

弹性后原摆锤仍受原绳约束，目标按后序轨道运动。完全非弹性表示在该质点接触处粘成一体、可随原绳离开目标原支承面，之后用两ID的组合摆；不再为目标保留水平支撑约束。输入不能既要求粘连，又在后序把两者分到不同轨道。

### 2.3 碰后同步 `parallel_motion`

弹性分离后通过受控并行阶段使用现有模块，不为整题增加switch：

```ts
{
  kind: "parallel_motion";
  tracks: Array<{ bodyIds: string[]; stages: Array<Record<string, unknown>> }>;
  end: { kind: "all_finite_tracks" } | { kind: "pendulum_turn"; bodyId: string };
}
```

本增量仅用于该碰撞之后。两个物体各在一条轨道，不能遗漏/重复ID；粘连组合只能在同一轨道。摆轨道复用inherit分支且end为scene_end；目标轨道支持已有horizontal_slide的distance/stop及其实际离沿后projectile（固定landingPlaneYM）。若目标在光滑面上持续运动，可用末段 `horizontal_slide` 的 `end: { kind: "scene_end" }`（`kineticFrictionCoefficient = 0`），由题定 `pendulum_turn` 决定共同终点。并行内不嵌套并行或第二次碰撞，不支持任意规则图。粘连后只有一组运动时直接用顶层继承摆阶段，end=first_turn即可。

- 各轨道从碰撞时刻同时开始，内部阶段顺序接续。不把第二条轨道排在第一条结束后。轨道内水平距离从本段入口量起，方向取实际带符号速度；摩擦始终反向，停止后不反向。目标桌沿相对距离沿入射方向取正，世界x可向左；零速不能离桌。
- `all_finite_tracks`取所有有限目标轨道完成时刻的最大值，scene_end摆为跟随轨道，积分到这个共同时间。至少要有一个有依据的有限目标；全部scene_end或目标已在入口静止而摆仍运动时，需明确播放结束条件，定位并行end，不猜任意观察时长。
- **摆锤首个转折默认只是事件。**只要绳仍张紧，转折后反向继续取样到共同结束时间，不能截掉目标仍可计算的滑动/飞行，也不能让摆锤冻结在转折点。若题设明确“看到摆锤首个转折”，用并行end=pendulum_turn显式结束全场景，保留其他物体当时的真实状态。
- 已真正静止的水平物体或平衡摆可以保持静止等待其他轨道完成。落地保留入射速度；本批没有落地后的碰撞/弹跳模型，不将这个瞬间状态当作仍在运动的持续轨道。两物体本批只有一个目标轨道，首次落地与摆动首转折同刻时保留两项事件，以落地为终止事件。若任何轨道先遇到真正的模型边界（例如再次张紧），结束共同可求范围并明确报告，不能拖长冻结该物体来凑另一路末点。模型边界与落地同刻时保留两项事件，以模型边界为终止事件。
- 新阶段事件`stageIndex`仍指顶层列表，另带`stagePath`定位嵌套模块，例如`/stages/2/tracks/1/stages/0`。顺序下标不是物体ID。只输出实际发生且有正时长的运动段；collision不生成segment。

## 3. 非线性摆、张力和松绳

张紧期间取q=L·dθ/dt，M为同一绳上当前组合质量：

```text
x=L sinθ，y=L(1−cosθ)
(vx,vy)=q(cosθ,sinθ)
dθ/dt=q/L，dq/dt=−g sinθ
q²=q0²+2gL(cosθ−cosθ0)
Trequired=M(q²/L+g cosθ)
```

时间由完整非线性方程或等价积分求出，不用θ''≈−gθ/L的小角近似。静止振幅A的四分之一周期为`√(L/g) K(sin(A/2))`，`K(k)=∫₀^(π/2)(1−k²sin²ψ)^(-1/2)dψ`。专用积分须处理转折可积端点，不引入任意规则求解器。

轻绳只能拉，不能推：

| 边界 | 状态与处理 |
|---|---|
| 所需T>0 | 张紧，沿圆周取样。 |
| T=0但之后仍需T≥0 | 仍可张紧；不能仅凭等于零松绳。静止从±90°释放就是例子，随后T>0；最低点q²=5gL完整绕行在最高点也仅瞬时T=0。 |
| T降至0，继续圆周需要T<0 | `string_slack`，保留实际位置与切向速度，解除定长圆周运动约束。之后T=0。 |
| 初态taut但Trequired<0 | 可修正的前提冲突，定位initialStringState；不以max(0,T)掩盖错误并继续沿圆周。 |
| released_at_length且Trequired<0 | t=0即松绳，按真实初速度自由飞行；若静止在120°，初速就是0，不能给它凭空的切向速度。 |

最低点以q0出发，r=q0²/(gL)：0<r≤2时先转折（cos|θturn|=1−r/2），其中r=2在90°零速、零张力转折后仍张紧；2<r<5上升途中松绳，`cos|θloss|=(2−r)/3`，方向继承q0的符号；r≥5可完整绕行，r=5在最高点不松绳。θ=0且q=0持续平衡。临界比较仅吸收按量级缩放的浮点舍入，不能用宽容差吞掉两侧真实分支。

没有slackContinuation时，在实际松绳点结束范围，保留其速度，motionStatus为range_end。指定`free_flight_until_retaut`时，以当时真实(x,y,vx,vy)复用重力段；绳仍连在支点但松弛，不再有圆周向心力。只求到距离支点首次重新达到L且将向外越过的正时间：

```text
r(t)=r0+v0 τ+(0,−gτ²/2)，r0=position−pivot
|r(t)|²−L² = (v0²+gL cosθ0)τ²−g·vy0 τ³+(g²/4)τ⁴
```

忽略τ=0的接续根，只取自由飞行后实际重新绷直的最小正根；初态贴圆上但随后向内时不能立即报再次张紧。T=0上行松绳时τ=4vy0/g；静止从|θ0|>90°释放时τ=2√(−L cosθ0/g)。到此输出`string_retaut_boundary`，motionStatus=model_limit，结束原因同名。此事件只标出**再次张紧之前**的已知入射状态，不计算径向冲量、碰撞损失或之后轨迹；body状态为model_boundary，constraint仍是slack、T=0，不能画成已张紧继续摆。事件前后快照同值仅表示未施加未知冲量，不声称真实张紧后速度不变。越界样本钳制为此范围末快照，界面说明不代表之后物理静止。

绳形状松弛时不唯一；A用虚线/松绳标记，不把支点到质点的直线当成长度始终为L的拉紧绳。松绳后再次张紧、摆绳与支点/其他物体碰撞的后续模型本批不接。

松绳的自由段是实际projectile segment，沿用原顶层stageIndex，stagePath指向该段的slackContinuation，bodyIds仍为原物体/粘连组；之前的张紧段为pendulum_swing。string_slack后同刻projectile_launch，内部实际最高点沿用apex，且只在时间区间内部发生时输出。初始松绳无张紧segment、无pendulum_enter。此处projectile几何进入bodyTracks；没有指定落地平面时不能额外造land。连续绕行时状态角度可连续超过180°，不将正方向角速度在跨顶时改成负值。

## 4. 碰撞公式、来源和守恒核对

u1、u2均为世界x的带符号速度，不用速率替代。弹性：

```text
v1=((m1−m2)u1+2m2u2)/(m1+m2)
v2=(2m1u1+(m2−m1)u2)/(m1+m2)
```

粘连：`v=(m1u1+m2u2)/(m1+m2)`，两ID共享此速度和碰撞位置，动能损失`½[m1m2/(m1+m2)](u1−u2)²`。水平方向总动量守恒；弹性总动能守恒，粘连按损失核对。碰后摆张力立刻用真实碰后q和当前约束质量重算，不沿用碰前张力。

同一纯碰撞计算接收两质量和带符号切向速度即可，不依赖60°、等质量或本题路径。后续普通水平正碰/碰后抛体复用它及第5节物体状态和事件接口；本PR不提前登记未做的通用接触寻时模块。

公开calculations继续用quantity/value/unit/source/inputPaths，来源为真实路径：摆最低点速度引用初态、绳长、角度和g；碰后速度引用对应质量及碰前事件；张力还引用当前组合质量和几何。题面给的u2不得标成B推导，B算出的u1/tc不得说成AI直接识别。事件引用可另用`sourceEventIds?:string[]`，不把事件ID伪装成reading的JSON Pointer。

## 5. 状态、几何、事件和兼容投影

目前代码没有MotionStatus或多物体字段，不能假设旧播放器会自动理解它们。本节定义新增可选字段，旧场景不要求补齐。

```ts
type BodyState = {
  bodyId: string; massKg: number;
  xM: number; yM: number; vxMps: number; vyMps: number;
  springCompressionM: number;          // 本模块恒为0
  status: "moving" | "resting" | "turning" | "landed" | "model_boundary";
  constraintId?: string;
  groupId?: string;                   // 粘连组，不替代bodyId
};
type StringState = {
  kind: "pendulum_string";
  constraintId: string;
  bodyIds: string[];
  pivot: Point; lengthM: number;
  state: "taut" | "slack";
  tensionN: number;                   // 该整根绳的总张力，不是各body独立受力
  angleDeg?: number;                  // 张紧时必填；松绳时不冒充圆周角状态
  angularVelocityRadps?: number;      // 张紧时必填，有符号
};
type MotionStatus = {
  state: "complete" | "range_end" | "model_limit";
  reason: string;
  message: string;
  bodyIds: string[];
};

// 新摆路径 sampleAt 的增量：顶层旧xM/yM/vxMps/vyMps等仍投影primaryBodyId。
bodies: Record<string, BodyState>;
constraints: Record<string, StringState>;

// StageMotion 增量
primaryBodyId: string;
motionStatus: MotionStatus;

// 新路径 StageEvent 增量（所有实际body在同一个时刻的完整快照）
bodyIds: string[];                    // 此事件直接涉及的ID
stagePath: string;
bodyStatesBefore: Record<string, BodyState>;
bodyStatesAfter: Record<string, BodyState>;
constraintsBefore: Record<string, StringState>;
constraintsAfter: Record<string, StringState>;

// 新路径 segment 增量
bodyIds: string[];
stagePath: string;
```

body快照所有数值有限，body表ID全程存在。status=turning是瞬时反向，不能显示“永久停止”；body静止平衡才是resting。新constraints表独立于旧圆弧`sample.constraint:ArcConstraint`；原constraint的类型和值不被替换。摆画布根据body.constraintId读新表。粘连后保留两bodyId，同位置同速度且同groupId；约束ID稳定为`string:<原摆bodyId>`，其bodyIds从一项更新成两项，总张力只显示一次。groupId由排序后的ID拼为`group:<id1>,<id2>`，不把两份25 N相加成50 N。

静止释放的非平衡摆和初始松绳质点即使t=0速度为0，也属于将要运动的moving；不能只凭当前速率为0改成resting。首转折结束和模型边界快照也不能被播放器解释为永久静止。

新几何在StageGeometry中增量给出：

```ts
bodies?: Array<{ bodyId: string; massKg: number }>;
pendulums?: Array<{
  constraintId: string; bodyIds: string[];
  definitionStageIndex: number;
  pivot: Point; lowestPoint: Point; lengthM: number; initialPosition: Point;
}>;
bodyTracks?: Array<{
  bodyIds: string[]; stagePath: string;
  horizontal?: { start: Point; plannedEnd: Point | null };
  projectile?: { launch: Point; landingPlane?: { yM: number } };
}>;
```

pendulums的bodyIds表示原始定义时的物体，动态粘连成员读sample.constraints；bodyTracks只列实际执行的轨道，计划桌沿若提前停仍保留plannedEnd。旧geometry/单物体投影只作主物体兼容视图，不能把目标轨道装进它再假装是主物体；A应使用新增米制表绘制两个物体与支点。

只有新增bodyTracks.projectile的landingPlane可省略：松绳自由飞行到再次张紧边界没有题给地面时，只给真实launch，不画地面、不发land。目标从桌沿飞行且题给地面时仍填固定landingPlane。旧单物体StageGeometry.projectile的landingPlane必填及落地语义保持不变。

事件增加`pendulum_enter`、`pendulum_lowest`、`pendulum_turn`、`collision`、`string_slack`、`string_retaut_boundary`。已有release、reach_target、leave_table、apex、land、stop按实际轨道继续使用。每次摆经过最低点/转折都可记录事件，重复经过不自动触发第二次未计划的碰撞。首段真实张紧时release之后同刻pendulum_enter；初始released_at_length已经松绳时仅release→string_slack，再接实际自由飞行，**不发pendulum_enter**。到最低点与碰撞同刻时**pendulum_lowest在前、collision在后**，之后才是碰后轨道入口事件。

timeSeconds是同一全局物理时钟，order全局严格递增。同刻独立轨道事件按输入track次序和轨道内部顺序确定，但collision是一次整体原子更新，不能按body逐个交付半个碰后帧。所有新事件的旧velocityBefore/After、position投影主物体；新画布及字幕用bodyStates而不是猜投影指谁。

精确取样沿用“精确时间优先，再择最近容差事件；同刻取最后事件之后”的规则。在tc精确返回两个物体碰后速度和碰后张力，t−ε取双方碰前状态，t+ε各走其真实轨道；两body位置在碰撞时连续。不能把刚好相邻的可表示事件合并。

termination/endReason仍同源同值：所有物体最终真实静止时stopped/complete；明确到最低点的前缀为prefix_end/range_end；明确在首个转折结束为新增pendulum_first_turn/range_end；无后序轨道的碰撞前缀为collision_complete/range_end（保留双方速度）；松绳处指定结束为string_slack/range_end；再次张紧边界为string_retaut_boundary/model_limit。落地结束沿用landed，保留入射速度并说明未模拟接地后。durationSeconds仅为已求范围；末帧及越界样本钳制，但不能把范围结束解读为所有物体永久静止。

all_finite_tracks由目标stop结束而摆锤仍在摆动时，保留目标stop为最后事件、摆锤真实末态，termination/endReason取prefix_end、motionStatus取range_end；只有所有body确实静止才stopped/complete。目标land结束而摆仍运动时为landed/range_end。motionStatus.bodyIds标记触发范围结束的物体（全体静止时列全体），message说明其他物体仍运动；不能把主物体的旧投影视为也已停下/落地。

适配器保留上述body/constraint/事件表、MotionStatus、stagePath和主物体ID；只把米制位置/速度映射成UI的position/velocity。旧顶层sample仍返回primaryBodyId对应的状态，旧播放器操作沿用单一时间。新画布逐ID取样，辅助技术应能分别读到ID、速度和松绳/张紧状态。

## 6. 校验、草稿和两端边界

共享校验只有B的validateStagePlan一份实现。C的Node和Qoder继续原有状态映射、结构损坏重试和脚本同步，不复写碰撞公式或摆校验。成功回reading原样保留bodies/ID/有序阶段/并行轨道；失败保留所有可确认的body、局部阶段和引用。结构未知才reading:null。本文不调整既有HTTP状态。

| 输入问题 | 结果与定位示例 |
|---|---|
| 缺质量、绳长、角度、g、目标速度或事实 | NEEDS_INPUT，仅真实缺项，如`/bodies/1/massKg`、`/stages/0/lengthM`、`/stages/1/targetApproach/velocityXMps`；不能因质量未知就要求人工补可由题设推导的tc/u1。 |
| 非有限数、负质量/长度、非法角度/normal、非整数/越界索引 | 沿用NOT_FINITE/RANGE，数值草稿置null，fieldErrors独立于missingKeys。 |
| 字段类型损坏、枚举为非字符串、数组/对象类型错误 | TYPE/INVALID_READING，Node/Qoder沿已有规则处理；不能误报unsupported。 |
| 未登记字符串mode/kind、杆/运动支点等明确超范围 | UNSUPPORTED，指明字段；明确false的理想前提同样不偷偷忽略。 |
| 重复bodyId、未知引用、质量两套来源、粘连后拆轨、碰撞不接近、给定初位与同步到达矛盾、taut所需负张力 | PRECONDITION_CONFLICT；定位对应ID/引用/物理前提路径，可修正草稿。 |
| 已知post摆持续运动但所有轨道都只等scene_end | 并行end为NEEDS_INPUT，要求明确观察终点，不制造停止时刻。 |

bodyId本身只需满足唯一标识，不因用户命名为bob以外的字符串而改变公式。引用索引仅指已有定义，禁止未来/错误阶段；root.stageIndex和nested.stagePath一起定位，不用生成的时间轴次序回写reading。未知一个阶段/质量不得吞掉其他可识别字段的错误。编辑质量、角度或目标速度后重算完整计划与目标预碰位置；ID与题面事实保留，不保留过期派生tc。C提取的质量/速度不填“等质量模板”的默认值。

## 7. 共享样例和独立基准

主样例L=1 m、g=10 m/s²，从左侧-60°静止释放，m1=m2=1 kg、目标静止。释放位置(-√3/2,1/2)，初始张力5 N。时间由非线性积分给出：

| 场景 | 对照 |
|---|---|
| [弹性等质量](fixtures/pendulum-elastic.reading.json) | tc≈0.533081068764 s，O=(0,0)，碰前(u1,u2)=(√10,0)，摆张力20 N；碰后(0,√10)，摆锤在O平衡、张力10 N。目标μ=.2，再滑2.5 m；全程2.114219898849 s停在(2.5,0)，二者静止。 |
| [粘连](fixtures/pendulum-sticky.reading.json) | 碰后共同q=√10/2，整根绳T=25 N；动能5→2.5 J。全程1.037857180691 s到首个右转折，θ≈28.955024371860°，位置(√15/8,1/8)；不是永久静止，转折时总张力17.5 N。 |
| [独立摆](fixtures/pendulum-alone.reading.json) | 不放目标；全程1.066162137529 s到右侧+60°首个转折，位置(√3/2,1/2)，保留张紧与5 N张力；只有明确首个转折范围结束，没有collision/stop。 |
| [异质量弹性](fixtures/pendulum-unequal.reading.json) | m2=3 kg，碰后bob=-√10/2、target=+√10/2。bob在1.037857180691 s左转折后继续向右下摆；目标在1.323650483807 s停在(.625,0)。共同末帧bob约(-.313970025,.050567104)，速度(1.158408484,-.383076617)，不能冻结在左转折。 |
| [带符号目标入射](fixtures/pendulum-moving-target.reading.json) | 等质量，u2=-1 m/s；目标初位x=+tc≈.533081069，tc到O。弹性碰后bob=-1、target=√10，动量√10−1保持；总动能5.5 J保持。 |
| [目标离桌飞行](fixtures/pendulum-target-projectile.reading.json) | 取异质量样例，目标μ=.2、距沿.4 m、固定地面y=-1.25。约.849308834781 s以√.9离沿，再飞.5 s，总时长1.349308834781 s；落点(.874341649,-1.25)，入射速度(√.9,-5)。摆锤已过首个左转折，飞行期间继续同钟取样，不冻结。landed/range_end。 |
| [高能最低点松绳](fixtures/pendulum-slack.reading.json) | 最低点q0=√30向右，初始T=40 N；约.477612599684 s、θ≈109.471220634491°处T=0，位置(.942809042,1.333333333)，速度(-.608580619,1.721325932)，速率√(10/3)。随后自由飞行；约1.166142972343 s到再次张紧边界，位置(.523782801,.148148148)，入射速度(-.608580619,-5.163977795)，明确model_limit。 |
| [初始松绳](fixtures/pendulum-initial-slack.reading.json) | 120°静止、released_at_length，所需张力-5 N而真实T=0。自由下落至.447213595500 s的再次张紧边界，位置(√3/2,.5)，速度(0,-√20)。改initialStringState为taut应给前提冲突，不继续圆弧。 |

机器可读数据见[pendulum-collision.acceptance.json](fixtures/pendulum-collision.acceptance.json)。独立命令`node scripts/check-pendulum-collision-contract.mjs`只用能量/动量闭式关系、去奇异后的复合Simpson积分及独立RK4交叉核对，不调用未来的生产新阶段，也不把它通过称作运行时接线已验收。验收位置/速度/张力/时间误差≤1e-6 SI，精确碰撞快照与稳定ID另作严格断言。

[碰撞输出快照](fixtures/pendulum-collision.output.json)给A/C核对body/constraint完整映射、主物体投影和collision的前后速度；`contractPreview:true`只是样例标记，不进入reading或生产Motion。示例事件ID仅用于该输入，调用方不能依赖硬编码ID。validationCases为实现后应跑的缺项/矛盾用例，独立数据核对不冒充共享校验已支持这些新字段。

实现验收至少覆盖：主样例的t−1e-7/t/t+1e-7、两ID原子碰后状态、最低点/碰撞同刻order；等质量/异质量/带符号目标/镜像右侧释放；静止平衡、±90°零张力保约束、初始负张力的冲突与真实松绳；q²=2gL、5gL及两侧，完整绕行T=0不松绳；无后缀碰撞与独立摆；水平提前/恰停无假飞行；目标飞行时摆继续同钟；仅用户明确首转折才截断；模型边界的有限范围；字段错误及局部缺项往返；旧斜面弹簧、圆弧、预压、API及生产构建回归。

## 8. 联审后的接入顺序

1. 本PR合并前不改src/functions/Skill或部署，不声称UI已支持多个物体。共享契约不改package。
2. B先登记body表、摆/碰撞/受控并行，保留单物体入口；碰撞纯计算与路径装配分开。复用已存在的重力段、水平公式和专用非线性积分，不复制整题求解器。先交核心和标准测试覆盖的验收，再交接线。
3. A同步`src/types/index.ts`、`src/adapters/stageMotionAdapter.ts`、编辑器、画布和字幕：按bodyId取同一sample，保留旧主物体投影，新增group/constraint/tension/MotionStatus；避免把turning或model_boundary显示成停止。播放器继续只有一个时钟和事件列表。
4. C同步`src/api/stageTypes.ts`及生成的functions副本、Skill登记和图文mock入口；完整透传body/嵌套计划与草稿。模型只提取事实，B算tc、目标初位、碰后速度和张力。先验证两端共享校验、再验证真实图文；本契约阶段不部署。
5. 下一增量为斜面末端直接斜抛；普通水平正碰与碰后接抛体复用本次body状态、事件及碰撞公式，之后按规划补齐首批与第二批。这里不提前承诺尚未实现的接触寻时或再次张紧冲量。
