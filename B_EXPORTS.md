# B · 稳定导出契约（给 A、C）

> **结论先行**：下面这些已经实现并测试通过，**不需要重新开发**。
> 联调时如果发现数值或形状对不上，先按本文核对字段语义；确认是计算问题再改 `src/physics`，不要另写一套。

统一从 `src/physics` 导入（`src/physics/index.ts` 是唯一公共入口）：

```ts
import {
  validateStagePlan,
  assembleScene,
  buildMotion,
} from "../physics";
import type {
  StagePlanDraft, ResolvedStagePlan, StagePlanValidation, StagePlanFailure,
  StageGeometry, StageScene, StageMotion, StageEvent, EndReason,
} from "../physics";
```

---

## 1. `validateStagePlan(input: unknown): StagePlanValidation`

纯校验，不计算运动。C 的接口层和 A 的核对表都用它，**只有这一份规则**。

成功：`{ ok: true, reading: ResolvedStagePlan }` —— 已归一化，数值字段保证是有限数。

失败：`{ ok: false, code, message, reading, missingKeys, fieldErrors }`

| 字段 | 含义 |
|---|---|
| `code` | `NEEDS_INPUT` / `INVALID_READING` / `INCONSISTENT_CONDITIONS` / `UNSUPPORTED` |
| `reading` | 归一化后的草稿，缺的字段是 `null`，可直接回填核对表 |
| `missingKeys` | **RFC 6901 JSON Pointer**，零基，如 `/stages/2/end/distanceM` |
| `fieldErrors` | `{ path, code, message }[]`，`path` 同指针格式 |

两种路径不要混用：`missingKeys` 是「缺值」，`fieldErrors` 是「有值但不合法」。界面文案要分开。

## 2. `StageGeometry`

```ts
type StageGeometry = {
  incline?:    { start: Point; end: Point };
  horizontal?: { start: Point; plannedEnd: Point | null };
  spring?:     { contact: Point; anchor: Point };
  projectile?: { launch: Point; landingPlane: { yM: number } };
  blockSizeM: number;               // 0.3
  positionReference: "front_bottom";
};
```

- 只出现计划里真实存在的段；没这段就没有这个键，**不要假设四个键都在**。
- `horizontal.plannedEnd` 是题设的目标位置：`end.kind === "distance"` 时给出，`"stop"` 时为 `null`。
  **停止发生在目标之前时，`plannedEnd` 仍然保留** —— 画面上要能标出「本来要走到哪」。
- `projectile.landingPlane.yM` 是落地平面高度（相对坐标），不是地面。
- 坐标原点在斜面底端，x 向右、y 向上，单位米。`positionReference` 一律是滑块**前下沿接触点**，不是几何中心。

## 3. `assembleScene` / `buildMotion`

```ts
assembleScene(plan: StagePlanDraft | ResolvedStagePlan): { ok: true, scene: StageScene } | StagePlanFailure
assembleScene(reading: Reading): { ok: true, scene: Scene } | PhysicsFailure        // 旧模板，保留
buildMotion(scene: StageScene): { ok: true, motion: StageMotion }
buildMotion(scene: Scene): { ok: true, motion: Motion }                              // 旧模板，保留
```

两个函数都按 `kind` 分派：`assembleScene` 看 `plan.kind === "stage_plan"`，`buildMotion` 看 `scene.kind === "stage_scene"`。旧调用方不用改，新代码传阶段计划即可。

`assembleScene` 内部先跑 `validateStagePlan`，校验不过直接返回失败，**不会**抛异常。
`buildMotion` 只做映射，不重新求解 —— 一次 `assembleScene` 对应一次完整求解。

## 4. `StageMotion`

```ts
type StageMotion = {
  geometry: StageGeometry;
  durationSeconds: number;
  segments: { stageIndex: number; kind: StageKind; startSeconds: number; endSeconds: number }[];
  events: StageEvent[];
  termination: { reason: EndReason; eventId: string; stageIndex: number };
  readonly endReason: EndReason;          // 与 termination.reason 同源同值
  sampleAt(t: number): MotionSample;
};
```

**`segments`** 只收时长大于 0 的阶段，首尾相接。转向段时长恒为 0，因此**不会**出现在 `segments` 里 —— 它的信息在 `events` 的 `lossless_turn` 事件上。阶段卡按 `segments` 切，别按 `plan.stages` 切，否则会多出一张零长卡片。

**`events`** 每条是 `{ id, stageIndex, kind, timeSeconds, order, velocityBefore, velocityAfter, label, explanation }`：

- `id` 形如 `3:spring_detach:7`（`阶段序号:事件种类:全局序号`），**一次求解内稳定**，可用于对话跳转；跨题不要复用。
- 事件种类至少覆盖：`release`、`reach_bottom`、`lossless_turn`、`reach_target`、`stop`、`leave_table`、`apex`、`land`、`spring_contact`、`max_compression`、`spring_detach`。
- `velocityBefore` / `velocityAfter` 是事件前后瞬间的速度，转向与接触是瞬时事件，两者不同才是正常。

**`sampleAt(t)`**：

- `t` 会被夹到 `[0, durationSeconds]`，不会返回 NaN，也不会抛错 —— 时间轴拖动短暂越界是安全的。
- 同一时刻有多个事件时返回**最后一个事件的「事件后」状态**，保证转向、接触、零时长终止能精确停靠。
- 末帧停在终止事件上，保留接地/脱离瞬间的入射速度。

## 5. 五种终止原因与末帧

`endReason`（= `termination.reason`）只有这六个值：

| 值 | 含义 | 末帧 |
|---|---|---|
| `stop_at_target` | 恰好停在指定距离处 | 停在目标点，速度 0 |
| `stop_before_target` | 到目标前就停了（摩擦耗尽） | 停在**实际**停止点，`geometry.horizontal.plannedEnd` 仍是目标点 |
| `stopped` | 水平段无距离目标，靠摩擦停下 | 停在停止点 |
| `landed` | 抛体落地 | 停在落地平面，保留入射速度 |
| `spring_detached` | 弹簧恢复原长、滑块脱离 | 停在接触点，速度反向 |
| `prefix_end` | 计划本身跑完了，没有别的终止事件（如只给了斜面一段） | 停在最后一段终点 |

两种「停止」必须分开渲染：`stop_at_target` 的停止点与目标点重合，`stop_before_target` 不重合 —— 后者要在画面上同时给出实际停止位置和目标虚线位置。

`prefix_end` 不是错误，是「题面只要求看到这里」的正常结束。

## 6. 测试与验收基准

- `npm test` 里 `src/physics/__tests__/stagePlan.test.ts`（17 条，校验）与 `stageMotion.test.ts`（13 条，装配）覆盖上述全部形状与末帧语义。
- 旧模板 13 条数值基准不变，见 `HANDOFF-B.md` 的验收基准表。
- `node --test src/physics/motion.test.ts src/physics/scene.test.ts` 覆盖旧整题方案，仍然全绿。

## 7. 不要做的事

1. **不要在适配层重算物理**。A 的适配器只做字段映射；数值一律来自 `assembleScene` / `buildMotion`。
2. **不要改导出名**。`validateStagePlan` / `assembleScene` / `buildMotion` / `StageGeometry` 已经定稿，C 的云函数和 A 的播放器都按这三个名字导入。
3. **不要为「缺段」补默认值**。模型少给一段就是少给一段，缺值走 `missingKeys` 追问，不要填 0 或猜测。
4. **不要绕开 `validateStagePlan` 直接构造 `ResolvedStagePlan`**。类型能骗过去，运行时会在装配阶段抛 `INCONSISTENT_CONDITIONS`。

---

PR #11 的旧整题方案已被本方案取代（#18），低层公式（`motion.ts` / `scene.ts` / `kinematics.ts`）保留复用，不再单独演进。
