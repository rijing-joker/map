import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const publicHost = env.PUBLIC_HOST || "map.rjsyfe324.ccwu.cc";

  return {
    plugins: [react()],
    server: {
      allowedHosts: [publicHost],
      proxy: {
        "/api": "http://127.0.0.1:5174"
      },
      hmr: env.PUBLIC_HOST
        ? {
            host: publicHost,
            protocol: "wss",
            clientPort: 443
          }
        : undefined
    }
  };
});
