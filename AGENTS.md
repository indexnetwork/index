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

This is a Bun monorepo. See `docs/design/architecture-overview.md` for the
architecture and `docs/guides/development-reference.md` for commands.

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
  shape only. They may import services, guards, schemas, and types;
  never adapters, `db`, or Drizzle.
- `services/*.service.ts`: business logic, transactions, and events.
  They may import adapters and `@indexnetwork/protocol`.
- `adapters/*.adapter.ts`: concrete protocol-interface implementations over
  infrastructure. This is the only place the protocol meets infrastructure.
- Tests live next to the code or in its `tests/` directory. Exercise behavior
  through services, never directly through adapters or `db`.

### Protocol package (`packages/protocol`)

- `src/index.ts` is the only public entry point; exports are explicit and deep
  imports are not a contract. Follow `STABILITY.md` and `IMPLEMENTATION.md`.
- Organize source by domain capability and enter a capability through its barrel;
  do not import another capability's implementation files.
- The package must not depend on host infrastructure such as Drizzle,
  Redis, or Postgres clients. Define interfaces in `shared/interfaces/` and have
  the host implement them. Run `bun run architecture:check` in this package when
  changing its boundaries.
- Breaking public changes are acceptable: bump the major, add a `CHANGELOG.md`
  entry, update in-repo consumers in the same PR, and do not keep old exports.

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
