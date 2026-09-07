# AGENTS.md

## How we build

This is an early-stage product. Everything is provisional and can be rewritten as
we learn. Keep the codebase small and direct.

- **Build the smallest thing that does what was asked.** Use one code path. Do
  not add options, flags, fallbacks, configuration, or abstractions for a case
  that does not exist today. Do not handle unreachable states.
- **Every changed line traces to the request.** No drive-by refactors, renames,
  reformatting, or incidental improvements. Mention a discovery briefly instead
  of fixing it without scope.
- **Change in place, do not layer.** Rewrite the old behavior, update every
  caller in this repository, and delete what becomes dead, including tests.
  Do not add `legacy*`/`v2` twins, adapters, deprecated re-exports, or
  compatibility paths.
- **Compatibility is optional.** If preserving an old API, behavior, or data
  needs a migration, dual read, or parallel path, make the breaking change and
  state it in the PR. For public protocol changes, follow the release rules
  below.
- **Do not build for later.** Record a future idea in one sentence and wait
  until it is requested. Prefer deleting unused code, tests, docs, and fixtures
  to retaining them just in case.

If the request appears to require substantially more, state why and deliver the
smallest useful version.

## Repository map and boundaries

This is a Bun monorepo. The table below is the whole architecture map; commands,
conventions, and workflow appear later in this file. There is no `docs/`
directory. It was deleted on 2026-08-28 and is not being restored.

| Path | Responsibility |
|---|---|
| `packages/protocol` | `@indexnetwork/protocol`: domain graphs, agents, tools, MCP server, and host interfaces. Published to npm and used by external integrators. |
| `services/api` | Bun HTTP host and workers. Wires infrastructure (Drizzle/Postgres, Redis, OpenRouter) into the protocol. |
| `apps/web` | Vite + React Router SPA. `src/services/*.ts` are typed API clients, not business logic. |
| `apps/mac` | Swift WKWebView shell around a self-contained React bundle. |
| `packages/cli`, `packages/claude-plugin`, `packages/hermes-plugin` | HTTP/MCP clients mirrored to public repositories. Their dependencies must be exact pins; run `bun run check:subtree-parity` when they change. |

### API layering (`services/api/src`)

The ESLint boundaries enforce these roles:

- `controllers/*.controller.ts`: HTTP decorators, input validation, and response
  shape only. They may import services, guards, schemas, and types; never
  adapters, `db`, or Drizzle.
- `services/*.service.ts`: business logic, transactions, events, and background
  triggers. They may import adapters and `@indexnetwork/protocol`, but not
  another service.
- `adapters/*.adapter.ts`: persistence and infrastructure shims. They may not
  import `@indexnetwork/protocol`; declare aligned types locally and let the
  composition root duck-type them.
- `crons/*.cron.ts`: one `node-cron` sweep per file; schedule and orchestrate
  only.
- `lib/`: cross-cutting helpers, plus host port implementations that compose
  graphs (`lib/intent/indexing.ts`) or would otherwise need a service-to-service
  import.

### Protocol package (`packages/protocol`)

- `src/index.ts` is the only public entry point; exports are explicit and deep
  imports are not a contract. Follow `STABILITY.md` and `IMPLEMENTATION.md`.
- Organize source by domain capability and enter a capability through its barrel;
  do not import another capability's implementation files.
- The package must not depend on host infrastructure such as Drizzle, BullMQ,
  Redis, or Postgres clients. Define interfaces in `shared/interfaces/` and have
  the host implement them. Run `bun run architecture:check` in this package when
  changing its boundaries.
- Breaking public changes are acceptable: bump the major, add a `CHANGELOG.md`
  entry, update in-repo consumers in the same PR, and do not keep old exports.

## Tests

The repository keeps two specs, all under `packages/protocol`, and nothing
else: `src/capabilities/tests/intents.spec.ts` and
`src/internal/opportunities/tests/opportunity.graph.spec.ts`. The rest were
deleted because maintaining them cost more than they returned.

- Do not add tests unless you are asked. A missing spec is not a gap to fill.
- If a change genuinely warrants one, say so and ask before writing it. The only
  shape worth adding is the live-graph E2E under `src/capabilities/tests/`: an
  in-memory fake host implementing the ports, the capability's `createGraph()`
  invoked against the real model, and assertions on what the host persisted.
  Register it in `LIVE_MODEL_SPECS` in `packages/protocol/scripts/test.ts` so the
  credential-free gate skips it.
- Run them from `packages/protocol` with `bun run test`, or `bun test <file>` for
  a single spec.

## Commands

```bash
# Root
bun install                                  # Install all workspaces
bun run lint                                 # ESLint across the repository
bun run worktree:new <type>/<description>    # Create or reuse a worktree, then set it up
bun run worktree:setup <name>                # node_modules and .env symlinks
bun run worktree:dev <name>                  # Run dev servers from a worktree
bun run check:subtree-parity                 # Mirrored packages must pin dependencies exactly
bun run check:lockfile-versions              # Report workspace version drift in bun.lock
bun run sync:lockfile-versions               # Rewrite those fields in place

# services/api
bun run dev                                  # Bun.serve dev server on port 3001
bun run typecheck                            # Type-check without emitting
bun run db:generate                          # Generate migrations after schema edits
bun run db:migrate                           # Apply pending migrations
bun run db:studio                            # Drizzle Studio

# apps/web
bun run dev | build | start | lint

# apps/mac
./build.sh                                   # Assemble HTML and build the app

# packages/protocol
bun run build                                # Compile to dist/
bun run architecture:check                   # Host isolation, capability, kernel bounds
bun run test                                 # The five surviving specs
```

Publishing is handled by CI. Pushing `dev` to the indexnetwork remote publishes an
`rc` prerelease; pushing `main` publishes the stable version when it is new.

## Conventions

- File naming is `{domain}.{purpose}.ts`, for example `chat.graph.ts` or
  `intent.inferrer.ts`. Purposes in use: `.graph`, `.state`, `.agent`,
  `.generator`, `.evaluator`, `.verifier`, `.inferrer`, `.reconciler`,
  `.controller`, `.service`, `.cron`, `.adapter`, `.spec`. Exceptions are
  `index.ts`, `schema.ts`, `main.ts`, and root-level `constants.ts`/`types.ts`.
- Name adapters by concept, not technology: `database.adapter.ts` rather than
  `drizzle.adapter.ts`. `scripts/check-adapter-names.sh` enforces this.
- Order imports as external packages, then deep relative (`../../+`), then nearby
  relative (`./`, `../`), separated by blank lines.
- Write TSDoc on classes (summary) and public methods (`@param`, `@returns`,
  `@throws`).
- Agents use `createModel()` from `model.config.ts` and stay pure with no direct
  database access. Services own persistence and events and must not import other
  services. Controllers delegate to services or graphs, never import adapters,
  and use guards for authentication.

## Environment and database

Runtime env files live at the repository root (`.env.development`, `.env.test`,
both gitignored); the root `.env.example` is the canonical reference. Required
variables are `DATABASE_URL`, `OPENROUTER_API_KEY`, `PORT`, and `NODE_ENV`.
`services/api/src/startup.env.ts` validates them at boot, failing hard on invalid
values.

Two Neon projects exist: Protocol-dev-europe (`patient-pine-89907813`) for local
development, and Protocol (`shiny-cloud-34341469`) with branches `production`
(never touch), `dev` (the Railway dev environment, database `protocol_prod`), and
`local-dev`. On `local-dev`, `protocol_prod` is a real-data copy while
`protocol_sandbox` is the disposable one and the safe default for
`.env.development`.

The schema is `services/api/src/schemas/database.schema.ts` and the Drizzle client
is `services/api/src/lib/drizzle/drizzle.ts`. To change the schema: edit the
schema, run `bun run db:generate`, rename the generated file to
`{NNNN}_{action}_{target}[_{detail}].sql` and update the matching `tag` in
`drizzle/meta/_journal.json` without the `.sql` suffix, run `bun run db:migrate`,
then confirm `bun run db:generate` reports no schema changes. Do not rename
snapshot files. Always migrate through `bun run db:migrate`;
`bun run maintenance:fix-migrations` repairs a corrupted local history.

## Git workflow

- Use Conventional Commits: `<type>[scope]: <description>` with type `feat`,
  `fix`, `docs`, `style`, `refactor`, `perf`, `test`, or `chore`. Mark breaking
  changes with `!` after the type or `BREAKING CHANGE:` in the footer.
- Name branches `<type>/<short-description>` with no issue identifiers.
- Open pull requests into `origin/dev` with the description written as a
  changelog.
- Before merging, bump the version of every package the branch touched
  (`packages/protocol`, `packages/cli`, `services/api`, `apps/web`) following
  SemVer, then run `bun run sync:lockfile-versions` and commit the root
  `bun.lock`. Bun leaves workspace `version` fields stale on a version-only bump
  and `--frozen-lockfile` still passes, so `bun run check:lockfile-versions` is
  the only check that catches the drift.
- Merge from the root checkout. Never check out or merge `dev` inside a feature
  worktree, and never modify source from the canonical root. Wait for post-merge
  checks and a terminal Railway deployment before calling a release healthy, then
  remove the worktree and branch.

## Codex worktree workflow

Codex cannot launch or orchestrate a separate Codex session. Use a root session
to prepare work and a user-opened Codex session in the task worktree to implement
it.

### Root session: design and handoff

When working in the canonical repository root, do not implement product changes.

1. Inspect the relevant code and clarify only decisions that materially affect
   the change. Produce an initial, decision-complete design spec.
2. First check for an existing task worktree with `bun run worktree:list` or
   `git worktree list`. Reuse the matching worktree if one exists.
3. For a genuinely new task, create it with
   `bun run worktree:new -- <type>/<description>`. The script validates the
   branch, bases it on `origin/dev`, and performs required setup. Do not create
   a parallel worktree for follow-up work.
4. Return the worktree path and one paste-ready handoff. The handoff begins with
   `/goal` and includes: the durable objective, accepted design decisions,
   scope boundaries, relevant paths or interfaces, required verification, and
   PR target (`dev`). Do not write a handoff file or rely on Zed or the
   clipboard.

The user opens Codex in that worktree and pastes the handoff. `/goal` gives the
implementation session a durable objective; it does not start that session.

### Worktree session: implement to PR readiness

At the start, set the supplied goal. Own the scoped task until its PR is ready:

1. Inspect only what is needed, implement the smallest useful change, and keep
   work on the requested path.
2. Surface a discovery immediately when it changes the accepted design; otherwise
   mention it briefly and continue. Do not wait between small iterations unless
   the user requested staged review.
3. Run focused verification first, then the broader checks warranted by the
   change. For a known failing check, run only it and its direct prerequisites
   unless narrower evidence is unavailable.
4. Commit and push the completed worktree branch, open a PR into `dev`, and
   report its URL, verification, and any remaining risks. Do not merge the PR.

### Root session: merge and cleanup

After the user explicitly approves merging, the root session owns completion:

1. Merge the approved PR into `dev`, then verify `dev` is current and clean and
   that the feature commit is in its history.
2. Identify the linked worktree with `git worktree list`. Remove it only when it
   is clean and merged; never force-remove a dirty worktree. Report dirty files
   instead.
3. Delete the merged feature branch locally without force, then delete the same
   branch from the remote. Never delete the currently checked-out branch, `dev`,
   or an unmerged branch.
4. If a completed GitHub issue is unambiguously associated with the work, close
   it with a brief completion note. If it is ambiguous or only partly complete,
   leave it open and say why.
5. Report the merged commit, removed worktree path, local and remote branch
   deletion, and issue outcome.

## Working discipline

- Keep useful results arriving in minutes. Split a long slice before starting.
- Do not investigate incidental issues, redesign adjacent code, run broad checks
  prematurely, or turn a functioning slice into unsolicited polish.
- Preserve existing user changes. Do not reset, discard, or overwrite unrelated
  work. Prefer recoverable deletion; never force-delete a worktree or branch
  without explicit approval.
