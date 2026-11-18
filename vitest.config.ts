import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 物理层使用 node:test，另以 Node 原生 TypeScript 命令执行。
    exclude: [...configDefaults.exclude, "src/physics/*.test.ts"],
  },
});
