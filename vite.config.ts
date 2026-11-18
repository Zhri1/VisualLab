import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发期若 VITE_API_BASE 留空，/api 会走这里的代理。
// 端口只是本地默认值，成员 C 的服务起来后按实际端口改，或用 VITE_API_BASE 覆盖。
const PROXY_TARGET = process.env.VITE_PROXY_TARGET ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
});
