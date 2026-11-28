# 纯匀强磁场双动粒子弹性正碰与周期再相遇契约

本契约定义单一垂直匀强磁场中两个带电运动粒子沿接触切线发生弹性正碰、碰后两回旋圆在接触点外切并按周期同刻再相遇的可复用阶段 `magnetic_reencounter`，对应 2023 湖北物理第 15 题及其一般化参数变式。

本模块复用 `createMagneticOrbit`、`collide1D` 与现有双体播放器/画布，不改变既有单粒子 `magnetic_deflection` 与分区电磁场 `switchable_em_collision`。

## 1. 标度与输入结构

仍使用 `kind: "stage_plan"`、`schemaVersion: 1` 与唯一阶段 `stages: [MagneticReencounterStage]`：

```ts
export type MagneticReencounterStage = {
  kind: "magnetic_reencounter";
  scaleMode: "normalized" | "si";
  massScaleKg: number;                 // 基准质量 m > 0；normalized 省略默认 1
  chargeScaleC: number;                // 基准电荷量 q > 0；normalized 省略默认 1
  magneticTeslaB: number;              // 磁感应强度 B > 0；normalized 省略默认 1
  lengthScaleM: number;                // 基准长度 a > 0；normalized 省略默认 1
  fieldDirection: "into_page" | "out_of_page";
  chargeSignA?: 1 | -1;                // 甲电荷符号，默认 +1
  targetChargeRatio?: number;          // 乙/甲电荷比 q乙/q甲（非零，含符号），默认 1
  entryOverLength: { x: number; y: number };   // 甲 t=0 位置（以 a 为单位）
  entryDirection: { x: number; y: number };    // 甲 t=0 速度方向向量（非零）
  contactOverLength: { x: number; y: number }; // 首次正碰点 O（以 a 为单位）
  postFirstCollisionSpeedRatioA: number;       // 首次碰后甲相对碰前的带符号速率倍率（如反向 3 倍填 -3）
  periodRatioAOverB: number;                   // 周期比 T甲 / T乙（正有理数）
  observationTimeOverPiTau: number;            // 观察时刻系数：t_obs = k * π * (m/(qB))，k > 0
  gravityAndMutualForcesNegligible: true;      // 忽略重力、库仑力及电荷转移
};
```

- 基准时间与速度标度：$\tau = \frac{m}{q B}$，$v = \frac{q B a}{m} = \frac{a}{\tau}$。
- `scaleMode: "normalized"` 时按 $m = q = B = a = 1$ 演示并标注归一化；`scaleMode: "si"` 时按实际物理标度缩放长度、速度、时间与质量。
- AI 只提取题面给出的入射点/方向、接触点、首次碰后带符号速率倍率、周期比和观察时刻系数，不代算碰前速度、乙质量、碰撞次数、末态坐标或累计路程。

## 2. 物理推导与边界规则

1. **甲首段轨道**：
   - 由 `entryOverLength`、`entryDirection`、`contactOverLength` 及洛伦兹力转向 $\text{spin}_A$ 唯一确定过接触点 $O$ 的圆周半径 $R_A = \frac{|\vec{d}|^2}{2(\vec{d}\cdot\hat{n}_0)}$（须满足 $\vec{d}\cdot\hat{n}_0 > 0$，否则报 `PRECONDITION_CONFLICT`），由此得碰前速率 $v_{A,1}^- = \omega_A R_A$ 与首次到达 $O$ 的时刻 $t_1 = \Delta\theta_1 / \omega_A$。
2. **乙质量、首碰与初态逆算**：
   - 由周期比得 $m_B = m_A \cdot \frac{|q_B/q_A|}{T_A/T_B}$。
   - 沿甲在 $O$ 处的入射切线单位向量 $\hat{e}_t$，由甲碰后速度 $v_A' = k_A v_{A,1}^-$ 结合弹性正碰公式反求乙碰前切向速度 $u_B = \frac{(m_A+m_B)v_A' - (m_A-m_B)u_A}{2 m_B}$，再调用 `collide1D(m_A, m_B, u_A, u_B, "elastic")` 核对动量与动能守恒。
   - 将乙从 $(O, \vec{v}_{B,1}^-)$ 沿自身磁回旋轨道逆推 $-t_1$ 得到 $t = 0$ 时的乙初态；若两粒子在 $[0, t_1)$ 某时刻同刻重合，报 `PRECONDITION_CONFLICT`。
3. **外切再相遇与超范围边界**：
   - 首版要求每次碰后两回旋圆在接触点 $O$ **外切**（$|C_A - C_B| = R_A + R_B$，且两速率均非零）且 $T_A / T_B = p/q$ 为简单有理比（$p, q \le 24$）。不满足外切或非简单有理周期比时明确返回 `UNSUPPORTED`。
   - 外切两圆仅在 $O$ 点相交，因此轨迹交点不会产生未建模的异点斜碰；同刻再相遇最小正间隔严格为 $\Delta t_{\text{meet}} = \operatorname{lcm}(T_A, T_B) = q T_A = p T_B > 0$，不会在碰后 $0$ 时刻重复触发碰撞。
   - 在 $[0, t_{\text{obs}}]$ 内逐次以 `collide1D(..., "elastic")` 更新状态并记录每次 `magnetic_collision` 事件；乙自首次碰后的累计路程严格由事件区间逐段累加 $\sum v_B \Delta t$ 得出，不做答案特判。

## 3. 验收基准（2023 湖北物理第 15 题）

- 参数：$P_0 = (2a, 0)$，方向 $(0, 1)$，$O = (0, 0)$，`fieldDirection: "into_page"`，`postFirstCollisionSpeedRatioA: -3`，`periodRatioAOverB: 2`，`observationTimeOverPiTau: 18`。
- 独立核算（$\tau = m/(qB)$，$v = qBa/m$）：
  - $m_{\text{乙}} = m/2$，$T_{\text{甲}} = 2T_{\text{乙}} = 2\pi\tau$；
  - 首次碰撞 $t_1 = \pi\tau$，碰前 $v_{y,\text{甲}}^- = -v$、$v_{y,\text{乙}}^- = +5v$，碰后 $+3v$、$-3v$；
  - 碰撞发生于 $t = (1, 3, 5, 7, 9, 11, 13, 15, 17)\pi\tau$ 共 9 次；
  - $t = 18\pi\tau$ 时：甲位于 $(-6a, 0)$，乙位于 $(0, 0)$；乙自第一次碰后累计路程为 $67\pi a$。
