import { execSync } from "node:child_process";

const token = execSync(
  `printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill`,
  { encoding: "utf8" },
).split("\n").find((line) => line.startsWith("password="))?.slice(9);

const api = "https://api.github.com/repos/Zhri1/VisualLab";
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
  "User-Agent": "visuallab-ci",
};

async function call(path, init = {}) {
  const response = await fetch(api + path, { ...init, headers });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

// ---------- 1. 关闭 #11 ----------
const closeBody = `## 关闭原因

这个 PR 的整题方案（\`batchMotion\` / \`batchReading\` / \`batch.test\`，四套 \`templateId\` 分派）已被 #18 的有序阶段组合取代：

- 题目不再被压成四个固定模板，而是按 \`stages[]\` 逐段求解，段与段的接续由契约校验，不再靠 \`templateId\` 分派。
- 同一道题里「斜面 → 转向 → 水平 → 弹簧 / 抛体」可以自由组合，模板数量不再随题面变化膨胀。

## 保留了什么

本 PR 里已提取的低层公式**没有丢**，它们现在在 \`src/physics/kinematics.ts\`（#18 已合入 main）：

| 导出 | 用途 |
|---|---|
| \`linearState\` | 匀变速直线运动的状态 |
| \`landingTime\` | 重力场中落到指定高度的时间 |
| \`springMetrics\` | 弹簧接触的角频率与最大压缩量 |
| \`springState\` | 弹簧接触段任意时刻的状态 |

\`stageMotion.ts\` 的斜面、水平、弹簧、抛体四段都在调用这四个函数，而不是各写一份。

## 没有保留什么

\`batchMotion.ts\` / \`batchReading.ts\` / \`batch.test.ts\` 与四个 \`fixtures/*.reading.json\` 不进入 main —— 它们的职责已被 \`stagePlan.ts\`（校验）与 \`stageMotion.ts\`（装配）覆盖，留着会变成第二套真相。

关闭，不合并。`;
const closeComment = await call("/issues/11/comments", {
  method: "POST",
  body: JSON.stringify({ body: closeBody }),
});
console.log("#11 comment:", closeComment.status);
const closed = await call("/pulls/11", {
  method: "PATCH",
  body: JSON.stringify({ state: "closed" }),
});
console.log("#11 close:", closed.status, closed.body.state);

// ---------- 2. 合并 #17 ----------
const pr = await call("/pulls/17");
console.log("#17:", pr.body.mergeable, pr.body.mergeable_state, "head", pr.body.head.sha.slice(0, 7));

const reviewBody = `## 审核结论：可以合并

对照 #18 合并后的 main 复核，这个 PR 现在做的是三件事，都成立。

### 1. 共享校验真的接进了两端

不是状态映射的复制，而是同一份实现：\`scripts/sync-functions.mjs\` 从 \`src/\` 复制
\`stagePlan.ts\` / \`stageTypes.ts\` / \`stageStatus.ts\` / \`legacyBridge.ts\` 进 \`functions/\`，
只给相对 import 补 Deno 必需的 \`.ts\` 扩展名。

\`src/api/__tests__/sync.test.ts\` 把「副本与源文件逐字一致」锁进 CI。这道防线在本轮真的响过：
合并 B 的 \`489e80e\` 后它当场报出 \`functions/stagePlan.ts\` 过期。

### 2. 回包形状由环境变量决定，不是写死

内部统一按 \`stage_plan\` 校验，出口由 \`API_CONTRACT_MODE\` 决定：

- \`legacy\`（默认）：压回 \`{ templateId, conditions, facts }\`，旧前端直接可用；
- \`stage_plan\`：原样返回阶段计划。

兼容桥只认契约允许的两种接续（四段含水平段、三段无水平段），三段时 \`springGapM\` 留
\`null\` 让前端追问，不填 0 冒充「紧贴坡底」—— 模型漏段和题面真的紧贴在这里分不清。

### 3. 超范围题不再降级成追问

\`validateReading\` 返回 UNSUPPORTED 时原样透传，不再拼成 \`needs_input\`。
前提冲突（有摩擦的水平面、有初速度）不是缺值，追问也补不出来。

### 合并后的部署约束（重要）

A 的 #19 前端直接消费 \`stage_plan\`，而本 PR 默认仍是 \`legacy\`。两者不能各发各的：

1. 先合 #19；
2. 把 \`outputContractFromEnv\` 的默认值改成 \`stage_plan\`（一行），或部署时注入
   \`API_CONTRACT_MODE=stage_plan\`；
3. 前端与云函数**同一次** \`prepare_site\` / \`publish_site\` 发布。

顺序反了就会出现「云函数返回 stage_plan、静态前端仍按旧格式解析」。本 PR 只合代码，不触发发布。`;

const review = await call("/pulls/17/reviews", {
  method: "POST",
  body: JSON.stringify({ event: "APPROVE", body: reviewBody }),
});
console.log("#17 review:", review.status, review.body.state ?? JSON.stringify(review.body).slice(0, 200));

// 等 CI
const sha = pr.body.head.sha;
let conclusion = null;
for (let i = 0; i < 24; i++) {
  const checks = await call(`/commits/${sha}/check-runs`);
  const runs = checks.body.check_runs || [];
  if (runs.length && runs.every((run) => run.status === "completed")) {
    conclusion = runs.every((run) => run.conclusion === "success") ? "success" : "failure";
    console.log(`  [${i}] ${runs.map((run) => `${run.name}=${run.conclusion}`).join(" ")}`);
    break;
  }
  console.log(`  [${i}] waiting`);
  await new Promise((resolve) => setTimeout(resolve, 10000));
}
console.log("CI:", conclusion ?? "timeout");

if (conclusion !== "success") {
  console.log("CI 未通过或超时，未合并");
  process.exit(1);
}

const merged = await call("/pulls/17/merge", {
  method: "PUT",
  body: JSON.stringify({
    merge_method: "squash",
    commit_title: "feat(api): stage_plan 状态映射与两端共用入口 (#17)",
  }),
});
console.log("MERGE #17:", merged.status, merged.body.merged ? "merged" : JSON.stringify(merged.body).slice(0, 300));
