/**
 * 内置示例题库：覆盖高考物理主要模型族。
 *
 * 覆盖范围（15 道）：
 * - 组合压轴：平抛入弧 / 碰后平抛 / 斜面-圆弧-弹簧 / 弹簧-跳台-斜抛 / 传送带 / 组合场 / 连接体 / 可移动圆弧槽；
 * - 单模型基础：万有引力圆轨道、双星系统、恒力一维（加速-匀速-减速）、弹性正碰后单摆上摆、电磁感应导轨减速；
 * - 电磁与多体压轴：匀强磁场两粒子正碰再相遇、传送带加速后冲上可平动半圆槽。
 *
 * 约定：
 * - 每道题均复用已验收的 fixtures 路径，包含多阶段不同物理模型串联；
 * - 每道题均附带原题图片（imageUrl）与完整题面（problemText），点右上角「查看原题」可直接看图并放大；
 * - message 为计算摘要，不写死答案，只说明关键约束。
 */
import type { WorkspaceReading } from "../types";
import gaokaoProjArcHorizLoop from "../../fixtures/gaokao-proj-arc-horiz-loop.reading.json";
import collisionFlight from "../../fixtures/horizontal-collision-flight.reading.json";
import inclineArcHorizSpring from "../../fixtures/gaokao-incline-arc-horiz-spring.reading.json";
import springArcProjIncline from "../../fixtures/gaokao-spring-arc-proj-incline.reading.json";
import conveyorAccel from "../../fixtures/conveyor-accel.reading.json";
import magneticDeflection from "../../fixtures/magnetic-deflection.reading.json";
import movableArcSpring from "../../fixtures/movable-arc-spring.reading.json";
import pulleyGroundSlack from "../../fixtures/pulley-ground-slack.reading.json";
import circularOrbit from "../../fixtures/circular-orbit.reading.json";
import binaryCircularOrbit from "../../fixtures/binary-circular-orbit.reading.json";
import constantForceThreeStage from "../../fixtures/constant-force-three-stage.reading.json";
import conveyorMovableSemicircle from "../../fixtures/conveyor-movable-semicircle.reading.json";
import magneticReencounter from "../../fixtures/magnetic-reencounter-hubei2023.reading.json";
import horizontalCollisionPendulum from "../../fixtures/horizontal-collision-pendulum.reading.json";
import emfRailFriction from "../../fixtures/emf-rail-friction.reading.json";
import fieldSceneTwoParticle from "../../fixtures/field-scene-two-particle.reading.json";
import fieldSceneReverseB from "../../fixtures/field-scene-reverse-b.reading.json";
import fieldSceneBoundaryVariant from "../../fixtures/field-scene-boundary-variant.reading.json";

export type SampleDifficulty = "基础" | "中档" | "压轴";

/** 逐问讲解：小问绑定关键时刻（eventKind 优先），附方程与代入数值。 */
export interface SampleQuestion {
  label: string;
  eventKind?: string;
  timeSeconds?: number;
  formula: string;
  substitution: string;
}

export interface Sample {
  id: string;
  title: string;
  description: string;
  difficulty: SampleDifficulty;
  tags: string[];
  /** 原题图片地址（内置示例位于 public/samples/，在「查看原题」中直接展示） */
  imageUrl: string;
  /** 同一道题的第二组条件：点「对照」切换。 */
  compare?: { label: string; backLabel: string; reading: WorkspaceReading };
  problemText: string;
  message: string;
  assumptions: string[];
  questions?: SampleQuestion[];
  /** 预测—验证练习：先答再播放。 */
  practice?: { prompt: string; options: string[]; answer: number; explain: string }[];
  reading: WorkspaceReading;
}

export const SAMPLES: Sample[] = [
  {
    id: "gaokao-proj-arc-horiz-loop",
    title: "平抛入弧 · 粗糙水平 · 临界整圆",
    description: "4 阶段：平抛切向入弧 BC → 粗糙水平 CD → 临界整圆 DE",
    difficulty: "压轴",
    tags: ["平抛", "双圆弧", "临界"],
    imageUrl: "/samples/gaokao-proj-arc-horiz-loop.jpg",
    problemText:
      "质量为 m=2 kg 的小滑块，从水平轨道上的 A 点以 v₀=6 m/s 的速度水平滑出，恰好在 B 点沿切线方向滑入光滑的圆弧轨道 BC。滑块离开轨道 BC 后，经粗糙水平轨道 CD 进入光滑圆轨道 DE 中运动。已知轨道 BC 对应的圆心角为 θ=53°，半径 OC 与水平轨道 CD 垂直，B 点与水平轨道 CD 的竖直高度 h=2 m；滑块与轨道 CD 间的动摩擦因数 μ=0.25，轨道 CD 长 L=8 m，g 取 10 m/s²，忽略空气阻力。求：(1) A、B 两点的高度差；(2) 滑块滑到 C 点时对轨道的压力；(3) 要使滑块恰好能到达圆轨道最高点 E，圆轨道的半径为多大？",
    message: "已按切向入弧、高度差与临界过顶反求全段几何，四段连续播放",
    assumptions: ["g=10 m/s²", "忽略空气阻力", "圆弧 BC 与圆轨道 DE 光滑"],
    questions: [
      {
        label: "(1) 高度差",
        eventKind: "arc_enter",
        formula: "v_y = v₀·tanθ，h_AB = v_y² / (2g)",
        substitution: "v_y = 6×tan53° = 8 m/s；h_AB = 8²/(2×10) = 3.2 m",
      },
      {
        label: "(2) C 点压力",
        eventKind: "arc_endpoint",
        formula: "N − mg = m·v_C²/R_BC（C 为弧最低点）",
        substitution: "v_C 由 B→C 机械能守恒求得；N 与画布法向力读数同钟，压力 = N 反作用",
      },
      {
        label: "(3) 临界整圆半径",
        eventKind: "arc_enter",
        formula: "v_E² = gR；½v_D² = ½v_E² + 2gR → R = v_D²/(5g)",
        substitution: "v_D² = v_C² − 2μgL = v_C² − 40；R = v_D²/50（恰好过顶 E 点 N=0）",
      },
    ],
    practice: [
      {
        prompt: "按题给条件反求的圆轨道半径，滑块能否到达最高点 E？",
        options: ["恰好能到 E，且该处压力为 0", "到 E 之前就脱轨", "能到 E 且压力大于 0"],
        answer: 0,
        explain: "临界整圆条件 v_E² = gR：恰好过顶时轨道压力 N = 0，重力单独提供向心力。",
      },
    ],
    reading: gaokaoProjArcHorizLoop as WorkspaceReading,
  },
  {
    id: "collision-flight",
    title: "碰后飞出桌面 · 平抛",
    description: "双体弹性正碰 → 一物飞出桌沿平抛、另一物反弹同步滑行",
    difficulty: "压轴",
    tags: ["碰撞", "平抛", "动量"],
    imageUrl: "/samples/collision-flight.svg",
    problemText:
      "质量 1 kg 的物块 A 以 5 m/s 在光滑桌面向右运动，前方 4 m 处质量 3 kg 的物块 B 以 1 m/s 同向运动，桌面右沿在 x=5 m，桌面离地 1.25 m。两物块发生弹性正碰，g 取 10 m/s²。求碰后 A、B 的速度；B 飞出桌沿后的落地时间与水平位移；A 碰后向哪个方向运动？",
    message: "碰后 B 从桌沿飞出做平抛，A 反弹向左滑行，两条轨道同时播放",
    assumptions: ["g=10 m/s²", "桌面光滑", "碰撞外冲量可忽略"],
    questions: [
      {
        label: "(1) 碰后速度",
        eventKind: "collision",
        formula: "v_A' = (m_A−m_B)v_A/(m_A+m_B) + 2m_B·v_B/(m_A+m_B)；v_B' 对称",
        substitution: "v_A' = (1−3)×5/4 + 2×3×1/4 = −1 m/s；v_B' = 2×1×5/4 + (3−1)×1/4 = 3 m/s",
      },
      {
        label: "(2) 平抛落地",
        eventKind: "land",
        formula: "t = √(2h/g)，x = v_B'·t",
        substitution: "t = √(2×1.25/10) = 0.5 s；x = 3×0.5 = 1.5 m",
      },
      {
        label: "(3) A 的方向",
        eventKind: "collision",
        formula: "v_A' 符号即方向",
        substitution: "v_A' = −1 m/s < 0 → 碰后 A 反弹向左滑行",
      },
    ],
    practice: [
      {
        prompt: "弹性正碰后，物块 A 的运动方向是？",
        options: ["向左反弹", "继续向右但变慢", "立即静止"],
        answer: 0,
        explain: "m_A < m_B 时轻球碰重球反弹：v_A' = −1 m/s，方向向左。",
      },
    ],
    reading: collisionFlight as WorkspaceReading,
  },
  {
    id: "gaokao-incline-arc-horiz-spring",
    title: "斜面 · 圆弧过渡 · 粗糙水平 · 弹簧回弹",
    description: "4 阶段 4 模型：粗糙斜面 → 光滑圆弧 → 粗糙水平 → 粗糙弹簧压缩回弹 + 实时能量",
    difficulty: "压轴",
    tags: ["斜面", "圆弧", "粗糙弹簧"],
    imageUrl: "/samples/gaokao-incline-arc-horiz-spring.svg",
    problemText:
      "倾角 θ=37°、长 L₁=5 m 的粗糙斜面 AB（μ₁=0.25）下端 B 与半径 R=2.5 m、圆心角 37° 的光滑圆弧轨道 BC 相切，C 点切线水平并接长 L₂=3 m 的粗糙水平轨道 CD（μ₂=0.20）。D 点右侧水平面动摩擦因数 μk=0.15、静摩擦因数 μs=0.20，固定一原长左端恰在 D 点的轻弹簧（k=60 N/m）。质量 m=1 kg 的滑块从 A 点由静止释放，滑块与弹簧不连接，g 取 10 m/s²。求：(1) 滑块经过 C 点的速率及对轨道压力；(2) 弹簧最大压缩量、是否回弹脱离及全过程摩擦产热。",
    message: "斜面 + 圆弧 + 粗糙水平 + 粗糙弹簧四段串联，画布底部同钟显示机械能与摩擦耗能",
    assumptions: ["g=10 m/s²", "圆弧 BC 光滑", "滑块与弹簧不连接"],
    questions: [
      {
        label: "(1) C 点速率与压力",
        eventKind: "arc_endpoint",
        formula: "mgL₁(sinθ−μ₁cosθ) + mgR(1−cosθ) = ½mv_C²；N = m(g + v_C²/R)",
        substitution: "sin37°=0.6、cos37°=0.8：v_C² = 2×10×5×(0.6−0.2) + 2×10×2.5×0.2 = 50；N = 1×(10+50/2.5) = 30 N",
      },
      {
        label: "(2) 最大压缩与产热",
        eventKind: "max_compression",
        formula: "½mv_D² = ½kx² + μk·mg·x；Q = Σ f·s",
        substitution: "v_D² = v_C² − 2μ₂gL₂ = 50−12 = 38；30x² + 1.5x − 19 = 0 解出 x；产热含斜面/水平/弹簧段三段摩擦功",
      },
    ],
    practice: [
      {
        prompt: "滑块把弹簧压到最短后，接下来会？",
        options: ["被弹回并最终脱离弹簧", "停在最大压缩处不动", "与弹簧一起简谐振动不停"],
        answer: 0,
        explain: "最大压缩处弹力 kx 远大于最大静摩擦 μs·mg，故回弹；脱离后摩擦使其最终停下。",
      },
    ],
    reading: inclineArcHorizSpring as WorkspaceReading,
  },
  {
    id: "gaokao-spring-arc-proj-incline",
    title: "弹簧弹射 · 圆弧跳台 · 斜抛 · 切向入斜坡",
    description: "5 阶段 5 模型：预压弹簧 → 水平 → 45° 圆弧飞出 → 斜抛过最高点 → 53° 粗糙斜坡",
    difficulty: "压轴",
    tags: ["预压弹簧", "圆弧跳台", "斜抛入坡"],
    imageUrl: "/samples/gaokao-spring-arc-proj-incline.svg",
    problemText:
      "水平粗糙轨道 AB 长 L₁=3 m（μ₁=0.1），左端固定劲度系数 k=500 N/m 的轻弹簧，右端 B 与半径 R=2 m、圆心角 45° 的光滑上仰圆弧跳台 BC 相切。质量 m=0.5 kg 的小滑块将弹簧压缩 x₀=0.22 m 后在 A 点由静止释放，从 C 点飞出做斜抛运动，恰在与 AB 等高的 D 点沿切线滑入倾角 53°、长 L₂=4 m 的粗糙斜坡 DE（μ₂=0.2），g 取 10 m/s²。求：(1) 到达跳台顶端 C 点的速度与支持力；(2) 斜抛最高点高度及滑至斜坡底端 E 时的速度。",
    message: "五段五模型一镜到底：预压释放 → 水平滑行 → 圆弧腾空 → 斜抛最高点 → 切向入斜坡",
    assumptions: ["g=10 m/s²", "圆弧跳台 BC 光滑", "忽略空气阻力"],
    questions: [
      {
        label: "(1) C 点速度与支持力",
        eventKind: "arc_endpoint",
        formula: "½kx₀² − μ₁mgL₁ − mgR(1−cos45°) = ½mv_C²；N = m·v_C²/R − mg·cos45°",
        substitution: "½×500×0.22² = 12.1 J；扣摩擦 1.5 J 与抬升 2.93 J 后得 v_C；N 与画布法向力同钟",
      },
      {
        label: "(2) 斜抛最高点与 E 点速度",
        eventKind: "apex",
        formula: "H = (v_C·sin45°)²/(2g) + R(1−cos45°)；½mv_E² = ½mv_D² + mg·h_DE − μ₂mg·cos53°·L₂",
        substitution: "入坡 D 与 AB 等高 → 斜抛净升 0；H 即跳台顶以上升高的部分；E 点速度由坡上功能关系求得",
      },
    ],
    practice: [
      {
        prompt: "斜抛轨迹最高点相对水平轨道 AB 的高度？",
        options: ["大于 0（跳台已把滑块抬高）", "等于 0", "小于 0"],
        answer: 0,
        explain: "45° 跳台出口 C 已高于 AB 约 R(1−cos45°)，斜抛再升一段，最高点必然高于 AB。",
      },
    ],
    reading: springArcProjIncline as WorkspaceReading,
  },
  {
    id: "conveyor-accel",
    title: "传送带 · 轻放留痕后滑离带端平抛",
    imageUrl: "/samples/conveyor-accel.svg",
    problemText:
      "水平传送带以 2 m/s 匀速运行，带长 2 m、带端离地 1.25 m。将物块无初速轻放于带面左端，物块与带面间 μ = 0.2，g = 10 m/s²。求：(1) 物块相对带面留下的滑动痕迹长度；(2) 物块滑离带端时的速度；(3) 落地点到带端的水平距离。",
    message: "已载入传送带组合示例：先相对滑动留痕，共速后滑离带端做平抛。",
    description: "物块轻放后先打滑留痕，共速随带匀速到带端，再平抛落地——摩擦、相对运动与抛体三模型串联。",
    difficulty: "压轴",
    tags: ["传送带", "摩擦", "平抛"],
    assumptions: ["g = 10 m/s²", "μ = 0.2，带速 2 m/s 恒定", "带长 2 m、带端离地 1.25 m"],
    questions: [
      {
        label: "(1) 痕迹长度",
        timeSeconds: 1,
        formula: "Δx = v带·t − ½·μg·t²，t = v带/(μg)",
        substitution: "t = 2/2 = 1 s；Δx = 2×1 − ½×2×1² = 1 m",
      },
      {
        label: "(2) 离带速度",
        eventKind: "conveyor_exit",
        formula: "共速后随带匀速；带长 2 m = 打滑 1 m + 共速 1 m",
        substitution: "共速后再走 1 m 恰离带 → v = 2 m/s",
      },
      {
        label: "(3) 平抛射程",
        eventKind: "land",
        formula: "t = √(2h/g)，x = v·t",
        substitution: "t = √(2×1.25/10) = 0.5 s；x = 2×0.5 = 1 m",
      },
    ],
    practice: [
      {
        prompt: "若把带长改为 1 m，物块滑离带端时的速度是？",
        options: ["√2 m/s ≈ 1.4 m/s", "2 m/s", "4 m/s"],
        answer: 0,
        explain: "1 m 内物块一直打滑（共速需 1 m 恰好边界之外），v = √(2·μg·s) = √(2×2×1) = √2 m/s。",
      },
    ],
    compare: {
      label: "看带速 4 m/s",
      backLabel: "回到带速 2 m/s",
      reading: {
        ...conveyorAccel,
        stages: [
          {
            ...(conveyorAccel.stages[0] as object),
            initialBeltSpeedMps: 4,
            segments: [{ accelerationMps2: 0, durationSeconds: null }],
            beltLengthM: 2,
            continuationExitEdge: "end",
          },
          { kind: "projectile", dropHeightM: 1.25 },
        ],
      } as WorkspaceReading,
    },
    reading: {
      ...conveyorAccel,
      stages: [
        {
          ...(conveyorAccel.stages[0] as object),
          segments: [{ accelerationMps2: 0, durationSeconds: null }],
          beltLengthM: 2,
          continuationExitEdge: "end",
        },
        { kind: "projectile", dropHeightM: 1.25 },
      ],
    } as WorkspaceReading,
  },
  {
    id: "magnetic-deflection",
    title: "组合场 · 磁场偏转后平抛落回地面",
    imageUrl: "/samples/magnetic-deflection.svg",
    problemText:
      "宽 1 m 的匀强磁场区域下边界贴地面，B = 1 T、方向垂直纸面向里。带电粒子 m = 1×10⁻³ kg、q = +1×10⁻³ C 以 2 m/s 沿地面水平射入，磁区内忽略重力；穿出磁场后只受重力 g = 10 m/s²。求：(1) 磁中轨道半径；(2) 偏转角与出射速度；(3) 落地点到入射点的水平距离。",
    message: "已载入组合场示例：磁中圆周偏转 30°，出磁后重力接管平抛落回地面。",
    description: "洛伦兹力只改方向不改速率；出磁场后重力接管——圆周+抛体串联的组合场压轴。",
    difficulty: "压轴",
    tags: ["磁场", "洛伦兹力", "组合场", "平抛"],
    assumptions: ["磁区内忽略重力", "B = 1 T 垂直纸面向里", "出磁后 g = 10 m/s²，地面 y = 0"],
    questions: [
      {
        label: "(1) 轨道半径",
        eventKind: "magnetic_enter",
        formula: "R = mv/(|q|B)",
        substitution: "R = 1×10⁻³×2 / (1×10⁻³×1) = 2 m",
      },
      {
        label: "(2) 偏转角与出射速度",
        eventKind: "magnetic_exit",
        formula: "sinθ = W/R；出射速率不变",
        substitution: "sinθ = 1/2 → θ = 30°；v = (√3, 1) m/s，速率仍 2 m/s",
      },
      {
        label: "(3) 落点水平距离",
        eventKind: "land",
        formula: "h = R(1−cosθ)；t = (v_y + √(v_y² + 2gh))/g；x = W + v_x·t",
        substitution: "h = 2−√3 ≈ 0.27 m；t ≈ 0.35 s；x ≈ 1 + 0.61 = 1.61 m",
      },
    ],
    practice: [
      {
        prompt: "若把磁感应强度加倍（B = 2 T），粒子还能穿出右边界吗？",
        options: ["不能，半径减半后转半圆从入口侧返回", "能，偏转角变小", "能，偏转角变大"],
        answer: 0,
        explain: "R = mv/(qB) 减半为 1 m，等于区域宽度时恰好切向；再大一点的 B 就穿不出，转半圆返回。",
      },
    ],
    compare: {
      label: "看 B = 2 T",
      backLabel: "回到 B = 1 T",
      reading: {
        ...magneticDeflection,
        gravityMps2: 10,
        stages: [
          { ...(magneticDeflection.stages[0] as object), magneticTeslaB: 2 },
          { kind: "projectile", landingPlaneYM: 0 },
        ],
      } as WorkspaceReading,
    },
    reading: {
      ...magneticDeflection,
      gravityMps2: 10,
      stages: [
        magneticDeflection.stages[0],
        { kind: "projectile", landingPlaneYM: 0 },
      ],
    } as WorkspaceReading,
  },
  {
    id: "pulley-ground-slack",
    title: "连接体 · 斜面桌面着地绳松弛后冲上斜面",
    imageUrl: "/samples/pulley-ground-slack.svg",
    problemText:
      "倾角 37° 的粗糙斜面桌面上滑块 m₁ = 2 kg（μ = μs = 0.25），经轻绳绕过理想定滑轮与 m₂ = 4 kg 的悬挂物相连，悬挂物离地 2 m，斜面足够长。系统由静止释放（sin37° = 0.6、cos37° = 0.8）。求：(1) 共同加速度；(2) 悬挂物着地瞬间的速度；(3) 绳松弛后滑块沿斜面上滑的最大距离；(4) 滑块到最高点后能否自行返回。",
    message: "已载入连接体压轴示例：斜面共加速 → 着地绳松弛 → 沿斜面上滑到瞬时零速边界。",
    description: "绳只能拉不能推：着地后张力归零，滑块凭惯性冲上斜面减速到零；能否返回由 μ 与 tanθ 比较判断。",
    difficulty: "压轴",
    tags: ["连接体", "绳松弛", "斜面"],
    assumptions: ["g = 10 m/s²，sin37° = 0.6、cos37° = 0.8", "轻绳不可伸长、滑轮理想", "μ = μs = 0.25，悬挂物离地 2 m"],
    questions: [
      {
        label: "(1) 共同加速度",
        timeSeconds: 0.5,
        formula: "a = (m₂g − m₁g·sinθ − μm₁g·cosθ)/(m₁ + m₂)",
        substitution: "a = (40 − 12 − 4)/6 = 4 m/s²",
      },
      {
        label: "(2) 着地瞬间速度",
        timeSeconds: 1,
        formula: "v = √(2ah)",
        substitution: "v = √(2×4×2) = 4 m/s",
      },
      {
        label: "(3) 上滑最大距离",
        eventKind: "string_slack",
        formula: "绳松弛 T = 0；a上 = g·sinθ + μg·cosθ；s = v²/(2a上)",
        substitution: "a上 = 6 + 2 = 8 m/s²；s = 16/16 = 1 m",
      },
      {
        label: "(4) 能否自行返回",
        eventKind: "turn_around",
        formula: "μ < tanθ 时重力分量胜过最大静摩擦",
        substitution: "0.25 < tan37° = 0.75 → 能返回（下滑 a = 4 m/s²）；演示播放到瞬时零速边界",
      },
    ],
    practice: [
      {
        prompt: "悬挂物着地后，滑块沿斜面还能上滑多远？",
        options: ["1 m", "2 m", "0.5 m"],
        answer: 0,
        explain: "着地时 v = 4 m/s；上滑减速度 g·sinθ + μg·cosθ = 8 m/s²，s = v²/(2a) = 1 m。",
      },
    ],
    compare: {
      label: "看光滑斜面",
      backLabel: "回到 μ = 0.25",
      reading: {
        ...pulleyGroundSlack,
        bodies: [
          { bodyId: "block", massKg: 2 },
          { bodyId: "hanging", massKg: 4 },
        ],
        stages: [
          {
            ...(pulleyGroundSlack.stages[0] as object),
            surface: { kind: "incline", angleDeg: 37, kineticFrictionCoefficient: 0, staticFrictionCoefficient: 0, slidesAfterRelease: true },
            body2DropToGroundM: 2,
          },
        ],
      } as WorkspaceReading,
    },
    reading: {
      ...pulleyGroundSlack,
      bodies: [
        { bodyId: "block", massKg: 2 },
        { bodyId: "hanging", massKg: 4 },
      ],
      stages: [
        {
          ...(pulleyGroundSlack.stages[0] as object),
          surface: { kind: "incline", angleDeg: 37, kineticFrictionCoefficient: 0.25, staticFrictionCoefficient: 0.25, slidesAfterRelease: true },
          body2DropToGroundM: 2,
        },
      ],
    } as WorkspaceReading,
  },
  {
    id: "movable-arc-spring",
    title: "可移动圆弧槽 · 球离槽经弹簧恰好不再滑上",
    imageUrl: "/samples/movable-arc-spring.svg",
    problemText:
      "质量 M = 3.0 kg、半径 R = 0.6 m 的四分之一光滑圆弧槽静置于光滑水平地面上，可自由滑动。m₁ = 1 kg 的小球从槽顶端由静止释放；m₂ 右侧与球心等高处连接一轻质弹簧，弹簧另一端自由，m₂ 质量未知。已知 m₁ 恰好不能再次滑上圆弧槽，g = 10 m/s²。求：(1) m₁ 离开圆弧槽时槽的速度 v₁；(2) m₂ 的质量；(3) 弹簧被压缩过程中弹性势能的最大值 Ep。",
    message: "已载入可移动圆弧槽压轴示例：球槽动量守恒分离 → 自由弹簧双球弹性作用 → 恰好不再滑上反求 m₂。",
    description: "槽不固定：水平动量守恒让球与槽反向分离；弹簧不锚墙：共速时压缩最大；「恰好不再滑上」把分离速度钉在槽速上反求 m₂。",
    difficulty: "压轴",
    tags: ["圆弧槽", "动量守恒", "弹簧双球", "临界反求"],
    assumptions: ["g = 10 m/s²，地面与槽面均光滑", "弹簧轻质、另一端自由，作用弹性无耗散", "k 取 100 N/m（题未给，仅影响过程时长）"],
    questions: [
      {
        label: "(1) 离槽时槽的速度",
        eventKind: "movable_arc_exit",
        formula: "m·v球 = M·V槽；mgR = ½mv球² + ½MV槽²",
        substitution: "v球 = √(2gRM/(M+m)) = 3 m/s；V槽 = m·v球/M = 1 m/s（反向）",
      },
      {
        label: "(2) m₂ 的质量",
        eventKind: "spring_pair_separate",
        formula: "恰好不再滑上 → 分离后 m₁ 速率 = 槽速 1 m/s；m₂ = m₁(u+s)/(u−s)",
        substitution: "m₂ = 1×(3+1)/(3−1) = 2 kg",
      },
      {
        label: "(3) 最大弹性势能",
        eventKind: "spring_pair_max_compression",
        formula: "共速 v = m₁u/(m₁+m₂)；Ep = ½m₁u² − ½(m₁+m₂)v²",
        substitution: "v = 3/3 = 1 m/s；Ep = 4.5 − 1.5 = 3 J",
      },
    ],
    practice: [
      {
        prompt: "球离槽之后，圆弧槽做什么运动？",
        options: ["以 1 m/s 匀速直线运动", "立即静止", "继续加速"],
        answer: 0,
        explain: "地面光滑、水平方向无外力：槽保持离槽瞬间的 1 m/s 匀速运动，这正是「恰好不再滑上」的比较基准。",
      },
    ],
    compare: {
      label: "看 m₂ = 3 kg",
      backLabel: "回到反求 m₂ = 2 kg",
      reading: {
        ...movableArcSpring,
        stages: [
          movableArcSpring.stages[0],
          { ...(movableArcSpring.stages[1] as object), targetMassKg: 3, separationSpeedMps: null },
        ],
      } as WorkspaceReading,
    },
    reading: movableArcSpring as WorkspaceReading,
  },
  {
    id: "circular-orbit",
    title: "万有引力 · 近地圆轨道卫星",
    description: "单段圆轨：由引力参数 GM 与轨道半径求线速度、周期与向心加速度，重点看 r 与 (R+h) 的区别。",
    difficulty: "基础",
    tags: ["万有引力", "圆轨道", "天体运动"],
    imageUrl: "/samples/circular-orbit.svg",
    problemText:
      "地球半径 R = 6.371×10⁶ m，一颗人造卫星在离地高度 h = 4.0×10⁵ m 的圆轨道上运行。已知地球的引力参数 GM = 3.986×10¹⁴ m³/s²。求：(1) 卫星的轨道半径 r；(2) 卫星的线速度大小 v；(3) 卫星运行的周期 T；(4) 卫星的向心加速度 a。",
    message: "已建立圆轨模型：轨道半径取 R + h，线速度、周期与向心加速度由物理库按 GM 计算，可播放一整周。",
    assumptions: ["GM = 3.986×10¹⁴ m³/s²", "圆轨道，忽略空气阻力与摄动", "轨道半径 r = R + h"],
    questions: [
      {
        label: "(1) 轨道半径",
        formula: "r = R + h",
        substitution: "r = 6.371×10⁶ + 4.0×10⁵ = 6.771×10⁶ m",
      },
      {
        label: "(2) 线速度",
        eventKind: "orbit_half",
        formula: "GMm/r² = mv²/r → v = √(GM/r)",
        substitution: "v = √(3.986×10¹⁴ / 6.771×10⁶) ≈ 7.67×10³ m/s",
      },
      {
        label: "(3) 周期",
        eventKind: "orbit_complete",
        formula: "T = 2πr/v = 2π√(r³/GM)",
        substitution: "T ≈ 5.54×10³ s ≈ 92.4 min",
      },
    ],
    practice: [
      {
        prompt: "把卫星高度从 400 km 抬到 800 km，运行周期会怎样变化？",
        options: ["变长", "变短", "不变"],
        answer: 0,
        explain: "T ∝ r^(3/2)，轨道半径变大周期变长——这正是高轨卫星周期更长的原因。",
      },
    ],
    reading: circularOrbit as WorkspaceReading,
  },
  {
    id: "binary-circular-orbit",
    title: "双星系统 · 绕共同质心同步运行",
    description: "双星模型：半径按质量反比分配、周期必然相同，看质心如何把两星「锁」在一起。",
    difficulty: "中档",
    tags: ["双星", "万有引力", "质心"],
    imageUrl: "/samples/binary-circular-orbit.svg",
    problemText:
      "两颗恒星质量分别为 m₁ = 2×10³⁰ kg 和 m₂ = 1×10³⁰ kg，相距 L = 3×10⁹ m，仅在相互引力作用下绕它们连线上的某点做匀速圆周运动。已知 G = 6.674×10⁻¹¹ N·m²/kg²。求：(1) 两星各自的轨道半径 r₁、r₂；(2) 系统的共同周期 T；(3) 两星的线速度大小 v₁、v₂。",
    message: "已建立双星模型：质心固定在两星连线上，半径按质量反比分配，两星同步绕质心运行一整周。",
    assumptions: ["G = 6.674×10⁻¹¹ N·m²/kg²", "仅受相互引力，忽略其他天体影响", "两星始终分居质心两侧且共线"],
    questions: [
      {
        label: "(1) 轨道半径",
        formula: "r₁ = m₂L/(m₁+m₂)，r₂ = m₁L/(m₁+m₂)",
        substitution: "r₁ = 1×10³⁰×3×10⁹/3×10³⁰ = 1×10⁹ m；r₂ = 2×10⁹ m（r₁:r₂ = m₂:m₁）",
      },
      {
        label: "(2) 共同周期",
        eventKind: "orbit_half",
        formula: "Gm₁m₂/L² = m₁ω²r₁ → T = 2π√(L³/(G(m₁+m₂)))",
        substitution: "T = 2π√((3×10⁹)³/(6.674×10⁻¹¹×3×10³⁰)) ≈ 7.30×10⁴ s ≈ 20.3 h",
      },
      {
        label: "(3) 线速度",
        eventKind: "orbit_complete",
        formula: "v = 2πr/T",
        substitution: "v₁ ≈ 8.61×10⁴ m/s，v₂ ≈ 1.72×10⁵ m/s（v₁:v₂ = m₂:m₁）",
      },
    ],
    practice: [
      {
        prompt: "若 m₁ 增大到 3×10³⁰ kg 而 L 不变，共同周期会怎样？",
        options: ["变短", "变长", "不变"],
        answer: 0,
        explain: "T ∝ 1/√(m₁+m₂)，总质量变大、引力更强，周期变短。",
      },
    ],
    reading: binaryCircularOrbit as WorkspaceReading,
  },
  {
    id: "constant-force-three-stage",
    title: "恒力一维 · 加速—匀速—减速后平抛",
    description: "三段恒力推进：牛顿第二定律逐段求速度与位移，末段从桌沿平抛落地。",
    difficulty: "基础",
    tags: ["匀变速", "恒力", "平抛"],
    imageUrl: "/samples/constant-force-three-stage.svg",
    problemText:
      "质量 m = 1.5 kg 的物块静止在光滑水平桌面上，先受水平恒力 F₁ = 3 N 作用 2 s；撤去 F₁ 后匀速运动 1.5 s；再受与运动方向相反的恒力 F₂ = 1.5 N 作用 2 s；随后从桌沿水平飞出。桌面离地 h = 0.8 m，g = 10 m/s²。求：(1) 三段末的速度；(2) 物块离开桌沿时的速度；(3) 落地点到桌沿的水平距离。",
    message: "已按恒力一维建模：逐段由牛顿第二定律与运动学推进，末段从桌沿平抛落地。",
    assumptions: ["桌面光滑，忽略空气阻力", "g = 10 m/s²", "两段恒力均沿运动所在直线"],
    questions: [
      {
        label: "(1) 第 1 段末（2 s）",
        timeSeconds: 2,
        formula: "a₁ = F₁/m，v = a₁t",
        substitution: "a₁ = 3/1.5 = 2 m/s²；v = 2×2 = 4 m/s，位移 4 m",
      },
      {
        label: "(2) 第 2 段末（3.5 s）",
        timeSeconds: 3.5,
        formula: "F = 0 → 匀速",
        substitution: "v 仍为 4 m/s，再走 4×1.5 = 6 m",
      },
      {
        label: "(3) 第 3 段末（5.5 s）",
        timeSeconds: 5.5,
        formula: "a₂ = −F₂/m，v = v₀ + a₂t",
        substitution: "a₂ = −1 m/s²；v = 4 − 1×2 = 2 m/s，再走 4 m",
      },
      {
        label: "(4) 平抛射程",
        eventKind: "land",
        formula: "t = √(2h/g)，x = v·t",
        substitution: "t = √(2×0.8/10) = 0.4 s；x = 2×0.4 = 0.8 m",
      },
    ],
    practice: [
      {
        prompt: "若第 3 段的反向力改为 3 N，物块会怎样？",
        options: ["2 s 内速度减到零后反向", "仍以 2 m/s 离开桌沿", "一直匀速"],
        answer: 0,
        explain: "a = −3/1.5 = −2 m/s²，2 s 后速度 4 − 4 = 0，恰好减到零（临界），不会飞出桌沿。",
      },
    ],
    reading: constantForceThreeStage as WorkspaceReading,
  },
  {
    id: "conveyor-movable-semicircle",
    title: "传送带加速 · 冲上可平动半圆槽",
    description: "斜面—传送带—可平动半圆槽三连：水平动量守恒，槽被滑块推着反向运动。",
    difficulty: "压轴",
    tags: ["传送带", "可平动槽", "动量守恒"],
    imageUrl: "/samples/conveyor-movable-semicircle.svg",
    problemText:
      "滑块质量 m = 0.2 kg，从长 1.6 m、倾角 30° 的光滑斜面顶端由静止下滑，经坡底光滑转向后滑上以 5 m/s 匀速运行的传送带，滑块与带面间动摩擦因数 μ = 0.25。滑块离开传送带后滑上质量 M = 1.8 kg、半径 R = 0.36 m 的可平动光滑半圆槽，槽与地面均光滑。g = 10 m/s²。求：(1) 滑块到达坡底的速度；(2) 滑块在传送带上加速到与带共速所经过的距离；(3) 滑块到达槽顶时滑块与槽的速度。",
    message: "已按斜面—传送带—可平动半圆槽串联建模：水平方向动量守恒，槽随滑块反向运动。",
    assumptions: ["g = 10 m/s²", "斜面、槽面与地面光滑，传送带 μ = 0.25", "槽只做平动，不翻转"],
    questions: [
      {
        label: "(1) 到达坡底",
        eventKind: "reach_bottom",
        formula: "mgL·sinθ = ½mv²",
        substitution: "v = √(2×10×1.6×0.5) = 4 m/s",
      },
      {
        label: "(2) 加速到共速的位移",
        eventKind: "conveyor_common_velocity",
        formula: "a = μg，Δx = (v带² − v²)/(2a)",
        substitution: "a = 2.5 m/s²；Δx = (25 − 16)/(2×2.5) = 1.8 m",
      },
      {
        label: "(3) 槽顶时两者速度",
        eventKind: "movable_semicircle_top",
        formula: "动量守恒 + 机械能守恒（槽顶高 2R）",
        substitution: "mv₀ = mv + MV，½mv₀² = ½mv² + ½MV² + mg·2R → v = −2.2 m/s（向左），V = 0.8 m/s（向右）",
      },
    ],
    practice: [
      {
        prompt: "滑块沿槽上升的过程中，槽的速度如何变化？",
        options: ["一直增大", "先增大后不变", "一直为零"],
        answer: 0,
        explain: "水平方向系统动量守恒，滑块向右速度减小、槽向右速度增大，直到滑块到达槽顶。",
      },
    ],
    reading: conveyorMovableSemicircle as WorkspaceReading,
  },
  {
    id: "magnetic-reencounter",
    title: "匀强磁场 · 两粒子正碰后再相遇",
    description: "同种电荷同向偏转：半径随速率变、周期只由比荷决定，看多次正碰如何形成周期性相遇。",
    difficulty: "压轴",
    tags: ["磁场", "带电粒子", "正碰"],
    imageUrl: "/samples/magnetic-reencounter.svg",
    problemText:
      "如图，xOy 平面内 x > 0 的区域存在垂直纸面向里的匀强磁场，磁感应强度为 B。粒子 A、B 的电荷量均为 +q，质量分别为 2m 和 m。粒子 A 从 P(2a, 0) 沿 +y 方向以速率 v 射入磁场，粒子 B 静止在原点 O。A 经过半个周期后与 B 发生正碰，碰后 A 的速率变为碰前的 3 倍且方向反向。忽略重力与粒子间的库仑力。求：(1) A 碰前的轨道半径；(2) A 的周期与 B 的周期之比；(3) 两粒子此后再次相遇的时刻与位置。",
    message: "已按同种电荷同向偏转建模：两粒子在磁场中多次正碰，按归一化标度演示 18π 内的完整过程。",
    assumptions: ["题设用符号 m、q、B、a，按归一化标度 1 演示", "忽略重力与粒子间库仑力", "碰撞为弹性正碰，碰撞时间极短"],
    questions: [
      {
        label: "(1) 碰前轨道半径",
        formula: "qvB = mv²/r → r = mv/(qB)",
        substitution: "A 的质量为 2m，r_A = 2mv/(qB)；由 P(2a,0) 与 O 相切得 r_A = a，即 v = qBa/(2m)",
      },
      {
        label: "(2) 周期之比",
        formula: "T = 2πm/(qB)",
        substitution: "T_A : T_B = 2m : m = 2 : 1（周期与速率无关，只由比荷决定）",
      },
      {
        label: "(3) 碰后再相遇",
        eventKind: "magnetic_collision",
        formula: "碰后 v_A′ = 3v → r_A′ = 3a；两粒子各自做圆周运动，轨迹交点即相遇点",
        substitution: "每次相遇间隔由两粒子转过角度差决定，动画按 18π 观察 9 次正碰",
      },
    ],
    practice: [
      {
        prompt: "若把 A 的入射速率加倍，A 在磁场中的周期会怎样？",
        options: ["不变", "变为 2 倍", "变为一半"],
        answer: 0,
        explain: "T = 2πm/(qB) 与速率无关；速率加倍只让半径加倍，周期不变。",
      },
    ],
    reading: magneticReencounter as WorkspaceReading,
  },
  {
    id: "pendulum-collision",
    title: "弹性正碰 · 碰后摆球上摆",
    description: "一维弹性碰撞 + 单摆：碰后滑块反向、摆球上摆，用能量守恒求最大高度与摆角。",
    difficulty: "中档",
    tags: ["弹性碰撞", "单摆", "能量守恒"],
    imageUrl: "/samples/pendulum-collision.svg",
    problemText:
      "质量 m₁ = 1 kg 的滑块以 v₀ = 2 m/s 在光滑水平面上向右运动，与静止的 m₂ = 3 kg 小球发生弹性正碰。小球用长 L = 1 m 的轻绳悬挂于 O 点，碰后小球在竖直平面内摆动。g = 10 m/s²。求：(1) 碰后滑块与小球的速度；(2) 小球摆起的最大高度；(3) 最大摆角。",
    message: "已按弹性正碰 + 单摆建模：碰后滑块反向匀速，小球上摆到最高点后转折。",
    assumptions: ["g = 10 m/s²", "水平面光滑，轻绳不可伸长", "碰撞为弹性正碰，时间极短"],
    questions: [
      {
        label: "(1) 碰后速度",
        eventKind: "collision",
        formula: "v₁′ = (m₁−m₂)v₀/(m₁+m₂)，v₂′ = 2m₁v₀/(m₁+m₂)",
        substitution: "v₁′ = (1−3)×2/4 = −1 m/s（反向）；v₂′ = 2×1×2/4 = 1 m/s",
      },
      {
        label: "(2) 最大高度",
        eventKind: "pendulum_turn",
        formula: "½m₂v₂′² = m₂gh → h = v₂′²/(2g)",
        substitution: "h = 1²/(2×10) = 0.05 m",
      },
      {
        label: "(3) 最大摆角",
        formula: "cosθ = 1 − h/L",
        substitution: "cosθ = 1 − 0.05/1 = 0.95 → θ ≈ 18.2°",
      },
    ],
    practice: [
      {
        prompt: "若把 m₂ 换成 1 kg（等质量弹性正碰），碰后滑块会怎样？",
        options: ["静止，速度全部传给小球", "以 1 m/s 继续前进", "以 2 m/s 反向弹回"],
        answer: 0,
        explain: "等质量弹性正碰发生速度交换：滑块停下，小球以 2 m/s 摆起。",
      },
    ],
    reading: horizontalCollisionPendulum as WorkspaceReading,
  },
  {
    id: "emf-rail-friction",
    title: "电磁感应 · 粗糙导轨上导体棒的减速",
    description: "单杆切割磁感线：安培力随速度减小而减弱，只有摩擦才能让棒真正停下，焦耳热要用能量守恒扣掉摩擦热。",
    difficulty: "中档",
    tags: ["电磁感应", "安培力", "电荷量", "焦耳热"],
    imageUrl: "/samples/emf-rail-friction.svg",
    problemText:
      "如图，水平平行导轨间距 L = 1.0 m，处在磁感应强度 B = 0.5 T、方向垂直纸面向里的匀强磁场中，导轨左端接有 R = 0.4 Ω 的电阻（导轨与棒的电阻不计）。质量 m = 0.2 kg 的导体棒垂直于导轨，以 v₀ = 10 m/s 的初速度沿导轨向右滑上磁场区域，棒与导轨间的动摩擦因数 μ = 0.1，g 取 10 m/s²。求：(1) 棒刚滑上导轨时回路中的电流 I₀ 与棒所受安培力 F₀；(2) 棒最终停下时滑行的总距离 x 与通过回路的总电荷量 q；(3) 全过程回路中产生的焦耳热 Q。",
    message:
      "已建立电磁感应导轨模型：阻尼系数 B²L²/R = 0.625 N·s/m，特征时间 mR/(B²L²) = 0.32 s；安培力单独作用只能让速度指数趋近于零，是摩擦使棒在有限时间内停下。",
    assumptions: [
      "导轨水平且足够长，磁场垂直导轨平面向里",
      "回路总电阻恒为 R = 0.4 Ω，忽略自感与端点效应",
      "g = 10 m/s²，动摩擦因数 μ 恒定，棒始终垂直于导轨",
    ],
    questions: [
      {
        label: "(1) 初始电流与安培力",
        formula: "ε₀ = BLv₀，I₀ = ε₀/R，F₀ = BI₀L",
        substitution: "ε₀ = 0.5×1.0×10 = 5 V；I₀ = 5/0.4 = 12.5 A；F₀ = 0.5×12.5×1.0 = 6.25 N（方向向左）",
      },
      {
        label: "(2) 总位移与总电荷量",
        eventKind: "emf_stop",
        formula: "m·dv/dt = −(B²L²/R)v − μmg → x = v_t t + (v₀−v_t)(1−e^(−λt))/λ；q = BLx/R",
        substitution:
          "λ = B²L²/(mR) = 3.125 s⁻¹，v_t = −μmgR/(B²L²) = −0.32 m/s，解得 t = 1.11 s、x = 2.84 m；q = 0.5×1.0×2.84/0.4 = 3.56 C",
      },
      {
        label: "(3) 焦耳热",
        eventKind: "emf_stop",
        formula: "½mv₀² = Q + μmg·x",
        substitution: "Q = ½×0.2×10² − 0.1×0.2×10×2.84 = 10 − 0.57 = 9.43 J（摩擦热仅 0.57 J）",
      },
    ],
    practice: [
      {
        prompt: "若把导轨改成光滑（μ = 0），导体棒最终会怎样？",
        options: ["在有限时间内停下", "速度无限趋近于零但永不真正停下", "保持 10 m/s 匀速运动"],
        answer: 1,
        explain:
          "光滑时只有安培力，v = v₀e^(−λt) 是指数衰减，只在 t → ∞ 时趋近于零；位移趋于 v₀mR/(B²L²) = 3.2 m，焦耳热恰好等于 ½mv₀² = 10 J。",
      },
    ],
    reading: emfRailFriction as WorkspaceReading,
  },
  {
    id: "field-scene-two-particle",
    title: "双粒子跨反向磁场 · 组合场景正演",
    imageUrl: "/samples/field-scene-two-particle.svg",
    problemText:
      "在 xOy 平面内，与 y 轴相距 d 且平行于 y 轴的虚线左侧（0<x<d）有垂直纸面向里的匀强磁场 I，右侧有垂直纸面向外的匀强磁场 II。两完全相同的带负电粒子 a、b 分别沿 +x、+y 方向以等大初速从原点 O 射入。已知 b 第一次经过虚线时速度与 +y 方向夹角 θ 满足 cos θ = 2/5，经磁场 II 偏转后恰好从 P(d, 4√21d/3) 再次进入 I 区。不计重力与粒子间作用。求：(1) B_I : B_II；(2) a 第一次到达 x 轴的位置到 O 的距离。",
    message: "已载入组合磁场场景：两粒子共钟执行，过界换场位置速度连续，观察事件解析求时刻。",
    description: "开放组合接口示范：AI 只写粒子初态 + 分区磁场 + 观察事件；引擎共钟推进、过界换场、精确记录「b 返回左区」「a 首次回 x 轴」。",
    difficulty: "压轴",
    tags: ["组合场景", "磁场偏转", "过界换场", "观察事件"],
    assumptions: ["归一化演示参数 d = 1 m、v₀ = 1 m/s、m = 1 kg、q = −1 C（几何与比值与量纲无关）", "I 区 B = 0.6 T 向里、II 区 B = 0.4 T 向外（即 3:2）", "忽略重力与粒子间相互作用"],
    questions: [
      {
        label: "(1) B_I : B_II",
        eventKind: "field_observer",
        formula: "r₁(1−cos θ) = d → r₁ = 5d/3；P 点弦长 → r₂ = 5d/2；B ∝ 1/r",
        substitution: "B_I : B_II = r₂ : r₁ = 3 : 2",
      },
      {
        label: "(2) a 首次回 x 轴距离",
        eventKind: "field_observer",
        formula: "a 在 I 区与 x 轴相切，于 (d, −d/3) 过界；II 区圆几何求首次 y=0",
        substitution: "x = (15+5√5)d/6 ≈ 4.3634d",
      },
    ],
    practice: [
      {
        prompt: "b 穿越虚线进入 II 区的瞬间，哪些量连续？",
        options: ["位置与速度都连续", "速度方向突变", "速率减半"],
        answer: 0,
        explain: "过界换场只改变受力的磁场参数：位置与速度（含方向、速率）连续，之后按新区 B 重新定圆。",
      },
    ],
    compare: {
      label: "看反求 B（只给角度与 P 点）",
      backLabel: "回到正演 B = 0.6 / 0.4",
      reading: fieldSceneReverseB as unknown as WorkspaceReading,
    },
    reading: fieldSceneTwoParticle as unknown as WorkspaceReading,
  },
  {
    id: "field-scene-reverse-b",
    title: "双粒子跨反向磁场 · 由观察量反求 B",
    imageUrl: "/samples/field-scene-two-particle.svg",
    problemText:
      "同原题图。两磁场大小未知：只知 b 第一次过虚线时速度与 +y 夹角余弦为 2/5，且经 II 区偏转后从 P(d, 4√21d/3) 返回 I 区。把这两个观察量作为约束，反求 B_I 与 B_II（归一化 d=1、v₀=1、m=1、q=−1）。",
    message: "已载入反求示例：constraints 声明观察量目标值，引擎对 |B| 扫描+二分求根后正演复核。",
    description: "反求也是可复用能力：未知 B 填 null + fieldDirection，constraints 指向观察事件与目标值；换一道同类题只改目标数字。",
    difficulty: "压轴",
    tags: ["组合场景", "反求", "约束求根", "磁场偏转"],
    assumptions: ["归一化 d = 1 m、v₀ = 1 m/s、m = 1 kg、q = −1 C", "I 区向里、II 区向外（方向给定，大小待求）", "忽略重力与粒子间相互作用"],
    questions: [
      {
        label: "反求 B_I",
        eventKind: "field_observer",
        formula: "cos θ = 2/5 钉住 r₁ = 5d/3 → B₁ = m v₀/(|q| r₁)",
        substitution: "B_I = 0.6 T（向里）",
      },
      {
        label: "反求 B_II",
        eventKind: "field_observer",
        formula: "P 点 y = 4√21d/3 钉住 r₂ = 5d/2",
        substitution: "B_II = 0.4 T（向外）；比值 3:2",
      },
    ],
    practice: [
      {
        prompt: "反求时为什么可以先求 B_I 再求 B_II？",
        options: ["第一个约束只涉及 I 区内的圆弧", "两个约束互相独立无顺序", "B_II 不影响 b 的轨迹"],
        answer: 0,
        explain: "b 首次过虚线前的轨迹只由 I 区决定，故先解 B_I；返回点约束在 B_I 已知后只含 B_II，顺序求根即可。",
      },
    ],
    reading: fieldSceneReverseB as unknown as WorkspaceReading,
  },
  {
    id: "field-scene-boundary-variant",
    title: "组合场景变体 · 边界外移 + 第三颗粒子",
    imageUrl: "/samples/field-scene-boundary-variant.svg",
    problemText:
      "原题改两处：虚线外移到 d′ = 1.4d（两磁场同比缩放保持 3:2），并加放第三颗完全相同粒子 c 以 45° 方向入射。不改任何代码，只改场景描述：确认三粒子共钟跑通、b 仍从缩放后的 P 点返回、a 首次回 x 轴距离整体缩放 1.4 倍。",
    message: "已载入变体：同一执行接口，只换场景参数（边界、粒子数、入射方向）。",
    description: "组合性验收：两颗改三颗、换边界位置都只是 AI 改场景参数；引擎接口不变。",
    difficulty: "压轴",
    tags: ["组合场景", "变体验收", "多粒子", "过界换场"],
    assumptions: ["d′ = 1.4 m；B_I = 3/7 T 向里、B_II = 2/7 T 向外（保持 3:2）", "c 与 a、b 完全相同，初速方向 45°", "忽略重力与粒子间相互作用"],
    questions: [
      {
        label: "b 返回点（缩放后）",
        eventKind: "field_observer",
        formula: "几何相似：y_P = 4√21d′/3",
        substitution: "y_P ≈ 8.5541 m（= 6.1101 × 1.4）",
      },
      {
        label: "a 首次回 x 轴（缩放后）",
        eventKind: "field_observer",
        formula: "x = (15+5√5)d′/6",
        substitution: "x ≈ 6.1087 m（= 4.3634 × 1.4）",
      },
    ],
    practice: [
      {
        prompt: "加放粒子 c 需要改引擎代码吗？",
        options: ["不需要，只在 particles 里加一条初态", "需要新增一个模型", "需要重写画布"],
        answer: 0,
        explain: "组合接口把「放几颗粒子、各自初态」交给场景描述；执行器对每颗粒子独立共钟推进。",
      },
    ],
    reading: fieldSceneBoundaryVariant as unknown as WorkspaceReading,
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
