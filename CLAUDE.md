# CLAUDE.md

## How we build: startup rules

This is an early-stage product. Everything in it is provisional and gets rewritten as we
learn; nothing in the codebase is owed a future. The git history is full of features that
were built with care and then deleted wholesale, plus a long tail of shims, adapters,
fallbacks and "legacy" paths that cost effort twice — once to write, once to remove.
These rules exist to stop that loop.

- **Smallest thing that does what was asked.** One code path. No option, mode, flag,
  fallback or config for a case nobody has today. No abstraction until a second real
  caller exists. No handling for states the code cannot reach. Test: would a senior
  engineer call this overcomplicated? If yes, simplify.
- **Every changed line traces to the request.** No drive-by refactors, renames, reformatting
  or "while I'm here" improvements. If you notice something worth doing, say so in a
  sentence; don't do it.
- **Change in place, don't layer.** When behaviour changes, rewrite the old code: no
  `legacy*`/`v2` twins, deprecated re-exports, adapters or "compat" paths. Update every
  caller in this repo in the same PR and delete what the change made dead, tests included.
- **Backwards compatibility only when it is free.** If keeping old data, APIs or behaviour
  working costs real work — a migration path, dual reads, a parallel code path — don't.
  Break it, state the break in the PR, move on. This applies to handoffs too: a root session
  does not write "preserve current behaviour" into a task unless that is the actual goal.
- **Don't build for later.** No "to make X easier next time". Write the idea down in one
  line and build it when someone asks for it. YAGNI is the default, not the exception.
- **Prefer deleting to maintaining.** Unused or redundant code, tests, docs and fixtures get
  removed, not kept around "just in case".

If the task as written seems to need more than this, say so in a sentence and deliver the
small version.

## Where things live

Bun monorepo. Overview: `docs/design/architecture-overview.md`; commands and conventions:
`docs/guides/development-reference.md`.

| Path | What it is |
|---|---|
| `packages/protocol` | `@indexnetwork/protocol` — the domain: LangGraph graphs, agents, tools, MCP server, and the **interfaces** a host must implement. Published to npm; also used by external integrators. |
| `services/api` | The host. Bun HTTP server + workers that wire real infrastructure (Drizzle/Postgres, Redis, BullMQ, OpenRouter) into the protocol. |
| `apps/web` | Vite + React Router SPA. `src/app` routes, `components`, `contexts`, `hooks`, `lib`; `src/services/*.ts` are typed API clients, not business logic. |
| `apps/mac` | Swift WKWebView shell (`Sources/`) around a self-contained React bundle (`src/`). |
| `packages/cli`, `claude-plugin`, `hermes-plugin` | Clients over the HTTP/MCP API. `protocol`, `cli`, `claude-plugin`, `hermes-plugin` are subtree-mirrored to public repos on every push to `dev`/`main`; their `package.json` deps must be pinned exactly (`bun run check:subtree-parity`). |

### API layering (`services/api/src`, enforced by `eslint-plugin-boundaries` in `eslint.config.mjs`)

- `controllers/*.controller.ts` — HTTP only: decorators (`@Controller`, `@Get`, `@UseGuards`),
  input validation, response shape. Import services, guards, schemas, types, queues. Never
  adapters, `db` or Drizzle. Template: `controllers/controller.template.md`.
- `services/*.service.ts` — business logic, transactions, event emission, queue enqueues.
  Import adapters and `@indexnetwork/protocol`. Template: `services/service.template.md`.
- `adapters/*.adapter.ts` — the concrete implementations of the protocol's interfaces
  (`import type { … } from '@indexnetwork/protocol'`) over Drizzle, Redis, OpenAI, etc.
  This is the only place the protocol meets infrastructure.
- `queues/*.queue.ts` — one BullMQ class per domain (queue + worker + handlers); orchestrate
  by calling services/graphs, no business logic. Template: `queues/queue.template.md`.
- `guards/`, `events/`, `schemas/` (Drizzle schema + zod), `lib/` (cross-cutting helpers),
  `cli/` (maintenance scripts). Guards are documented in `guards/README.md`.
- Tests sit in a `tests/` folder beside the code they cover (or as `*.spec.ts` next to it)
  and go through services, never adapters or `db`.

### Protocol package rules (`packages/protocol`)

- `src/index.ts` is the **only** entry point; every export is explicit, no wildcards. Deep
  imports are not a contract. Tiers and SemVer policy: `STABILITY.md`; host-side wiring and
  the required/optional interface list: `IMPLEMENTATION.md`.
- Source is domain-first: one directory per capability (`intents/`, `opportunities/`,
  `negotiations/`, `networks/`, …). A capability is reached only through its barrel
  (`index.ts` or `*.module.ts`); never import another capability's implementation files.
- The package knows no host: no `drizzle-orm`, `bullmq`, `ioredis`, `pg`, `redis`. It
  defines interfaces in `shared/interfaces/`; the host implements them. Both rules are
  checked by `bun run architecture:check` (run inside `packages/protocol`).
- Breaking the public surface is allowed and cheap: change it, bump the major, add a
  `CHANGELOG.md` line, update `services/api`/`apps/web` in the same PR. Do not keep old
  exports alive for external consumers.

## Session roles: root orchestrates, worktrees implement

We work via worktrees, one Zed window and one agent session per worktree.

- **Root session** (working directory is the repo root): orchestrate, never implement.
  1. Create the worktree with the script — `bun run worktree:new <type>/<description>` —
     which validates the branch name, bases it on `origin/dev`, and runs the mandatory setup.
  2. Write a handoff prompt for the task and copy it to the clipboard (`pbcopy`), then give
     the user the worktree path (`.worktrees/<type>-<description>`) so they can open it in
     Zed, start a session there, and paste the handoff.
- **Worktree session**: implement the change and finish by opening a PR into `dev`.
- **Follow-up changes go through a handoff too**: if the PR or worktree needs more work
  (review feedback, failing checks, scope additions), the root session writes another
  clipboard handoff for that worktree — it does not make the changes itself.
- **Merging the PR is the root session's responsibility** — the worktree session never
  merges, and merge approval from the user is always explicit.
