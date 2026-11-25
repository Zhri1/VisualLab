# 滑块与可移动木板契约

对应 [第二批第 1 项](PROJECT_PLAN_FINAL.md#82-第二批的制作和验收顺序)：光滑水平地面上的滑块与可移动木板，复用 `validateStagePlan → assembleScene → buildMotion → sampleAt`、`bodies` / `bodyId` 与同步时间轴。

## 1. 参考系、坐标与输入结构

- **参考系与正方向**：地面惯性系，`x` 水平向右为正，`y` 竖直向上为正，光滑地面位于 `y = 0`，SI 单位。
- **木板几何**：木板左端位于 `plank.xM`，右端位于 `plank.xM + plankLengthM`（\(L > 0\)）。滑块相对木板的位置为 \(s(t) = x_b(t) - x_p(t) \in [0, L]\)。初态须满足 \(0 \le x_{b0} - x_{p0} \le L\)，否则报 `PRECONDITION_CONFLICT`。
- **顶层字段**：`bodies`（2 个物体，含 `bodyId` 与正质量 `massKg`）、`primaryBodyId`、`gravityMps2`（>0）、`initial: { bodies: [{ bodyId, xM, vxMps }, ...] }`。

```ts
type BlockPlankStage = {
  kind: "block_plank";
  blockBodyId: string;
  plankBodyId: string;
  plankLengthM: number;                 // > 0，木板总长 L
  kineticFrictionCoefficient: number;   // >= 0，块-板动摩擦因数 μk
  staticFrictionCoefficient?: number | null; // >= μk；仅共速后有外力且影响判定时必填，禁止默认 μs = μk
  groundFrictionless: true;             // 本批要求光滑地面
  /** 可选：共速后施加的恒定水平外力及观察时长。 */
  postCommonForce?: {
    blockForceXN: number;               // 有限实数，向右为正
    plankForceXN: number;               // 有限实数，向右为正
    durationSeconds: number;            // > 0
  } | null;
  /** 可选：共速后无外力时的继续观察时长（默认 0，在共速处结束）。 */
  postCommonDurationSeconds?: number | null;
};
```

- **缺项规则**：
  - 缺 `plankLengthM`、`kineticFrictionCoefficient`、`groundFrictionless` 或 `bodies` 成员字段时，仅报对应真实叶路径。
  - 若给出 `postCommonForce` 且共速后所需静摩擦力 \(f_{s,\text{req}} = \frac{m F_p - M F_b}{m + M} \ne 0\)，而 `staticFrictionCoefficient` 缺失，返回 `NEEDS_INPUT`（`missingKeys: ["/stages/0/staticFrictionCoefficient"]`），**严禁默认 \(\mu_s = \mu_k\)**。
  - `staticFrictionCoefficient < kineticFrictionCoefficient` 报 `RANGE`；`groundFrictionless: false` 报 `UNSUPPORTED`。

## 2. 动力学方程与事件分支

令滑块质量 \(m\)、木板质量 \(M\)、相对速度 \(v_{\text{rel}} = v_b - v_p\)、动摩擦力大小 \(f_k = \mu_k m g\)。

1. **相对滑动段（\(v_{\text{rel},0} \ne 0\)）**：
   - 滑动摩擦方向由相对速度符号 \(d = \operatorname{sgn}(v_{\text{rel},0})\) 决定：
     \[a_b = -d \mu_k g,\quad a_p = +d \frac{m}{M} \mu_k g,\quad a_{\text{rel}} = a_b - a_p = -d \mu_k g \frac{m + M}{M}\]
   - 双体水平动量守恒：\(m v_b(t) + M v_p(t) = m v_{b0} + M v_{p0}\)。
   - **共速时刻**（当 \(\mu_k > 0\)）：\(t_c = -v_{\text{rel},0} / a_{\text{rel}}\)，共速 \(v_c = (m v_{b0} + M v_{p0})/(m + M)\)。
   - **到达板边时刻**：求 \(s(t) = s_0 + v_{\text{rel},0} t + \tfrac12 a_{\text{rel}} t^2\) 首次到达 \(s = L\)（\(d > 0\)）或 \(s = 0\)（\(d < 0\)）的正根 \(t_{\text{edge}}\)。
   - **先后判定与同刻规则**：
     - 若 \(t_{\text{edge}} < t_c - \varepsilon\)：先到板边，发 `plank_edge_leave`，以 `endReason = "plank_edge_leave"`（`motionStatus.state = "range_end"`）结束已求范围；保留离板瞬间双体位置与速度，缺板高/落地条件时不伪造落地。
     - 若 \(t_c \le t_{\text{edge}} + \varepsilon\)（含恰在板边共速同刻，此时相对速度已归零）：先（或恰在边）达到共速，发 `common_velocity`。
2. **共速后外力段（存在 `postCommonForce` 时）**：
   - 共同运动所需加速度 \(a_{\text{co}} = (F_b + F_p)/(m + M)\)，所需静摩擦力（板对块）\(f_{s,\text{req}} = m a_{\text{co}} - F_b = (m F_p - M F_b)/(m + M)\)，静摩擦上限 \(f_{s,\max} = \mu_s m g\)。
   - **保持共同运动**（\(|f_{s,\text{req}}| \le f_{s,\max}(1 + 64\varepsilon)\)）：发 `common_force_together`，双体以 \(a_b = a_p = a_{\text{co}}\) 运动至 `durationSeconds` 结束（`prefix_end`）。
   - **超过阈值重新滑动**（\(|f_{s,\text{req}}| > f_{s,\max}\)）：令相对滑动趋势方向 \(r = -\operatorname{sgn}(f_{s,\text{req}})\)（板被向右大力拉时 \(f_{s,\text{req}} > 0\)，块相对板向后 \(r = -1\)），块受动摩擦 \(-r f_k\)，板受 \(+r f_k\)：
     \[a_b = \frac{F_b - r f_k}{m},\quad a_p = \frac{F_p + r f_k}{M},\quad a_{\text{rel}} = a_b - a_p\]
     发 `reslide_start`；比较在 `durationSeconds` 内是否先到达 \(s = 0\) 或 \(s = L\)，先到板边则发 `plank_edge_leave` 结束，否则在观察时长末 `prefix_end` 结束。

## 3. 共享基准与变式

独立复算脚本：`node scripts/check-block-plank-contract.mjs`（不导入生产求解器）；机器数据见 [block-plank.acceptance.json](fixtures/block-plank.acceptance.json)。

| 共享样例 | 参数与独立结果 |
|---|---|
| [板够长共速](fixtures/block-plank-common.reading.json) | \(m=1, M=3, v_b=4, v_p=0, \mu_k=0.3, g=10, L=3\) → \(t_c=1\ \text{s}, v_c=1\ \text{m/s}, x_b=2.5, x_p=0.5, \Delta s=2\ \text{m}\)。 |
| [剩余1.5m到边](fixtures/block-plank-edge.reading.json) | 同上但 \(L=1.5\ \text{m}\) → \(t_{\text{edge}}=0.5\ \text{s}\) 到右端，\(v_b=2.5\ \text{m/s}, v_p=0.5\ \text{m/s}, x_b=1.625, x_p=0.125\)。 |
| [共速后12N共动](fixtures/block-plank-force-together.reading.json) | \(\mu_s=0.4\)，共速后仅对板施 \(12\ \text{N}\) 持续 \(1\ \text{s}\) → 共同加速度 \(a=3\ \text{m/s}^2\)，\(t=2\ \text{s}\) 时 \(v=4\ \text{m/s}\)。 |
| [共速后16N临界](fixtures/block-plank-force-threshold.reading.json) | \(\mu_s=0.4\)，共速后仅对板施 \(16\ \text{N}\) 持续 \(1\ \text{s}\) → 恰在静摩擦阈值 \(f_s=4\ \text{N}\)，仍共同加速度 \(a=4\ \text{m/s}^2\)，\(t=2\ \text{s}\) 时 \(v=5\ \text{m/s}\)。 |
| [共速后20N重滑](fixtures/block-plank-force-reslide.reading.json) | \(\mu_s=0.4\)，共速后仅对板施 \(20\ \text{N}\) 持续 \(2\ \text{s}\) → 块 \(a_b=3\ \text{m/s}^2\)、板 \(a_p=17/3\ \text{m/s}^2\)，相对加速度 \(-8/3\ \text{m/s}^2\)，块相对板向后，\(t=1+\sqrt{1.5}\approx 2.224744871\ \text{s}\) 滑离左端。 |
| [相向不等初速](fixtures/block-plank-reverse.reading.json) | \(m=1, M=3, v_b=-2, v_p=2, \mu_k=0.3, g=10, L=4, x_{b0}=3, x_{p0}=0\) → \(v_{\text{rel},0}=-4\)，\(t_c=1\ \text{s}\) 共速 \(v_c=1\ \text{m/s}\)，相对位移 \(-2\ \text{m}\)（最终 \(s=1\ \text{m}\)）。 |
