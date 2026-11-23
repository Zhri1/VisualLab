/**
 * 内置示例：高考风格的力学母题。
 *
 * 约定：
 * - 每道题都复用一个已验收的 reading 路径（fixtures 或同构数据），不引入新物理；
 * - problemText 是完整题面，进入工作台后显示在对话首条与原题抽屉里；
 * - message 是给用户看的计算摘要，不写答案，只描述关键约束。
 */
import type { WorkspaceReading } from "../types";
import inclineSpring from "../../fixtures/incline-spring.reading.json";


import collisionPendulum from "../../fixtures/horizontal-collision-pendulum.reading.json";
import collisionCatch from "../../fixtures/horizontal-collision-catch-after-stop.reading.json";
import roofProjectile from "../../fixtures/incline-projectile.reading.json";
import collisionFlight from "../../fixtures/horizontal-collision-flight.reading.json";

export type SampleDifficulty = "基础" | "中档" | "压轴";

export interface Sample {
  id: string;
  title: string;
  description: string;
  difficulty: SampleDifficulty;
  tags: string[];
  /** 同一道题的第二组条件：点「对照」切换。 */
  compare?: { label: string; backLabel: string; reading: WorkspaceReading };
  problemText: string;
  message: string;
  assumptions: string[];
  reading: WorkspaceReading;
}

/** 两物块粘连：碰后共速，一起在粗糙面上滑到停。 */
const stickyPair: WorkspaceReading = {
  kind: "stage_plan",
  schemaVersion: 1,
  gravityMps2: 10,
  bodies: [
    { bodyId: "one", massKg: 1 },
    { bodyId: "two", massKg: 1 },
  ],
  primaryBodyId: "one",
  initial: {
    bodies: [
      { bodyId: "one", xM: 0, vxMps: 5 },
      { bodyId: "two", xM: 6, vxMps: -1 },
    ],
  },
  stages: [
    {
      kind: "horizontal_approach",
      tracks: [
        { bodyId: "one", kineticFrictionCoefficient: 0 },
        { bodyId: "two", kineticFrictionCoefficient: 0 },
      ],
      end: { kind: "contact_or_rest" },
    },
    {
      kind: "collision_1d",
      bodyIds: ["one", "two"],
      mode: "perfectly_inelastic",
      contact: { kind: "horizontal_meeting", approachStageIndex: 0 },
      externalImpulseNegligible: true,
    },
    {
      kind: "parallel_motion",
      tracks: [
        {
          bodyIds: ["one", "two"],
          stages: [
            { kind: "horizontal_slide", kineticFrictionCoefficient: 0.2, end: { kind: "stop" } },
          ],
        },
      ],
      end: { kind: "all_finite_tracks" },
    },
  ],
} as WorkspaceReading;

/** 圆轨临界对照：默认恰好过顶，可一键切到差一点。 */
const circularCritical: WorkspaceReading = {
  kind: "stage_plan",
  schemaVersion: 1,
  gravityMps2: 10,
  massKg: 0.1,
  initial: { speedMps: 4.47213595499958 },
  stages: [
    { kind: "vertical_arc", radiusM: 0.4, endAngleDeg: 180, side: "inside", frictionless: true },
    { kind: "projectile", landingPlaneYM: 0 },
  ],
} as WorkspaceReading;

/** 弹簧枪：给定 k 与压缩量，完整播放“释放→滑行→圆轨→平抛”。 */
const springCriticalFull: WorkspaceReading = {
  kind: "stage_plan",
  schemaVersion: 1,
  massKg: 0.1,
  gravityMps2: 10,
  initial: { speedMps: 0 },
  constraints: [{ kind: "critical_arc_top", stageIndex: 2 }],
  stages: [
    {
      kind: "spring_release",
      springConstantNpm: 400,
      initialCompressionM: 0.09486832980505137,
      kineticFrictionCoefficient: 0.2,
      unattached: true,
      slidesAfterRelease: true,
      releaseCompleteByM: 4,
    },
    {
      kind: "horizontal_slide",
      kineticFrictionCoefficient: 0.2,
      end: { kind: "distance_from_stage_start", stageIndex: 0, distanceM: 4 },
    },
    { kind: "vertical_arc", radiusM: 0.4, endAngleDeg: 180, side: "inside", frictionless: true },
    { kind: "projectile", landingPlaneYM: 0 },
  ],
} as WorkspaceReading;

/** 圆轨入口速度略低于临界：用来演示“差一点就脱轨”。 */
const circularNearMiss: WorkspaceReading = {
  kind: "stage_plan",
  schemaVersion: 1,
  gravityMps2: 10,
  massKg: 0.1,
  initial: { speedMps: 4.2 },
  stages: [
    { kind: "vertical_arc", radiusM: 0.4, endAngleDeg: 180, side: "inside", frictionless: true },
    { kind: "projectile", landingPlaneYM: 0 },
  ],
} as WorkspaceReading;

/** 重球撞轻球：碰后轻球摆起，重球继续前进。 */
const heavyHitsLight = {
  ...collisionPendulum,
  bodies: [
    { bodyId: "one", massKg: 3 },
    { bodyId: "two", massKg: 1 },
  ],
  initial: {
    bodies: [
      { bodyId: "one", xM: 0, vxMps: 2 },
      {
        bodyId: "two",
        xM: 1,
        vxMps: 0,
        constraint: {
          kind: "pendulum_string",
          pivotXM: 1,
          lengthM: 1,
          pivotFixed: true,
          lightInextensibleString: true,
          airResistanceNegligible: true,
          initialStringState: "taut",
        },
      },
    ],
  },
} as WorkspaceReading;

export const SAMPLES: Sample[] = [
  {
    id: "incline-spring-2m",
    title: "斜面滑块压缩弹簧",
    description: "倾角 37°，水平段 1 m 后接触弹簧",
    difficulty: "基础",
    tags: ["斜面", "弹簧"],
    problemText:
      "质量 1 kg 的滑块从长 4 m、倾角 37° 的粗糙斜面顶端由静止下滑，斜面动摩擦因数 0.5；到坡底经光滑转向进入水平面，水平面光滑，滑块与弹簧不连接，弹簧劲度系数 400 N/m，g 取 10 m/s²。求滑块接触弹簧前的速度、弹簧的最大压缩量。",
    message: "已按 g=10 m/s²、μ=0.5、倾角 37° 生成动画",
    assumptions: ["g=10 m/s²", "μ=0.5", "倾角 37°"],
    reading: inclineSpring as WorkspaceReading,
  },
  {
    id: "spring-critical-arc",
    title: "弹簧枪·圆轨临界",
    description: "0.1 kg 物块 · μ=0.2 · R=0.4 m，恰好过最高点",
    difficulty: "压轴",
    tags: ["弹簧", "圆轨", "临界"],
    problemText:
      "质量 0.1 kg 的物块静止在水平面上，左端弹簧（劲度系数 400 N/m）被压缩 9.49 cm 后释放，物块脱离弹簧后继续滑行。从释放点到半径 R=0.4 m 的竖直圆轨道最低点共 4 m，水平面动摩擦因数 0.2。物块恰好通过圆轨道最高点后飞出，g 取 10 m/s²。求最高点速度、弹簧储存的弹性势能；若压缩量略小，物块会在何处脱离轨道？",
    message: "已按「恰好过最高点」反求能量：最高点速度 2.00 m/s，弹性势能 1.80 J",
    assumptions: ["g=10 m/s²", "弹簧原长时物块脱离弹簧"],
    reading: springCriticalFull,
  },
  {
    id: "circular-near-miss",
    title: "圆轨·差一点脱轨",
    description: "以 4.2 m/s 入轨，离过顶只差一点",
    difficulty: "压轴",
    tags: ["圆轨", "脱轨", "临界"],
    problemText:
      "小物块以 4.2 m/s 的速度从最低点进入半径 0.4 m 的光滑竖直圆轨道内侧，g 取 10 m/s²。判断它能否到达最高点；若不能，求脱离轨道时速度与水平方向的夹角。",
    message: "入口速度低于临界值：物块在最高点前脱离轨道，弹出位置由弹力为零决定",
    assumptions: ["g=10 m/s²", "圆轨内侧光滑"],
    reading: circularNearMiss,
  },
  {
    id: "heavy-hits-light",
    title: "重球撞轻球·摆起",
    description: "3 kg 撞静止 1 kg，碰后轻球摆起",
    difficulty: "压轴",
    tags: ["碰撞", "动量", "单摆"],
    problemText:
      "质量 3 kg 的物块以 2 m/s 在光滑水平面向右运动，与静止在最低点、用长 1 m 轻绳悬挂的 1 kg 小球发生弹性正碰。碰后物块继续沿水平面滑行 2 m，小球摆动，g 取 10 m/s²。求碰后物块与小球的速度、小球摆起的最大高度。",
    message: "弹性正碰 + 单摆：碰后轻球摆起，重球继续滑行，两条轨道同时播放",
    assumptions: ["g=10 m/s²", "轻绳不可伸长", "碰撞外冲量可忽略"],
    reading: heavyHitsLight,
  },
  {
    id: "catch-after-stop",
    title: "追及碰撞·先停后撞",
    description: "B 先停下，A 再追上发生弹性碰撞",
    difficulty: "压轴",
    tags: ["碰撞", "追及", "动量"],
    problemText:
      "质量 1 kg 的物块 A 以 4 m/s 在光滑水平面向右运动，前方 3 m 处有质量 2 kg 的物块 B 以 1 m/s 同向运动，B 与水平面动摩擦因数 0.2，A 所在面光滑，g 取 10 m/s²。A 追上 B 时发生弹性正碰。求碰前 B 是否已经停下、碰后 A 与 B 的速度。",
    message: "已按实际轨迹判定：B 先减速到零，A 追上静止的 B 后发生弹性碰撞",
    assumptions: ["g=10 m/s²", "碰撞外冲量可忽略"],
    reading: collisionCatch as WorkspaceReading,
  },
  {
    id: "roof-projectile",
    title: "屋顶积雪·檐口斜抛",
    description: "L=2.5 m，μ=0.125，檐口离地 1.95 m",
    difficulty: "中档",
    tags: ["斜面", "斜抛"],
    problemText:
      "积雪从长 2.5 m、倾角 θ（tanθ=3/4）的屋顶由静止下滑，屋顶动摩擦因数 0.125；到檐口后沿屋面方向飞出，檐口离地 1.95 m，g 取 10 m/s²。求积雪到达檐口的速度、落地时间与水平射程。",
    message: "沿坡下滑后从檐口斜抛：切向初速由斜面摩擦决定，落点由抛出高度决定",
    assumptions: ["g=10 m/s²", "沿屋面切向飞出"],
    reading: roofProjectile as WorkspaceReading,
  },
  {
    id: "sticky-collision",
    title: "两物块粘连·共速滑行",
    description: "等质量相向碰撞，粘连后一起减速到停",
    difficulty: "中档",
    tags: ["碰撞", "动量", "摩擦"],
    problemText:
      "质量 1 kg 的物块 A 以 5 m/s 在光滑水平面向右运动，前方 6 m 处质量 1 kg 的物块 B 以 1 m/s 向左运动，两物块碰撞后粘在一起。碰后整体进入动摩擦因数 0.2 的粗糙面，g 取 10 m/s²。求碰后共同速度、碰后滑行的距离。",
    message: "完全非弹性碰撞：动量守恒得到共同速度，随后整体在粗糙面上减速到停",
    assumptions: ["g=10 m/s²", "碰撞时间极短"],
    reading: stickyPair,
  },
  {
    id: "collision-flight",
    title: "碰后飞出桌面·平抛",
    description: "弹性碰撞后一物飞出桌沿，落点由桌高决定",
    difficulty: "压轴",
    tags: ["碰撞", "平抛", "动量"],
    problemText:
      "质量 1 kg 的物块 A 以 5 m/s 在光滑桌面向右运动，前方 4 m 处质量 3 kg 的物块 B 以 1 m/s 同向运动，桌面右沿在 x=5 m，桌面离地 1.25 m。两物块发生弹性正碰，g 取 10 m/s²。求碰后 A、B 的速度；B 飞出桌沿后的落地时间与水平位移；A 碰后向哪个方向运动？",
    message: "碰后 B 从桌沿飞出做平抛，A 反弹向左滑行，两条轨道同时播放",
    assumptions: ["g=10 m/s²", "碰撞外冲量可忽略"],
    reading: collisionFlight as WorkspaceReading,
  },
  {
    id: "circular-compare",
    title: "圆轨临界·对照",
    description: "同一圆轨：恰好过顶 vs 差一点脱轨",
    difficulty: "压轴",
    tags: ["圆轨", "临界", "对照"],
    compare: {
      label: "切到差一点",
      backLabel: "切回恰好过顶",
      reading: circularNearMiss,
    },
    problemText:
      "小物块从最低点进入半径 0.4 m 的光滑竖直圆轨道内侧，g 取 10 m/s²。(1) 若入口速度为 √20 m/s，求最高点速度并判断能否通过；(2) 若入口速度换成 4.2 m/s，物块还能到最高点吗？点右上角「切到差一点」对照两种情况。",
    message: "恰好过顶时最高点速度 2.00 m/s、弹力为零；切到 4.2 m/s 会在最高点前脱轨",
    assumptions: ["g=10 m/s²", "圆轨内侧光滑"],
    reading: circularCritical,
  },
];

export const DEFAULT_SAMPLE_ID = SAMPLES[0].id;

/** 选择器只关心展示字段，避免把 reading 打进列表渲染。 */
export const SAMPLE_OPTIONS = SAMPLES.map(({ id, title, description, difficulty, tags }) => ({
  id,
  title,
  description,
  difficulty,
  tags,
}));

export function getSample(id?: string): Sample {
  return SAMPLES.find((sample) => sample.id === id) ?? SAMPLES[0];
}