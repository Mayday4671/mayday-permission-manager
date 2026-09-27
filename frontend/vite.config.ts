import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** 开发期通过同源代理访问后端，部署时由 Nginx 接管 /api，业务代码无需切换地址。 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 15173,
    strictPort: true,
    proxy: { "/api": process.env.VITE_API_TARGET ?? "http://127.0.0.1:18080" },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
