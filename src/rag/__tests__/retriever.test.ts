import { describe, expect, it } from "vitest";
import {
  buildChatRagQuery,
  extractStageKindsFromContext,
  formatRagForSimilar,
  formatRagForTutor,
  formatRagForVision,
  PHYSICS_RAG_CORPUS,
  searchPhysicsRag,
  tokenizePhysicsText,
  toRagReferences,
  type RagKnowledgeEntry,
} from "../index.ts";

const SYNTHETIC_CORPUS: readonly RagKnowledgeEntry[] = [
  {
    id: "syn-incline-spring-basic",
    title: "粗糙斜面滑下接光滑水平面压缩轻弹簧",
    source: "高考经典母题 · 能量与弹簧",
    difficulty: "基础",
    stageSignature: ["incline_slide", "lossless_turn", "horizontal_slide", "spring_contact"],
    tags: ["斜面", "动摩擦", "弹簧压缩", "动能定理"],
    stem: "倾角 37°、长 4 m 的粗糙斜面（动摩擦因数 μ = 0.25）底端平滑连接光滑水平面，距离坡底 1 m 处有一轻弹簧（k = 400 N/m，不拴接），质量 1 kg 物块由静止释放，g = 10 m/s²，求坡底速度与最大压缩量。",
    keyFormulas: ["mgL·sinθ - μmgL·cosθ = ½mv²", "½mv² = ½kx_max²"],
    pitfalls: ["弹簧不拴接时物块在恢复原长处脱离"],
    solutionOutline: "斜面段用动能定理求坡底速度，弹簧段用机械能守恒求最大压缩量。",
    planHint: "stages: incline_slide -> lossless_turn -> horizontal_slide -> spring_contact",
  },
  {
    id: "syn-movable-arc-spring",
    title: "可移动光滑圆弧槽反冲与自由弹簧双球临界",
    source: "高考压轴母题 · 动量与圆弧槽",
    difficulty: "拔高",
    stageSignature: ["movable_arc", "spring_pair"],
    tags: ["可移动圆弧槽", "水平动量守恒", "人船模型", "弹簧双球", "共速"],
    stem: "质量 M = 3 kg、半径 R = 0.6 m 的四分之一光滑圆弧槽静置在光滑水平面上，小球 m1 = 1 kg 从槽顶静止滑下后压缩静止小球 m2 所连自由弹簧，m1 反弹恰好不能再次滑上圆弧槽，g = 10 m/s²。",
    keyFormulas: ["0 = m1v1 + Mv槽", "m1gR = ½m1v1² + ½Mv槽²"],
    pitfalls: ["圆弧槽系统仅水平方向动量守恒，总动量不守恒"],
    solutionOutline: "球槽分离联立水平动量与机械能守恒；由反弹速度等于槽速反求 m2。",
    planHint: "stages: movable_arc -> spring_pair(matchGrooveSpeed:true)",
  },
  {
    id: "syn-conveyor-proj-mid",
    title: "水平传送带加速共速后右端平抛落地",
    source: "高考高频母题 · 传送带与抛体",
    difficulty: "中档",
    stageSignature: ["conveyor_belt", "projectile"],
    tags: ["传送带", "共速", "划痕", "平抛"],
    stem: "水平传送带以 v = 4 m/s 向右匀速运行，长 L = 6 m，右端高出地面 h = 1.25 m。质量 1 kg 物块轻放左端，动摩擦因数 μ = 0.2，g = 10 m/s²，求到达右端速度与平抛水平射程。",
    keyFormulas: ["a = μg", "x = v·√(2h/g)"],
    pitfalls: ["先判断是否在离开传送带前达到共速，再算相对位移划痕"],
    solutionOutline: "比较加速位移与带长判断共速情况，再按平抛求水平射程。",
    planHint: "stages: conveyor_belt -> projectile(dropHeightM:1.25)",
  },
  {
    id: "syn-conveyor-incline-hard",
    title: "水平传送带接光滑斜面折返再从左端平抛",
    source: "高考综合母题 · 传送带折返",
    difficulty: "拔高",
    stageSignature: ["conveyor_belt", "incline_slide", "conveyor_belt", "projectile"],
    tags: ["传送带", "斜面", "折返", "平抛"],
    stem: "水平传送带右端平滑连接足够长光滑斜面、左端高出地面 h = 0.8 m，物块以初速度向右冲上传送带，经斜面折返后从左端水平飞出，g = 10 m/s²。",
    keyFormulas: ["v² = 2μgx", "h = ½gt²"],
    pitfalls: ["折返再次进入传送带时速度方向向左，需重新判断相对运动方向"],
    solutionOutline: "分段追踪向右与向左经过传送带的末速度，最后按左端平抛求解。",
    planHint: "stages: conveyor_belt -> incline_slide(upAndBack) -> conveyor_belt -> projectile",
  },
  {
    id: "syn-conveyor-basic",
    title: "倾斜传送带静止释放物块匀加速下滑",
    source: "高考基础母题 · 倾斜传送带",
    difficulty: "基础",
    stageSignature: ["conveyor_belt"],
    tags: ["倾斜传送带", "共速", "滑动摩擦"],
    stem: "倾角 37°、长 8 m 的倾斜传送带以 4 m/s 顺时针向下匀速运行，动摩擦因数 μ = 0.5，物块从顶端静止释放，g = 10 m/s²，求滑到底端时间。",
    keyFormulas: ["a1 = g(sinθ + μcosθ)", "a2 = g(sinθ - μcosθ)"],
    pitfalls: ["物块速度超过带速瞬间滑动摩擦力反向，加速度发生突变"],
    solutionOutline: "以共速为界分两段牛顿第二定律求加速度与时间。",
    planHint: "stages: conveyor_belt(angleDeg:37)",
  },
  {
    id: "syn-conveyor-proj-dup-diff",
    title: "高速物块滑上传送带减速共速接平抛",
    source: "高考高频母题 · 传送带减速与抛体",
    difficulty: "中档",
    stageSignature: ["conveyor_belt", "projectile"],
    tags: ["传送带", "共速", "平抛"],
    stem: "水平传送带速度 v = 3 m/s，长 L = 8 m，右端距地 h = 1.25 m，质量 1 kg 滑块以 v0 = 5 m/s 滑上传送带，μ = 0.2，g = 10 m/s²，求离开传送带后的平抛水平射程。",
    keyFormulas: ["v1² - v0² = -2μgx", "x = v·√(2h/g)"],
    pitfalls: ["初速度大于带速时物块受向左摩擦力做匀减速运动"],
    solutionOutline: "先求减速到共速的位移判断能否共速，再算平抛。",
    planHint: "stages: conveyor_belt -> projectile",
  },
];

describe("Physics Hybrid RAG 检索引擎", () => {
  it("领域分词器正确切分高中物理复合词并补充中文 2-gram", () => {
    const { tokens, domainTerms } = tokenizePhysicsText("可移动圆弧槽与弹簧双球满足水平动量守恒，阶段 movable_arc");
    expect(domainTerms.has("可移动圆弧槽")).toBe(true);
    expect(domainTerms.has("圆弧槽")).toBe(true);
    expect(domainTerms.has("弹簧双球")).toBe(true);
    expect(domainTerms.has("水平动量守恒")).toBe(true);
    expect(domainTerms.has("movable_arc")).toBe(true);
    expect(tokens.length).toBeGreaterThan(5);
  });

  it("默认内置 PHYSICS_RAG_CORPUS 可正常检索并归一化得分至 (0, 1]", () => {
    const hits = searchPhysicsRag({
      text: "可动圆弧槽静止在光滑水平面，小球从槽顶滑下后压缩自由弹簧双球",
      stageKinds: ["movable_arc", "spring_pair"],
      mode: "tutor",
      topK: 3,
    });

    expect(PHYSICS_RAG_CORPUS.length).toBeGreaterThanOrEqual(2);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].entry.stageSignature).toContain("movable_arc");
    expect(hits[0].score).toBeGreaterThan(0);
    expect(hits[0].score).toBeLessThanOrEqual(1);
    expect(Number(hits[0].score.toFixed(3))).toBe(hits[0].score);
    expect(hits[0].matchedReasons.some((r) => r.includes("阶段链匹配"))).toBe(true);
    expect(hits[0].matchedReasons.some((r) => r.includes("命中考点"))).toBe(true);
  });

  it("通道 A：阶段图谱匹配区分顺序与首阶段加分，完全一致给出 100%", () => {
    const exact = searchPhysicsRag(
      { stageKinds: ["movable_arc", "spring_pair"], mode: "tutor", topK: 2 },
      SYNTHETIC_CORPUS,
    );
    expect(exact[0].entry.id).toBe("syn-movable-arc-spring");
    expect(exact[0].score).toBe(1);
    expect(exact[0].matchedReasons).toContain("阶段链匹配 100%");

    const reversed = searchPhysicsRag(
      { stageKinds: ["spring_pair", "movable_arc"], mode: "tutor", topK: 2 },
      SYNTHETIC_CORPUS,
    );
    expect(reversed[0].entry.id).toBe("syn-movable-arc-spring");
    expect(reversed[0].score).toBeLessThan(exact[0].score);
  });

  it("通道 B：完全无关文本被噪声阈值过滤，返回空数组", () => {
    const hits = searchPhysicsRag(
      { text: "今天午饭吃红烧肉配清炒西兰花，苯环有机化学酯化反应", mode: "vision", topK: 3 },
      SYNTHETIC_CORPUS,
    );
    expect(hits).toEqual([]);
  });

  it("通道 C（vision 模式）：侧重题干/标签召回拆段母题，且 formatRagForVision 严格 ≤ 600 字", () => {
    const hits = searchPhysicsRag(
      {
        text: "物块轻放在向右运行的水平传送带左端，加速共速后从右端高台平抛落地，求划痕与射程",
        mode: "vision",
        topK: 2,
      },
      SYNTHETIC_CORPUS,
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].entry.id).toBe("syn-conveyor-proj-mid");

    const visionPrompt = formatRagForVision(hits);
    expect(visionPrompt).toContain(hits[0].entry.planHint);
    expect(visionPrompt.length).toBeGreaterThan(20);
    expect(visionPrompt.length).toBeLessThanOrEqual(600);
    expect(formatRagForVision([])).toBe("");
  });

  it("通道 C（similar 模式）：近乎雷同原题干被降权，且 MMR 提升难度与考点多样性", () => {
    const originalStem = SYNTHETIC_CORPUS[2].stem; // syn-conveyor-proj-mid
    const hits = searchPhysicsRag(
      {
        text: originalStem,
        stageKinds: ["conveyor_belt", "projectile"],
        mode: "similar",
        topK: 3,
      },
      SYNTHETIC_CORPUS,
    );

    expect(hits.length).toBe(3);
    // 雷同条目（Jaccard > 0.85）应被降权，不能排在第一位
    expect(hits[0].entry.id).not.toBe("syn-conveyor-proj-mid");
    expect(hits[0].entry.id).toBe("syn-conveyor-proj-dup-diff");
    // Top-3 应覆盖多种难度（MMR 多样性）
    const difficulties = new Set(hits.map((h) => h.entry.difficulty));
    expect(difficulties.size).toBeGreaterThanOrEqual(2);
  });

  it("格式化器与 toRagReferences / buildChatRagQuery 输出完整契约字段", () => {
    const hits = searchPhysicsRag(
      {
        text: "为什么圆弧槽水平动量守恒但总动量不守恒？",
        stageKinds: ["movable_arc", "spring_pair"],
        mode: "tutor",
        topK: 3,
      },
      SYNTHETIC_CORPUS,
    );

    const tutorPrompt = formatRagForTutor(hits);
    expect(tutorPrompt).toContain("核心规律/二级结论");
    expect(tutorPrompt).toContain("高频易错与临界判据");
    expect(tutorPrompt).toContain("标准解题思路");

    const similarPrompt = formatRagForSimilar(hits);
    expect(similarPrompt).toContain("母题题干参考");
    expect(similarPrompt).toContain("阶段链");

    const refs = toRagReferences(hits);
    expect(refs[0]).toMatchObject({
      id: "syn-movable-arc-spring",
      title: SYNTHETIC_CORPUS[1].title,
      difficulty: "拔高",
    });
    expect(refs[0].score).toBeGreaterThan(0);
    expect(refs[0].matchedReasons.length).toBeGreaterThan(0);

    // 兼容 stage_plan 与旧 incline_spring 模板的阶段提取
    expect(
      extractStageKindsFromContext({
        reading: { kind: "stage_plan", stages: [{ kind: "conveyor_belt" }, { kind: "projectile" }] },
      }),
    ).toEqual(["conveyor_belt", "projectile"]);
    expect(
      extractStageKindsFromContext({ reading: { templateId: "incline_spring" } }),
    ).toEqual(["incline_slide", "lossless_turn", "horizontal_slide", "spring_contact"]);

    const chatQuery = buildChatRagQuery(
      "弹簧最大压缩量怎么算？",
      { problemText: "粗糙斜面滑下压缩轻弹簧", reading: { templateId: "incline_spring" } },
      "tutor",
    );
    expect(chatQuery.mode).toBe("tutor");
    expect(chatQuery.stageKinds).toEqual(["incline_slide", "lossless_turn", "horizontal_slide", "spring_contact"]);
    expect(chatQuery.text).toContain("粗糙斜面");
    expect(chatQuery.text).toContain("弹簧最大压缩量");
  });
});
