# 高考多过程声明式几何与临界反求契约

本增量承接 [阶段组合契约](STAGE_COMPOSITION.md)、[圆轨增量](CIRCULAR_TRACK.md) 与 [预压弹簧扩展契约](PRECOMPRESSED_SPRING.md)。核心目标是让视觉识别层只声明题面给出的**几何/临界关系**（而非手算隐含落差、圆心或半径），由物理纯计算模块 `src/physics/gaokaoConstraints.ts` 按解析公式唯一反求并记录推导来源 `DerivedCalculation`，再交由 `validateStagePlan → assembleScene → buildMotion` 统一执行。

- 全程使用国际单位制（m、kg、s、N、J）与角度制（deg）。
- **绝不臆造未知值**：任一推导前提缺失时返回精确零基 JSON Pointer `missingKeys`；物理或字段互斥冲突时返回 `fieldErrors`（`PRECONDITION_CONFLICT` / `RANGE` / `NOT_FINITE` / `TYPE` / `UNSUPPORTED`）。
- 首段为 `spring_release` 的既有预压弹簧能量反求仍归 `src/physics/springEnergy.ts` 处理，本模块不抢占其 `critical_arc_top` 约束。

## 1. 四项声明式扩展与互斥规则

### 1.1 抛体切向入弧反求落差：`projectile.end`

当题面表述“平抛/斜抛后恰好沿切线方向进入下一段光滑圆弧轨道”且未直接给出落差 `dropHeightM` 时，在 `projectile` 阶段声明：

```ts
{
  kind: "projectile",
  end: { kind: "tangent_to_next_arc" }
}
```

- **互斥与双向反求规则**：
  - **已知出射速度 → 反求落差**（既有）：`end: { kind: "tangent_to_next_arc" }` 且未给 `dropHeightM`/`landingPlaneYM`，由入射速度 $(v_x, v_y)$ 反求 `dropHeightM`；若同时给出了入射速度与落差/落面，则定位 `/stages/<i>` 报 `PRECONDITION_CONFLICT`。
  - **已知平抛落差/落面与入口切线 → 反求水平出射速度（新增 `deriveProjectileTangentLaunchSpeed`）**：当平抛初速待求（`initial.vxMps: null` 且 `vyMps: 0`；或前段为水平切线出射的光滑 `vertical_arc` 且 `initial.speedMps: null`；或前段为无摩擦未连接 `spring_release` 且 `k`/`c`/`energy` 未给）且已知正落差 $H > 0$（直接给 `dropHeightM`，或圆弧后给固定 `landingPlaneYM` 由出射高度求 $H = y_{\text{exit}} - \text{landingPlaneYM} > 0$）时，允许 `end: { kind: "tangent_to_next_arc" }` 与该落差/落面同时出现：
    - 入弧竖直分速度 $v_{y,\text{entry}} = -\sqrt{2gH} < 0$，飞行时间 $t = \sqrt{2H/g} > 0$。
    - 要求非竖直切线（$\cos\varphi_0 \ne 0$）、非水平切线（$\sin\varphi_0 \ne 0$）且切线竖直分量向下（$d\sin\varphi_0 < 0$）；否则定位 `/stages/<i+1>/path/startAngleDeg` 或 `/stages/<i>/end` 报 `PRECONDITION_CONFLICT`。
    - 带符号水平出射速度：
      $$v_x = v_{y,\text{entry}} \cot\varphi_0 = -\sqrt{2gH}\frac{\cos\varphi_0}{\sin\varphi_0}$$
    - 反传前段能量（保留推导来源 `DerivedCalculation`）：
      - 前段为光滑 `vertical_arc` 时，校验出射切线水平且与 $v_x$ 同向、内轨最高点满足 $v_x^2 \ge gR$，由机械能守恒反求入弧初速 $v_0 = \sqrt{v_x^2 + 2gR(\cos\varphi_{\text{start}} - \cos\varphi_{\text{end}})}$ 写回 `initial.speedMps`。
      - 前段为光滑 `spring_release` 时，校验 $v_x > 0$，反求弹簧初始弹性势能 $E_p = \frac{1}{2}mv_x^2$ 写回 `energy`（`origin: "tangent_to_next_arc"`），并由既有 `resolveSpringEnergy` 以 `suffix` 模式从桌缘精确播放、标注未计时前段。
    - 规范化后移除 `stages[i].end`，保留 `dropHeightM` 或 `landingPlaneYM`，并在 `derivedCalculations` 记录 `rule: "tangent_to_next_arc_launch_vx"` 与 `rule: "energy_backprop_from_tangent_launch"`。
- **接续前提**：紧邻后继段 `stages[i + 1]` 必须为携带显式 `path`（含 `startAngleDeg`、`direction`）的 `vertical_arc`，否则定位 `/stages/<i>/end` 报 `PRECONDITION_CONFLICT`。
- **物理推导（`deriveProjectileTangentDrop`）**：
  - 入口角 $\varphi_0 = \text{nextArcStartAngleDeg} \cdot \pi / 180$，方向符号 $d = +1$（`positive`）或 $-1$（`negative`）。
  - 圆弧入口处沿运动方向的单位切向量为 $(d \cos\varphi_0, d \sin\varphi_0)$。
  - 要求 $\cos\varphi_0 \ne 0$（非竖直切线）且水平速度 $v_x$ 与 $d \cos\varphi_0$ 同号（$v_x \cdot d \cos\varphi_0 > 0$）。
  - 入弧竖直分速度：
    $$v_{y,\text{entry}} = v_x \tan\varphi_0$$
  - 要求 $v_{y,\text{entry}} < v_y$（对平抛 $v_y = 0$ 即 $v_{y,\text{entry}} < 0$），飞行时间：
    $$t = \frac{v_y - v_{y,\text{entry}}}{g} > 0$$
  - 竖直落差与入弧速率：
    $$\text{dropHeightM} = \frac{v_{y,\text{entry}}^2 - v_y^2}{2g} \ge 0, \qquad v_{\text{entry}} = \sqrt{v_x^2 + v_{y,\text{entry}}^2}$$
  - 若斜上抛导致切向入弧点高于抛出点（$\text{dropHeightM} < 0$），定位 `/stages/<i>/end` 报 `PRECONDITION_CONFLICT`。
- **规范化产物**：写回 `stages[i].dropHeightM`，移除 `stages[i].end`，并在 `calculations` 追加 `rule: "tangent_to_next_arc"`。

### 1.2 圆弧竖直高差与圆心角反求半径：`vertical_arc.verticalDropM`

当题面给出圆弧两端竖直高度差（如“B、C 两点高度差 $h = 2\text{ m}$”）及入口角/圆心角，但未直接给出半径时，在 `vertical_arc` 阶段声明：

```ts
{
  kind: "vertical_arc",
  radiusM: null,
  verticalDropM: 2,
  side: "inside",
  frictionless: true,
  path: {
    startAngleDeg: -53,
    direction: "positive",
    end: { kind: "physical_endpoint", sweepAngleDeg: 53 }
  }
}
```

- **互斥规则**：`verticalDropM` 与显式正数 `radiusM` 互斥，且与指向同一阶段的顶层 `critical_arc_top` 约束互斥；同时出现定位 `/stages/<i>` 报 `PRECONDITION_CONFLICT`。
- **物理推导（`deriveArcRadiusFromDrop`）**：
  - 端点角 $\varphi_1 = \varphi_0 + d \cdot \text{sweepAngleDeg}$。
  - 在圆轨坐标系 $y(\varphi) = y_c - R\cos\varphi$ 下，入口到端点的竖直向下落差为：
    $$\Delta y = y(\varphi_0) - y(\varphi_1) = R(\cos\varphi_1 - \cos\varphi_0) = R\,\Delta\cos$$
  - 要求 `verticalDropM > 0` 且 $\Delta\cos = \cos\varphi_1 - \cos\varphi_0 > 10^{-9}$（端点必须低于入口），反求：
    $$R = \frac{\text{verticalDropM}}{\Delta\cos}$$
  - 若 $\Delta\cos \le 10^{-9}$（如从最低点向上滑行却声明 `verticalDropM`），定位 `/stages/<i>/verticalDropM` 报 `PRECONDITION_CONFLICT`。
- **规范化产物**：写回 `stages[i].radiusM`，移除 `stages[i].verticalDropM`，并在 `calculations` 追加 `rule: "arc_radius_from_drop"`。

### 1.3 任意圆轨临界过顶反求半径：顶层 `constraints`

当题面给出“恰好能通过竖直圆轨道最高点”且该光滑内侧圆轨的 `radiusM` 为 `null`（或省略）时，在顶层 `constraints` 中声明：

```ts
constraints: [{ kind: "critical_arc_top", stageIndex: 3 }]
```

- **分工边界**：
  - 首段为 `spring_release` 且圆弧半径已知时，沿用 [预压弹簧扩展契约](PRECOMPRESSED_SPRING.md#4-题面约束固定能量与缺参处理) 由 `resolveSpringEnergy` 反求弹性势能。
  - 首段非 `spring_release` 时，由 `resolveGaokaoImplicitParams` 反求 `stages[stageIndex].radiusM`。
- **互斥规则**：
  - 若目标 `vertical_arc` 已显式给出数值 `radiusM`，定位 `/constraints/<cIdx>` 报 `PRECONDITION_CONFLICT`。
  - 若目标 `vertical_arc` 同时声明了 `verticalDropM`，定位 `/stages/<stageIndex>` 报 `PRECONDITION_CONFLICT`。
  - 同一圆弧阶段不可重复声明多个 `critical_arc_top`。
- **物理推导（`deriveCriticalArcTopRadius`）**：
  - 设进入该圆轨时的速率为 $u > 0$，入口角为 $\varphi_0$（默认 $0^\circ$，即最低点），重力加速度 $g > 0$。
  - 最高点临界失联条件 $N_{\text{top}} = 0 \implies v_{\text{top}}^2 = gR$，结合光滑圆轨机械能守恒：
    $$\frac{1}{2}u^2 = \frac{1}{2}gR + gR(1 + \cos\varphi_0) \implies u^2 = gR(3 + 2\cos\varphi_0)$$
  - 要求 $u > 0$ 且 $3 + 2\cos\varphi_0 > 10^{-9}$，反求：
    $$R = \frac{u^2}{g(3 + 2\cos\varphi_0)}, \qquad v_{\text{top}} = \sqrt{gR}$$
  - 在最低点入射（$\varphi_0 = 0^\circ$）时恰退化为经典公式 $R = \frac{u^2}{5g}$。
  - 若前置段减速至静止导致 $u = 0$，定位 `/constraints/<cIdx>` 报 `PRECONDITION_CONFLICT`。
- **规范化产物**：写回 `stages[stageIndex].radiusM`，在 `calculations` 追加 `rule: "critical_arc_top"`，并在返回值 `consumedConstraintIndices` 中标记已消费的约束下标。

### 1.4 显式圆弧相对衔接与地标标注

- **省略 `path.center`**：后继圆弧阶段允许省略 `path.center`，由运动引擎根据上一段出口坐标与入口角自动反算圆心 $O = (x_{\text{entry}} - R\sin\varphi_0,\; y_{\text{entry}} + R\cos\varphi_0)$；首段省略时默认入口在 $(0, 0)$。
- **地标 `startLabel` / `endLabel`**：各阶段可附带题图字母标注（如 `"A"`、`"B"`、`"C"`、`"D"`、`"E"`），规范化过程原样保留，供画布渲染与事件说明使用。

## 2. 组合解析与来源记录 `DerivedCalculation`

`src/physics/gaokaoConstraints.ts` 导出顶层组合解析函数 `resolveGaokaoImplicitParams(planDraft)`：

- **可静态递推速度的前置段**：`projectile`、`vertical_arc`（光滑）、`horizontal_slide`（定距 `distance`）、`incline_slide`、`lossless_turn`。
- **不可静态唯一确定末速的阶段**（如带未知释放参数的弹簧、传送带、缺少 `y` 参考的 `landingPlaneYM` 抛体）：将速度状态置空 `null`，若后续存在依赖入速的隐含反求则返回明确 `PRECONDITION_CONFLICT` 或 `missingKeys`，绝不猜测数值。
- **导出来源记录类型**（与 `StageMotion.calculations` 结构兼容）：

```ts
export type DerivedCalculation = {
  stageIndex: number;
  targetPath: string;
  quantity:
    | "projectile_drop_height"
    | "projectile_launch_vx"
    | "arc_entry_speed"
    | "initial_elastic_energy"
    | "arc_radius"
    | "critical_arc_top_radius";
  value: number;
  unit: "m" | "m/s" | "J";
  source: "derived";
  rule:
    | "tangent_to_next_arc"
    | "tangent_to_next_arc_launch_vx"
    | "energy_backprop_from_tangent_launch"
    | "arc_radius_from_drop"
    | "critical_arc_top"
    | "bounce_apex_height";
  inputPaths: string[];
};
```

- **API 回包再编辑重算**：规范化回包会保留 `derivedCalculations`（及弹簧 `energy.origin = "tangent_to_next_arc"`）作为派生来源记录。工作台在 API 回包基础上修改落差 `dropHeightM`、前段圆弧半径 `radiusM` 或后段入口切线角 `startAngleDeg` 时，只要原派生出的初速或弹簧能量未被用户手工改写，再次走 `validateStagePlan → assembleScene` 会自动按同一反求公式重新推导；若用户显式覆写了初速/能量（或补齐弹簧 `k`、压缩量），则以用户给定值为准，不再覆写，不自洽时按原规则报冲突。

## 3. 错误代码与 JSON Pointer 定位总表

| 场景 | 错误路径 `path` | 错误码 `code` | 说明 |
|---|---|---|---|
| `tangent_to_next_arc` 与 `dropHeightM` / `landingPlaneYM` 共存（非反求初速/能量场景） | `/stages/<i>` | `PRECONDITION_CONFLICT` | 仅在待反求水平出射速度/前段能量（或携带未手工改写的 `derivedCalculations` 派生来源）时允许共存；已给定固定初速/能量时视为过约束互斥 |
| `tangent_to_next_arc` 后继非显式 `path` 圆弧 | `/stages/<i>/end` | `PRECONDITION_CONFLICT` | 缺少目标圆弧入口切向 |
| 圆弧入口角为 $\pm 90^\circ$（$\cos\varphi_0 = 0$） | `/stages/<i+1>/path/startAngleDeg` | `PRECONDITION_CONFLICT` | 竖直切线无法由水平速度反求 |
| $v_x$ 与 $d\cos\varphi_0$ 异号或 $v_x = 0$ | `/stages/<i>/end` | `PRECONDITION_CONFLICT` | 水平速度与切向相反 |
| $v_{y,\text{entry}} \ge v_y$ 或反求落差 $< 0$ | `/stages/<i>/end` | `PRECONDITION_CONFLICT` | 上抛或初速条件无法在正时间内非负落差入弧 |
| `verticalDropM` 与显式 `radiusM` 或 `critical_arc_top` 共存 | `/stages/<i>` | `PRECONDITION_CONFLICT` | 圆弧半径来源互斥 |
| `verticalDropM <= 0` | `/stages/<i>/verticalDropM` | `RANGE` | 圆弧竖直落差须大于零 |
| $\cos\varphi_1 - \cos\varphi_0 \le 10^{-9}$ | `/stages/<i>/verticalDropM` | `PRECONDITION_CONFLICT` | 端点未低于入口，无法反求半径 |
| `critical_arc_top` 目标已有显式 `radiusM` | `/constraints/<c>` | `PRECONDITION_CONFLICT` | 与显式半径互斥 |
| `critical_arc_top` 目标非 `vertical_arc` | `/constraints/<c>/stageIndex` | `PRECONDITION_CONFLICT` | 约束仅适用于圆轨 |
| `critical_arc_top` 处入轨速率 $u \le 0$ | `/constraints/<c>` | `PRECONDITION_CONFLICT` | 零速无法临界过顶 |
| 任意数值非有限（`NaN` / `Infinity`） | 对应字段路径 | `NOT_FINITE` | 数值须为有限数 |
| 缺重力、缺初速、缺角度等必要输入 | 对应字段路径 | （收录 `missingKeys`） | 不臆造缺失值 |

## 4. 高考四段综合基准样例与 37°/53° 数值对照表

共享样例见 [fixtures/gaokao-proj-arc-horiz-loop.reading.json](fixtures/gaokao-proj-arc-horiz-loop.reading.json)：

- 题设：$m = 2\text{ kg}$，$g = 10\text{ m/s}^2$，A 点平抛初速 $v_0 = 6\text{ m/s}$；
- Stage 0（A→B）：`projectile`，`end: { kind: "tangent_to_next_arc" }`；
- Stage 1（B→C）：`vertical_arc`，`radiusM: null`，`verticalDropM: 2`，`startAngleDeg: -53`，`direction: "positive"`，`sweepAngleDeg: 53`；
- Stage 2（C→D）：`horizontal_slide`，$\mu = 0.25$，$L_{CD} = 8\text{ m}$；
- Stage 3（D→E→D）：`vertical_arc`，`radiusM: null`，`startAngleDeg: 0`，`direction: "positive"`，`end: { kind: "observation", sweepAngleDeg: 360 }`，配合顶层 `constraints: [{ kind: "critical_arc_top", stageIndex: 3 }]`。

物理引擎内部一律使用 **IEEE 754 精确三角函数**（`Math.sin` / `Math.cos`）；中国高考题常取 $\sin 53^\circ = \cos 37^\circ \approx 0.8$、$\cos 53^\circ = \sin 37^\circ \approx 0.6$（对应精确角 $\arctan(4/3) \approx 53.1301^\circ$，角差约 $0.1301^\circ \approx 0.00227\text{ rad}$）。下表给出两套口径的逐项对照，作为文档与单元测试的统一基准：

| 物理量 | 精确三角函数（53°） | 高考近似（0.6 / 0.8） | 相对差异 |
|---|---|---|---|
| $\cos 53^\circ = \sin 37^\circ$ | `0.601815` | `0.600000` | `+0.30%` |
| $\sin 53^\circ = \cos 37^\circ$ | `0.798636` | `0.800000` | `-0.17%` |
| $\tan 53^\circ$ | `1.327045` | `1.333333` ($4/3$) | `-0.47%` |
| A→B 飞行时间 $t_{AB}$ | `0.796227 s` | `0.800000 s` | `-0.47%` |
| B 点入弧竖直分速度 $v_{yB}$ | `-7.962269 m/s` | `-8.000000 m/s` | `-0.47%` |
| **反求 A→B 落差 `dropHeightM`** | **`3.169886 m`** | **`3.200000 m`** | `-0.94%` |
| B 点入弧速率 $v_B$ | `9.969841 m/s` | `10.000000 m/s` | `-0.30%` |
| **反求 B→C 圆弧半径 `R1`** | **`5.022791 m`** | **`5.000000 m`** | `+0.46%` |
| C 点速率 $v_C$ | `11.806681 m/s` | `11.832160 m/s` ($\sqrt{140}$) | `-0.22%` |
| C 点支持力 $N_C$ | `75.506081 N` | `76.000000 N` | `-0.65%` |
| D 点入轨速率 $v_D$（$2gh_{BC} = 2\mu gL_{CD} = 40$ 抵消） | `9.969841 m/s` | `10.000000 m/s` | `-0.30%` |
| **反求 D→E 整圆半径 `R2`** | **`1.987955 m`** | **`2.000000 m`** | `-0.60%` |
| E 点临界最高点速率 $v_E$ | `4.458648 m/s` | `4.472136 m/s` ($\sqrt{20}$) | `-0.30%` |
| E 点最高点支持力 $N_E$ | `0 N` | `0 N` | `0.00%` |
| D 点（回底）支持力 $N_D = 6mg$ | `120.000000 N` | `120.000000 N` | `0.00%` |

## 5. 合并接线参考（供 `validateStagePlan` / `stageMotion` 接入）

1. 在 `validateStagePlan` 中对非 `spring_release` 首段且包含声明式字段的草稿调用 `resolveGaokaoImplicitParams(draft)`：
   - 失败时将其 `missingKeys` 与 `fieldErrors` 合并到统一校验回包；
   - 成功时用返回的规范化 `stages` 继续常规字段与接续校验，并将已消费的 `constraints` 标记移除（不反复重施），同时保留 `calculations` 供 `buildMotion` 透传到 `StageMotion.calculations`。
2. `buildMotion` 无需感知 `tangent_to_next_arc`、`verticalDropM` 或半径型 `critical_arc_top`，直接消费已解析的 `dropHeightM` 与 `radiusM` 即可；`StageMotion.calculations` 中附加 `DerivedCalculation` 供前端区分题设值与推导值。
