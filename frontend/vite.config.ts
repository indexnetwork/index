import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { existsSync, statSync, readFileSync, writeFileSync } from "fs";

const PUBLIC_DIR = path.resolve(__dirname, "public");
const SPRITES_JSON = path.join(PUBLIC_DIR, "edge-city", "healdsburg", "sprites.json");

function publicDirectoryIndex(): PluginOption {
  return {
    name: "public-directory-index",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || req.method !== "GET") return next();
        const [pathname, query] = req.url.split("?");
        if (!pathname || pathname === "/" || pathname.includes("..") || path.extname(pathname)) return next();
        const candidate = path.join(PUBLIC_DIR, pathname, "index.html");
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          if (!pathname.endsWith("/")) {
            res.statusCode = 308;
            res.setHeader("Location", pathname + "/" + (query ? "?" + query : ""));
            res.end();
            return;
          }
          const html = readFileSync(candidate, "utf-8");
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(html);
          return;
        }
        next();
      });
    },
  };
}

// Dev-only: POST /__edge-city/save-sprites with { positions: [{ id, position: {x, y} }] }
// merges new positions into sprites.json on disk (preserving image, icon, story, size).
function edgeCitySpritesSave(): PluginOption {
  return {
    name: "edge-city-sprites-save",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "POST" || req.url !== "/__edge-city/save-sprites") return next();
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body) as { positions: Array<{ id: string; position: { x: number; y: number } }> };
            if (!payload?.positions || !Array.isArray(payload.positions)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "missing positions[]" }));
              return;
            }
            const current = JSON.parse(readFileSync(SPRITES_JSON, "utf-8")) as Array<{ id: string; position: { x: number; y: number } }>;
            const byId = new Map(payload.positions.map((p) => [String(p.id), p.position]));
            const merged = current.map((s) => {
              const next = byId.get(String(s.id));
              return next ? { ...s, position: { x: next.x, y: next.y } } : s;
            });
            writeFileSync(SPRITES_JSON, JSON.stringify(merged, null, 2) + "\n", "utf-8");
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, count: merged.length }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), publicDirectoryIndex(), edgeCitySpritesSave()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  preview: {
    port: parseInt(process.env.PORT || "4173", 10),
    host: "0.0.0.0",
    allowedHosts: true,
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: process.env.VITE_PROTOCOL_URL || "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
