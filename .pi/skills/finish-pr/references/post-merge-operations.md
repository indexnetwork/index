# Finish PR post-merge operations

Detailed steps extracted from `../SKILL.md` to keep the main skill lean. Follow these after PR merge and post-merge GitHub checks.

### 8. Verify Railway deployment with MCP

Use Railway MCP tools if available. First discover/connect them instead of guessing tool names:

```text
mcp({ search: "railway deployment project service environment logs status" })
mcp({ server: "railway" })
```

Then use the available Railway MCP tool(s) to verify:

- target project,
- target environment,
- target service(s),
- deployment triggered by the merged branch/commit,
- build status,
- deploy status,
- recent logs for startup/runtime errors,
- app health URL or smoke endpoint if available.

If a Railway deployment is still building/deploying, explicitly call `team_delegate` for one read-only `release-verifier` with the exact PR/base/head/merge SHA and Railway project/environment/service/deployment tuple, then return user control immediately. The worker performs one bounded status read, emits at most one pending report deduplicated by identity tuple plus observed status, and `team_block`s the same task. Do not wait, watch, sleep, or poll; resume only that exact blocked worker via a durable terminal event or explicit natural-tick `team_send`. Do not claim success.

If Railway MCP is not configured or does not expose enough tools to verify status/logs, report deployment verification as incomplete. Do not claim success or close related issues, but do not treat MCP unavailability alone as a reason to undo or delay an otherwise-safe GitHub merge.

### 9. Finish related GitHub issues

For GitHub issues auto-closed by PR keywords, verify state:

```bash
gh issue view ISSUE_NUMBER --json number,title,state,url
```

If an issue is not auto-closed but should be closed, confirm the PR merge and deployment succeeded, then close with a comment:

```bash
gh issue comment ISSUE_NUMBER --body "Shipped in PR PR_URL and verified after deployment: SUMMARY."
gh issue close ISSUE_NUMBER --reason completed
```

If deployment is pending or failed, leave the issue open and comment with the blocker/status only if useful. Issue closure is gated on terminal success, never on merge or notifications.

### 10. Finish related Linear issues

For each related Linear issue:

1. Add a comment with PR URL, merge commit, verification commands, and Railway deployment status.
2. Move the issue to the appropriate done/completed status only after merge and deployment verification reach terminal success. A nonterminal result remains fail-closed and pending.

Use Linear tools rather than guessing API calls:

- `linear_indexnetwork_get_issue` to inspect current issue state,
- `linear_indexnetwork_list_issue_statuses` if you need the team's done-state name,
- `linear_indexnetwork_save_comment` to add the shipment note,
- `linear_indexnetwork_save_issue` to update state.

If the correct done status is ambiguous, ask the user rather than guessing.

### 11. Clean up the finished PR worktree (MANDATORY)

This repo does implementation work in `.worktrees/<name>` worktrees. **Removing the just-finished PR worktree is a required step of finish-pr, not an optional one.** Once its PR is merged and post-merge verification has passed, remove it. Do not turn one PR closeout into a sweep of unrelated worktrees; report other apparently finished worktrees and clean them only on request.

Inspect worktrees and the current location:

```bash
git worktree list
pwd
```

**Default = remove.** A worktree is "finished" and MUST be removed when its PR is merged into the base branch. For squash merges, the local branch may not appear in `git branch --merged`; use the PR's merged state and merge commit as the source of truth, then force-remove the worktree once its work is preserved on the base branch. Disposable leftovers in a finished worktree — the just-merged file edits, a copied test fixture, a deferred submodule-pointer bump that is already preserved on a remote branch — do NOT count as a reason to keep it; force-remove through them.

Keep a worktree ONLY if one of these genuinely holds (otherwise remove it):

- its branch is NOT yet merged, OR
- it has uncommitted/unpushed work that is NOT a disposable leftover of the finished task (e.g. genuinely unrelated in-flight work for a different effort), OR
- the user explicitly asked to keep it, OR
- it is the canonical root worktree (`/Users/yanek/Projects/index`) — never remove the canonical root.

When in doubt about whether uncommitted content is disposable, inspect it (`git -C PATH status --short` + `git -C PATH diff`) and confirm the work is preserved elsewhere (merged PR, pushed branch) before force-removing. Only ask the user when you cannot establish that the content is safe to discard.

Removal procedure:

1. You cannot remove the worktree you are standing in. `cd` to the canonical root first:

   ```bash
   cd /Users/yanek/Projects/index
   ```

2. Close the exact Herdr workspace for the finished worktree **before** removing the Git worktree. A removed worktree leaves its Herdr workspace and idle Pi agent behind as a stale sidebar entry; closing the workspace stops the Pi/terminal and removes that entry. Use the workspace ID recorded when the session was opened and re-verify identity before closing — never guess from the label alone, and never close the canonical root workspace (or any other active workspace):

   ```bash
   herdr workspace get "$WORKSPACE_ID"   # path/branch must match the finished worktree
   herdr workspace close "$WORKSPACE_ID"
   herdr workspace list                   # verify the workspace is gone
   ```

   If the recorded ID's path/branch does not match the finished worktree, or the close fails, **stop and report** — do not close another workspace or remove the Git worktree until identity is resolved. Verify the workspace disappeared from `herdr workspace list` before proceeding.

3. Before removing the worktree, inspect and restore any external local pointers that target it. Example: a local Hermes plugin install may be a symlink to the PR worktree; repoint it to the canonical package before deletion so local tooling does not reference a removed path:

   ```bash
   ls -ld "$HOME/.hermes/plugins/index-network" || true
   ln -sfn "/Users/yanek/Projects/index/packages/hermes-plugin" "$HOME/.hermes/plugins/index-network"
   ```

4. Remove the PR's worktree. Use `--force` only when it carries disposable leftovers that are already preserved on the merged PR/base:

   ```bash
   git fetch origin <base-branch>
   git worktree remove --force .worktrees/WORKTREE_NAME
   ```

5. Prune stale administrative entries and report the remaining worktrees; leave unrelated worktrees in place:

   ```bash
   git worktree prune
   git worktree list
   ```

If `gh pr merge --delete-branch` was used, the branch is already gone remotely; removing the worktree only cleans up local state. Delete any accidental helper/review branches that were pushed during finishing once their commits are preserved on the real PR branch or base branch. Report each worktree removed (and any deliberately kept, with the reason) in the final summary.
