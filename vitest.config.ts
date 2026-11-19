import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 物理层使用 node:test，另以 Node 原生 TypeScript 命令执行。
    // .claude/worktrees 是本地并行会话的 git worktree 副本，不参与本仓库的用例发现。
    exclude: [...configDefaults.exclude, "src/physics/*.test.ts", ".claude/**"],
  },
});
