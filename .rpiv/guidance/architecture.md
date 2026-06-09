# Project Overview
Index Network is a Bun/TypeScript monorepo for an intent-driven discovery protocol: backend API/workers, React frontend, protocol package, CLI, and Claude plugin. PostgreSQL/Drizzle, BullMQ/Redis, LangChain/LangGraph, and React Router shape most implementation patterns.

# Architecture
```
index/
├── backend/                 # Bun HTTP API, composition root, services/adapters/queues
├── frontend/                # Vite + React Router SPA
├── packages/protocol/       # Adapter-free LangGraph agents/tools/interfaces
├── packages/cli/            # npm `index` terminal client
├── packages/claude-plugin/  # static Claude/Codex plugin distribution
└── scripts/                 # worktree, skill generation, release helpers
```

Dependency flow:
```
frontend/cli/plugin → backend HTTP/MCP → backend controllers → services → adapters/schema
backend composition root → packages/protocol factories/tools via injected interfaces
packages/protocol → shared interfaces only; never imports backend/frontend
```

# Commands
| Area | Command | Purpose |
|---|---|---|
| root | `bun install` | install workspaces |
| root | `bun run dev` | interactive dev launcher |
| backend | `cd backend && bun run dev` | API server on port 3001 |
| backend | `cd backend && bun test path/to/test.ts` | targeted tests |
| backend | `cd backend && bun run db:generate && bun run db:migrate` | schema migration flow |
| frontend | `cd frontend && bun run dev` | Vite frontend |
| frontend | `cd frontend && bun run build` | production frontend build |
| CLI | `cd packages/cli && bun src/main.ts conversation` | run CLI from source |
| protocol | `cd packages/protocol && bun run build` | compile protocol package |
| skills | `bun run build:skills` | regenerate Claude plugin skill outputs |

# Business Context
Users define signals/intents and indexes; autonomous agents discover relevant people, negotiate possible opportunities, and surface introductions through chat, CLI, MCP, and plugin skills.

<important if="you are adding a cross-layer feature">
- Start from the owning protocol/domain surface when agents or MCP tools are involved; see `.rpiv/guidance/packages/protocol/architecture.md`.
- Add backend persistence/API wiring in the appropriate controller/service/adapter guidance files under `.rpiv/guidance/backend/src/`.
- Add frontend pages/services/components by following `.rpiv/guidance/frontend/src/app/architecture.md`, `.rpiv/guidance/frontend/src/services/architecture.md`, and `.rpiv/guidance/frontend/src/components/architecture.md`.
- Add CLI exposure by following `.rpiv/guidance/packages/cli/src/architecture.md`.
</important>

<important if="you are changing database schema">
- Canonical schema is `backend/src/schemas/database.schema.ts`; do not introduce parallel schema definitions.
- Generate migrations with Drizzle, rename SQL files to `{NNNN}_{action}_{target}.sql`, and update `drizzle/meta/_journal.json` tag.
- Verify with a second `bun run db:generate` showing no pending schema changes.
</important>

<important if="you are changing generated Claude plugin skills">
- Edit `packages/protocol/skills/claude-plugin/*.template.md` or `packages/protocol/skills/core-guidance.partial.md`.
- Run `bun run build:skills` and commit both template/partial changes and generated `packages/claude-plugin/skills/**/SKILL.md` outputs.
- Do not hand-edit generated skill files as the source of truth.
</important>

<important if="you are running tests">
- Prefer targeted tests (`bun test path/to/spec.ts`) over full suites.
- Use Bun test imports and mock external systems at the boundary being tested.
- For backend/protocol graph tests, inject adapters/models rather than connecting to live services.
</important>
