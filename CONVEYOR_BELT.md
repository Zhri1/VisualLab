# 传送带与滑块契约

对应 [第二批第 2 项](PROJECT_PLAN_FINAL.md#82-第二批的制作和验收顺序)：水平传送带（匀速与分段恒加速）与滑块，复用 `validateStagePlan → assembleScene → buildMotion → sampleAt`，明确对地与相对带面两套位移参考系。

## 1. 参考系、坐标与输入结构

- **参考系与正方向**：地面惯性系，`x` 水平向右为正，`y = 0`，SI 单位。滑块初位置在地面系 `x = 0`，带面参考点初位置 `x_belt(0) = 0`。
- **位移参考系**：
  - 滑块对地位移：\(x(t)\)；
  - 带面位移：\(x_{\text{belt}}(t) = \int_0^t v_{\text{belt}}(\tau)\,d\tau\)；
  - 滑块相对带面位移：\(\Delta x_{\text{rel}}(t) = x(t) - x_{\text{belt}}(t)\)。
- **初态**：首段为 `conveyor_belt` 时，顶层 `initial` 使用 `{ vxMps: number }`（带符号水平对地初速，向右为正、向左为负）；顶层必填 `gravityMps2`（>0），`massKg` 可选（不填时运动学与相对位移仍可唯一求解）。

```ts
type ConveyorBeltSegment = {
  accelerationMps2: number; // 有限实数，带面加速度（0 表示匀速）
  durationSeconds: number;  // > 0，该带速段持续时间
};

type ConveyorBeltStage = {
  kind: "conveyor_belt";
  initialBeltSpeedMps: number;          // 有限实数，带面初速度（向右为正）
  segments: ConveyorBeltSegment[];      // 非空，分段恒加速带速序列
  kineticFrictionCoefficient: number;   // >= 0，动摩擦因数 μk
  staticFrictionCoefficient?: number | null; // >= μk；存在非零带加速度时必填，禁止默认 μs = μk
  beltLengthM?: number | null;          // 可选 > 0，若给出则以 [0, beltLengthM] 为带长边界
};
```

- **缺项规则**：
  - 缺 `initialBeltSpeedMps`、`segments`、`kineticFrictionCoefficient` 或 `gravityMps2` 仅报对应叶路径。
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
3. **带长边界（仅当给出 `beltLengthM` 时）**：到达 `x = 0`（向左离开）或 `x = beltLengthM`（向右离开）时发 `conveyor_exit` 并以 `endReason = "conveyor_exit"` 结束，保留离开瞬间速度，不伪造未给出的落地过程。未给 `beltLengthM` 时在所有带速段结束处以 `prefix_end` 结束。

## 3. 共享基准与独立复算

独立脚本：`node scripts/check-conveyor-belt-contract.mjs`（不导入生产求解器）；机器数据见 [conveyor-belt.acceptance.json](fixtures/conveyor-belt.acceptance.json)。

| 共享样例 | 参数与独立结果 |
|---|---|
| [匀速带基准](fixtures/conveyor-uniform.reading.json) | \(v_{\text{belt}}=+2, v_0=0, \mu_k=0.2, g=10\)，时长 2 s → \(t=1\ \text{s}\) 共速（对地 \(+1\ \text{m}\)，相对带面 \(-1\ \text{m}\)）；\(t=2\ \text{s}\) 对地 \(+3\ \text{m}\)，相对仍 \(-1\ \text{m}\)。 |
| [恒加速带共速](fixtures/conveyor-accel.reading.json) | \(v_{\text{belt},0}=+2, a_{\text{belt}}=+1, v_0=0, \mu_k=0.2, \mu_s=0.25, g=10\)，时长 3 s → \(t=2\ \text{s}\) 共速于 \(4\ \text{m/s}\)（对地 \(+4\ \text{m}\)，相对带面 \(-2\ \text{m}\)）；共速后 \(a_{\text{belt}}=1 \le 2.5\) 静摩擦维持，\(t=3\ \text{s}\) 时 \(v=5, x=8.5, \Delta x_{\text{rel}}=-2\ \text{m}\)。 |
| [分段加速跨过 μs g 重滑](fixtures/conveyor-reslide.reading.json) | 接上例第 2 段 \([3,4]\ \text{s}\) 切为 \(a_{\text{belt}}=+3 > \mu_s g=2.5\) → \(t=3\ \text{s}\) 发 `conveyor_reslide`，块以 \(a=+2\) 加速，\(t=4\ \text{s}\) 时 \(v=7, v_{\text{belt}}=8, x=14.5, \Delta x_{\text{rel}}=-2.5\ \text{m}\)。 |
| [反向相对滑动](fixtures/conveyor-reverse.reading.json) | \(v_{\text{belt}}=+2, v_0=-2, \mu_k=0.2, g=10\)，时长 2 s → \(t=1\ \text{s}\) 在 \(x=-1\ \text{m}\) 过零折返，\(t=2\ \text{s}\) 共速于 \(+2\ \text{m/s}\)（对地 \(0\ \text{m}\)，相对带面 \(-4\ \text{m}\)）。 |
