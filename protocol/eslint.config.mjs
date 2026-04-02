import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";

export default tseslint.config(
  { ignores: ["dist/", "drizzle/"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  // ── Architectural boundary enforcement ──────────────────────────────
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.spec.ts", "src/**/*.test.ts", "src/**/tests/**"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "controllers", pattern: "src/controllers/*", mode: "file" },
        { type: "services", pattern: "src/services/*", mode: "file" },
        { type: "adapters", pattern: "src/adapters/*", mode: "file" },
        { type: "protocol", pattern: "src/lib/protocol/**/*", mode: "file" },
        { type: "queues", pattern: "src/queues/*", mode: "file" },
        { type: "events", pattern: "src/events/*", mode: "file" },
        { type: "guards", pattern: "src/guards/*", mode: "file" },
        { type: "schemas", pattern: "src/schemas/*", mode: "file" },
        { type: "types", pattern: "src/types/*", mode: "file" },
        { type: "main", pattern: "src/main.ts", mode: "file" },
        { type: "cli", pattern: "src/cli/**/*", mode: "file" },
        { type: "init", pattern: "src/protocol-init.ts", mode: "file" },
      ],
      "boundaries/ignore": [
        "src/**/*.spec.ts",
        "src/**/*.test.ts",
        "src/**/tests/**",
      ],
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
      },
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          rules: [
            // Controllers → services, guards, types, schemas, queues (BullBoard)
            {
              from: { type: "controllers" },
              allow: {
                to: {
                  type: ["services", "guards", "types", "schemas", "queues"],
                },
              },
            },
            // Services → adapters, protocol, init, events, queues, schemas, types
            // Service-to-service NOT allowed — use events/queues
            {
              from: { type: "services" },
              allow: {
                to: {
                  type: [
                    "adapters",
                    "protocol",
                    "init",
                    "events",
                    "queues",
                    "schemas",
                    "types",
                  ],
                },
              },
            },
            // Adapters → sibling adapters, schemas, types, events
            {
              from: { type: "adapters" },
              allow: {
                to: { type: ["adapters", "schemas", "types", "events"] },
              },
            },
            // Protocol → itself, types, schemas (for Drizzle type inference)
            {
              from: { type: "protocol" },
              allow: {
                to: { type: ["protocol", "types", "schemas"] },
              },
            },
            // Queues → services, adapters, protocol, schemas, types, events, sibling queues
            {
              from: { type: "queues" },
              allow: {
                to: {
                  type: [
                    "queues",
                    "services",
                    "adapters",
                    "protocol",
                    "schemas",
                    "types",
                    "events",
                  ],
                },
              },
            },
            // Events → sibling events, types
            {
              from: { type: "events" },
              allow: { to: { type: ["events", "types"] } },
            },
            // Guards → adapters, schemas, types
            {
              from: { type: "guards" },
              allow: {
                to: { type: ["adapters", "schemas", "types"] },
              },
            },
            // Schemas → sibling schemas, types
            {
              from: { type: "schemas" },
              allow: { to: { type: ["schemas", "types"] } },
            },
            // Types → sibling types
            {
              from: { type: "types" },
              allow: { to: { type: ["types"] } },
            },
            // protocol-init.ts (composition root) → everything
            {
              from: { type: "init" },
              allow: {
                to: {
                  type: [
                    "adapters",
                    "protocol",
                    "queues",
                    "services",
                    "schemas",
                    "types",
                    "events",
                  ],
                },
              },
            },
            // main.ts (entrypoint) → everything
            {
              from: { type: "main" },
              allow: {
                to: {
                  type: [
                    "controllers",
                    "services",
                    "adapters",
                    "protocol",
                    "queues",
                    "events",
                    "guards",
                    "schemas",
                    "types",
                    "cli",
                    "init",
                  ],
                },
              },
            },
            // CLI scripts → everything
            {
              from: { type: "cli" },
              allow: {
                to: {
                  type: [
                    "cli",
                    "controllers",
                    "services",
                    "adapters",
                    "protocol",
                    "queues",
                    "events",
                    "guards",
                    "schemas",
                    "types",
                    "init",
                  ],
                },
              },
            },
          ],
        },
      ],
    },
  },
);
