/**
 * 把阶段组合的校验与状态映射同步进云函数目录。
 *
 * 为什么需要：Qoder Sites 云函数只打包 functions/，不能 import 项目里的 src/。
 * 但这两份逻辑必须与 Node 服务**完全同源**，否则同一个 fixture 在两端会得到
 * 不同的 status / missingKeys —— 这正是契约第 2 节要防的事。
 *
 * 做法：原样复制 src 里的源文件，只把相对 import 补上 Deno 要求的 .ts 扩展名。
 * 不在云函数目录里手写第二份实现。
 *
 * 用法：node scripts/sync-functions.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 源文件 → 云函数文件。顺序即依赖顺序，便于阅读。 */
const FILES = [
  { from: "src/physics/springEnergy.ts", to: "functions/springEnergy.ts" },
  { from: "src/physics/stagePlan.ts", to: "functions/stagePlan.ts" },
  { from: "src/api/stageTypes.ts", to: "functions/stageTypes.ts" },
  { from: "src/api/stageStatus.ts", to: "functions/stageStatus.ts" },
  { from: "src/api/legacyBridge.ts", to: "functions/legacyBridge.ts" },
];

/** Deno 要求相对导入带显式扩展名；src 里走 TS 解析，可以省略。 */
function withDenoExtensions(code) {
  return code.replace(
    /(from\s+['"])(\.\/[^'"]+?)(['"])/g,
    (_match, head, specifier, tail) =>
      /\.(ts|tsx|js|mjs)$/.test(specifier) ? `${head}${specifier}${tail}` : `${head}${specifier}.ts${tail}`,
  );
}

let total = 0;
for (const { from, to } of FILES) {
  const source = readFileSync(join(root, from), "utf8");
  const header = [
    `// 由 scripts/sync-functions.mjs 从 ${from} 复制生成，请勿手改。`,
    "// 改动请改源文件后重新运行：node scripts/sync-functions.mjs",
    "",
  ].join("\n");
  const output = header + withDenoExtensions(source);
  writeFileSync(join(root, to), output, "utf8");
  total += 1;
  console.log(`${to} ← ${from}`);
}

console.log(`已同步 ${total} 个文件。记得同时运行 build-skill-module.mjs 生成 skill.ts。`);
