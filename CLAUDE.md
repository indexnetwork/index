# CLAUDE.md

## Start here

`AGENTS.md` at the repo root is the entry point for coding agents, and it delegates
almost everything to **[docs/guides/development-reference.md](./docs/guides/development-reference.md)** —
commands per app/service, architecture, code style, database and migration workflow,
testing policy, git/PR workflow, subtrees, and evals. Read the relevant section there
before nontrivial work rather than inferring conventions from surrounding code.

More deeply nested `AGENTS.md` files, where they exist, add to or override the root one
for their directory tree.

The runtime is **bun** (`bun@1.3.6`), not npm or node. Scripts are `bun run <script>`;
workspaces install with `bun install`.

## The root checkout stays on `dev`

`/Users/yanek/Projects/index` is the main worktree and it stays on `dev`. Do not
`git checkout` or `git switch` to another branch there. Real branch work belongs in a
worktree; a one-line edit or a doc tweak can just be made in root.

The point is that the root tree is always a known-good `dev` checkout — builds,
dev servers, editors, and other sessions can rely on it without first asking
what branch it happens to be on. Moving root's HEAD out from under those is what
this rule exists to prevent.

Branch work goes in a linked worktree under `.worktrees/` (gitignored). Branch names
must match `^(feat|fix|chore|refactor|docs|test|perf)/[a-z0-9]+(?:-[a-z0-9]+)*$` — the
description has to explain the change, and issue-only names are rejected. The only valid
folder name is the branch with `/` replaced by `-`, so `fix/mac-owner-sign-in` lives at
`.worktrees/fix-mac-owner-sign-in`.

```bash
ROOT=/Users/yanek/Projects/index
BRANCH=feat/some-thing
FOLDER=${BRANCH/\//-}

git -C "$ROOT" fetch origin dev

# new branch, based on origin/dev
git -C "$ROOT" worktree add -b "$BRANCH" ".worktrees/$FOLDER" origin/dev

# existing branch
git -C "$ROOT" worktree add ".worktrees/$FOLDER" "$BRANCH"

# mandatory for new AND reused worktrees
bun run worktree:setup "$FOLDER"
```

`bun run worktree:setup` is not optional and is not just an install: it installs the
workspace dependencies *and* symlinks the root env files into the worktree. Skipping it
leaves the tree unable to build or resolve `.env` at all.

Once created, work inside that directory — use absolute paths or `git -C <worktree> ...`
rather than `cd`-ing around, since the shell's working directory doesn't persist between
tool calls. One writer per worktree; reuse the same worktree for review and PR-closeout
fixes.

If commit signing fails, fall back only worktree-locally
(`git config --worktree commit.gpgsign false`) — never repository-wide.

When a branch is merged and done, `git worktree remove .worktrees/<slug>` — from another
checkout, and only after the merge and preservation checks in the Development Reference.

### Enforcement

A `PreToolUse` hook (`.claude/hooks/guard-main-worktree-branch.sh`, wired up in
`.claude/settings.json`) blocks branch-changing `checkout`/`switch` in the main
worktree. If you see it fire, that's the rule working — create a worktree rather
than looking for a way around it. The hook deliberately leaves alone anything
that doesn't move HEAD: `git checkout -- <path>`, `git restore`, and any
checkout run inside a linked worktree.

`.pi/` holds a parallel guard for the pi agent (`.pi/extensions/root-dev-guard.ts`) that
warns instead of blocking. It is not Claude Code's tooling — don't edit it to work around
the hook above.

## Testing and validation

Validate what the diff touches; do not run the full suite as a branch-finishing ritual.
This repository's targeted-validation policy overrides generic "run everything" guidance.

```bash
cd services/api
bun test path/to/test.ts   # preferred — target specific files
bun test                   # all tests; avoid unless genuinely necessary
```

For each change run the affected tests plus whichever of build, typecheck,
static-inventory, lint, and generated-artifact checks apply, and report the exact
evidence in the PR. Never commit without running the affected tests.

**Database-backed tests are gated.** Run them only when the changed behavior requires
them, and only after proving `DATABASE_URL` points at a dedicated, disposable database —
then set `TEST_DATABASE_SAFE=1`. The guard is fail-closed by design; never bypass it, and
never set the marker before the URL has been proven disposable.

Use **local Postgres**, provisioned with `bun run db:setup:local` — it satisfies that
proof (database `index_test`, nothing but test data) and is roughly 500x faster than a
remote branch. CI's `test` job only runs hermetic specs that mock the database, so the
database-backed suite is gated nowhere except your machine.

## Finishing a branch

The full checklist lives in the Development Reference under **Git Workflow → Finishing a
Branch**. The parts that are easy to miss:

- Conventional commits (`<type>[scope]: <description>`) and PRs opened into `origin/dev`
  with `gh`, description written as a changelog.
- Update the docs the change affects — `AGENTS.md`, this file, the Development Reference,
  package `README.md`s, and the relevant `docs/` subdirectory.
- **Bump the version of every package the branch touched** (`packages/protocol/`,
  `packages/cli/`, `services/api/`, `apps/web/`) per semver, then run
  `bun run sync:lockfile-versions` and commit the root `bun.lock`. Bun refreshes the
  lockfile's workspace `version` fields only unreliably — for a version-only bump,
  where `node_modules` is already in sync, `bun install` leaves them stale — and
  `--frozen-lockfile` passes while they are. Do not assume an install fixed it.
  `bun run check:lockfile-versions` reports drift; CI enforces it.
- Merge approval is always explicit and separate — never infer it from green checks.
  Merge server-side from a non-canonical checkout; never check out or merge `dev` inside
  a feature worktree.
- There is no automated PR reviewer. Nothing reviews a PR unless a human is asked to,
  so green checks are the only signal a PR carries by default — and green is not review.
  Say so plainly when handing one over. If review comments do get opened, resolve every
  conversation before merge; see the Development Reference for the reply/resolve flow.
- Sync the canonical root afterwards only with `git pull --ff-only origin dev`.
