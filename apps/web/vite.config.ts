import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Runtime env files (.env.development, .env.test, ...) live at the repo root —
// see the root .env.example. Only VITE_-prefixed vars are exposed to the bundle.
const envDir = path.resolve(__dirname, "../..");

export default defineConfig(({ mode, command }) => {
  // Merge file-based vars (root .env*) with process vars (Railway injects
  // variables directly into the environment; loadEnv only reads files).
  const fileEnv = loadEnv(mode, envDir, "VITE_");
  const env = { ...fileEnv, ...process.env };

  // Deployment guard: a production bundle without VITE_PROTOCOL_URL silently
  // falls back to '' and breaks auth/API calls. Hard-fail on Railway; warn
  // everywhere else (local/CI production builds are fine without it).
  if (command === "build" && mode === "production" && !env.VITE_PROTOCOL_URL) {
    const onRailway = Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME);
    const message =
      "VITE_PROTOCOL_URL is not set for a production build — the web app would " +
      "silently fall back to '' for all API/auth calls. Set it on the Railway web service.";
    if (onRailway) throw new Error(message);
    console.warn(`⚠️ ${message}`);
  }

  return {
    envDir,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        // Keep the reporter kickoff marker browser-safe without bundling the
        // protocol runtime barrel (which includes Node-only graph modules).
        "@indexnetwork/protocol": path.resolve(
          __dirname,
          "../../packages/protocol/src/chat/reporter.prompt.ts",
        ),
      },
    },
    preview: {
      port: parseInt(env.PORT || "4173", 10),
      host: "0.0.0.0",
      allowedHosts: true,
    },
    server: {
      port: 3000,
      proxy: {
        "/api": {
          target: env.VITE_PROTOCOL_URL || "http://localhost:3001",
          changeOrigin: true,
        },
      },
    },
  };
});
