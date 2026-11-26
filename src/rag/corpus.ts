import type { RagKnowledgeEntry } from "./types.ts";

/**
 * 占位种子题库（供并行分支独立编译；将由 corpus-curator 扩充为完整高考母题库）。
 */
export const PHYSICS_RAG_CORPUS: readonly RagKnowledgeEntry[] = [
  {
    id: "seed-incline-spring-01",
    title: "粗糙斜面滑下接光滑水平面压缩轻弹簧",
    source: "高考经典母题 · 能量与弹簧综合",
    difficulty: "基础",
    stageSignature: ["incline_slide", "lossless_turn", "horizontal_slide", "spring_contact"],
    tags: ["斜面", "动摩擦", "弹簧压缩", "机械能与动能定理"],
    stem: "倾角 37°、长 4 m 的粗糙斜面（动摩擦因数 μ = 0.25）底端平滑连接光滑水平面，距离坡底 1 m 处有一原长自由端朝左、右端固定的轻弹簧（k = 400 N/m，不拴接）。质量 1 kg 的物块从斜面顶端静止释放，g = 10 m/s²，求到达坡底速度及弹簧最大压缩量。",
    keyFormulas: ["mgL·sinθ - μmgL·cosθ = ½mv²", "½mv² = ½kx_max²"],
    pitfalls: ["弹簧不拴接时物块在恢复原长处脱离，不会拉伸弹簧", "斜面段克服摩擦力做功不可遗漏 cosθ"],
    solutionOutline: "先对斜面段用动能定理求坡底速度，再对弹簧段用机械能守恒求最大压缩量。",
    planHint: "stages: incline_slide -> lossless_turn -> horizontal_slide(distance:1) -> spring_contact(frictionless:true)",
  },
  {
    id: "seed-movable-arc-spring-02",
    title: "可动光滑圆弧槽反冲与自由弹簧双球临界",
    source: "高考压轴母题 · 水平动量守恒与双球弹簧",
    difficulty: "拔高",
    stageSignature: ["movable_arc", "spring_pair"],
    tags: ["可移动圆弧槽", "水平动量守恒", "人船模型", "弹簧双球", "共速最大势能"],
    stem: "质量 M = 3.0 kg、半径 R = 0.6 m 的四分之一光滑圆弧槽静置于光滑水平地面上可自由滑动，小球 m₁ = 1 kg 从槽顶静止释放，滑离槽底后经 0.5 m 光滑水平面压缩静止小球 m₂ 右侧的轻弹簧，m₁ 反弹后恰好不能再次滑上圆弧槽，g = 10 m/s²，求槽速、m₂ 质量与最大弹性势能。",
    keyFormulas: ["0 = m₁v₁ + Mv_槽（水平动量守恒）", "m₁gR = ½m₁v₁² + ½Mv_槽²", "E_pmax = ½·(m₁m₂/(m₁+m₂))·v₁²"],
    pitfalls: ["圆弧槽仅水平方向动量守恒，竖直方向合外力不为零，总动量不守恒", "恰好不再滑上圆弧槽的临界条件为反弹速度等于槽速"],
    solutionOutline: "球槽分离联立水平动量与机械能守恒得槽速与球速；由恰好追不上槽反求 m₂；双球共速时弹簧弹性势能最大。",
    planHint: "stages: movable_arc(exitDirection:-1) -> spring_pair(matchGrooveSpeed:true)",
  },
];
