/**
 * 把 skills/vision-reading.v1.md 内联成 TS 模块。
 *
 * 为什么需要：Qoder Sites 的云函数只打包 functions/ 目录，运行时读不到
 * 项目里的 skills/*.md，所以把 Skill 文案在构建前生成成常量随函数一起上传。
 *
 * 用法：node scripts/build-skill-module.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "skills", "vision-reading.v1.md");
const target = join(root, "functions", "skill.ts");

const skill = readFileSync(source, "utf8");
const body = [
  "// 由 scripts/build-skill-module.mjs 从 skills/vision-reading.v1.md 生成，请勿手改。",
  "// 修改 Skill 文案请改源文件后重新运行：node scripts/build-skill-module.mjs",
  `export const SKILL_TEXT: string = ${JSON.stringify(skill)};`,
  "",
].join("\n");

mkdirSync(join(root, "functions"), { recursive: true });
writeFileSync(target, body, "utf8");
console.log(`functions/skill.ts 已生成：${skill.length} 字符`);
