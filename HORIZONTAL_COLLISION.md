# 独立水平正碰与碰后接续契约（联审稿）

扩展 [摆与碰撞契约](PENDULUM_COLLISION.md)，对应规划8.1第4项。本PR仅交字段、共享输入和独立基准，审核合并后再实现。沿用稳定bodyId、particle、同钟sampleAt、事件前后快照、MotionStatus和纯函数collide1D；不注册整题模板。旧最低点碰撞、单物体及其初态形状保持兼容。

## 1. 两物体初态与自由水平接近

仍为kind=stage_plan、schemaVersion=1。顶层bodies为恰好两个不同ID及各自有限正massKg，primaryBodyId引用其中之一；禁止另给顶层massKg。世界坐标由题面初位确定，x向右、y向上；本增量初态都在y=0的同一直线上，不把实际接触点重置到原点。单位为m、kg、s及导出单位。

新增互斥的顶层初态形状：

```ts
initial: { bodies: Array<{
  bodyId: string;
  xM: number;
  vxMps: number;
  constraint?: {
    kind: "pendulum_string";
    pivotXM: number; lengthM: number;
    pivotFixed: true; lightInextensibleString: true;
    airResistanceNegligible: true; initialStringState: "taut";
  };
}> };
```

ID格式沿用旧契约，数组次序不代表左右；初态表必须精确覆盖body表。x与vx有限，vx带符号；不同时提交speedMps、vx/vy或tangentialSpeedMps等旧初态。题面未给位置或速度填null，不把“碰前瞬时速度”当初始速度。模型只提取题给初态；接触时刻、位置、碰前速度由B求。

首段登记可复用的水平接近阶段：

```ts
{
  kind: "horizontal_approach";
  tracks: Array<{ bodyId: string; kineticFrictionCoefficient: number }>;
  end: { kind: "contact_or_rest" }
     | { kind: "time_limit"; durationSeconds: number };
}
```

tracks恰好覆盖两个ID，μ有限非负且按题设分别给出，不默认相同或光滑。含任一μ>0或摆/抛体后缀时g有限正且必需，否则可省略；质量因碰撞必需。time_limit时长有限正，是明确观察范围，不是模型猜出的碰撞时刻。

初态含已有绳约束时，即使接近阶段没有摩擦，也必需g，用于题给初态及碰后绳张力；不得省略重力依赖。

每体滑动时 a=-μg sign(v0)，到tstop=|v0|/(μg)后原位静止，μ=0时匀速；初速0保持静止，不引入自启动或静摩擦系数。不允许摩擦把物体反向加速。以两个停止时刻分区，解相对位置二次方程的最早有效接触根；区间末端根只处理一次。不得只用初始相对速度或无摩擦公式判接触。

若无接触且两体都能静止，contact_or_rest在最后实际停止时结束；包括“先停后被追上”和“两体先停未接触”的不同结局。若无接触但有物体无限匀速运动，该模式缺有限播放范围，提示/stages/0/end，由用户改为time_limit，不能编造时间。time_limit先到而尚未接触时范围结束；不能声称以后永不碰撞。可由分段公式证明不会接触时，输出说明，但仍需有依据的有限播放范围。

## 2. 瞬时碰撞与真实方向

紧接首段使用已有collision_1d的新增contact分支：

```ts
{
  kind: "collision_1d";
  bodyIds: [string,string];
  mode: "elastic" | "perfectly_inelastic";
  contact: { kind: "horizontal_meeting"; approachStageIndex: 0 };
  normalXM?: 1 | -1;
  externalImpulseNegligible: true;
}
```

不提交targetApproach或pendulumStageIndex。初位不同，n由第一个ID指向第二个ID的初始位置方向确定，碰前必须(u1-u2)n>0；题面另给normalXM时核对一致性。初位相同的t=0接触须明确normalXM，缺时待补该路径；相对静止或分离不能按速度自行挑法线来制造冲击，明确不接近的碰撞断言为前提冲突。接近但接触处相对速度恰为0，只记contact，以contact_without_impact/range_end保留该边界，不能给无冲击接触套反弹速度或继续穿透。contact事件快照的前后位置与速度相同、保留双方ID；完整计划及接近前缀都在此处以contact_without_impact/range_end结束，不执行collision或任何后缀。不使用no_collision/complete的静止字幕；是否零速仍按各物体真实速度判断。

使用实际接触时刻的带符号u1/u2和对应质量调用collide1D。弹性保持总动量和动能；粘连速度为(m1u1+m2u2)/(m1+m2)，保留两个ID、共位置和速度。接触前摩擦耗能与瞬时碰撞损失分开记录，不拿初态动能冒充碰前动能。

计划中collision及其后缀只有实际发生冲击才执行；不接触时不产生collision事件、假接触点或碰后几何。首段单独可用作前缀：到真实接触前状态即结束，reason=prefix_end、MotionStatus=range_end，无碰后速度。

## 3. 碰后有序轨道与约束

碰后沿用parallel_motion/tracks/end。弹性分离两个ID各一条轨道；粘连一条轨道bodyIds含两个ID，禁止拆成两个独立求解。无后缀时以collision_complete/range_end结束，保留碰后速度；不宣称全体停止。

- horizontal_slide复用现有μ、distance/stop：距离沿该段实际速度方向取正，世界位置可以向左；摩擦反向、停止钳制。两ID粘连只使用该共同轨道的一项题给μ，不把两份μ相加。碰后并行轨道的末段还可给 `end: { kind: "scene_end" }`，此时题面须明确光滑（`kineticFrictionCoefficient = 0`）。该物体沿碰后的实际速度等速运动直到共同终点，无需给停止时刻或位移。`scene_end` 不允许用在单物体顶层水平段或并行轨道中间，不生成停止或到达目标事件。本增量不装配分区或随时间换面。同一物体在同一水平表面往返沿用其μ；不同物体可因接触材料不同而有不同μ。仅凭碰前/碰后两项μ不能证明换面，水平同面μ矛盾定位相应轨道为前提冲突，不暗加切换事实。路径不重合的已明确支撑变化可由supportBoundary或已有绳约束表示；其他分区/表面变化留待后续契约，不猜。
- 直接projectile使用固定landingPlaneYM，从实际接触位置和碰后(vx,0)发射；该轨道首段须额外给supportAbsentAtStart:true，确认题面明确碰撞处无支撑/位于檐口。未知为null并待补该字段，明确false与直接飞行冲突。同时提供supportBoundary:{edgeXM:number,supportedSide:"left"|"right"}，明确哪侧仍有支撑；实际接触点必须在该边缘，直接飞行体碰后速度指向无支撑侧，预碰轨迹不得经过无支撑区却仍按水平支撑计算。零速自由落体须题设明确失去支撑，不能仅由零速推定。此字段只用于新水平正碰的直接发射分支，不要求旧抛体补值。零水平速度也可在无支撑处自由落体，不能据此删除题给飞行。若先沿桌面再离沿，用水平定距→projectile，提前/恰停不飞行。不得用碰前速度发射。
- pendulum_swing新增`inheritFromBodyId`分支，引用initial.bodies中题面已有的绳约束，与inheritFromStageIndex/显式摆定义互斥；end和slackContinuation沿用摆契约。最低点为(pivotXM,0)、支点(pivotXM,L)，引用位置必须相符，碰后真实水平速度就是最低点切向速度。可引用初态已经静止在最低点的摆锤等待来物，或t=0即碰撞的最低点初态；不允许给正速直线走了有限距离的物体声明一直受固定张紧绳约束。未知约束事实须补齐，不能为支持摆动临时造绳。
- 粘连最多继承一根已有绳：用两质量之和算唯一张力，快照含两个ID共用constraintId，不能再对另一ID额外算一份张力。不支持两根绳的联立约束、碰后新挂接的冲量或支点突变。
- all_finite_tracks在所有可求有限轨道结束时结束，已停止水平体保持静止等待；摆scene_end继续越过首转折，光滑水平scene_end恒速跟随共同终点。若任一物体先落地（无落地后模型）或先到再次张紧边界，全场只求到该首次边界，其他物体保留当时真实状态，不冻结入射速度等待另一个落地。此时分别为range_end或model_limit。同刻保留各轨道事件，终止事件按绳约束边界、落地、距离目标或摆动转折的优先级选定。全部停止才为complete；全部非有限且无摆转折等明确结束条件，待补并行end。

本增量仍只一次碰撞，不支持碰后两体再次相遇的冲量；若后续路径导致再次接近并接触，仅在首次碰撞之后重新分离过的独立轨道上，求实际位置相交且确实接近的下一接触。排除第一次接触同刻离开、粘连两ID持续共位置及相对速度为零的无冲击重合；水平/抛体必须同时核对x与y，不能只看x投影相交。全场在第二次接触的入射状态结束，motionStatus=model_limit、reason=second_contact_boundary，不默默穿透。无再次接触的样例正常走到已声明终点。

## 4. 取样、事件、几何和错误

保留现有bodies/constraints快照与primaryBodyId兼容投影。时间轴从题面共同初态t=0开始，碰撞后两个轨道同时以tc为起点，不按数组依次播放。t<0回碰前初态，t≥duration回真实末态；若t=0发生正碰，负时间必须先返回原题碰前初态，t=0才按同刻事件序取碰后，不能先把负时间钳到0而误读碰后状态。首次落地/模型边界末帧保留入射速度。瞬时速度由方程决定，摆的转折或无冲击接触可瞬间零速；只有真实持续静止才钳制零速，首转折不能标为resting。以上边界须做t=0正碰的专门运行时回归。

事件包含release、各体实际stop、contact、collision和后缀实际事件；同刻按stop（如有）→contact→collision→各轨道进入事件排序，order全程严格递增，stagePath定位真实模块。contact属于approach，collision属于collision_1d。同刻精确取样原子地返回所有ID最终碰后状态；t−ε/t/t+ε核对坐标连续及各分量。几何bodyTracks分别记录实际水平起点/目标与实际发射点，不把两体轨迹混入主物体投影。事件快照保留按ID关联的碰前/后速度、能量与约束；初态与求得的接触状态必须可区分。

collision事件新增可选collision元数据：`{ mode, normalXM, momentumBeforeKgMps, momentumAfterKgMps, energyBeforeJ, energyAfterJ, energyLostJ }`，均由实际碰前/后状态求得，非输入答案。实现需同步StagePlan初态联合、BodyStage、EndReason和Adapter；新增原因包括no_collision、approach_range_end、contact_without_impact、second_contact_boundary。旧事件/字段继续可缺省这些扩展，服务两端共用同一校验。

没有碰撞且全部静止：endReason及termination.reason=no_collision、MotionStatus=complete，termination指向最后实际stop（初始都静止时指release）。观察范围先结束：approach_range_end/range_end，新增range_end事件保留双方当时状态；不生成后缀。已有 stopped/landed/prefix_end/collision_complete及摆边界沿原约定使用，新原因不得被适配层误说成永久静止。

所有字段仍走validateStagePlan，零基JSON Pointer。缺质量、x、vx、μ、g（按需）、显式方向或约束前提分别报真实路径；如/initial/bodies/1/xM、/stages/0/tracks/1/kineticFrictionCoefficient。已识别草稿保留，补一项后同入口重算。重复/未知ID、轨道绑定错误、混初态、矛盾法线/约束为可修正字段错误；结构类型损坏INVALID_READING沿Node/Qoder已有重试；超范围模式为UNSUPPORTED。没有发生接触是可求的物理结果，不伪装成模型坏结构或强行要求用户补碰撞时刻。

## 5. 共享锚点及实施顺序

输入见fixtures/horizontal-collision-*.reading.json，对照见horizontal-collision.acceptance.json。同一接近/碰撞模块用于所有变式，质量和速度均取题设。

1. m=(1,3)、x=(0,6)、v=(5,-1)、碰前光滑：tc=1、xc=5、动量2、动能14。弹性v=(-4,2)，粘连共同.5、能量.5、损失13.5。无后缀都保留真实碰后状态，range_end。
2. 先停后被追上：m=(1,2)、x=(0,3)、v=(4,1)、μ=(0,.2)、g=10。第二体.5s停于3.25，第一体.8125s追到；碰前(4,0)，弹性后(-4/3,8/3)。不能用初始相对速度算成1s。
3. 同一初态改μ=(1,.2)：两体分别.4s/.5s停在.8和3.25，无接触；.5s全体静止，no_collision，无碰后段。
4. 同一粗糙表面碰前后均μ=.2、g=10，m=(1,3)、x=(0,7)、初速=(6,-3)：1s在x=5接触，碰前(4,-1)，弹性后(-3.5,1.5)。第二体1.75s停于5.5625，第一体2.75s停于1.9375，全程2.75s结束。动量只在碰撞瞬间守恒，不在阶段交接处凭空换表面。
5. 光滑桌面同向追及：m=(1,3)、x=(0,4)、v=(5,1)，右檐x=5，x≤5有支撑、x>5无支撑。1s在檐口碰撞，弹性后(-1,3)；第一体仍在光滑桌面向左，题给有限距离2m，第二体向无支撑侧飞向y=-1.25。1.5s首次落地，第一体x=4.5/vx=-1，第二体x=6.5/v=(3,-5)。range_end，第一体尚未走完2m，保留此刻真实状态。字段supportBoundary={edgeXM:5,supportedSide:"left"}明确物理表面，两体预碰都在支撑侧。
6. 题设已有摆约束的变式：m=(1,3)、第一体初态x=0/v=2水平光滑，第二体x=1/v=0、支点(1,1)、L=1张紧绳。tc=.5，弹性后(-1,1)，第二体沿原绳摆动。转折cosθ=.95，角约18.19487234°；后续按明确摆转折终点截断，第一体碰前后均在光滑面，碰后题给向左有限距离2m，继续同钟取样。此例不从直线走来的第一体上造绳。
7. 无冲击接触锚点：x=(0,1)、v=(4,2)、μ=(.2,0)、g=10。相对间距为(1−t)²，1s在x=3首次接触、双方共速2。只生成contact，前后快照均为x=3/v=2，完整与前缀均以contact_without_impact/range_end结束，无collision、粘连或反弹，不显示“全体静止”。
8. 再次追及边界锚点：m=(3,1)、x=(0,3)、v=(3,0)、μ=(0,.2)、g=10。1s在x=3首碰，弹性后(1.5,4.5)。第一体后续光滑水平明确距离7m；第二体仍μ=.2，3.25s停于8.0625。第一体在全程4.375s再次接触该静止物，边界位置均为8.0625、入射速度(1.5,0)，second_contact_boundary/model_limit，只记录边界快照、不做第二次冲击。第一体7m目标为x=10，晚于实际边界；第一次同刻离开与粘连共位置不算再次接触。

独立脚本`node scripts/check-horizontal-collision-contract.mjs`只校对解析数值与输入，不导入生产求解器；不代表新入口已支持。实现阶段须新增标准npm test覆盖的公开入口用例，验收上述分支、镜像/交换ID、相向/追及、初位同点方向缺项、摩擦停止同刻接触、零相对速度、正负超界、第二次接触边界、落地先于另一轨道、已有约束与粘连唯一张力及缺项往返。碰撞±1e-7s用1e-10量级位置/速度绝对误差核对，碰撞精确帧另测原子状态。

本契约先单独PR审核。随后B先实现分区求最早接触、collide1D复用及轨道装配，再接Adapter/画布/编辑器/Skill和Node/Qoder同源校验；正常图文handler可mock上游但须注明，工作区走正常首页与播放器。旧摆碰撞、圆弧、斜抛、预压与incline_spring全量回归。由规划会话合并，不部署。

## 6. 增量扩展：底入可移动四分之一圆弧槽与上游预压弹簧接续

- `parallel_motion` 碰后轨道新增 `movable_arc`（`entryMode: "bottom"`）阶段，与 `horizontal_slide`、`projectile`、`pendulum_swing` 并列，沿同一物理时钟同步取样。碰后接触位置、带符号水平速度和槽约束状态（`grooveXM`、`grooveVX`、`normalForceN`、`angleDeg`）直接由 `collision_1d` 传入。
- 底入四分之一光滑圆弧槽（半径 $R$、槽质量 $M$、球质量 $m$、光滑水平地面）：
  - 无量纲能量 $e = \frac{M}{m+M}\frac{v_0^2}{gR}$。
  - 当 $e \le 2$ 时，球沿槽上升至最大角 $\phi_{\max} = 2\arcsin(\sqrt{e}/2) \le \pi/2$ 与槽共速 $v_{\text{cm}} = \frac{m}{m+M}v_0$（相对静止，事件 `movable_arc_top`），随后对称下滑返回槽底并分离（事件 `movable_arc_return_exit`）：球速 $v_{B2} = \frac{m-M}{m+M}v_0$，槽速 $v_{C2} = \frac{2m}{m+M}v_0$，返回槽底瞬间法向力 $N_{\text{bottom}} = mg + m\frac{v_0^2}{R}$。
  - 临界条件 `criticalTopRelativeRest: true` 对应 $e = 2$，即 $v_0 = \sqrt{\frac{2(m+M)}{M}gR}$。
- 上游预压弹簧（`horizontal_approach.upstreamSpring`）：
  - 若题面给出 `springConstantNpm` 与 `initialCompressionM` 及初位，则完整求解；
  - 若题面未给弹簧劲度系数 $k$、初始压缩量 $x_0$ 或物体间水平间距，但给出弹性正碰（静止靶球）及 `criticalTopRelativeRest: true`，则确定性反求 $v_{B1}$、碰前入射速 $v_{A0} = \frac{m_A+m_B}{2m_A}v_{B1}$ 及弹簧弹性势能 $E_p = \frac{1}{2}m_A v_{A0}^2$，并以 `playback.mode = "suffix"` 仅播放从碰撞与滑上圆弧槽开始的已知后缀，上游弹簧仅作示意，不编造未知前段时长或后续二次相遇。
