import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import dts from "vite-plugin-dts";
import { resolve } from "path";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    dts({
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "IndexClient",
      formats: ["es", "cjs"],
      fileName: (format) => `indexclient.${format}.js`,
    },
    rollupOptions: {
      external: ["crypto", "chromadb-default-embed", "@xenova/transformers"],
      output: {
        globals: {
          crypto: "crypto",
          "chromadb-default-embed": "chromadb-default-embed",
          "@xenova/transformers": "@xenova/transformers",
        },
      },
    },
    outDir: "dist",
  },
});
