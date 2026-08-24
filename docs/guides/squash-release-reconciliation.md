# Squash-release reconciliation

When release PRs are squash-merged into `main`, `main` contains the release as one squash commit while `dev` may still contain the original individual commits. The file trees can match while ancestry diverges. If not reconciled, the next release PR may re-include already-shipped commits and report conflicts.

## When opening a release PR

Before trusting `BASE..HEAD`, inspect whether `main`'s latest release squash matches an older `dev` release head:

```bash
git log --oneline --decorate --left-right --cherry-pick origin/main...origin/dev | head -80
git diff --quiet origin/main <prior-dev-release-head> && echo "main squash tree matches prior dev release head"
```

If true, build the release head from `origin/main` and cherry-pick only commits after
`<prior-dev-release-head>`. Capture the repaired commit before returning to the root:

```bash
ROOT="$(git rev-parse --show-toplevel)"
REPAIR_WORKTREE="$ROOT/.worktrees/fix-release-YYYY-MM-DD"
git worktree add --detach "$REPAIR_WORKTREE" origin/main
cd "$REPAIR_WORKTREE"
git cherry-pick <new-commit-1> <new-commit-2> ...
git diff --quiet HEAD origin/dev && echo "release branch tree matches dev tree"
git merge-tree "$(git merge-base origin/main HEAD)" origin/main HEAD | grep -E '<<<<<<<|CONFLICT|^changed in both$|^added in both$' || echo "no merge-tree conflicts"
REPAIRED_HEAD="$(git rev-parse HEAD)"
cd "$ROOT"
BASE="$(git rev-parse origin/main)"
HEAD="$REPAIRED_HEAD"
```

Stop unless the tree-match and merge-simulation checks pass. `open-release-pr` must use
this repaired `BASE`/`HEAD` for both its evidence range and `git push`; pushing
`origin/dev` after this repair would discard it. Remove the detached repair worktree
after the release PR is opened and its remote head matches `HEAD`.

## After merging the release PR

After the main-branch release checks pass, reconcile `main` back into `dev` only when trees match and the merge simulation is clean:

```bash
git fetch origin main dev
git diff --quiet origin/main origin/dev && echo "main and dev trees match"
git merge-tree "$(git merge-base origin/main origin/dev)" origin/dev origin/main | grep -E '<<<<<<<|CONFLICT|^changed in both$|^added in both$' || echo "main into dev merge simulation clean"
```

Then create a no-content merge and push. This runs from the **canonical root** (which is on `dev`) and is a **sanctioned exception** to the root-is-read-only rule: the reconciliation merge can only be created on a local `dev` checkout, it is invoked by `manage-pr` during release closeout from the main session, and root-dev-guard's warn-mode advisory is expected and accepted here. This reconciliation merge is executed by the **root/main session, never by a child**, and it is the single named exception to the rule that root merges only from its own worktree. Do not generalize this escape to other root mutations.

```bash
git switch dev
git merge --no-ff origin/main -m "chore: reconcile main after release YYYY-MM-DD"
git push origin dev
```

Wait for the normal `dev` workflows triggered by that push. If the trees differ or merge simulation reports conflicts, stop and report exact files rather than forcing the reconciliation.
