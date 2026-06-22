import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
