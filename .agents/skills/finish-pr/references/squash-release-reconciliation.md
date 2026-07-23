# Squash-release reconciliation

When release PRs are squash-merged into `main`, `main` contains the release as one squash commit while `dev` may still contain the original individual commits. The file trees can match while ancestry diverges. If not reconciled, the next release PR may re-include already-shipped commits and report conflicts.

## When opening a release PR

Before trusting `BASE..HEAD`, inspect whether `main`'s latest release squash matches an older `dev` release head:

```bash
git log --oneline --decorate --left-right --cherry-pick origin/main...origin/dev | head -80
git diff --quiet origin/main <prior-dev-release-head> && echo "main squash tree matches prior dev release head"
```

If true, build the release branch from `origin/main` and cherry-pick only commits after `<prior-dev-release-head>`:

```bash
git worktree add --detach .worktrees/fix-release-YYYY-MM-DD origin/main
cd .worktrees/fix-release-YYYY-MM-DD
git cherry-pick <new-commit-1> <new-commit-2> ...
git diff --quiet HEAD origin/dev && echo "release branch tree matches dev tree"
git merge-tree "$(git merge-base origin/main HEAD)" origin/main HEAD | grep -E '<<<<<<<|CONFLICT|^changed in both$|^added in both$' || echo "no merge-tree conflicts"
```

## After merging the release PR

After the main-branch release checks pass, reconcile `main` back into `dev` only when trees match and the merge simulation is clean:

```bash
git fetch origin main dev
git diff --quiet origin/main origin/dev && echo "main and dev trees match"
git merge-tree "$(git merge-base origin/main origin/dev)" origin/dev origin/main | grep -E '<<<<<<<|CONFLICT|^changed in both$|^added in both$' || echo "main into dev merge simulation clean"
```

Then create a no-content merge and push. This runs from the **canonical root** (which is on `dev`) and is a **sanctioned exception** to the root-is-read-only rule: the reconciliation merge can only be created on a local `dev` checkout, it is invoked by `finish-pr` step 7 from the main session, and root-dev-guard's warn-mode advisory is expected and accepted here. Do not generalize this escape to other root mutations.

```bash
git switch dev
git merge --no-ff origin/main -m "chore: reconcile main after release YYYY-MM-DD"
git push origin dev
```

Wait for the normal `dev` workflows triggered by that push. If the trees differ or merge simulation reports conflicts, stop and report exact files rather than forcing the reconciliation.
