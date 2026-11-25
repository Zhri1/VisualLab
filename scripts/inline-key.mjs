/**
 * 构建期密钥注入（Qoder 云函数专用）。
 *
 * Qoder 平台不允许 CLI 写 Secret（`secretValueInput: false`，`sites operations`
 * 里只有 `delete_secret`），密钥值只能在客户端手工填一次。在填之前，用本脚本
 * 把本地 `.env` 里的 Key 临时写进 `functions/inline-key.ts`，让 `prepare_site`
 * 打进函数包，首轮打包完成后立刻 `restore`。若 `prepare_site` 返回
 * `descriptorStatus: "pending"`，等 `canPublish` 变为 `true` 后用同一
 * `actionId` 和同一入参再跑一次 `prepare_site` 时，平台会从冻结的 ZIP 恢复而
 * 不重新打包，因此无需再次 `inject`。
 *
 * 仓库是 public，所以 `functions/inline-key.ts` 在 git 里必须是空值。
 * 本脚本的 `restore` 就是保证这一点，任何注入都必须配对还原。
 *
 * 用法：
 *   node scripts/inline-key.mjs inject     # 从 .env 读 Key 写入
 *   node scripts/inline-key.mjs restore    # 还原为空值
 *   node scripts/inline-key.mjs status     # 只看当前是否为空，不打印 Key
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "functions", "inline-key.ts");
const envFile = join(root, ".env");

const HEADER = `/**
 * 构建期注入的密钥占位（Qoder 云函数专用）。
 *
 * 仓库里这个值**永远是空字符串**，真实值只在 \`prepare_site\` 打包的那一刻由
 * \`scripts/inline-key.mjs\` 从本地 \`.env\` 写入，打包完成后立刻还原。
 *
 * 为什么要这么绕：Qoder 平台把 CLI 上下文的 \`secretValueInput\` 固定为 \`false\`，
 * \`sites operations\` 里也没有 set secret 操作，密钥值只能在客户端手工填一次。
 * 在填之前，用构建期注入让函数先跑起来。
 *
 * 优先级：平台 Secret（\`Deno.env\`）> 本文件的构建期注入值。
 * 一旦在站点设置里填了 \`DASHSCOPE_API_KEY\`，Secret 会覆盖这里的值，本文件可长期留空。
 *
 * 注意：本仓库是 public，任何情况下都不要把真实 Key 提交进 git。
 */
`;

function readKeyFromEnv() {
  const text = readFileSync(envFile, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*DASHSCOPE_API_KEY\s*=\s*(.*)$/.exec(line);
    if (match) return match[1].trim();
  }
  return "";
}

function readInjected() {
  const text = readFileSync(target, "utf8");
  const match = /export const INLINE_API_KEY = "([^"]*)";/.exec(text);
  return match ? match[1] : "";
}

const command = process.argv[2] ?? "status";

if (command === "inject") {
  const key = readKeyFromEnv();
  if (!key) {
    console.error("✗ .env 里没有 DASHSCOPE_API_KEY，无法注入");
    process.exit(1);
  }
  writeFileSync(target, `${HEADER}export const INLINE_API_KEY = ${JSON.stringify(key)};\n`, "utf8");
  console.log(`✓ 已注入：${key.length} 字符，前缀 ${key.slice(0, 8)}…（打包后务必 restore）`);
} else if (command === "restore") {
  writeFileSync(target, `${HEADER}export const INLINE_API_KEY = "";\n`, "utf8");
  console.log("✓ 已还原为空值");
} else {
  const injected = readInjected();
  console.log(injected ? `! 当前已注入：${injected.length} 字符（打包完成后记得 restore）` : "✓ 当前为空值");
}
