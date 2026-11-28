# 电磁感应导轨（单棒切割磁感线）

独立单阶段 `emf_rail`，不与碰撞或其他阶段串接（`stages` 长度必须为 1），不使用顶层 `bodies/primaryBodyId/massKg/gravityMps2/scaleMode/energy/constraints`。`initial` 只能写 `{speedMps: 与段内 initialSpeedMps 相同}` 作接口占位，真正的初速以段内为准。

范围：**水平**平行导轨、磁场垂直导轨平面、单根导体棒始终垂直于导轨平动切割磁感线；可带沿导轨方向的恒定外力与恒定动摩擦；回路为纯电阻（总电阻恒定），忽略自感与端点效应。

不在范围：双棒或多棒、倾斜/竖直导轨、线框整体转动（发电机/电动机模型）、变压器与交流电、含电容或电感的回路、棒绕端点转动切割（$E = \frac12B\omega L^2$）。

## 字段

| 字段 | 单位与含义 |
|---|---|
| `magneticTeslaB` | T，正有限数；匀强磁场的磁感应强度 $B$ |
| `railSpacingM` | m，正有限数；导轨间距 $L$，同时是棒在磁场中的有效长度 |
| `totalResistanceOhm` | Ω，正有限数；**回路总电阻** $R$，含棒电阻与（若有）外接电阻 |
| `rodMassKg` | kg，正有限数；导体棒质量 $m$ |
| `externalForceN` | N，有限数，默认 0；沿导轨方向的恒定外力，沿 $+x$ 为正、反向为负 |
| `kineticFrictionCoefficient` | 无量纲，非负，默认 0；棒与导轨间动摩擦因数 $\mu$ |
| `gravityMps2` | m/s²，正有限数，默认 10 |
| `initialSpeedMps` | m/s，非负，默认 0；$t=0$ 时的速率。反向运动用负的 `externalForceN` 表达，不要写负初速 |
| `fieldDirection` | `"into_page"`（默认，垂直纸面向里）/ `"out_of_page"`（向外） |
| `end` | 观察终点，见下 |

### `end` 分支

| `kind` | 附加字段 | 含义 |
|---|---|---|
| `time` | `durationSeconds`（s，正） | 观察固定时长 |
| `distance` | `distanceM`（m，正） | 观察到位移达到给定值；滑不到则报错 |
| `speed` | `speedMps`（m/s，非负） | 观察到速度经过给定值 |
| `stop` | — | 观察到速度减为零；要求 $v_t < 0$ 且 $v_0 > 0$ |
| `terminal` | — | 观察到速度达到收尾速度的 99%；要求 $v_t > 0$ |

## 物理

记 $k = B^2L^2/R$（N·s/m）、$f = F - \mu mg$（N）、$\lambda = k/m$（s⁻¹）、$v_t = f/k$（m/s），则

$$v(t) = v_t + (v_0 - v_t)e^{-\lambda t}, \qquad x(t) = v_t t + \frac{(v_0 - v_t)(1 - e^{-\lambda t})}{\lambda}$$

- 特征时间 $\tau = 1/\lambda = mR/(B^2L^2)$；
- 感应电动势 $\varepsilon = BLv$，电流 $I = \varepsilon/R$，安培力 $F_安 = B^2L^2v/R = kv$，方向始终阻碍相对运动；
- 通过回路的电荷量 $q = \dfrac{BLx}{R}$；
- 焦耳热 $Q = f x - \Delta E_k$（外力做功减去动能增量），等价于 $k\int v^2dt$；
- $v_t > 0$ 时速度指数趋近收尾速度；$v_t = 0$ 时只渐近趋零、**永不停止**；$v_t < 0$ 时在有限时间 $t_s = \dfrac{1}{\lambda}\ln\dfrac{v_0 - v_t}{-v_t}$ 内停下。

## 事件

| `kind` | 触发条件 | 含义 |
|---|---|---|
| `emf_start` | $t = 0$ | 进入磁场开始切割磁感线，给出 $k$、$\tau$、$\varepsilon_0$ 与 $F_{安0}$ |
| `emf_terminal` | $v_t > 0$ 且 $v_0 < v_t$，速度达 $0.95v_t$ | 速度接近收尾速度 |
| `emf_force_balance` | $\lvert v_t\rvert > 0$ 且 $\lvert v_t\rvert < v_0$ | 安培力衰减到与其他阻力大小相等，此后减速几乎全靠摩擦 |
| `emf_stop` | `end.kind === "stop"` | 速度减为零，携带完整结论；此时不再另发 `emf_end` |
| `emf_end` | 其他终点 | 观察终点，携带末速、位移、$\varepsilon$、$I$、$q$、$Q$ |

## 派生量

`emf_travel`（m）、`emf_charge`（C）、`emf_joule_heat`（J）、`emf_terminal_speed`（m/s）、`emf_damping_time`（s，即 $\tau$）。

## 校验

必需字段缺任一项 → `needs_input` 并列出 `missingKeys`；字段类型错误 → `INVALID_READING`；混用顶层 `massKg/gravityMps2/bodies/...` 或 `stages` 长度不为 1 → `PRECONDITION_CONFLICT` / `UNSUPPORTED`；参数组合无法求解（初速为零且合力不大于零、`stop` 但只渐近趋零、`distance` 滑不到、`terminal` 但无正收尾速度）→ `INCONSISTENT_CONDITIONS`。

## 画布

专用渲染：两条平行导轨、左端折线电阻、磁场符号（向里 ×／向外 ·）、运动导体棒、电流箭头、速度箭头、安培力箭头与顶部读数（$v$、$\varepsilon$、$I$、$F_安$、$x$）。位移沿 $+x$，导轨平面 $y \in [0, L]$，电阻固定在 $x = 0$ 一端。

## 样例

`fixtures/emf-rail-friction.reading.json`：$B = 0.5$ T、$L = 1.0$ m、$R = 0.4$ Ω、$m = 0.2$ kg、$\mu = 0.1$、$v_0 = 10$ m/s、`end: stop`。

解析结果：$\lambda = 3.125$ s⁻¹、$\tau = 0.32$ s、$v_t = -0.32$ m/s、$t_s = 1.1115$ s、$x = 2.8443$ m、$q = 3.5554$ C、$Q = 9.4311$ J，摩擦热 $0.5689$ J，两者之和恰为 $\frac12mv_0^2 = 10$ J。

回归要求：`src/physics/__tests__/emfRail.test.ts` 覆盖五种终点分支、非法组合、缺项与顶层混用；`src/data/__tests__/samples.test.ts` 锁定上述数值与能量守恒。
