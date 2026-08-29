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

Bun monorepo. The table below is the whole architecture map; commands, conventions and
workflow live further down this file. There is no `docs/` directory — it was deleted on
2026-08-28 and is not coming back.

| Path | What it is |
|---|---|
| `packages/protocol` | `@indexnetwork/protocol` — the domain: LangGraph graphs, agents, tools, MCP server, and the **interfaces** a host must implement. Published to npm; also used by external integrators. |
| `services/api` | The host. Bun HTTP server + workers that wire real infrastructure (Drizzle/Postgres, Redis, OpenRouter) into the protocol. |
| `apps/web` | Vite + React Router SPA. `src/app` routes, `components`, `contexts`, `hooks`, `lib`; `src/services/*.ts` are typed API clients, not business logic. |
| `apps/mac` | Swift WKWebView shell (`Sources/`) around a self-contained React bundle (`src/`). |
| `packages/cli`, `claude-plugin`, `hermes-plugin` | Clients over the HTTP/MCP API. `protocol`, `cli`, `claude-plugin`, `hermes-plugin` are subtree-mirrored to public repos on every push to `dev`/`main`; their `package.json` deps must be pinned exactly (`bun run check:subtree-parity`). |

### API layering (`services/api/src`, enforced by `eslint-plugin-boundaries` in `eslint.config.mjs`)

- `controllers/*.controller.ts` — HTTP only: decorators (`@Controller`, `@Get`, `@UseGuards`),
  input validation, response shape. Import services, guards, schemas, types. Never
  adapters, `db` or Drizzle. Template: `controllers/controller.template.md`.
- `services/*.service.ts` — business logic, transactions, event emission, background
  triggers. Import adapters and `@indexnetwork/protocol`. A service must not import
  another service. Template: `services/service.template.md`.
- `adapters/*.adapter.ts` — persistence and infrastructure shims over Drizzle, Redis,
  OpenAI, etc. They must **not** import `@indexnetwork/protocol` (enforced by
  `no-restricted-imports`): declare aligned types locally and let the composition root
  (`mcp.controller.ts`) duck-type them against the protocol's ports.
- `crons/*.cron.ts` — one `node-cron` sweep per file; schedule and orchestrate only.
- Host implementations of protocol ports that must compose graphs live in `lib/`
  (e.g. `lib/intent/indexing.ts` implements `IntentFollowUp`). `lib/` is outside the
  boundaries graph, so it is also where code that would otherwise need a
  service-to-service import belongs.
- `guards/`, `events/`, `schemas/` (Drizzle schema + zod), `lib/` (cross-cutting helpers),
  `cli/` (maintenance scripts). Guards are documented in `guards/README.md`.

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

## Tests

The repository keeps five specs, all in `packages/protocol`, and nothing else:
`src/capabilities/tests/{intents,negotiations.e2e,personal-agent.e2e}.spec.ts` and
`src/internal/{opportunities/tests/opportunity.graph,premises/tests/premise.decomposer}.spec.ts`.
Everything else was deleted on 2026-08-28 because the suite cost more to maintain than it
returned.

- **Do not add tests unless asked.** A missing spec is not a gap to fill, and "I added a
  test for this" is not a bonus — it is unrequested scope.
- **If a change genuinely warrants one**, say so in a sentence and ask first. The only
  shape worth writing is the live-graph E2E in `src/capabilities/tests/`: an in-memory
  fake host implementing the ports, the capability's `createGraph()` invoked against the
  real model, assertions on what the host persisted. Register it in `LIVE_MODEL_SPECS`
  (`packages/protocol/scripts/test.ts`) so the credential-free gate skips it.
- Run them from `packages/protocol` with `bun run test` (per-file runner; mocks do not
  leak between files) or `bun test <file>` for one.

## Commands

```bash
# Root
bun install                                  # Install all workspaces
bun run dev                                  # Interactive: pick root or a worktree
bun run lint                                 # ESLint across the repo
bun run worktree:new <type>/<description>    # Create/reuse a worktree, then set it up
bun run worktree:setup <name>                # node_modules + .env symlinks for a worktree
bun run worktree:dev <name>                  # Run dev servers from a worktree
bun run check:subtree-parity                 # Mirrored packages must pin deps exactly
bun run check:lockfile-versions              # Report workspace version drift in bun.lock
bun run sync:lockfile-versions               # Rewrite those fields in place
bun run pr:snapshot -- <number|URL|branch>   # Factual PR/review/worktree JSON

# services/api
bun run dev                                  # Bun.serve dev server, port 3001
bun run start                                # Production server
bun run typecheck                            # Type-check without emitting
bun run db:generate                          # Generate migrations after schema edits
bun run db:migrate                           # Apply pending migrations
bun run db:studio                            # Drizzle Studio
bun run db:seed:sandbox -- --confirm --minimal  # Seed protocol_sandbox, five-person market

# apps/web
bun run dev | build | start | lint

# apps/mac
./build.sh                                   # Assemble HTML, build the WKWebView app

# packages/protocol
bun run build                                # Compile to dist/
bun run architecture:check                   # Host isolation + capability + kernel bounds
bun run test                                 # The five surviving specs
```

Publishing is CI's job: pushing `dev` to the indexnetwork remote publishes an `rc`
prerelease, pushing `main` publishes the stable version when it is new.

## Conventions

- **File naming**: `{domain}.{purpose}.ts` — `chat.graph.ts`, `intent.inferrer.ts`,
  `opportunity.evaluator.ts`. Purposes in use: `.graph`, `.state`, `.agent`, `.generator`,
  `.evaluator`, `.verifier`, `.inferrer`, `.reconciler`, `.controller`, `.service`,
  `.cron`, `.adapter`, `.spec`. Exceptions: `index.ts`, `schema.ts`, `main.ts`, and
  root-level `constants.ts`/`types.ts`.
- **Adapters are named by concept, not technology**: `database.adapter.ts` not
  `drizzle.adapter.ts`; `cache.adapter.ts` not `redis.adapter.ts`. Enforced by
  `scripts/check-adapter-names.sh`.
- **Import ordering**: external packages → deep relative (`../../+`) → nearby relative
  (`./`, `../`), separated by blank lines.
- **TSDoc** on all classes (summary) and public methods (`@param`, `@returns`, `@throws`).
- **Layer rules**: agents use `createModel()` from `model.config.ts` and stay pure, with no
  direct DB access; services own persistence and event emission and must not import other
  services; controllers delegate to services/graphs, never import adapters, and use guards
  for auth.

## Environment and database

Runtime env files live at the **repo root** (`.env.development`, `.env.test`, gitignored);
the root `.env.example` is the canonical reference. Required: `DATABASE_URL`,
`OPENROUTER_API_KEY`, `PORT`, `NODE_ENV`. Validation happens at API boot in
`services/api/src/startup.env.ts` — hard-fail on invalid, warnings for commonly forgotten
vars. `bun scripts/audit-railway-env.ts` diffs a Railway service against the schema.

Two Neon projects: **Protocol-dev-europe** (`patient-pine-89907813`) for local
development, and **Protocol** (`shiny-cloud-34341469`) whose branches are `production`
(**never touch**), `dev` (the Railway dev environment, database `protocol_prod`), and
`local-dev`. On `local-dev`, `protocol_prod` is a real-data copy and `protocol_sandbox` is
the curated synthetic sandbox — `protocol_sandbox` is the safe default for
`.env.development`.

Schema lives in `services/api/src/schemas/database.schema.ts`; the Drizzle client in
`services/api/src/lib/drizzle/drizzle.ts`. To change the schema:

1. Edit `database.schema.ts`.
2. `bun run db:generate`.
3. Rename the generated `.sql` to `{NNNN}_{action}_{target}[_{detail}].sql` — Drizzle names
   them randomly — and update the matching `tag` in `drizzle/meta/_journal.json` (without
   `.sql`). Do not rename snapshot files.
4. `bun run db:migrate`.
5. Verify: `bun run db:generate` reports "No schema changes".

Migrations break when `_journal.json` and the `.sql` files diverge, when SQL is applied
outside Drizzle without updating `__drizzle_migrations`, or when `CREATE EXTENSION vector`
is missing from the first migration. Always migrate with `bun run db:migrate`;
`bun run maintenance:fix-migrations` repairs a corrupted local history.

## Git workflow

- **Commits** are Conventional Commits: `<type>[scope]: <description>`, type one of `feat`,
  `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`. Breaking changes carry `!`
  after the type or `BREAKING CHANGE:` in the footer.
- **Branches** are `<type>/<short-description>`, no issue IDs: `feat/user-authentication`,
  `fix/login-redirect-loop`.
- **PRs** go into `origin/dev` via the `gh` CLI, with the description written as a
  changelog.
- **Before merging, bump the version of every package the branch touched**
  (`packages/protocol`, `packages/cli`, `services/api`, `apps/web`) per SemVer — `feat` is
  minor, `fix` is patch, breaking is major (minor before 1.0). Then run
  `bun run sync:lockfile-versions` and commit the root `bun.lock`: Bun leaves the workspace
  `version` fields in `bun.lock` stale on a version-only bump, `--frozen-lockfile` passes
  while they are stale, and `bun run check:lockfile-versions` is the only thing that
  catches the drift.
- **Merge server-side from the root checkout.** Never check out or merge `dev` inside a
  feature worktree, and never mutate source from the canonical root. Confirm the merge and
  wait for post-merge checks and terminal Railway deployment success before calling a
  release healthy. Remove the worktree and branch only after that.
- Keep a clean canonical `dev` in sync with `git pull --ff-only origin dev`; if it is
  dirty, preserve the work and report the pending reconciliation instead.

## Session roles: root orchestrates, worktrees implement

We work via worktrees, one Zed window and one agent session per worktree. The separation is
for isolation, not for disappearing with the task: implementation happens in short,
collaborative iterations so the user can react while the direction is still easy to change.

- **Root session** (working directory is the repo root): orchestrate, never implement.
  1. Before creating anything, check whether the task already has a worktree. Continue in
     that worktree and its existing Zed session whenever possible; do not create a parallel
     or replacement worktree for follow-up work.
  2. Only for a genuinely new task, create the worktree with
     `bun run worktree:new <type>/<description>`, which validates the branch name, bases it
     on `origin/dev`, and runs the mandatory setup.
  3. Write a handoff prompt for the next small outcome and copy it to the clipboard
     (`pbcopy`), then give the user the worktree path (`.worktrees/<type>-<description>`) so
     they can open it in Zed, start a session there, and paste the handoff.
- **Worktree session**: work in small, visible slices. For each iteration:
  1. State the next small outcome.
  2. Inspect only what is needed for that outcome.
  3. Implement the smallest useful slice and run focused verification.
  4. Report the result and wait for the user's reaction before expanding it, unless the
     user explicitly asked for uninterrupted execution.
- **Keep iterations short.** A useful result should arrive in minutes, not hours. If a
  slice is likely to take a long time, split it before starting. Surface discoveries that
  could change the direction immediately, while they are still cheap to act on.
- **Stay on the requested path.** Do not investigate incidental issues, redesign adjacent
  code, run broad checks prematurely, or chase optional improvements. Mention a
  non-blocking discovery in one sentence and keep moving. Do not silently turn a working
  first slice into refactoring, polish, exhaustive tests, or PR preparation.
- **Diagnose CI narrowly.** For a known failing CI check, run only that check and its direct
  prerequisites; do not run broad or repository-wide suites unless asked or narrower
  evidence is unavailable.
- **Finish after the direction is agreed.** Once the user is happy with the solution,
  complete the necessary broader checks and open a PR into `dev`.
- **Follow-ups stay in the same worktree and session.** If the session is no longer open,
  the root session writes a new clipboard handoff for that existing worktree; it does not
  implement the changes or create another worktree.
- **Merging the PR is the root session's responsibility** — the worktree session never
  merges, and merge approval from the user is always explicit.
