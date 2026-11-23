# 粗糙弹簧接触与能量显示契约

对应 [首批第 6 项](PROJECT_PLAN_FINAL.md#81-第一批的制作和验收顺序)后半：滑块以水平正速入射、压缩弹簧，接触面粗糙。沿用 `validateStagePlan → assembleScene → buildMotion → sampleAt`，不登记整题模板。光滑 `spring_contact`、预压 `spring_release`、摆、圆轨与两套正碰保持原行为。

## 1. 输入与新旧判别

`spring_contact` 增加互斥的粗糙分支，以阶段自有键 `kineticFrictionCoefficient` 为判别（值为 `null` 也算进入新分支）：

```ts
type RoughSpringContact = {
  kind: "spring_contact";
  springConstantNpm: number;            // >0
  kineticFrictionCoefficient: number;   // >=0
  unattached: true;
  // 最大压缩处能否回弹，二选一提供，不得默认 μs=μk：
  staticFrictionCoefficient?: number | null;  // 题给静摩擦因数（上限 μs·m·g），须 >= μk
  reboundAtMaxCompression?: boolean | null;   // 题给“能/不能从最大压缩回弹”的已知事实
  frictionless?: never;
};
```

- 水平向右为压缩方向，入射 `speedMps>0`（沿用旧限制）。质量 `massKg`、`gravityMps2` 必填且为有限正数（μk=0 时 g 仍必填，因为静摩擦判断用 m·g）。
- `staticFrictionCoefficient` 与 `reboundAtMaxCompression` 都缺（`null`/缺省）时，报缺 `/stages/i/staticFrictionCoefficient`，不猜。两者同给时须一致，否则 `PRECONDITION_CONFLICT` 指向 `/stages/i/reboundAtMaxCompression`。`staticFrictionCoefficient<kineticFrictionCoefficient` 为 `RANGE`。
- 同时出现 `frictionless` 与 `kineticFrictionCoefficient` 为 `PRECONDITION_CONFLICT`。旧输入（只有 `frictionless:true`）不受影响，数值与事件不变。
- 本增量脱离后不接后续阶段：`spring_contact` 之后接任何阶段仍是 `UNSUPPORTED`（与旧行为一致）。

## 2. 方程与结局

令 \(\omega=\sqrt{k/m}\)，\(x_e=\mu_k g/\omega^2\)（摩擦等效平衡位置），入射速率 \(v_0\)，压缩量 \(x\ge0\)。

- **压缩段**（向右运动，摩擦向左）：\(x(t)=-x_e+x_e\cos\omega t+(v_0/\omega)\sin\omega t\)。速度第一次为零：\(t_1=\operatorname{atan2}(v_0/\omega,x_e)/\omega\)，\(x_{max}=\sqrt{(v_0/\omega)^2+x_e^2}-x_e\)。
- **最大压缩处判定**：弹力 \(k x_{max}\le \mu_s m g\) 则保持静止（`stop`，endReason `stopped`，保留压缩量）；否则回弹。只给事实时按事实：`reboundAtMaxCompression:false` 保持，`true` 回弹。事实为 `true` 但 \(kx_{max}\le\mu_k mg\)（此时合力仍指向压缩方向，不可能回弹）是 `PRECONDITION_CONFLICT`，指向 `/stages/i/reboundAtMaxCompression`。事实为 `false` 时 μs 未知，只表示静摩擦上限不小于 \(kx_{max}\)。
- **回弹段**（向左运动，摩擦向右）：令 \(D=x_{max}-x_e\)，\(x(\tau)=x_e+D\cos\omega\tau\)，\(v=-D\omega\sin\omega\tau\)。
  - \(x_2=2x_e-x_{max}\)。\(x_2<0\)（容差内）：在 \(x=0\) 以 \(v<0\) 脱离，\(\tau_d=\arccos(-x_e/D)/\omega\)，事件 `spring_detach`，endReason `spring_detached`，`springCompressionM=0`。速度 \(v_d=-D\omega\sin\omega\tau_d\)，即 \(v_d^2=(k x_{max}^2-2\mu_k m g x_{max})/m\)。
  - \(x_2=0\)（按量级缩放容差）：在原长处速度同时降为零，`stop`，压缩 0，不发 `spring_detach`。
  - \(x_2>0\)：在 \(\tau=\pi/\omega\) 停下，保留残余压缩 \(x_2\)，`stop`，endReason `stopped`。因 \(k x_2<\mu_k m g\le\mu_s m g\)，不会再次启动；弹簧只会向外推，不存在返程第三段。
- 累计摩擦耗能 \(Q=\mu_k m g\,s\)（s 为路程）。能量守恒：\(\tfrac12 mv_0^2=\tfrac12 mv^2+\tfrac12 kx^2+Q\)。
- 事件：`spring_contact`（t=0，原长）、`max_compression`（速度为零，弹力 kx）、随后 `spring_detach` 或 `stop`。保持在最大压缩时不再发回弹事件。`max_compression` 事件的说明须写清保持或回弹及依据（静摩擦上限或题给事实）。

## 3. 基准（m=1, k=10, g=10, μk=0.2, μs=0.25）

数据见 [rough-spring.acceptance.json](fixtures/rough-spring.acceptance.json)；`node scripts/check-rough-spring-contract.mjs` 用闭式解与独立 RK4 复算，不导入生产求解器。

| 共享输入 | 结果 |
|---|---|
| [v=2](fixtures/rough-spring-detach.reading.json) | \(x_{max}=0.4633249581\) m，t≈0.399876 s；回弹后在原长脱离，\(v_x≈-0.5416644122\) m/s，耗能 1.8532998323 J，总用时 1.169374 s |
| [v=1.5](fixtures/rough-spring-residual.reading.json) | \(x_{max}=0.3147815070\) m；停下后残余压缩 0.0852184930 m，耗能 1.0886890423 J |
| [v=1](fixtures/rough-spring-hold.reading.json) | \(x_{max}=0.1741657387\) m，kx=1.74<2.5，停在最大压缩，无回弹 |
| [v=√3.2](fixtures/rough-spring-natural.reading.json) | \(x_{max}=0.4\) m；在原长处速度为零，压缩 0，不脱离，耗能 1.6 J |

## 4. 能量显示

`StageMotion` 增加 `energyAt(timeSeconds)`，与 `sampleAt` 共用同一时钟与取样规则（精确事件优先，t 钳制到 [0,duration]）：

```ts
type EnergyReading = {
  kineticJ: number;                      // ½mv²
  elasticPotentialJ: number | null;      // 活动弹簧阶段内 ½k x²；其他阶段 null
  gravitationalPotentialJ: number | null; // 计划含斜面/圆弧/抛体且给 g 时 m·g·y（世界 y=0 为参考）；否则 null
  frictionHeatJ: number;                 // 播放窗口内累计已知摩擦耗能 μ·N·路程
  priorFrictionKnown: boolean;           // false：播放窗口之前有未知摩擦，frictionHeatJ 只从窗口起点计
};
```

- 无质量（不含弹簧/圆弧等需 m 的计划）或需要 g 而缺失时，`energyAt` 返回 `null`，不伪造能量。
- `scope.mode` 为 `suffix`/`state_only`（缺参，起点后移到 B 或静止点）时 `priorFrictionKnown=false`，耗能从窗口起点计；`full` 时为 `true`。窗口前用时同样未知，不补造。
- 摩擦耗能覆盖有摩擦的 `incline_slide`（μ·m·g·cosθ·路程）、`horizontal_slide`、`spring_release` 与粗糙 `spring_contact`；`lossless_turn`、圆弧、抛体为 0。
- 光滑弹簧与旧预压题也提供动能、弹性势能；光滑弹簧全程 `frictionHeatJ=0` 且动能+势能守恒。
- 播放器在现有读数区增加“动能／势能／累计摩擦耗能”三项，与时间轴同钟；`priorFrictionKnown=false` 时耗能旁标“自此起计”，不适用的势能项（`null`）省略，`energyAt` 为 `null` 时不渲染。

## 5. 接线

校验与计算在 `src/physics/stagePlan.ts`、`stageMotion.ts`，经 `scripts/sync-functions.mjs` 同步到 `functions/`；适配层透传 `energyAt`；`StagePlanEditor` 增加粗糙/光滑切换、μk、μs 或回弹事实；Skill 只提取题给的 μk、μs（或“能/不能回弹”的已知事实），不推导结局；模型给出的结局不被采信，由 B 计算。无公网部署。

