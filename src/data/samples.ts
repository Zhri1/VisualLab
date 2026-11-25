/**
 * 内置示例：精选 4 道多过程、多模型串联的高考压轴综合题。
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
            segments: [{ accelerationMps2: 0, durationSeconds: 2 }],
            beltLengthM: 2,
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
          segments: [{ accelerationMps2: 0, durationSeconds: 2 }],
          beltLengthM: 2,
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
