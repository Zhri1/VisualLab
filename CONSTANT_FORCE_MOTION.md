# 常力作用与分段匀变速直线运动契约

对应 [首批第 7 项](PROJECT_PLAN_FINAL.md#81-第一批的制作和验收顺序)：按恒定合力与质量求加速度，用每段结束点的位置和带方向速度继续装配下一段。沿用 `validateStagePlan → assembleScene → buildMotion → sampleAt`，不登记整题模板。自由落体、平抛、斜抛与旧斜面转向路径全部保持兼容并回归。

## 1. 阶段结构与校验

新增单物体阶段 `constant_force_1d`：

```ts
type ConstantForce1DStage = {
  kind: "constant_force_1d";
  netForceXN: number; // 有限实数，向右为正、向左为负；0 表示合力为零（匀速或静止）
  end:
    | { kind: "duration"; durationSeconds: number } // 有限正数 > 0
    | { kind: "stop" };                             // 减速至 vx = 0
};
```

- **质量**：含 `constant_force_1d` 的计划顶层 `massKg` 必填且为有限正数。单独常力段不要求 `gravityMps2`；若后续接 `projectile` 等需要重力的阶段，则按原有规则要求 `gravityMps2`。
- **初态**：作为首段时沿用 `initial: { speedMps }`（非负，向右）。非首段继承前段的真实位置 `(xM, yM)` 与带符号速度 `vxMps`（可正、零、负），不丢弃方向。
- **加速度**：\(a_x = F_{\text{net},x} / m\)，精确保存符号。
- **结束条件与矛盾**：
  - `end.kind === "duration"`：`durationSeconds` 须为有限正数。若段内速度反向（\(v_0 \cdot v_{\text{end}} < 0\)），在 \(t_{\text{turn}} = -v_0 / a_x\) 发非终止事件 `turn_around`，随后沿新方向继续匀变速至段末。
  - `end.kind === "stop"`：
    - 若 \(v_0 = 0\) 且 \(F_{\text{net},x} = 0\)，0 时长静止（`stop`）。
    - 若 \(v_0 = 0\) 且 \(F_{\text{net},x} \ne 0\)，或 \(v_0 \ne 0\) 且合力与速度同向或为零，则无法减速至零，报 `PRECONDITION_CONFLICT`（指向 `/stages/i/end` 或 `/stages/i/netForceXN`）。
- **允许接续**：
  - `constant_force_1d` 可作首段，也可接在 `constant_force_1d`、`lossless_turn`、`horizontal_slide`、`spring_release` 之后。
  - `constant_force_1d` 之后可接 `constant_force_1d`、`horizontal_slide`、`spring_contact`、`projectile`、`vertical_arc`。
  - `end.kind === "stop"` 后若紧接另一段 `constant_force_1d`，从该静止点继续装配；若为末段，以 `stopped` 结束；若后接非 `constant_force_1d` 阶段，前置校验报 `PRECONDITION_CONFLICT`。
  - 反向运动（\(v_x < 0\)）或零速进入 `spring_contact`，或反向速度进入 `horizontal_slide`，均报 `PRECONDITION_CONFLICT`。

## 2. 基准与参数变式

机器基准见 [constant-force.acceptance.json](fixtures/constant-force.acceptance.json)，独立手算脚本 `node scripts/check-constant-force-contract.mjs` 不导入生产求解器。

| 共享输入 | 独立结果 |
|---|---|
| [基准题](fixtures/constant-force-benchmark.reading.json) | \(m=2\ \mathrm{kg}\)，静止出发；先受 \(+4\ \mathrm{N}\) 作用 \(2\ \mathrm{s}\)（\(a=2\ \mathrm{m/s^2}\)）到 \(x=4\ \mathrm{m}, v=4\ \mathrm{m/s}\)；再受 \(-2\ \mathrm{N}\)（\(a=-1\ \mathrm{m/s^2}\)）直至 \(t=6\ \mathrm{s}\) 在 \(x=12\ \mathrm{m}\) 静止。 |
| [反向折返变式](fixtures/constant-force-reversal.reading.json) | \(m=2\ \mathrm{kg}, v_0=6\ \mathrm{m/s}\)；先受 \(-4\ \mathrm{N}\) 作用 \(5\ \mathrm{s}\)（\(a=-2\)），\(t=3\ \mathrm{s}\) 在 \(x=9\ \mathrm{m}\) 瞬时零速折返，\(t=5\ \mathrm{s}\) 到 \(x=5\ \mathrm{m}, v=-4\ \mathrm{m/s}\)；再受 \(+4\ \mathrm{N}\)（\(a=+2\)）直至 \(t=7\ \mathrm{s}\) 在 \(x=1\ \mathrm{m}\) 静止。 |
| [三段接平抛变式](fixtures/constant-force-three-stage.reading.json) | \(m=1.5\ \mathrm{kg}, g=10\)，静止出发；\(+3\ \mathrm{N}\times 2\ \mathrm{s}\)（\(x=4, v=4\)）→ \(0\ \mathrm{N}\times 1.5\ \mathrm{s}\)（\(x=10, v=4\)）→ \(-1.5\ \mathrm{N}\times 2\ \mathrm{s}\)（\(x=16, v=2\)）→ 落差 \(0.8\ \mathrm{m}\) 平抛，\(t=5.9\ \mathrm{s}\) 落于 \(x=16.8\ \mathrm{m}, y=-0.8\ \mathrm{m}, v=(2,-4)\)。 |

## 3. 事件、几何与接线

- 事件：每段开始发 `force_segment_start`（记录该段合力与加速度）；段内速度过零发 `turn_around`；定时段末发 `force_segment_end`，减速至零发 `stop`。
- 几何：`StageGeometry.linearTrack` 记录所有常力段覆盖的 `[minXM, maxXM]` 水平区间与高度 `yM`，供 `StagePhysicsCanvas` 完整绘制轨线与运动过程，不截断折返点。
- `StagePlanEditor` 支持编辑 `netForceXN` 及 `end.kind`（`duration` / `stop`）和 `durationSeconds`。
- Skill 只提取题给恒定合力（含正负方向）、质量与每段时长/停止条件，不代算加速度、位移或末速度。通过 `scripts/sync-functions.mjs` 保持 Node 与 Qoder 校验同源。
