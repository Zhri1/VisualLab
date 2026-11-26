// 由 scripts/sync-functions.mjs 从 src/rag/corpus.ts 复制生成，请勿手改。
// 改动请改源文件后重新运行：node scripts/sync-functions.mjs
import type { RagKnowledgeEntry } from "./types.ts";

/**
 * VisualLab 高考物理经典力学与电磁偏转母题知识库（32 题全覆盖）。
 * 全面覆盖 16 类核心物理模型与 18 种合法 StageKind，每道题均经参数完整性、
 * 数值物理自洽性与空间几何一致性校验，可直接作为 RAG 检索源与动画试做母题。
 */
export const PHYSICS_RAG_CORPUS: readonly RagKnowledgeEntry[] = [
  // =========================================================================
  // 一、斜面 + 水平面 + 光滑/粗糙弹簧压缩与回弹（3 题）
  // =========================================================================
  {
    id: "gk-incline-spring-smooth-01",
    title: "粗糙斜面滑下接光滑水平面压缩轻弹簧",
    source: "高考经典母题 · 斜面与光滑弹簧综合",
    difficulty: "基础",
    stageSignature: ["incline_slide", "lossless_turn", "horizontal_slide", "spring_contact"],
    tags: ["斜面下滑", "动摩擦", "无损转向", "弹簧压缩", "动能定理", "机械能守恒"],
    stem: "倾角 37°、长 4 m 的粗糙斜面（动摩擦因数 μ = 0.25）底端平滑连接光滑水平面，距离坡底 1 m 处有一原长自由端朝左、右端固定的轻弹簧（k = 400 N/m，不拴接）。质量 m = 1 kg 的物块从斜面顶端由静止释放，g = 10 m/s²，求物块到达坡底的速度及弹簧的最大压缩量。",
    keyFormulas: [
      "a = g(sinθ - μcosθ)",
      "mgL·sinθ - μmgL·cosθ = ½mv²",
      "½mv² = ½kx_max²",
    ],
    pitfalls: [
      "斜面段克服摩擦力做功为 μmgL·cosθ，极易漏乘 cosθ",
      "弹簧与物块不拴接，反弹恢复原长时即脱离，不会出现拉伸过程",
    ],
    solutionOutline:
      "先对斜面下滑段用动能定理：重力做功 24 J，摩擦生热 8 J，得坡底动能 16 J（v = 4√2 m/s）。水平面光滑速度不变，接触弹簧后动能全部转化为弹性势能，由 ½kx_max² = 16 J 解得 x_max = 0.283 m。",
    planHint:
      "stages: incline_slide(direction:'down', angleDeg:37, lengthM:4, μ:0.25) -> lossless_turn -> horizontal_slide(μ:0, distanceM:1) -> spring_contact(k:400, frictionless:true, unattached:true)",
  },
  {
    id: "gk-incline-spring-rough-stick-02",
    title: "粗糙弹簧压缩后最大形变处静摩擦锁死",
    source: "高考经典母题 · 粗糙弹簧与静摩擦临界",
    difficulty: "中档",
    stageSignature: ["incline_slide", "lossless_turn", "horizontal_slide", "spring_contact"],
    tags: ["粗糙弹簧", "静摩擦临界", "最大压缩静止", "动能定理"],
    stem: "倾角 30°、长 0.8 m 的光滑斜面底端平滑连接粗糙水平面（动摩擦因数 μ = 0.2，静摩擦因数 μ_s = 0.45），距坡底 1 m 处有一自由端朝左、右端固定的轻弹簧（k = 16 N/m，不拴接，弹簧下方水平面同样粗糙）。质量 m = 2 kg 的物块从斜面顶端由静止释放，g = 10 m/s²，求弹簧的最大压缩量并判断物块能否反弹。",
    keyFormulas: [
      "mgL·sinθ - μmg(d + x) = ½kx²",
      "弹力与最大静摩擦判据：kx_max ≤ μ_s·mg 时静止不反弹",
    ],
    pitfalls: [
      "粗糙弹簧压缩过程并非纯简谐对称，不可直接用 ½mv² = ½kx²",
      "速度减为零处必须检验 kx_max 与 μ_s·mg 的大小，不能默认必然反弹",
    ],
    solutionOutline:
      "斜面下滑得坡底动能 8 J，滑过 1 m 粗糙水平面耗能 4 J，以 4 J 动能接触弹簧。由 8x² + 4x = 4 解得最大压缩量 x_max = 0.5 m；此时弹力 kx_max = 8 N 小于最大静摩擦力 μ_s·mg = 9 N，故物块停在最大压缩处不反弹。",
    planHint:
      "stages: incline_slide(angleDeg:30, lengthM:0.8, μ:0) -> lossless_turn -> horizontal_slide(μ:0.2, distanceM:1) -> spring_contact(k:16, μ:0.2, μ_s:0.45, unattached:true)",
  },
  {
    id: "gk-incline-spring-rebound-return-03",
    title: "粗糙斜面滑下经水平面压缩弹簧后反弹再上斜面",
    source: "高考压轴母题 · 7 阶段往返能量综合",
    difficulty: "拔高",
    stageSignature: [
      "incline_slide",
      "lossless_turn",
      "horizontal_slide",
      "spring_contact",
      "horizontal_slide",
      "lossless_turn",
      "incline_slide",
    ],
    tags: ["7阶段往返", "粗糙斜面", "弹簧反弹", "能量守恒", "分段动能定理"],
    stem: "倾角 37°、长 5 m 的粗糙斜面（μ₁ = 0.25）底端平滑连接长 1 m 的粗糙水平面（μ₂ = 0.2），水平面右端接光滑区域并固定一自由端朝左的轻弹簧（k = 400 N/m，不拴接）。质量 m = 1 kg 的物块从斜面顶端由静止释放，g = 10 m/s²，求弹簧最大压缩量及反弹后首次冲上斜面的最大位移。",
    keyFormulas: [
      "下滑坡底动能：E_k1 = mgL(sinθ - μ₁cosθ)",
      "弹簧最大压缩：½kx_max² = E_k1 - μ₂mgd",
      "返回上滑距离：L_上 = (E_k1 - 2μ₂mgd) / [mg(sinθ + μ₁cosθ)]",
    ],
    pitfalls: [
      "物块往返经过粗糙水平面两次，摩擦生热共 2μ₂mgd，漏算返程损耗是高频错因",
      "返回冲上斜面时摩擦力沿斜面向下，加速度变为 g(sinθ + μ₁cosθ)，与下滑加速度不同",
    ],
    solutionOutline:
      "下滑至坡底得动能 20 J，右行过 1 m 粗糙水平面耗能 2 J，以 18 J 压缩光滑弹簧得 x_max = 0.3 m。原速反弹左行再次过粗糙水平面耗能 2 J，以 16 J 冲上斜面；上滑合力 8 N，由动能定理得首次上滑最大位移 L_上 = 2 m。",
    planHint:
      "stages: incline_slide(down) -> lossless_turn -> horizontal_slide(d:1, μ:0.2) -> spring_contact(k:400, frictionless:true) -> horizontal_slide(d:1, μ:0.2) -> lossless_turn -> incline_slide(up, μ:0.25)",
  },

  // =========================================================================
  // 二、斜面上滑与往返模型（3 题）
  // =========================================================================
  {
    id: "gk-incline-up-stop-04",
    title: "足够长粗糙斜面上滑至最高点静止（μ ≥ tanθ）",
    source: "高考经典母题 · 斜面上滑自锁临界",
    difficulty: "基础",
    stageSignature: ["incline_slide"],
    tags: ["斜面上滑", "自锁条件", "静摩擦", "匀减速至静止"],
    stem: "足够长的粗糙斜面倾角 37°，物块与斜面间的动摩擦因数 μ = 0.75、静摩擦因数 μ_s = 0.8。质量 m = 2 kg 的物块从斜面底端以初速度 v₀ = 6 m/s 沿斜面向上滑出，g = 10 m/s²，求物块上滑的最大距离、上滑时间及到达最高点后的运动状态。",
    keyFormulas: [
      "a_上 = g(sinθ + μcosθ)",
      "s_max = v₀² / (2a_上)，t_上 = v₀ / a_上",
      "最高点静止判据：μ_s ≥ tanθ（即 mgsinθ ≤ μ_s·mgcosθ）",
    ],
    pitfalls: [
      "误以为所有冲上斜面的物块到达最高点后都会原路滑下，忘记检验 μ_s 与 tanθ 的关系",
      "套用下滑加速度 g(sinθ - μcosθ) 计算上滑过程，导致符号错误",
    ],
    solutionOutline:
      "上滑时重力分力与滑动摩擦力均沿斜面向下，a_上 = 10×(0.6 + 0.75×0.8) = 12 m/s²。由运动学公式得 t_上 = 0.5 s，s_max = 1.5 m。最高点处 μ_s = 0.8 > tan37° = 0.75，重力分力小于最大静摩擦力，物块将静止在最高点。",
    planHint:
      "stages: incline_slide(direction:'up', angleDeg:37, lengthM:null, μ:0.75, μ_s:0.8)",
  },
  {
    id: "gk-incline-up-return-asymmetric-05",
    title: "足够长粗糙斜面上滑与下滑加速度不对称往返",
    source: "高考经典母题 · 斜面往返动力学",
    difficulty: "中档",
    stageSignature: ["incline_slide"],
    tags: ["斜面上滑", "原路返回", "加速度不对称", "往返时间"],
    stem: "足够长的粗糙斜面倾角 θ 约为 37°（取 sinθ = 0.6、cosθ = 0.8），动摩擦因数 μ = 0.25（最大静摩擦力等于滑动摩擦力）。质量 m = 1 kg 的物块从底端以 v₀ = 8 m/s 沿斜面向上冲出，g = 10 m/s²，求物块上滑的最大距离、返回底端时的速度及往返总时间。",
    keyFormulas: [
      "a_上 = g(sinθ + μcosθ)，a_下 = g(sinθ - μcosθ)",
      "t_上 = v₀ / a_上，t_下 = √(2s_max / a_下)",
      "v_返 = √(2a_下·s_max) < v₀",
    ],
    pitfalls: [
      "误用竖直上抛的对称性认为 t_下 = t_上、v_返 = v₀，忽略摩擦力反向导致的加速度不对称",
      "计算总摩擦生热时只算单程 μmg·s_max·cosθ，忘记往返路程为 2s_max",
    ],
    solutionOutline:
      "上滑加速度 a_上 = 8 m/s²，经 t_上 = 1 s 到达最高点 s_max = 4 m。因 μ = 0.25 < tan37° = 0.75，物块加速下滑，a_下 = 4 m/s²，下滑时间 t_下 = √2 s，返回底端速度 v_返 = 4√2 m/s，往返总时间 (1 + √2) s。",
    planHint:
      "stages: incline_slide(direction:'up', angleDeg:36.86989764584402, lengthM:null, kineticFrictionCoefficient:0.25, staticFrictionCoefficient:0.25)，整段自动求折返",
  },
  {
    id: "gk-incline-up-projectile-06",
    title: "定长粗糙斜面上滑冲出顶端接斜抛落地",
    source: "高考经典母题 · 斜面与斜抛衔接",
    difficulty: "中档",
    stageSignature: ["incline_slide", "projectile"],
    tags: ["定长斜面", "斜抛运动", "切线出射", "运动分解"],
    stem: "倾角 37°、长 L = 2.5 m 的粗糙斜面（μ = 0.25）固定在水平地面上，顶端悬空距地面高 1.5 m。质量 m = 1 kg 的物块从斜面底端以 v₀ = 8 m/s 沿斜面向上滑出，冲出斜面顶端后做斜抛运动落回水平地面，g = 10 m/s²，求物块离开斜面顶端时的速度及落地时的速率。",
    keyFormulas: [
      "v_顶² - v₀² = -2g(sinθ + μcosθ)L",
      "斜抛初速度分量：v_x = v_顶·cosθ，v_y = v_顶·sinθ",
      "落地速率：v_地 = √(v_顶² + 2gL·sinθ)",
    ],
    pitfalls: [
      "物块冲出斜面顶端时速度沿斜面切线斜向上，并非水平抛出，竖直初速度 v_y ≠ 0",
      "斜抛最高点速度不为零，等于水平分量 v_顶·cosθ",
    ],
    solutionOutline:
      "斜面段匀减速 a_上 = 8 m/s²，到达顶端速度 v_顶 = √(64 - 40) = 2√6 m/s（方向与水平成 37° 斜向上）。随后从高 1.5 m 处做斜抛运动，由机械能守恒得落地动能为 ½mv_顶² + mgH = 27 J，落地速率为 3√6 m/s。",
    planHint:
      "stages: incline_slide(direction:'up', angleDeg:37, lengthM:2.5, μ:0.25) -> projectile(landingPlaneYM:0)",
  },

  // =========================================================================
  // 三、预压弹簧释放多过程（2 题）
  // =========================================================================
  {
    id: "gk-spring-release-projectile-07",
    title: "预压弹簧释放经粗糙桌面后桌沿平抛",
    source: "高考经典母题 · 弹簧弹射与平抛",
    difficulty: "基础",
    stageSignature: ["spring_release", "horizontal_slide", "projectile"],
    tags: ["预压弹簧", "弹射释放", "粗糙桌面", "平抛运动"],
    stem: "高 H = 1.25 m 的水平桌面上，左端固定一轻弹簧（k = 250 N/m），用质量 m = 2 kg 的物块将弹簧压缩 x₀ = 0.4 m 后由静止释放（物块与弹簧不拴接，弹簧下方桌面光滑）。物块离开弹簧后在长 d = 1 m、动摩擦因数 μ = 0.2 的粗糙桌面上滑行，随后从桌面右沿水平飞出落地，g = 10 m/s²，求物块落地点距桌沿的水平距离。",
    keyFormulas: [
      "E_p = ½kx₀²",
      "E_p - μmgd = ½mv_沿²",
      "t = √(2H/g)，x = v_沿·t",
    ],
    pitfalls: [
      "审题需区分弹簧下方是否粗糙：光滑时脱离点动能直接等于 ½kx₀²，粗糙时需扣去释放段摩擦损耗",
      "平抛运动时间仅由桌高 H 决定，与脱离速度无关",
    ],
    solutionOutline:
      "预压弹簧弹性势能 E_p = ½×250×0.16 = 20 J，光滑释放后物块以 20 J 动能进入粗糙桌面，滑行 1 m 克服摩擦做功 4 J，到达桌沿动能 16 J，速度 v_沿 = 4 m/s。平抛落地时间 t = √(2×1.25/10) = 0.5 s，水平射程 x = 2 m。",
    planHint:
      "stages: spring_release(k:250, initialCompressionM:0.4, μ:0, unattached:true) -> horizontal_slide(μ:0.2, distanceM:1) -> projectile(dropHeightM:1.25)",
  },
  {
    id: "gk-spring-release-vertical-arc-08",
    title: "预压弹簧释放经粗糙水平段冲上竖直半圆轨道",
    source: "高考经典母题 · 弹簧弹射与竖直圆周",
    difficulty: "中档",
    stageSignature: ["spring_release", "horizontal_slide", "vertical_arc"],
    tags: ["预压弹簧", "竖直半圆弧", "最高点弹力", "能量综合"],
    stem: "水平轨道左端固定轻弹簧（k = 250 N/m），用质量 m = 1 kg 的物块压缩 x₀ = 0.4 m 后由静止释放（不拴接，弹簧区光滑）。物块脱离弹簧后经长 d = 1 m、μ = 0.2 的粗糙水平直轨，平滑进入半径 R = 0.5 m 的竖直光滑半圆内轨道，g = 10 m/s²，求物块到达半圆轨道最高点时的速度与轨道对物块的压力。",
    keyFormulas: [
      "½kx₀² - μmgd = ½mv_底²",
      "½mv_底² = ½mv_顶² + mg·2R",
      "N_顶 + mg = mv_顶² / R",
    ],
    pitfalls: [
      "半圆最高点相对最低点上升高度是直径 2R 而非半径 R",
      "最高点压力公式为 N = mv²/R - mg，且须先校验 v_顶 ≥ √(gR) 确认不脱轨",
    ],
    solutionOutline:
      "弹簧弹性势能 20 J，经粗糙水平段耗能 2 J，得半圆底端动能 18 J（v_底 = 6 m/s）。上升 2R = 1 m 重力势能增 10 J，最高点动能 8 J，v_顶 = 4 m/s > √(gR) = √5 m/s，安全通过最高点；由向心力公式得轨道压力 N_顶 = 1×16/0.5 - 10 = 22 N。",
    planHint:
      "stages: spring_release(k:250, initialCompressionM:0.4, μ:0) -> horizontal_slide(μ:0.2, distanceM:1) -> vertical_arc(radiusM:0.5, endAngleDeg:180, side:'inside')",
  },

  // =========================================================================
  // 四、水平与倾斜传送带全系列（6 题）
  // =========================================================================
  {
    id: "gk-conveyor-horizontal-heat-09",
    title: "水平匀速传送带静止释放：共速划痕与摩擦生热",
    source: "高考经典母题 · 水平传送带基础",
    difficulty: "基础",
    stageSignature: ["conveyor_belt"],
    tags: ["水平传送带", "共速划痕", "相对位移", "摩擦生热", "电动机多耗能"],
    stem: "长 L = 6 m 的水平传送带以 v_带 = 4 m/s 顺时针匀速运行，将质量 m = 2 kg 的物块轻放于传送带左端（初速度为 0），物块与传送带间动摩擦因数 μ = 0.2，g = 10 m/s²，求物块加速至共速的时间、传送带上留下的划痕长度、摩擦生热及电动机多消耗的电能。",
    keyFormulas: [
      "a = μg，t_共 = v_带 / a",
      "Δs = x_带 - x_物 = v_带·t_共 - ½at_共²",
      "Q = μmg·Δs = ½mv_带²，E_电 = ½mv_带² + Q = mv_带²",
    ],
    pitfalls: [
      "计算摩擦生热 Q 时误用物块对地位移 x_物，必须使用相对位移 Δs = |x_带 - x_物|",
      "未先判断 x_物 与带长 L 的关系就直接假设物块一定能达到共速",
    ],
    solutionOutline:
      "物块加速加速度 a = 2 m/s²，经 t_共 = 2 s 达共速 4 m/s，对地位移 x_物 = 4 m < 6 m，此后匀速运动 0.5 s。共速期间传送带位移 x_带 = 8 m，划痕 Δs = 4 m，摩擦生热 Q = 16 J，电动机多耗能 16 + 16 = 32 J。",
    planHint:
      "stages: conveyor_belt(initialBeltSpeedMps:4, kineticFrictionCoefficient:0.2, beltLengthM:6)，未给时长，按实际带端结束",
  },
  {
    id: "gk-conveyor-horizontal-segmented-10",
    title: "水平传送带分段变速：共速后静摩擦随动",
    source: "高考经典母题 · 变速传送带模型",
    difficulty: "中档",
    stageSignature: ["conveyor_belt"],
    tags: ["水平传送带", "分段变速", "共速判据", "静摩擦随动"],
    stem: "长 L = 10 m 的水平传送带在 t = 0 时向右速度为 2 m/s，前 2 s 内以 a_带 = 2 m/s² 向右匀加速，随后保持 6 m/s 匀速运行 2 s。t = 0 时将质量 m = 1 kg 的物块轻放于传送带左端，物块与传送带间 μ = 0.4（最大静摩擦等于滑动摩擦），g = 10 m/s²，求物块与传送带首次共速的时刻及前 2 s 内的总位移。",
    keyFormulas: [
      "v_物(t) = μgt = v_带0 + a_带·t",
      "共速后随动判据：|a_带| ≤ μg 时物块与传送带保持相对静止，静摩擦 f = ma_带",
    ],
    pitfalls: [
      "共速后若传送带仍在加速，必须比较 |a_带| 与 μg，不能直接认为共速后摩擦力立即为零",
      "变速传送带的相对位移需用 v-t 图像面积差或分段积分求解，不可套用匀速带结论",
    ],
    solutionOutline:
      "物块滑动加速度 a_物 = μg = 4 m/s²，由 4t = 2 + 2t 得 t = 1 s 时首次共速（v = 4 m/s），前 1 s 位移 2 m。此后因 a_带 = 2 m/s² < μg = 4 m/s²，物块在 2 N 静摩擦力作用下随带以 2 m/s² 加速至 6 m/s，第 2 s 位移 5 m，前 2 s 总位移 7 m。",
    planHint:
      "stages: conveyor_belt(initialBeltSpeedMps:2, segments:[{a:2,dt:2},{a:0,dt:2}], μ:0.4, beltLengthM:10)",
  },
  {
    id: "gk-conveyor-incline-up-11",
    title: "倾斜向上传送带（μ ≥ tanθ）底端静止上运",
    source: "高考经典母题 · 倾斜向上传送带",
    difficulty: "中档",
    stageSignature: ["conveyor_belt"],
    tags: ["倾斜传送带", "向上运送", "共速静摩擦", "摩擦生热"],
    stem: "倾角 37°、长 L = 10 m 的倾斜传送带以 v_带 = 4 m/s 顺时针（沿斜面向上）匀速运行。将质量 m = 2 kg 的物块轻放于传送带底端，物块与传送带间动摩擦因数 μ = 0.875、静摩擦因数 μ_s = 0.9，g = 10 m/s²，求物块从底端运送到顶端所需的总时间及全程摩擦生热。",
    keyFormulas: [
      "a = g(μcosθ - sinθ)",
      "x_加速 = v_带² / (2a)，Δs = v_带·t_1 - x_加速",
      "共速后由静摩擦 f = mgsinθ 维持匀速，不再产生摩擦热",
    ],
    pitfalls: [
      "误以为倾斜传送带上共速后摩擦力为零，实际上共速后仍受沿斜面向上的静摩擦力 f = mgsinθ",
      "混淆 μcosθ 与 sinθ 的大小：只有 μ > tanθ 时底端静止物块才能被带上斜面",
    ],
    solutionOutline:
      "滑动加速度 a = 10×(0.875×0.8 - 0.6) = 1 m/s²，经 t₁ = 4 s 达共速 4 m/s，位移 x₁ = 8 m < 10 m。因 μ_s > tan37°，此后匀速走完剩余 2 m 用时 t₂ = 0.5 s，总时间 4.5 s；加速段相对位移 Δs = 16 - 8 = 8 m，摩擦生热 Q = 14×8 = 112 J。",
    planHint:
      "stages: conveyor_belt(initialBeltSpeedMps:4, angleDeg:37, inclineDirection:'up', μ:0.875, μ_s:0.9, beltLengthM:10)",
  },
  {
    id: "gk-conveyor-incline-down-16m-12",
    title: "倾斜向下传送带经典 16 m 二次加速模型（μ < tanθ）",
    source: "高考压轴母题 · 倾斜向下传送带双加速",
    difficulty: "拔高",
    stageSignature: ["conveyor_belt"],
    tags: ["倾斜向下传送带", "16m经典题", "摩擦力突变", "二次加速"],
    stem: "倾角 37°、长 L = 16 m 的倾斜传送带以 v_带 = 10 m/s 逆时针（沿斜面向下）匀速运行。将质量 m = 1 kg 的物块轻放于传送带顶端，物块与传送带间动摩擦因数 μ = 0.5，g = 10 m/s²，求物块从顶端滑到底端的总时间、到达底端的速度及相对传送带的划痕长度。",
    keyFormulas: [
      "第一段（v < v_带）：a₁ = g(sinθ + μcosθ)",
      "第二段（v > v_带，μ < tanθ）：a₂ = g(sinθ - μcosθ)",
      "两段划痕方向相反，最终划痕取 max(Δs₁, Δs₂)，而生热按 Δs₁ + Δs₂ 累加",
    ],
    pitfalls: [
      "共速瞬间忽略 μ = 0.5 < tan37° = 0.75，误判物块将随带匀速，漏掉第二段加速",
      "混淆“划痕长度”（两段相对位移反向重叠取较大值）与“摩擦生热路程”（两段绝对值相加）",
    ],
    solutionOutline:
      "第一段摩擦力向下，a₁ = 10 m/s²，经 t₁ = 1 s 达共速 10 m/s，位移 s₁ = 5 m（相对向上 Δs₁ = 5 m）。因 μ < tan37°，物块继续向下加速，摩擦力反向向上，a₂ = 2 m/s²，剩余 11 m 用时 t₂ = 1 s（相对向下 Δs₂ = 1 m），总时间 2 s，底端速度 12 m/s，划痕长 5 m。",
    planHint:
      "stages: conveyor_belt(initialBeltSpeedMps:10, angleDeg:37, inclineDirection:'down', μ:0.5, beltLengthM:16)",
  },
  {
    id: "gk-conveyor-rebound-projectile-13",
    title: "左端悬空水平传送带右接光滑斜面折返左端平抛",
    source: "高考压轴母题 · 传送带与斜面折返平抛",
    difficulty: "拔高",
    stageSignature: [
      "conveyor_belt",
      "incline_slide",
      "conveyor_belt",
      "projectile",
    ],
    tags: ["水平传送带", "光滑斜面折返", "双向相对运动", "桌沿平抛"],
    stem: "长 L = 3 m、距地面高 H = 1.25 m 的水平传送带左端悬空，右端平滑连接倾角 θ 约为 37°（取 sinθ = 0.6、cosθ = 0.8）、足够长的光滑斜面。传送带以 v_带 = 4 m/s 逆时针（向左）匀速运行，质量 m = 1 kg 的物块以 v₀ = 6 m/s 从传送带左端向右滑上，物块与传送带间 μ = 0.2，g = 10 m/s²，求物块滑上斜面的最大位移及最终从左端平抛落地的水平射程。",
    keyFormulas: [
      "右行减速：v_右² = v₀² - 2μgL",
      "光滑斜面折返：v_返 = v_右，s_斜 = v_右² / (2gsinθ)",
      "左行先减速至 v_带 后匀速，平抛射程 x = v_带·√(2H/g)",
    ],
    pitfalls: [
      "返回传送带左行时，因 v_返 = 2√6 ≈ 4.90 m/s > v_带 = 4 m/s，摩擦力向右使物块减速而非加速",
      "空间端点需明确：右端接斜面、左端悬空平抛，避免把同一端点既当斜面底又当悬崖",
    ],
    solutionOutline:
      "右行受向左摩擦力 a = 2 m/s²，到达右端速度 v_右 = 2√6 m/s，冲上光滑斜面最大位移 s_斜 = 24/(2×6) = 2 m。原速返回传送带左端方向，因 2√6 > 4 m/s，先以 2 m/s² 减速 2 m 至共速 4 m/s，再匀速 1 m 从左端平抛，落地时间 0.5 s，水平射程 2 m。",
    planHint:
      "stages: conveyor_belt(initialBeltSpeedMps:-4, beltLengthM:3, kineticFrictionCoefficient:0.2, entryEdge:'start', continuationExitEdge:'end') -> incline_slide(direction:'up', lengthM:null, angleDeg:36.86989764584402, kineticFrictionCoefficient:0) -> conveyor_belt(initialBeltSpeedMps:-4, beltLengthM:3, kineticFrictionCoefficient:0.2, entryEdge:'end', continuationExitEdge:'start') -> projectile(dropHeightM:1.25)",
  },
  {
    id: "gk-incline-conveyor-projectile-14",
    title: "光滑斜面滑下接逆向水平传送带后右端平抛",
    source: "镜像变式 · 斜面传送带平抛组合",
    difficulty: "中档",
    stageSignature: ["incline_slide", "lossless_turn", "conveyor_belt", "projectile"],
    tags: ["斜面下滑", "逆向传送带", "匀减速出射", "平抛运动"],
    stem: "倾角 30°、长 L₁ = 3.6 m 的光滑斜面底端平滑连接高 H = 1.25 m、长 L₂ = 4 m 的水平传送带左端，传送带右端悬空，带面以 v_带 = 2 m/s 向左匀速运行。质量 m = 1 kg 的物块从斜面顶端由静止释放，物块与传送带间 μ = 0.2，g = 10 m/s²，求物块离开传送带右端的速度及落地点距右端的水平距离。",
    keyFormulas: [
      "v_底 = √(2gL₁·sinθ)",
      "v_右² = v_底² - 2μgL₂",
      "x = v_右·√(2H/g)",
    ],
    pitfalls: [
      "物块逆着传送带方向滑行时，只要未减速至零，全程均受与运动方向相反的滑动摩擦力",
      "平抛初速度由传送带右端出射速度 v_右 决定，而非传送带自身速度 v_带",
    ],
    solutionOutline:
      "物块从光滑斜面滑下得底端速度 v_底 = √(2×10×0.5×3.6) = 6 m/s（向右）。在向左运行的传送带上以 a = 2 m/s² 匀减速滑过 4 m，离开右端速度 v_右 = √(36 - 16) = 2√5 m/s。平抛落地用时 0.5 s，水平射程 x = √5 m。",
    planHint:
      "stages: incline_slide(down, angleDeg:30, lengthM:3.6, μ:0) -> lossless_turn -> conveyor_belt(initialBeltSpeedMps:-2, kineticFrictionCoefficient:0.2, beltLengthM:4, entryEdge:'start', continuationExitEdge:'end') -> projectile(dropHeightM:1.25)",
  },

  // =========================================================================
  // 五、竖直圆周轨道双系列（3 题）
  // =========================================================================
  {
    id: "gk-vertical-arc-inside-critical-15",
    title: "竖直光滑单内轨最高点临界（v = √(gR)）与底端压力",
    source: "高考经典母题 · 轻绳/单内轨圆周临界",
    difficulty: "基础",
    stageSignature: ["horizontal_slide", "vertical_arc"],
    tags: ["竖直圆周", "单内轨临界", "向心力", "机械能守恒"],
    stem: "质量 m = 1 kg 的物块以初速度 v₀ = 6 m/s 在长 d = 2.75 m、动摩擦因数 μ = 0.2 的粗糙水平直轨上向右滑行，随后平滑进入半径 R = 0.5 m 的竖直光滑半圆内轨道底端，g = 10 m/s²，求物块进入半圆轨道底端时对轨道的压力，并判断是否恰好通过最高点。",
    keyFormulas: [
      "v_底² = v₀² - 2μgd",
      "底端压力：N_底 - mg = mv_底² / R",
      "单内轨最高点临界：v_顶min = √(gR)，对应底端最小速度 v_底min = √(5gR)",
    ],
    pitfalls: [
      "将单内轨临界速度误记为 0，单内轨只能提供向下压力，最高点速度必须满足 v_顶 ≥ √(gR)",
      "求底端对轨道的压力时忘记加上重力 mg，漏写牛顿第三定律说明",
    ],
    solutionOutline:
      "粗糙水平段减速后 v_底 = √(36 - 11) = 5 m/s，底端轨道支持力 N_底 = 10 + 1×25/0.5 = 60 N。由机械能守恒得最高点速度 v_顶 = √(25 - 20) = √5 m/s，恰好等于 √(gR) = √5 m/s，轨道压力为零，恰好通过最高点。",
    planHint:
      "stages: horizontal_slide(μ:0.2, distanceM:2.75) -> vertical_arc(radiusM:0.5, endAngleDeg:180, side:'inside')",
  },
  {
    id: "gk-vertical-arc-rod-boundary-16",
    title: "竖直光滑圆管/轻杆模型最高点支持力与拉力分界",
    source: "高考经典母题 · 轻杆与双轨圆管圆周",
    difficulty: "中档",
    stageSignature: ["vertical_arc"],
    tags: ["轻杆模型", "双轨圆管", "最高点弹力方向", "临界分界"],
    stem: "质量 m = 1 kg 的小球置于半径 R = 0.8 m 的竖直光滑细圆管（等效轻杆模型，内外壁均可提供弹力）最低点，给小球水平初速度 v₀ = 6 m/s 使其沿管内做圆周运动，g = 10 m/s²，求小球到达最高点时的速度大小及圆管对小球作用力的大小与方向。",
    keyFormulas: [
      "½mv₀² = ½mv_顶² + mg·2R",
      "轻杆/圆管最高点通过临界：v_顶min = 0（对应底端 v_底min = 2√(gR)）",
      "弹力方向分界 v = √(gR)：0 ≤ v < √(gR) 时受向上支持力，v > √(gR) 时受向下压力",
    ],
    pitfalls: [
      "套用单内轨公式导致 N = mv²/R - mg 算得负值后不知所措，负号正说明弹力竖直向上",
      "混淆“恰好到达最高点（v = 0）”与“最高点弹力为零（v = √(gR)）”两个不同的临界状态",
    ],
    solutionOutline:
      "由机械能守恒得最高点速度 v_顶 = √(36 - 32) = 2 m/s。因 v_顶 = 2 m/s < √(gR) = 2√2 m/s，所需向心力 mv_顶²/R = 5 N 小于重力 10 N，故圆管内壁对小球施加竖直向上的支持力 N = mg - mv_顶²/R = 5 N。",
    planHint:
      "stages: vertical_arc(radiusM:0.8, endAngleDeg:180, side:'rod', frictionless:true)",
  },
  {
    id: "gk-projectile-tangent-arc-loop-17",
    title: "平抛切向无碰撞入圆弧接粗糙直轨与临界完整圆轨",
    source: "高考压轴母题 · 平抛+圆弧+完整内轨综合",
    difficulty: "拔高",
    stageSignature: ["projectile", "vertical_arc", "horizontal_slide", "vertical_arc"],
    tags: ["平抛切向入轨", "无碰撞衔接", "粗糙水平段", "完整圆轨临界"],
    stem: "质量 m = 1 kg 的小球从高台以水平初速度 v₀ = 3 m/s 抛出，恰好沿切线无碰撞进入圆心角 53°、半径 R₁ = 1.0 m 的竖直光滑圆弧轨道左端（53° 为标称值，入口切线倾角满足 sinθ = 4/5、cosθ = 3/5），滑至圆弧底端后经长 d = 2.0 m、μ = 0.2 的粗糙水平直轨，再平滑进入半径 R₂ = 0.5 m 的竖直光滑完整圆形内轨道，g = 10 m/s²，求平抛下落高度及小球能否通过圆形轨道最高点。",
    keyFormulas: [
      "切向无碰撞入轨：v_y = v₀·tanθ，h = v_y² / (2g)",
      "圆弧入口速度：v_A = v₀ / cosθ，下降高度 Δh₁ = R₁(1 - cosθ)",
      "完整内轨临界：v_C² = v_A² + 2gΔh₁ - 2μgd ≥ 5gR₂",
    ],
    pitfalls: [
      "“无碰撞进入圆弧”意味着平抛末速度方向与圆弧入口切线重合，即 tanθ = v_y / v₀",
      "计算圆弧段重力做功时误把下降高度写成 R₁·sinθ，正确表达式为 R₁(1 - cosθ)",
    ],
    solutionOutline:
      "由切向入轨得 v_y = 3×(4/3) = 4 m/s，下落高度 h = 0.8 m，入口速度 v_A = 5 m/s。沿圆弧下落 Δh₁ = 0.4 m，经 2 m 粗糙直轨损耗动能 8 J，得圆轨底端 v_C² = 25 + 8 - 8 = 25（v_C = 5 m/s），恰好满足 v_C = √(5gR₂)，能恰好通过圆轨最高点，此时支持力为 0。",
    planHint:
      "stages: projectile(end:{kind:'tangent_to_next_arc'}) -> vertical_arc(radiusM:1, side:'inside', frictionless:true, path:{startAngleDeg:-53.13010235415598, direction:'positive', end:{kind:'physical_endpoint', sweepAngleDeg:53.13010235415598} }) -> horizontal_slide(kineticFrictionCoefficient:0.2, end:{kind:'distance', distanceM:2}) -> vertical_arc(radiusM:0.5, side:'inside', frictionless:true, path:{startAngleDeg:0, direction:'positive', end:{kind:'observation', sweepAngleDeg:360} })",
  },

  // =========================================================================
  // 六、一维常力分段匀变速与折返（1 题）
  // =========================================================================
  {
    id: "gk-constant-force-1d-turnaround-18",
    title: "一维多段恒力换向：匀加速、减速折返与路程位移辨析",
    source: "高考经典母题 · 牛顿第二定律分段动力学",
    difficulty: "基础",
    stageSignature: ["constant_force_1d", "constant_force_1d"],
    tags: ["恒力换向", "分段匀变速", "减速折返", "位移与路程"],
    stem: "质量 m = 2 kg 的物块置于光滑水平面上，t = 0 时以 v₀ = 4 m/s 向右运动；前 2 s 内受到向右的水平恒力 F₁ = 4 N，t = 2 s 末立即撤去 F₁ 并施加向左的水平恒力 F₂ = 8 N 持续 3 s，g = 10 m/s²，求物块速度为零的时刻、5 s 末的位移及 5 s 内的总路程。",
    keyFormulas: [
      "a = F_合 / m",
      "v = v₀ + at，x = v₀t + ½at²",
      "折返段路程 = |x_正向减速| + |x_反向加速| ≠ |总位移|",
    ],
    pitfalls: [
      "第二段直接用全段位移公式算路程，忘记在 v = 0 处发生折返，导致路程与位移混淆",
      "换向后加速度未取负号，导致末速度方向判错",
    ],
    solutionOutline:
      "前 2 s 加速度 a₁ = 2 m/s²，末速度 8 m/s，位移 12 m。2 s 后加速度 a₂ = -4 m/s²，经 2 s（即 t = 4 s）速度减为零，再右行 8 m（最远位置 20 m）；第 5 s 反向左行 2 m，末速度 -4 m/s，总位移 18 m，总路程 22 m。",
    planHint:
      "stages: constant_force_1d(netForceXN:4, durationSeconds:2) -> constant_force_1d(netForceXN:-8, durationSeconds:3)",
  },

  // =========================================================================
  // 七、带电粒子在有界匀强磁场中的偏转（2 题）
  // =========================================================================
  {
    id: "gk-magnetic-half-circle-19",
    title: "带电粒子垂直射入有界匀强磁场半圆出射",
    source: "高考经典母题 · 磁场偏转半圆模型",
    difficulty: "基础",
    stageSignature: ["magnetic_deflection"],
    tags: ["洛伦兹力", "匀速圆周运动", "半圆出射", "磁场周期"],
    stem: "质量 m = 0.01 kg、电荷量 q = +0.02 C 的带电粒子以 v₀ = 4 m/s 垂直于左边界向右射入垂直纸面向里的有界匀强磁场，磁感应强度 B = 2 T，磁场区域水平宽度 d = 2 m（不计粒子重力），求粒子在磁场中的轨道半径、出射点与入射点的距离及在磁场中的运动时间。",
    keyFormulas: [
      "qvB = mv² / R => R = mv / (qB)",
      "T = 2πm / (qB)，半圆出射时间 t = T / 2 = πm / (qB)",
      "穿不出远边界判据：R < d 时转过 180° 从原边界出射，偏移量 Δy = 2R",
    ],
    pitfalls: [
      "未比较轨道半径 R 与磁场宽度 d 的大小就默认粒子穿出右边界",
      "左手定则判断洛伦兹力方向时忽略电荷正负号或磁场进出纸面方向",
    ],
    solutionOutline:
      "由 R = mv/(qB) 得轨道半径 R = 1.0 m < d = 2 m，粒子无法到达右边界，在磁场内逆时针转过半圆从左边界向左射出。出射点在入射点正上方 2R = 2.0 m 处，运动时间 t = πm/(qB) = π/4 ≈ 0.785 s。",
    planHint:
      "stages: magnetic_deflection(magneticTeslaB:2, chargeC:0.02, regionWidthM:2, fieldDirection:'into_page', exitKind:'half_circle')",
  },
  {
    id: "gk-magnetic-region-edge-20",
    title: "带电粒子穿出矩形有界匀强磁场：弦长与圆心角几何",
    source: "高考经典母题 · 矩形有界磁场偏转",
    difficulty: "中档",
    stageSignature: ["magnetic_deflection"],
    tags: ["有界磁场", "圆心角几何", "偏转角", "弦长关系"],
    stem: "质量 m = 0.01 kg、电荷量 q = +0.02 C 的带电粒子以 v₀ = 8 m/s 垂直于左边界向右射入垂直纸面向里的矩形有界匀强磁场，磁感应强度 B = 2 T，磁场水平宽度 d = 1.0 m（不计粒子重力），求粒子穿出右边界时的速度偏转角、侧移距离及在磁场中的运动时间。",
    keyFormulas: [
      "R = mv / (qB)",
      "几何偏转角：sinθ = d / R",
      "侧移量 y = R(1 - cosθ)，运动时间 t = (θ / 2π)·T = θm / (qB)",
    ],
    pitfalls: [
      "计算时间时误把角度制 30° 直接代入 θm/(qB)，必须转换为弧度制 π/6",
      "将速度偏转角 θ 与弦切角混淆，垂直入射时速度偏转角等于圆心角 θ",
    ],
    solutionOutline:
      "由 R = mv/(qB) 得 R = 2.0 m > d = 1.0 m，粒子穿出右边界。由几何关系 sinθ = d/R = 0.5 得偏转角 θ = 30°（π/6 rad），侧移距离 y = 2(1 - √3/2) = 2 - √3 ≈ 0.268 m，运动时间 t = π/24 ≈ 0.131 s。",
    planHint:
      "stages: magnetic_deflection(magneticTeslaB:2, chargeC:0.02, regionWidthM:1.0, fieldDirection:'into_page', exitKind:'region_edge')",
  },

  // =========================================================================
  // 八、可移动光滑圆弧槽 + 自由弹簧双球（2 题）
  // =========================================================================
  {
    id: "gk-movable-arc-spring-pair-21",
    title: "可动光滑圆弧槽反冲与自由弹簧双球临界反求质量",
    source: "高考压轴母题 · 水平动量守恒与双球弹簧",
    difficulty: "拔高",
    stageSignature: ["movable_arc", "spring_pair"],
    tags: ["可移动圆弧槽", "水平动量守恒", "自由弹簧双球", "恰好追不上临界", "共速最大势能"],
    stem: "质量 M = 3.0 kg、半径 R = 0.6 m 的四分之一光滑圆弧槽静置于光滑水平地面上可自由滑动，小球 m₁ = 1 kg 从槽顶（切线竖直）由静止释放，滑离槽底后经 0.5 m 光滑水平面压缩静止小球 m₂ 右侧的轻弹簧（k = 100 N/m，地面光滑），m₁ 反弹后恰好不能再次滑上圆弧槽，g = 10 m/s²，求圆弧槽的末速度、m₂ 的质量及弹簧的最大弹性势能。",
    keyFormulas: [
      "球槽水平动量与机械能守恒：m₁v₁ = Mv_槽，m₁gR = ½m₁v₁² + ½Mv_槽²",
      "恰好追不上临界：m₁ 反弹速率 v₁' = v_槽 => m₂ = m₁(v₁ + v_槽)/(v₁ - v_槽)",
      "双球共速最大弹性势能：E_pmax = ½·[m₁m₂/(m₁ + m₂)]·v₁²",
    ],
    pitfalls: [
      "圆弧槽系统竖直方向合外力不为零，仅水平方向动量守恒，总动量不守恒",
      "“恰好不再滑上圆弧槽”的临界条件是 m₁ 反弹后与槽同向且速率相等，而非 m₁ 速度为零",
    ],
    solutionOutline:
      "联立球槽水平动量与机械能守恒得离槽球速 v₁ = 3 m/s（向左）、槽速 v_槽 = 1 m/s（向右）。m₁ 与 m₂ 经自由弹簧作用等效弹性碰撞，由反弹速率等于槽速 1 m/s 反求得 m₂ = 2 kg；两球共速时弹簧弹性势能最大，E_pmax = 3 J。",
    planHint:
      "stages: movable_arc(radiusM:0.6, grooveMassKg:3.0, exitDirection:-1) -> spring_pair(gapM:0.5, springConstantNpm:100, matchGrooveSpeed:true)",
  },
  {
    id: "gk-movable-arc-recoil-projectile-22",
    title: "可动光滑圆弧槽反冲接桌沿平抛",
    source: "拟题变式 · 水平动量守恒与平抛",
    difficulty: "中档",
    stageSignature: ["movable_arc", "horizontal_slide", "projectile"],
    tags: ["可移动圆弧槽", "水平动量守恒", "光滑水平匀速", "桌沿平抛"],
    stem: "光滑水平台面距地面高 H = 1.25 m，质量 M = 2 kg、半径 R = 0.6 m 的四分之一光滑圆弧槽静置于台面上，可自由滑动。质量 m = 1 kg 的小球从槽顶（切线竖直）由静止释放，从槽底向左离槽时，离槽点距台面左沿 d = 0.35 m。小球随后沿台面滑到桌沿并水平飞出落地，g = 10 m/s²。求小球从离槽到落地的总时间，以及落地点到桌沿的水平距离。",
    keyFormulas: [
      "联立水平动量守恒与机械能守恒：m v_球 = M v_槽，mgR = ½m v_球² + ½M v_槽²",
      "总时间为台面匀速滑行时间与平抛时间之和：t = d/v_球 + √(2H/g)",
      "从桌沿量起的平抛射程：x = v_球·√(2H/g)",
    ],
    pitfalls: [
      "错把固定圆弧槽速度 √(2gR) 套用于可动圆弧槽，忽略槽获得反冲动能导致球速变小",
      "从离槽到落地包含台面滑行与空中飞行两段，平抛射程从桌沿起算",
    ],
    solutionOutline:
      "联立水平动量守恒和机械能守恒，得离槽球速 2√2 m/s，方向向左。小球以该速度滑过题给的 0.35 m，到桌沿用时 0.35/(2√2) s。平抛用时 0.5 s，从离槽到落地共约 0.624 s。落地点到桌沿的水平距离为 √2 m，约 1.41 m。",
    planHint:
      "stages: movable_arc(radiusM:0.6, grooveMassKg:2.0, exitDirection:-1) -> horizontal_slide(kineticFrictionCoefficient:0, end:{kind:'distance', distanceM:0.35}) -> projectile(dropHeightM:1.25)",
  },

  // =========================================================================
  // 九、多体水平弹性/完全非弹性碰撞与桌沿平抛（2 题）
  // =========================================================================
  {
    id: "gk-horizontal-elastic-collision-projectile-23",
    title: "水平一动碰一静弹性正碰接桌沿平抛",
    source: "高考经典母题 · 弹性碰撞与平抛验证",
    difficulty: "中档",
    stageSignature: ["horizontal_approach", "collision_1d", "parallel_motion"],
    tags: ["弹性正碰", "动量守恒", "机械能守恒", "桌沿平抛"],
    stem: "高 H = 1.25 m 的光滑水平桌面上，质量 m₁ = 1 kg 的滑块 A 在 x = 0 处以 v₀ = 6 m/s 向右匀速运动，与 x = 1.2 m 处静止的质量 m₂ = 2 kg 的滑块 B 发生一维弹性正碰。碰后滑块 B 沿光滑桌面继续右行 0.8 m 后从桌沿水平飞出落地，g = 10 m/s²，求碰后两滑块的速度及滑块 B 落地的水平射程。",
    keyFormulas: [
      "v₁' = [(m₁ - m₂)/(m₁ + m₂)]·v₀",
      "v₂' = [2m₁ / (m₁ + m₂)]·v₀",
      "平抛射程：x_B = v₂'·√(2H/g)",
    ],
    pitfalls: [
      "轻球碰重球（m₁ < m₂）时碰后 v₁' 为负值（反弹），代入动量方程时切忌漏掉方向正负号",
      "平抛时间仅取决于桌面高度 H，两球若同高度平抛则水平射程之比直接等于速度之比",
    ],
    solutionOutline:
      "A 匀速运动 0.2 s 撞上静止的 B。由一维弹性碰撞公式得 v₁' = -2 m/s（向左反弹）、v₂' = 4 m/s（向右）。B 沿桌面右行 0.8 m（用时 0.2 s）到达桌沿水平飞出，落地用时 0.5 s，水平射程 x_B = 4×0.5 = 2.0 m。",
    planHint:
      "initial.bodies 按题给 A、B 的 xM / vxMps；stages: horizontal_approach(tracks 中两物体的 kineticFrictionCoefficient 均为 0, end:{kind:'contact_or_rest'}) -> collision_1d(mode:'elastic', contact:{kind:'horizontal_meeting', approachStageIndex:0}) -> parallel_motion(A:horizontal_slide(kineticFrictionCoefficient:0, end:{kind:'scene_end'}), B:horizontal_slide(kineticFrictionCoefficient:0, end:{kind:'distance', distanceM:0.8})->projectile(landingPlaneYM:-1.25), end:{kind:'all_finite_tracks'})",
  },
  {
    id: "gk-horizontal-inelastic-collision-heat-24",
    title: "粗糙水平面接近后完全非弹性碰撞粘连生热与滑停",
    source: "高考经典母题 · 完全非弹性碰撞与能量损耗",
    difficulty: "基础",
    stageSignature: ["horizontal_approach", "collision_1d", "parallel_motion"],
    tags: ["完全非弹性碰撞", "碰撞生热", "粗糙水平滑停", "分段守恒"],
    stem: "粗糙水平地面（动摩擦因数 μ = 0.2）上，质量 m₁ = 2 kg 的滑块 A 在 x = 0 处以 v₀ = 5 m/s 向右滑出，与 x = 2.25 m 处静止的质量 m₂ = 2 kg 的滑块 B 发生完全非弹性碰撞并粘为一体（碰撞时间极短），g = 10 m/s²，求碰撞瞬间损失的机械能及粘连体碰后继续滑行的距离。",
    keyFormulas: [
      "碰前速度：v_A² = v₀² - 2μgd",
      "完全非弹性碰撞：m₁v_A = (m₁ + m₂)v_共，Q_碰 = ½·[m₁m₂/(m₁+m₂)]·v_A²",
      "碰后滑停：s = v_共² / (2μg)",
    ],
    pitfalls: [
      "未先扣去碰前粗糙接近段的动能损耗，直接拿初始速度 v₀ = 5 m/s 代入碰撞动量守恒",
      "误以为粗糙地面上碰撞瞬间动量不守恒：因内力远大于摩擦力且碰撞极短，瞬间动量仍守恒",
    ],
    solutionOutline:
      "碰前 A 以 a = 2 m/s² 减速滑过 2.25 m，碰前速度 v_A = √(25 - 9) = 4 m/s。瞬间粘连得共速 v_共 = 2 m/s，碰撞生热 Q_碰 = 16 - 8 = 8 J。随后共同体在 μ = 0.2 地面减速滑停，滑行距离 s = 4/4 = 1.0 m。",
    planHint:
      "stages: horizontal_approach(μ:0.2) -> collision_1d(mode:'perfectly_inelastic') -> parallel_motion(AB:horizontal_slide(μ:0.2, end:'stop'))",
  },

  // =========================================================================
  // 十、轻绳单摆下摆与最低点正碰（2 题）
  // =========================================================================
  {
    id: "gk-pendulum-elastic-collision-25",
    title: "单摆下摆最低点张力突变与弹性正碰",
    source: "高考经典母题 · 单摆与弹性碰撞综合",
    difficulty: "中档",
    stageSignature: ["pendulum_swing", "collision_1d", "parallel_motion"],
    tags: ["轻绳单摆", "最低点张力", "弹性正碰", "碰后上摆高度"],
    stem: "长 L = 0.8 m 的不可伸长轻绳上端固定于 O 点，下端系质量 m₁ = 1 kg 的小球 A。将 A 拉至支点左侧的水平位置（偏角 90°）由静止释放，摆至最低点时与静置于光滑水平面上的质量 m₂ = 3 kg 的小球 B 发生弹性正碰，g = 10 m/s²，求碰前瞬间轻绳拉力、碰后两球速度及 A 反弹上摆的最大高度。",
    keyFormulas: [
      "下摆机械能守恒：v₁ = √(2gL)",
      "最低点张力：T = m₁g + m₁v₁²/L（90° 释放时 T = 3m₁g）",
      "碰后上摆最大高度：h = v₁'² / (2g)",
    ],
    pitfalls: [
      "最低点轻绳拉力在碰撞前后发生突变：碰前 T = 30 N，碰后速度变为 -2 m/s，张力骤降为 15 N",
      "求反弹最大高度时误用动量守恒，碰后 A 单独上摆应使用机械能守恒",
    ],
    solutionOutline:
      "A 从水平位置下摆至最低点速度 v₁ = √(2×10×0.8) = 4 m/s，碰前张力 T = 10 + 16/0.8 = 30 N。与 m₂ = 3 kg 的 B 弹性正碰后，v₁' = -2 m/s、v₂' = 2 m/s；B 向右匀速运动，A 向左反弹上摆的最大高度 h = 4/20 = 0.2 m。",
    planHint:
      "stages: pendulum_swing(lengthM:0.8, initialAngleDeg:-90, end:{kind:'lowest_point'}) -> collision_1d(mode:'elastic') -> parallel_motion(A:pendulum_swing(inheritFromStageIndex:0, end:{kind:'scene_end'}), B:horizontal_slide(kineticFrictionCoefficient:0, end:{kind:'scene_end'}), end:{kind:'pendulum_turn', bodyId:'A'})",
  },
  {
    id: "gk-pendulum-inelastic-slack-26",
    title: "单摆最低点迎面完全非弹性碰撞与上摆松绳临界",
    source: "高考压轴母题 · 单摆碰撞与松绳临界",
    difficulty: "拔高",
    stageSignature: ["pendulum_swing", "collision_1d", "pendulum_swing"],
    tags: ["轻绳单摆", "完全非弹性碰撞", "松绳临界", "竖直圆周"],
    stem: "长 L = 0.8 m 的不可伸长轻绳上端固定于 O 点，下端系质量 m₁ = 1 kg 的小球 A。将 A 拉至左侧水平位置（偏角 90°）由静止释放，摆至最低点时与沿光滑水平面向左以 14 m/s 迎面驶来的质量 m₂ = 1 kg 的滑块 B 发生完全非弹性碰撞并粘为一体，随后共同绕 O 点向左上方摆动，g = 10 m/s²，判断粘连体能否做完整圆周运动并求轻绳恰好松弛时绳与竖直向上方向的夹角余弦值。",
    keyFormulas: [
      "最低点迎面碰撞：m₁v_A - m₂v_B = (m₁ + m₂)v_共",
      "松绳区间判据：√(2gL) < |v_共| < √(5gL)",
      "松弛临界（T = 0）：g·cosα = v² / L，结合 ½v_共² = ½v² + gL(1 + cosα)",
    ],
    pitfalls: [
      "迎面相碰时必须规定正方向，两物体初动量异号相减而非相加",
      "速度处于 √(2gL) 与 √(5gL) 之间时，小球不会到达最高点，而是在上半圆某处 T = 0 提前松绳斜抛",
    ],
    solutionOutline:
      "A 摆至最低点向右速度 4 m/s，与向左 14 m/s 的 B 粘连得共同向左速度 v_共 = 5 m/s。因 2gL = 16 < 25 < 5gL = 40，不能做完整圆周运动而在上半圆松绳。联立 T = 0 与机械能守恒得 3gL·cosα = v_共² - 2gL = 9，解得 cosα = 9/24 = 0.375。",
    planHint:
      "stages: pendulum_swing(lengthM:0.8, initialAngleDeg:-90, end:{kind:'lowest_point'}) -> collision_1d(mode:'perfectly_inelastic', targetApproach:{kind:'uniform_horizontal', velocityXMps:-14, endsAtContact:true}) -> pendulum_swing(bodyIds:['A','B'], inheritFromStageIndex:0, end:{kind:'first_turn'})；实际先到松绳时结束，不填写松绳续段",
  },

  // =========================================================================
  // 十一、滑块-长木板相对滑行模型（3 题）
  // =========================================================================
  {
    id: "gk-block-plank-common-speed-27",
    title: "光滑地面滑块滑上长木板共速与摩擦生热",
    source: "高考经典母题 · 板块模型基础",
    difficulty: "基础",
    stageSignature: ["block_plank"],
    tags: ["滑块木板", "光滑地面", "动量守恒", "相对位移", "摩擦生热"],
    stem: "光滑水平地面上静置质量 M = 2 kg、长 L = 5 m 的长木板，质量 m = 1 kg 的小物块以初速度 v₀ = 6 m/s 从木板左端水平向右滑上，物块与木板间动摩擦因数 μ = 0.3，g = 10 m/s²，求两者达到共同速度时的速度大小、滑块在木板上滑行的相对位移及系统产生的内能。",
    keyFormulas: [
      "mv₀ = (m + M)v_共",
      "Q = μmg·Δs = ½mv₀² - ½(m + M)v_共²",
      "不滑离判据：Δs ≤ L",
    ],
    pitfalls: [
      "忘记校验 Δs ≤ L 就直接套用共速动量守恒，若板长不足则物块会提前滑离",
      "计算摩擦力对木板做的功时误用相对位移 Δs，正确应乘以木板对地位移 x_板",
    ],
    solutionOutline:
      "地面光滑系统水平动量守恒，共速 v_共 = 1×6/(1+2) = 2 m/s。由能量守恒得系统生热 Q = 18 - 6 = 12 J，结合 Q = μmgΔs 解得相对位移 Δs = 12/3 = 4 m < 5 m，物块未滑离木板，共速时间 t = 4/3 s。",
    planHint:
      "stages: block_plank(blockMass:1, plankMass:2, plankLengthM:5, μ:0.3, groundFrictionless:true)",
  },
  {
    id: "gk-block-plank-slide-off-28",
    title: "滑块高速滑离有限长木板与地面摩擦分段辨析",
    source: "高考经典母题 · 板块滑离边界与动力学分段",
    difficulty: "中档",
    stageSignature: ["block_plank"],
    tags: ["滑块木板", "滑离板端", "相对运动学", "动力学隔离法"],
    stem: "光滑水平地面上静置质量 M = 2 kg、长 L = 3.0 m 的长木板，质量 m = 1 kg 的小物块以初速度 v₀ = 6 m/s 从木板左端水平向右滑上，物块与木板间动摩擦因数 μ = 0.3，g = 10 m/s²，求物块从木板右端滑离所需的时间、滑离瞬间两者的速度及全过程摩擦生热。",
    keyFormulas: [
      "a_物 = -μg，a_板 = μmg / M",
      "相对位移方程：v₀t - ½(|a_物| + a_板)t² = L",
      "滑离生热：Q = μmg·L",
    ],
    pitfalls: [
      "滑块已滑离板端时仍错误地用 mv₀ = (m+M)v_共 求末速度，滑离瞬间 v_物 > v_板",
      "若拓展至地面有摩擦情形，须先判断 μ₁mg 与 μ₂(m+M)g 决定木板是否启动，共速后整体匀减速",
    ],
    solutionOutline:
      "物块减速 a_物 = -3 m/s²，木板加速 a_板 = 1.5 m/s²，相对加速度 4.5 m/s²。由 6t - 2.25t² = 3 解得较小的物理根 t = 2/3 s（另一根 2 s 为假设不滑离的数学解，舍去）。滑离时 v_物 = 4 m/s，v_板 = 1 m/s，摩擦生热 Q = 3×3 = 9 J。",
    planHint:
      "stages: block_plank(blockMass:1, plankMass:2, plankLengthM:3.0, μ:0.3, groundFrictionless:true)",
  },
  {
    id: "gk-block-plank-external-force-29",
    title: "板块共速后外力牵引临界滑离板端（postCommonForce）",
    source: "高考压轴母题 · 板块临界牵引与二次相对滑动",
    difficulty: "拔高",
    stageSignature: ["block_plank"],
    tags: ["滑块木板", "外力牵引临界", "二次相对滑动", "最大静摩擦"],
    stem: "光滑水平地面上静置质量 M = 2 kg、长 L = 3 m 的长木板，质量 m = 1 kg 的小物块以 v₀ = 3 m/s 从木板左端向右滑上，物块与木板间 μ = 0.2（最大静摩擦等于滑动摩擦），g = 10 m/s²。两者达到共速后，立即对长木板施加向右的水平恒力 F = 9 N 持续 2 s，求共速时物块距左端的距离，并判断施加 F 后物块是否从木板左端滑离及滑离耗时。",
    keyFormulas: [
      "整体不打滑临界外力：F_临 = (M + m)μg",
      "F > F_临 时二次滑移：a_物 = μg，a_板 = (F - μmg) / M",
      "滑离左端条件：½(a_板 - a_物)t₂² = Δs₁",
    ],
    pitfalls: [
      "不检验 F 与临界外力 F_临 = (M+m)μg 的关系就假设两者一起加速",
      "忘记第一阶段滑块已向右相对木板移动 Δs₁ = 1.5 m，滑离左端只需再相对左移 1.5 m 而非全板长 3 m",
    ],
    solutionOutline:
      "第一阶段经 t₁ = 1 s 达共速 1 m/s，物块右移相对位移 Δs₁ = 1.5 m。施加 F = 9 N > F_临 = 6 N 后发生相对滑动：a_物 = 2 m/s²，a_板 = 3.5 m/s²，相对加速度 1.5 m/s²，由 ½×1.5·t₂² = 1.5 得 t₂ = √2 ≈ 1.41 s < 2 s，物块从木板左端滑离。",
    planHint:
      "stages: block_plank(blockMass:1, plankMass:2, plankLengthM:3, μ:0.2, groundFrictionless:true, postCommonForce:{blockForceXN:0, plankForceXN:9, durationSeconds:2})",
  },

  // =========================================================================
  // 十二、轻绳与理想定滑轮连接体（3 题）
  // =========================================================================
  {
    id: "gk-pulley-atwood-30",
    title: "阿特伍德机：竖直悬挂定滑轮连接体与落地后上冲",
    source: "高考经典母题 · 阿特伍德机基础",
    difficulty: "基础",
    stageSignature: ["pulley_system"],
    tags: ["阿特伍德机", "理想定滑轮", "连接体加速度", "轻绳张力"],
    stem: "轻质不可伸长细绳跨过光滑轻质理想定滑轮，两端分别悬挂质量 m₁ = 2 kg、m₂ = 3 kg 的物块，系统初始静止，m₂ 距地面高 h = 1.0 m，g = 10 m/s²，求释放后两物块的加速度大小、轻绳张力、m₂ 落地时间及落地后 m₁ 继续上升的最大高度。",
    keyFormulas: [
      "a = (m₂ - m₁)g / (m₁ + m₂)",
      "T = 2m₁m₂g / (m₁ + m₂)",
      "m₂ 落地松绳后 m₁ 竖直上抛：h' = v² / (2g)",
    ],
    pitfalls: [
      "误以为轻绳张力等于较重物块重力 m₂g，加速运动时 T 介于 m₁g 与 m₂g 之间",
      "m₂ 落地瞬间细绳松弛，m₁ 并非立即静止，而是以此时速度继续竖直上抛",
    ],
    solutionOutline:
      "对整体由牛顿第二定律得 a = (30 - 20)/5 = 2 m/s²，隔离 m₁ 得张力 T = 2×(10 + 2) = 24 N。m₂ 下落 1.0 m 用时 t = √(2×1.0/2) = 1.0 s，落地速率 v = 2 m/s；随后细绳松弛，m₁ 继续竖直上抛高度 h' = 4/20 = 0.2 m。",
    planHint:
      "stages: pulley_system(body1Mass:2, body2Mass:3, surface:{kind:'hanging'}, body2DropToGroundM:1.0)",
  },
  {
    id: "gk-pulley-horizontal-table-31",
    title: "粗糙水平桌面滑轮连接体与悬挂物落地滑停",
    source: "高考经典母题 · 桌面滑轮连接体",
    difficulty: "中档",
    stageSignature: ["pulley_system"],
    tags: ["定滑轮连接体", "粗糙桌面", "整体法隔离法", "松绳滑停"],
    stem: "粗糙水平桌面（动摩擦因数 μₖ = 0.2）上静置质量 m₁ = 3 kg 的物块 A，经平行于桌面的轻绳绕过桌边理想定滑轮与竖直悬挂的质量 m₂ = 2 kg 的物块 B 相连，A 距滑轮足够远，B 距地面高 h = 1.4 m，由静止释放后 B 向下运动，g = 10 m/s²，求 B 下落过程中的加速度、轻绳张力及 B 落地后 A 在桌面上继续滑行的距离。",
    keyFormulas: [
      "a = (m₂g - μm₁g) / (m₁ + m₂)",
      "T = m₂(g - a) = m₁(a + μg)",
      "B 落地后 A 减速滑行：s = v² / (2μg)",
    ],
    pitfalls: [
      "整体法求加速度时忘记把悬挂物质量 m₂ 计入总质量 (m₁ + m₂)，误写成 (m₂g - μm₁g)/m₁",
      "计算 A 的总位移时漏加 B 下落阶段的位移 h",
    ],
    solutionOutline:
      "整体法得加速度 a = (20 - 6)/(3 + 2) = 2.8 m/s²，轻绳张力 T = 2×(10 - 2.8) = 14.4 N。B 下落 1.4 m 用时 t = √(2×1.4/2.8) = 1.0 s，落地速度 v = 2.8 m/s；此后轻绳松弛，A 在桌面以 2 m/s² 减速滑行 s = 7.84/4 = 1.96 m 停下。",
    planHint:
      "bodies 分别给 A 的 massKg:3、B 的 massKg:2；stages: pulley_system(body1Id:'A', body2Id:'B', surface:{kind:'horizontal', kineticFrictionCoefficient:0.2, slidesAfterRelease:true}, body2DropToGroundM:1.4)",
  },
  {
    id: "gk-pulley-incline-slack-32",
    title: "斜面滑轮连接体：悬挂物落地松绳后斜面物块继续上滑",
    source: "高考压轴母题 · 斜面滑轮与松绳多过程",
    difficulty: "拔高",
    stageSignature: ["pulley_system"],
    tags: ["斜面定滑轮", "连接体", "落地松绳", "二次匀减速上滑"],
    stem: "倾角约 37°（sinθ = 3/5、cosθ = 4/5）、足够长的粗糙斜面（动摩擦因数 μₖ = 0.25）上静置质量 m₁ = 2 kg 的物块 A，经平行于斜面的轻绳绕过斜面顶端理想定滑轮与竖直悬挂的质量 m₂ = 3 kg 的物块 B 相连，B 距地面高 h = 1.4 m，由静止释放后 B 向下运动，g = 10 m/s²，求 B 落地瞬间的速度大小及落地松绳后 A 沿斜面继续上滑的最大距离。",
    keyFormulas: [
      "拉动阶段：a₁ = [m₂g - m₁g(sinθ + μcosθ)] / (m₁ + m₂)",
      "松绳阶段：a₂ = g(sinθ + μcosθ)",
      "继续上滑距离：s₂ = v² / (2a₂) = (2a₁h) / (2a₂)",
    ],
    pitfalls: [
      "B 落地松绳后，A 沿斜面继续上滑时摩擦力仍沿斜面向下，减速加速度为 g(sinθ + μcosθ) 而非 gsinθ",
      "题面已给 B 从静止向下运动；若没有起动事实，须有静摩擦信息才能判定启动",
    ],
    solutionOutline:
      "A 上滑阻力 m₁g(sin37° + μcos37°) = 16 N < m₂g = 30 N，系统加速 a₁ = (30 - 16)/5 = 2.8 m/s²。B 下落 1.4 m 用时 1.0 s，落地速率 v = 2.8 m/s。松绳后 A 以 a₂ = 8 m/s² 沿斜面匀减速上滑，继续上滑距离 s₂ = 7.84/16 = 0.49 m，总上滑距离 1.89 m。",
    planHint:
      "bodies 分别给 A 的 massKg:2、B 的 massKg:3；stages: pulley_system(body1Id:'A', body2Id:'B', surface:{kind:'incline', angleDeg:36.86989764584402, kineticFrictionCoefficient:0.25, slidesAfterRelease:true}, body2DropToGroundM:1.4)",
  },
];
