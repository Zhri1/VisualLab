import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

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

const body = `## 问题

\`sampleAt\` 用严格相等匹配事件时刻，而事件时刻是各段时长累加出来的：

\`\`\`
reach_bottom  t = 1.2000000000000002   (十进制 1.2 差 1 ulp)
\`\`\`

播放进度按十进制推进（1.2 s），匹配不上，画面停在坡底前一瞬：

| 采样 | vx | vy | 含义 |
|---|---|---|---|
| \`sampleAt(1.2)\` 修复前 | 5.196 | -3 | 仍在斜面上 |
| \`sampleAt(1.2)\` 修复后 | 6 | 0 | 已过无损转向 |

## 改法

匹配改为 \`Math.abs(events[i].timeSeconds - t) <= 1e-9\`。容差只吸收浮点累加误差：
前端按 \`t ± 1e-7\` 取事件前后状态，1e-7 远大于 1e-9，事件前语义不变（有用例守着）。

## 验证

- 新增回归用例：去掉容差时失败（vx 差 0.804 m/s），加上后通过。
- \`src/physics/__tests__/stageMotion.test.ts\` 14 条通过。
- 全量 vitest 88 条通过，\`tsc --noEmit\` 无错误。

## 来源

A 在 #19 里为绕开这个问题直接改了 \`src/physics/stageMotion.ts\`。这是 B 的实现边界，
改动收回到这里，A 的 PR 可以删掉那个 hunk，避免同一行两边都改。
`;

const created = await call("/pulls", {
  method: "POST",
  body: JSON.stringify({
    title: "fix(physics): 事件时刻按 1e-9 容差匹配，十进制进度不再错过转向",
    head: "fix/stage-motion-ulp",
    base: "main",
    body,
  }),
});

if (created.status !== 201) {
  console.log("CREATE_FAILED", created.status, JSON.stringify(created.body).slice(0, 400));
  process.exit(1);
}
const number = created.body.number;
console.log(`PR #${number} created`);
writeFileSync(".pr-number", String(number));

// 等 CI，最多 4 分钟
const sha = created.body.head.sha;
let conclusion = null;
for (let i = 0; i < 24; i++) {
  await new Promise((resolve) => setTimeout(resolve, 10000));
  const checks = await call(`/commits/${sha}/check-runs`);
  const runs = checks.body.check_runs || [];
  if (runs.length === 0) {
    console.log(`  [${i}] 还没有 check`);
    continue;
  }
  const states = runs.map((run) => `${run.name}=${run.status}/${run.conclusion ?? "-"}`);
  console.log(`  [${i}] ${states.join(" ")}`);
  if (runs.every((run) => run.status === "completed")) {
    conclusion = runs.every((run) => run.conclusion === "success") ? "success" : "failure";
    break;
  }
}
console.log("CI:", conclusion ?? "timeout");
if (conclusion !== "success") {
  console.log("CI 未通过，不合并");
  process.exit(1);
}

const merged = await call(`/pulls/${number}/merge`, {
  method: "PUT",
  body: JSON.stringify({
    merge_method: "squash",
    commit_title: `fix(physics): 事件时刻按 1e-9 容差匹配，十进制进度不再错过转向 (#${number})`,
  }),
});
console.log("MERGE", merged.status, merged.body.merged ? "merged" : JSON.stringify(merged.body).slice(0, 300));
