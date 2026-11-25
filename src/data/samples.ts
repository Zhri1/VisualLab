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

export type SampleDifficulty = "基础" | "中档" | "压轴";

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
    reading: springArcProjIncline as WorkspaceReading,
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
