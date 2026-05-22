import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      "**/.worktrees/",
      "**/.claude/",
      "backend/drizzle/",
      "scripts/",
      "docs/",
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // ── Shared TypeScript rules ─────────────────────────────────────────
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "prefer-const": "warn",
      "no-empty": "warn",
    },
  },

  // ── Protocol package: warn-only for pre-existing violations ──────────
  {
    files: ["packages/protocol/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "no-useless-assignment": "warn",
      "no-useless-escape": "warn",
      "no-useless-catch": "warn",
    },
  },

  // ── Test files: relax strict rules ──────────────────────────────────
  {
    files: [
      "**/*.spec.ts",
      "**/*.test.ts",
      "**/tests/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-function-type": "off",
    },
  },

  // ── Backend lib internals: decorator/utility patterns ───────────────
  {
    files: ["backend/src/lib/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
    },
  },

  // ── Backend integration tests (outside src/) ────────────────────────
  {
    files: ["backend/tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // ── Frontend: React-specific rules ──────────────────────────────────
  {
    files: ["frontend/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },

  // ── Backend: Architectural boundary enforcement ─────────────────────
  {
    files: ["backend/src/**/*.ts"],
    ignores: [
      "backend/src/**/*.spec.ts",
      "backend/src/**/*.test.ts",
      "backend/src/**/tests/**",
    ],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "init", pattern: "src/controllers/mcp.controller.ts", mode: "file" },
        { type: "controllers", pattern: "src/controllers/*", mode: "file" },
        { type: "services", pattern: "src/services/*", mode: "file" },
        { type: "adapters", pattern: "src/adapters/*", mode: "file" },
        { type: "protocol", pattern: "src/lib/protocol/**/*", mode: "file" },
        { type: "queues", pattern: "src/queues/**/*", mode: "file" },
        { type: "events", pattern: "src/events/*", mode: "file" },
        { type: "guards", pattern: "src/guards/*", mode: "file" },
        { type: "schemas", pattern: "src/schemas/*", mode: "file" },
        { type: "types", pattern: "src/types/*", mode: "file" },
        { type: "main", pattern: "src/main.ts", mode: "file" },
        { type: "cli", pattern: "src/cli/**/*", mode: "file" },
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
            {
              from: { type: "controllers" },
              allow: {
                to: {
                  type: ["services", "guards", "types", "schemas", "queues"],
                },
              },
            },
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
            {
              from: { type: "adapters" },
              allow: {
                to: { type: ["adapters", "schemas", "types", "events"] },
              },
            },
            {
              from: { type: "protocol" },
              allow: {
                to: { type: ["protocol", "types", "schemas"] },
              },
            },
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
            {
              from: { type: "events" },
              allow: { to: { type: ["events", "types"] } },
            },
            {
              from: { type: "guards" },
              allow: {
                to: { type: ["adapters", "guards", "schemas", "types"] },
              },
            },
            {
              from: { type: "schemas" },
              allow: { to: { type: ["schemas", "types"] } },
            },
            {
              from: { type: "types" },
              allow: { to: { type: ["types"] } },
            },
            {
              from: { type: "init" },
              allow: {
                to: {
                  type: [
                    "init",
                    "adapters",
                    "protocol",
                    "queues",
                    "services",
                    "schemas",
                    "types",
                    "events",
                    "guards",
                  ],
                },
              },
            },
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

  // ── Backend: Prevent adapters from importing @indexnetwork/protocol ──
  {
    files: ["backend/src/adapters/**/*.ts"],
    ignores: [
      "backend/src/adapters/tests/**",
      "backend/src/adapters/**/*.spec.ts",
      "backend/src/adapters/**/*.test.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@indexnetwork/protocol", "@indexnetwork/protocol/*"],
              message:
                "Adapters must not import from @indexnetwork/protocol. Define aligned types locally — structural compatibility is verified at the composition root (mcp.controller.ts) via TypeScript duck typing.",
            },
          ],
        },
      ],
    },
  },
);
