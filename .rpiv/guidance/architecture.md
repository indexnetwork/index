# Project Overview
Index Network is a Bun/TypeScript monorepo for an intent-driven discovery protocol: API services, web/native apps, protocol package, CLI, and Claude plugin. PostgreSQL/Drizzle, BullMQ/Redis, LangChain/LangGraph, React Router, and Swift/WebKit shape most implementation patterns.

# Architecture
```
index/
├── apps/
│   ├── web/                 # Vite + React Router SPA
│   └── mac/                 # Native macOS/iOS WKWebView prototype subtree
├── services/
│   └── api/                 # Bun HTTP API, composition root, services/adapters/queues
├── packages/protocol/       # Adapter-free LangGraph agents/tools/interfaces
├── packages/cli/            # npm `index` terminal client
├── packages/claude-plugin/  # static Claude/Codex plugin distribution
└── scripts/                 # worktree, skill generation, release helpers
```

Dependency flow:
```
apps/web + apps/mac + CLI/plugin → API HTTP/MCP → controllers → services → adapters/schema
services/api composition root → packages/protocol factories/tools via injected interfaces
packages/protocol → shared interfaces only; never imports services/api or apps/*
```

# Commands
| Area | Command | Purpose |
|---|---|---|
| root | `bun install` | install workspaces |
| root | `bun run dev` | interactive dev launcher |
| api | `cd services/api && bun run dev` | API server on port 3001 |
| api | `cd services/api && bun test path/to/test.ts` | targeted tests |
| api | `cd services/api && bun run db:generate && bun run db:migrate` | schema migration flow |
| web | `cd apps/web && bun run dev` | Vite web app |
| web | `cd apps/web && bun run build` | production web build |
| CLI | `cd packages/cli && bun src/main.ts conversation` | run CLI from source |
| protocol | `cd packages/protocol && bun run build` | compile protocol package |
| skills | `bun run build:skills` | regenerate Claude and Hermes plugin skill outputs |

# Business Context
Users define signals/intents and indexes; autonomous agents discover relevant people, negotiate possible opportunities, and surface introductions through chat, CLI, MCP, and plugin skills.

<important if="you are adding a cross-layer feature">
- Start from the owning protocol/domain surface when agents or MCP tools are involved; see `.rpiv/guidance/packages/protocol/architecture.md`.
- Add API persistence/API wiring in the appropriate controller/service/adapter guidance files under `.rpiv/guidance/services/api/src/`.
- Add web pages/services/components by following `.rpiv/guidance/apps/web/src/app/architecture.md`, `.rpiv/guidance/apps/web/src/services/architecture.md`, and `.rpiv/guidance/apps/web/src/components/architecture.md`.
- Add CLI exposure by following `.rpiv/guidance/packages/cli/src/architecture.md`.
</important>

<important if="you are changing database schema">
- Canonical schema is `services/api/src/schemas/database.schema.ts`; do not introduce parallel schema definitions.
- Generate migrations with Drizzle, rename SQL files to `{NNNN}_{action}_{target}.sql`, and update `drizzle/meta/_journal.json` tag.
- Verify with a second `bun run db:generate` showing no pending schema changes.
</important>

<important if="you are changing generated plugin skills">
- Edit `packages/protocol/skills/claude-plugin/*.template.md`, `packages/protocol/skills/hermes-plugin/*.template.md`, or `packages/protocol/skills/core-guidance.partial.md`.
- Run `bun run build:skills` and commit both template/partial changes and generated `packages/claude-plugin/skills/**/SKILL.md` / `packages/hermes-plugin/skills/**/SKILL.md` outputs.
- Do not hand-edit generated skill files as the source of truth.
</important>

<important if="you are running tests">
- Prefer targeted tests (`bun test path/to/spec.ts`) over full suites.
- Use Bun test imports and mock external systems at the boundary being tested.
- For services/api/protocol graph tests, inject adapters/models rather than connecting to live services.
</important>

<important if="you are wrapping up a session where a reusable, non-obvious learning emerged">
- If this session uncovered a reusable workflow, a fix for a recurring failure, an exact command sequence, an environment gotcha, or a convention worth keeping, run the `learn-skill` skill to capture it before ending.
- `learn-skill` writes to the project-local `.pi/skills/` and never edits protected/home skills in place (it migrates them local first). See `.pi/skills/learn-skill/SKILL.md`.
- Skip silently when nothing meets the "reusable and non-obvious" bar — do not capture one-off facts.
</important>
