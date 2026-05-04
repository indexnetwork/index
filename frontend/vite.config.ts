import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { existsSync, statSync, readFileSync } from "fs";

const PUBLIC_DIR = path.resolve(__dirname, "public");

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

export default defineConfig({
  plugins: [react(), tailwindcss(), publicDirectoryIndex()],
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
