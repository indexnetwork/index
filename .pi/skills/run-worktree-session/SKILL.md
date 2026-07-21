---
name: run-worktree-session
description: >-
  Run feature and fix implementation in an observable tmux-hosted Pi worktree session,
  using deterministic handoff delivery and a focused verify-commit-push-PR loop. Use
  when Index work moves from root investigation into implementation or returns for PR
  review and finish-pr fixes.
---

# run-worktree-session

The canonical root coordinates; the worktree Pi session owns code mutations. tmux is
the first observable-session layer. Pi RPC and dashboards are deliberately out of scope.

## 1. Launch or reuse the session

Choose a semantic branch and invoke the repository helper from the canonical root:

```bash
bun run worktree:session -- <type>/<description>
```

The helper derives the folder, safely creates or reuses the worktree, runs full setup,
verifies any existing tmux pane cwd, and launches a named Pi session. Never manually
accept a separate worktree folder and never create another worktree when the requested
session is already inside one.

For a deterministic preflight:

```bash
bun run worktree:session -- <type>/<description> --dry-run --json
```

## 2. Deliver one complete handoff

When a root coordinator needs to hand work over, prepare one prompt file outside the
repository with:

- a stable handoff name, branch, and expected absolute worktree path;
- verified findings and agreed scope;
- key files and constraints;
- targeted verification commands;
- an instruction to verify cwd/branch and not create another worktree.

Deliver the file through tmux rather than interpolating its contents into a shell
command:

```bash
bun run worktree:session -- <type>/<description> \
  --prompt-file /absolute/path/to/handoff.md
```

The same command works for a new or existing tmux session. Attach explicitly when
interactive observation is wanted:

```bash
tmux attach-session -t pi-<type>-<description>
```

Do not create task-specific committed `.pi` handoff files.

## 3. Verify session identity

Before edits:

```bash
pwd
git branch --show-current
git status --short --branch
```

The path and branch must match the handoff. Stop on a collision or mismatch rather than
mutating another checkout.

## 4. Implement and verify

Keep changes within the agreed foundation or fix scope. Run targeted tests, lint,
typechecks, and manual acceptance checks appropriate to the diff. Update required docs,
package versions, and generated artifacts before committing. Report failures honestly.

Ask only when there is genuine architecture or scope ambiguity, a destructive action,
an external infrastructure mutation, or merge approval. Do not ask before ordinary
edits, tests, commits, pushes, or PR creation.

## 5. Commit, push, and open the PR

After verification succeeds:

1. commit with a conventional commit message;
2. push the semantic feature branch;
3. open or update a PR into `dev` with exact verification results and caveats.

Opening a PR is not merge approval. The canonical `finish-pr` workflow owns readiness,
explicit merge confirmation, deployment verification, issue updates, and cleanup.

## 6. Reuse for fix rounds

For review or finish-pr findings, return to the same tmux/worktree session and deliver
one consolidated prompt file. Apply the focused fixes, rerun affected checks, commit,
and push. Do not create a fresh worktree or Pi session for each comment.

## See also

- `create-worktree` — launcher contract, branch policy, and GPG fallback.
- `address-code-review` — factual thread inspection and resolution workflow.
- `finish-pr` — merge approval and post-merge operations.
