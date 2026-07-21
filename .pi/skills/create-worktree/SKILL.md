---
name: create-worktree
description: >-
  Create or reuse an isolated Index worktree and observable tmux-hosted Pi session with
  the deterministic worktree:session helper. Use before implementation from the
  canonical root, when resuming a branch session, or when validating branch/worktree
  naming and setup without mutation.
---

# create-worktree

Use the repository launcher instead of manually composing `git worktree`, setup, tmux,
and Pi commands:

```bash
bun run worktree:session -- <type>/<description>
```

It derives the only valid folder name (`<type>-<description>`), resolves the canonical
worktree from `git worktree list --porcelain`, safely creates or reuses the matching
worktree, runs `bun run worktree:setup <folder>`, and starts or reuses tmux session
`pi-<folder>` at the exact real worktree path. New Pi processes receive the same stable
name through the installed and documented `pi --name <name>` option.

## Branch policy

Branches must match:

```text
^(feat|fix|chore|refactor|docs|test|perf)/[a-z0-9]+(?:-[a-z0-9]+)*$
```

The description must explain the change. Opaque issue-only names such as
`chore/ind-422` are rejected. Never accept or invent a separate folder argument.

Examples:

```bash
bun run worktree:session -- feat/negotiation-evidence-shadow
bun run worktree:session -- fix/opportunity-scope-hardening --base origin/dev
```

## Observe, deliver, and attach

Detached tmux is the default so the caller remains observable and can attach when
ready:

```bash
tmux attach-session -t pi-feat-negotiation-evidence-shadow
```

Use `--attach` to attach after setup. To deliver a handoff without shell-quoting its
contents, write it to an absolute file and pass:

```bash
bun run worktree:session -- feat/negotiation-evidence-shadow \
  --prompt-file /absolute/path/to/handoff.md --attach
```

The helper uses tmux buffers for both new and existing sessions and verifies an existing
pane's cwd before reuse. It does not modify tmux configuration.

## Inspect before mutation

Use the deterministic dry-run contract when reviewing the plan or integrating tooling:

```bash
bun run worktree:session -- chore/session-automation --dry-run --json
```

Dry-run performs no mutation. JSON includes schema version 1 facts and ordered command
argv. `--attach` and `--json` are intentionally incompatible.

## Work inside the session

Once inside the worktree, verify:

```bash
pwd
git branch --show-current
git status --short --branch
```

Do not create another worktree when the requested implementation session is already in
one. Make ordinary edits, run tests, commit, push, and open a PR without asking for a
routine approval gate. Ask only for genuine architecture or scope ambiguity,
destructive actions, external infrastructure mutations, or merge approval.

If GPG signing fails in a non-interactive shell, preserve repository-wide settings. A
worktree-local fallback is allowed when needed:

```bash
git config --worktree commit.gpgsign false
```

Never use plain `git config commit.gpgsign false`, which affects every worktree.

## See also

- `run-worktree-session` — implementation and fix-loop ownership inside the launched session.
- `finish-pr` — explicit merge approval and post-merge verification.
