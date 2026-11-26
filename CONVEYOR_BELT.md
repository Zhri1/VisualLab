# 传送带与滑块契约

对应 [第二批第 2 项](PROJECT_PLAN_FINAL.md#82-第二批的制作和验收顺序)：水平传送带（匀速与分段恒加速）与滑块，复用 `validateStagePlan → assembleScene → buildMotion → sampleAt`，明确对地与相对带面两套位移参考系。

## 1. 参考系、坐标与输入结构

- **参考系与正方向**：地面惯性系，`x` 水平向右为正，`y` 向上为正，SI 单位。沿带正向的局部坐标为 `s`。定长带两个固定滚轮位于 `s = 0`（`start`）和 `s = beltLengthM`（`end`），水平带对应左端和右端。带面材料位移从进入该段开始计算。
- **位移参考系**：
  - 滑块对地沿带位移：\(s(t)-s(0)\)；
  - 带面位移：\(x_{\text{belt}}(t) = \int_0^t v_{\text{belt}}(\tau)\,d\tau\)；
  - 滑块相对带面位移：\(\Delta x_{\text{rel}}(t) = s(t)-s(0) - x_{\text{belt}}(t)\)。
- **初态**：首段为 `conveyor_belt` 时，顶层 `initial` 使用 `{ vxMps: number }`（带符号水平对地初速，向右为正、向左为负）；顶层必填 `gravityMps2`（>0），`massKg` 可选（不填时运动学与相对位移仍可唯一求解）。

```ts
type ConveyorBeltSegment = {
  accelerationMps2: number; // 有限实数，带面加速度（0 表示匀速）
  durationSeconds: number | null; // >0；单段定长匀速且无指定时长时为 null
};

type ConveyorBeltStage = {
  kind: "conveyor_belt";
  initialBeltSpeedMps: number;          // 有限实数，带面初速度（向右为正）
  segments: ConveyorBeltSegment[];      // 非空，分段恒加速带速序列
  kineticFrictionCoefficient: number;   // >= 0，动摩擦因数 μk
  staticFrictionCoefficient?: number | null; // >= μk；存在非零带加速度时必填，禁止默认 μs = μk
  beltLengthM?: number | null;          // >0，固定滚轮在局部 s=0 与 s=L
  entryEdge?: "start" | "end" | null;   // 可选，入带时物块位于哪一端
  continuationExitEdge?: "start" | "end" | null; // 可选，哪个出口连接计划后缀
};
```

- `entryEdge` 与 `continuationExitEdge` 都以给定 `beltLengthM` 为前提。入带端省略时，保留旧规则：首段从 `start` 放上，继承负向入射速度的后续定长水平带从 `end` 入带，其余从 `start` 入带。指定入带端时，固定带移到与实际入带位置相合，粒子世界坐标保持连续。
- 定长匀速且题面无给定运行时长时可省略 `segments` 或给单段 `{ accelerationMps2: 0, durationSeconds: null }`，由求解器停止在实际离带或达到可持续静止时。明确给出的时长表示观察窗口，保留原值。无定长或分段变速仍给各段有限时长。
- **缺项规则**：
  - 缺 `initialBeltSpeedMps`、`kineticFrictionCoefficient`、`gravityMps2` 或必需的 `segments` 仅报对应叶路径。
  - 若 `segments` 中存在 `accelerationMps2 !== 0`，则 `staticFrictionCoefficient` 必填；缺失时报 `NEEDS_INPUT`（`missingKeys: ["/stages/0/staticFrictionCoefficient"]`），**严禁默认 \(\mu_s = \mu_k\)**。
  - `staticFrictionCoefficient < kineticFrictionCoefficient` 报 `RANGE`。

## 2. 动力学与摩擦切换规则

在每一带速段内，带加速度 \(a_{\text{belt}}\) 恒定，带速 \(v_{\text{belt}}(\tau) = v_{\text{belt},0} + a_{\text{belt}}\tau\)：

1. **相对滑动（\(v \ne v_{\text{belt}}\)）**：
   - 相对速度 \(v_{\text{rel}} = v - v_{\text{belt}}\)，动摩擦加速度 \(a = -\operatorname{sgn}(v_{\text{rel}})\,\mu_k g\)，相对加速度 \(a_{\text{rel}} = a - a_{\text{belt}}\)。
   - 若 \(v_{\text{rel}} \cdot a_{\text{rel}} < 0\)，共速时间 \(\tau_c = -v_{\text{rel}} / a_{\text{rel}}\)；若 \(\tau_c\) 落在当前段内，发 `conveyor_common_velocity`，随后转入共速判定。
   - 若段内对地速度过零（\(v_0 \cdot v_1 < 0\)），在 \(\tau_{\text{turn}} = -v_0 / a\) 发非终止事件 `turn_around`。
2. **共速后（\(v = v_{\text{belt}}\)）**：
   - 比较 \(|a_{\text{belt}}|\) 与静摩擦上限 \(\mu_s g\)：
     - \(|a_{\text{belt}}| \le \mu_s g(1 + 64\varepsilon)\)：静摩擦可维持共速，滑块随带以 \(a = a_{\text{belt}}\) 运动（相对速度保持 0，相对带面位移不变）。
     - \(|a_{\text{belt}}| > \mu_s g\)：静摩擦不足以维持，发 `conveyor_reslide`，滑块相对带面朝 \(-\operatorname{sgn}(a_{\text{belt}})\) 方向滑出，加速度切换为 \(a = \operatorname{sgn}(a_{\text{belt}})\,\mu_k g\)。
3. **离带与观察边界**：仅向带外跨过固定滚轮时产生 `conveyor_exit`，事件携带 `conveyorExitEdge`（`start` / `end`）和实际位置，保留离带瞬间速度。到端速度为零并折回带内时仍在带上。真实离带与给定时长同刻时，离带优先。
   - 若给出 `continuationExitEdge`，只有实际离开该端才接续下一阶段；从另一端离开的计算止于 `conveyor_exit`。未指定端点的历史计划仍可在实际离开任一端时接续。抛体从同一位置、时间和实际速度分量起算。
   - 截至给定时长仍在带上时发 `force_segment_end`，以 `prefix_end` 结束。定长匀速、未给时长且物块达到可持续静止时发 `stop`，以 `stopped` 结束。两种情况均不生成后续落地或其他运动。

## 3. 共享基准与独立复算

独立脚本：`node scripts/check-conveyor-belt-contract.mjs`（不导入生产求解器）；机器数据见 [conveyor-belt.acceptance.json](fixtures/conveyor-belt.acceptance.json)。

| 共享样例 | 参数与独立结果 |
|---|---|
| [匀速带基准](fixtures/conveyor-uniform.reading.json) | \(v_{\text{belt}}=+2, v_0=0, \mu_k=0.2, g=10\)，时长 2 s → \(t=1\ \text{s}\) 共速（对地 \(+1\ \text{m}\)，相对带面 \(-1\ \text{m}\)）；\(t=2\ \text{s}\) 对地 \(+3\ \text{m}\)，相对仍 \(-1\ \text{m}\)。 |
| [恒加速带共速](fixtures/conveyor-accel.reading.json) | \(v_{\text{belt},0}=+2, a_{\text{belt}}=+1, v_0=0, \mu_k=0.2, \mu_s=0.25, g=10\)，时长 3 s → \(t=2\ \text{s}\) 共速于 \(4\ \text{m/s}\)（对地 \(+4\ \text{m}\)，相对带面 \(-2\ \text{m}\)）；共速后 \(a_{\text{belt}}=1 \le 2.5\) 静摩擦维持，\(t=3\ \text{s}\) 时 \(v=5, x=8.5, \Delta x_{\text{rel}}=-2\ \text{m}\)。 |
| [分段加速跨过 μs g 重滑](fixtures/conveyor-reslide.reading.json) | 接上例第 2 段 \([3,4]\ \text{s}\) 切为 \(a_{\text{belt}}=+3 > \mu_s g=2.5\) → \(t=3\ \text{s}\) 发 `conveyor_reslide`，块以 \(a=+2\) 加速，\(t=4\ \text{s}\) 时 \(v=7, v_{\text{belt}}=8, x=14.5, \Delta x_{\text{rel}}=-2.5\ \text{m}\)。 |
| [反向相对滑动](fixtures/conveyor-reverse.reading.json) | \(v_{\text{belt}}=+2, v_0=-2, \mu_k=0.2, g=10\)，时长 2 s → \(t=1\ \text{s}\) 在 \(x=-1\ \text{m}\) 过零折返，\(t=2\ \text{s}\) 共速于 \(+2\ \text{m/s}\)（对地 \(0\ \text{m}\)，相对带面 \(-4\ \text{m}\)）。 |
