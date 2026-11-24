# 轻绳与理想定滑轮连接体契约

对应 [第二批第 3 项](PROJECT_PLAN_FINAL.md#82-第二批的制作和验收顺序)：轻质不可伸长绳与理想定滑轮（不计滑轮质量与轴摩擦），支持两侧悬挂、水平支承面与悬挂物、斜面与悬挂物三种拓扑，复用 `validateStagePlan → assembleScene → buildMotion → sampleAt`、`bodies` / `bodyId` 与 `constraints`（张力非负）。

## 1. 坐标系、拓扑与输入结构

- **世界坐标**：定滑轮圆心位于 `(0, 0)`，`x` 向右、`y` 向上，SI 单位。
- **广义位移 \(s\)**：以 `body2`（右侧悬挂物）向下、`body1` 朝滑轮方向移动为正（\(s(0) = 0\)）。
- **物体与前提**：`bodies` 含两个正质量物体（`body1Id` 与 `body2Id`），顶层必填 `gravityMps2`（>0），`initial: { speedMps }`（沿 \(+s\) 方向的初始共速，静止填 `0`）。

```ts
type PulleySurface =
  | { kind: "hanging" }
  | {
      kind: "horizontal";
      kineticFrictionCoefficient: number;      // >= 0
      staticFrictionCoefficient?: number | null; // >= μk
      slidesAfterRelease?: boolean | null;     // 静止释放且粗糙时，与 μs 至少给一项，绝不默认 μs = μk
    }
  | {
      kind: "incline";
      angleDeg: number;                        // (0, 90)
      kineticFrictionCoefficient: number;      // >= 0
      staticFrictionCoefficient?: number | null;
      slidesAfterRelease?: boolean | null;
    };

type PulleyStage = {
  kind: "pulley_system";
  body1Id: string;
  body2Id: string;
  surface: PulleySurface;
  lightInextensibleString: true;
  idealFixedPulley: true;
  durationSeconds?: number | null;             // 可选观察时长上限 > 0
  body2DropToGroundM?: number | null;          // 可选 > 0：右侧悬挂物下方地面距离（着地后绳松弛 T=0，body1 继续滑行）
  body1TravelLimitM?: number | null;           // 可选 > 0：body1 距滑轮/止点的最大行程
};
```

- **缺项与前提规则**：
  - 缺 `lightInextensibleString`、`idealFixedPulley`、`surface` 叶字段、`gravityMps2` 或质量均只报对应叶路径。
  - `body1` 在粗糙水平面或粗糙斜面从静止释放且 \(F_{\text{drive}} \ne 0\) 时，若 `staticFrictionCoefficient` 与 `slidesAfterRelease` 均缺失，报 `NEEDS_INPUT`（`missingKeys: ["/stages/0/surface/staticFrictionCoefficient"]`），**严禁默认 \(\mu_s = \mu_k\)**。
  - 两者同给时须一致，否则报 `PRECONDITION_CONFLICT`；`slidesAfterRelease: true` 但 \(|F_{\text{drive}}| \le \mu_k N_1\) 亦报 `PRECONDITION_CONFLICT`。
  - `durationSeconds`、`body2DropToGroundM`、`body1TravelLimitM` 至少给一项（否则无法确定有限播放范围，报缺 `/stages/0/durationSeconds`）。

## 2. 动力学、张力与约束切换

1. **绳张紧阶段**：
   - 沿 \(+s\) 驱动力：\(F_{g2} = m_2 g\)；\(F_{g1} = -m_1 g\)（悬挂）/ \(0\)（水平）/ \(-m_1 g\sin\theta\)（斜面）；支承法向力 \(N_1 = 0\) / \(m_1 g\) / \(m_1 g\cos\theta\)。
   - 动摩擦力 \(f_k = \mu_k N_1\)，静摩擦上限 \(f_{s,\max} = \mu_s N_1\)。
   - 滑动方向 \(d\) 由初速符号或 \(F_{\text{drive}} = F_{g2} + F_{g1}\) 符号决定：
     \[a = \frac{F_{\text{drive}} - d f_k}{m_1 + m_2},\quad T = m_2 (g - a) \ge 0\]
   - 张力不可为负；若 \(T < 0\) 则绳松弛（`T = 0`）。
2. **着地触发绳松弛与后续运动**：
   - 若 `body2` 先到达地面（\(s = h_{\text{ground}}\)），发 `body2_ground_hit` 与同刻 `string_slack`（张力由 \(T \to 0\)）；此后 `body2` 静止于地面，`body1` 在无绳拉力下按自身支承面（水平摩擦减速或斜面重力+摩擦）继续运动，直至速度为零（`stop`）、到达行程上限或观察结束。

## 3. 共享基准与独立复算

独立复算脚本：`node scripts/check-pulley-system-contract.mjs`（不导入生产求解器）；机器数据见 [pulley-system.acceptance.json](fixtures/pulley-system.acceptance.json)。

| 共享样例 | 参数与独立结果 |
|---|---|
| [两侧悬挂 1/3kg](fixtures/pulley-atwood.reading.json) | \(m_1=1, m_2=3, g=10, t=1\ \text{s}\) → \(a=5\ \text{m/s}^2, T=15\ \text{N}\)，\(t=1\ \text{s}\) 时位移 \(2.5\ \text{m}\)、速率 \(5\ \text{m/s}\)。 |
| [水平支承 2/3kg](fixtures/pulley-horizontal.reading.json) | \(m_1=2\) 水平面（\(\mu_k=0.25\)，已知下滑 `slidesAfterRelease:true`），\(m_2=3, g=10, t=1\ \text{s}\) → \(a=5\ \text{m/s}^2, T=15\ \text{N}\)。 |
| [粗糙斜面滑动](fixtures/pulley-incline.reading.json) | \(m_1=2\) 位于 \(37^\circ\) 斜面（\(\sin=0.6, \cos=0.8, \mu_k=0.25, \mu_s=0.4\)），\(m_2=3, g=10, t=1\ \text{s}\) → \(a=2.8\ \text{m/s}^2, T=21.6\ \text{N}\)。 |
| [悬挂物着地绳松弛切换](fixtures/pulley-ground-slack.reading.json) | 同水平 2/3kg，`body2DropToGroundM=1.6 m` → \(t=0.8\ \text{s}\) 着地（\(v=4\ \text{m/s}\)，\(T: 15\to 0\ \text{N}\)），随后 `body1` 减速 \(a_1=-2.5\ \text{m/s}^2\) 于 \(t=2.4\ \text{s}\) 静止（总滑行 \(4.8\ \text{m}\)）。 |
| [斜面静摩擦保持静止](fixtures/pulley-incline-hold.reading.json) | 同 \(37^\circ\) 斜面但 \(m_2=1.5, \mu_s=0.4\) → \(F_{\text{drive}}=3 \le 6.4\ \text{N}\)，保持静止 \(a=0, T=15\ \text{N}\)。 |
