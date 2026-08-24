import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";
import importNewlines from "eslint-plugin-import-newlines";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      "**/.worktrees/",
      // Nested Agent Village project has its own package/tooling and generated Next output.
      "packages/edge-city/**",
      "services/api/drizzle/",
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
    plugins: { "import-newlines": importNewlines },
    rules: {
      // Keep every import on a single line (auto-fixable).
      // High thresholds mean an import is only ever broken if it has >100
      // specifiers or exceeds 100k chars — i.e. effectively never.
      "import-newlines/enforce": ["error", { items: 100, "max-len": 100000 }],
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

  // ── API lib internals: decorator/utility patterns ───────────────
  {
    files: ["services/api/src/lib/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
    },
  },

  // ── API integration tests (outside src/) ────────────────────────
  {
    files: ["services/api/tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // ── API runtime: route logs through lib/log so Sentry receives them ──
  {
    files: ["services/api/src/**/*.ts"],
    ignores: [
      "services/api/src/**/*.spec.ts",
      "services/api/src/**/*.test.ts",
      "services/api/src/**/tests/**",
      "services/api/src/cli/**/*.ts",
      "services/api/src/lib/log.ts",
      "services/api/src/startup.env.ts",
    ],
    rules: {
      "no-console": "error",
    },
  },

  // ── Protocol runtime: route logs through shared/observability/log ────
  // (log.ts itself carries inline eslint-disable comments for its console
  // sink — the default implementation used when no host logger is wired.)
  {
    files: ["packages/protocol/src/**/*.ts"],
    ignores: [
      "packages/protocol/src/**/*.spec.ts",
      "packages/protocol/src/**/*.test.ts",
      "packages/protocol/src/**/tests/**",
    ],
    rules: {
      "no-console": "error",
    },
  },

  // ── Web runtime: route logs through lib/logger (labelled + truncated) ─
  // (lib/logger.ts itself carries a file-level eslint-disable — it is the
  // console sink.)
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: [
      "apps/web/src/**/*.spec.{ts,tsx}",
      "apps/web/src/**/*.test.{ts,tsx}",
      "apps/web/src/test/**",
    ],
    rules: {
      "no-console": "error",
    },
  },

  // ── CLI surfaces: stdout (console.log) is the product; warnings and
  // errors go to stderr (console.warn/error). Only debug/info/trace are
  // banned so diagnostics never drift onto pipeable stdout. ─────────────
  {
    files: [
      "packages/cli/src/**/*.ts",
      "packages/cli/scripts/**/*.ts",
      "services/api/src/cli/**/*.ts",
    ],
    rules: {
      "no-console": ["error", { allow: ["log", "warn", "error"] }],
    },
  },

  // ── Web app: React-specific rules ──────────────────────────────────
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
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

  // ── API: Architectural boundary enforcement ─────────────────────
  {
    files: ["services/api/src/**/*.ts"],
    ignores: [
      "services/api/src/**/*.spec.ts",
      "services/api/src/**/*.test.ts",
      "services/api/src/**/tests/**",
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

  // ── API: Prevent adapters from importing @indexnetwork/protocol ──
  {
    files: ["services/api/src/adapters/**/*.ts"],
    ignores: [
      "services/api/src/adapters/tests/**",
      "services/api/src/adapters/**/*.spec.ts",
      "services/api/src/adapters/**/*.test.ts",
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
