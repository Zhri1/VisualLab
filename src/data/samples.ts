/**
 * 内置示例：精选高考压轴级力学综合题（4 类不同物理模型）。
 *
 * 约定：
 * - 每道题都复用已验收的 fixtures 路径，不引入新物理；
 * - 每道题均附带原题图片（imageUrl）与完整题面（problemText），点右上角「查看原题」可直接看图并放大；
 * - message 为计算摘要，不写死答案，只说明关键约束。
 */
import type { WorkspaceReading } from "../types";
import gaokaoProjArcHorizLoop from "../../fixtures/gaokao-proj-arc-horiz-loop.reading.json";
import collisionFlight from "../../fixtures/horizontal-collision-flight.reading.json";
import conveyorReslide from "../../fixtures/conveyor-reslide.reading.json";
import pulleyGroundSlack from "../../fixtures/pulley-ground-slack.reading.json";

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
    description: "A 点平抛切向入弧 BC，经粗糙 CD 恰好过圆轨最高点 E",
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
    description: "1 kg 与 3 kg 弹性正碰后，一物飞出桌沿平抛、另一物反弹",
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
    id: "gaokao-conveyor-reslide",
    title: "变速传送带 · 共速后再滑动",
    description: "滑块被传送带加速追上共速，带加速度突增后突破静摩擦再次相对滑动",
    difficulty: "压轴",
    tags: ["传送带", "摩擦切换", "双参考系"],
    imageUrl: "/samples/gaokao-conveyor-reslide.svg",
    problemText:
      "足够长的水平传送带在 t=0 时刻以初速度 v₀=2 m/s 向右运行，同时将一小滑块由静止轻放在传送带左端。0~3 s 内传送带以 a₁=1 m/s² 匀加速运动；3~4 s 内传送带加速度突增为 a₂=3 m/s²。已知滑块与带面间的动摩擦因数 μk=0.20，最大静摩擦因数 μs=0.25，g 取 10 m/s²。求：(1) 首次共速时刻与速度；(2) t=3 s 后滑块能否保持相对静止；(3) 0~4 s 内滑块对地位移与相对带面位移 Δx。",
    message: "已按双参考系计算：2 s 共速后随带加速，3 s 超过静摩擦上限重新相对滑动",
    assumptions: ["g=10 m/s²", "传送带足够长", "动/静摩擦因数分开判定"],
    reading: conveyorReslide as WorkspaceReading,
  },
  {
    id: "gaokao-pulley-ground-slack",
    title: "定滑轮连接体 · 着地松绳滑行",
    description: "粗糙桌面滑块与悬挂重物共加速，重物着地后绳松弛滑块减速至停",
    difficulty: "压轴",
    tags: ["定滑轮", "连接体", "松绳"],
    imageUrl: "/samples/gaokao-pulley-ground-slack.svg",
    problemText:
      "质量 m₁=2 kg 的物块置于粗糙水平桌面上（μ=0.25），距桌沿理想定滑轮水平距离 L=5 m；轻绳绕过定滑轮悬挂质量 m₂=3 kg 的重物，重物初始离地高度 h=1.6 m。系统由静止释放，重物着地后不反弹，g 取 10 m/s²。求：(1) 着地前系统的加速度与轻绳张力；(2) 重物着地绳松弛后，物块 m₁ 继续滑行的距离与总位移。",
    message: "已按连接体两阶段求解：0.80 s 重物着地瞬间绳松弛（T=0），物块继续减速停在 4.80 m 处",
    assumptions: ["g=10 m/s²", "轻绳不可伸长且滑轮理想", "重物着地后不反弹"],
    reading: pulleyGroundSlack as WorkspaceReading,
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
