# CLAUDE.md

## The root checkout stays on `dev`

`/Users/yanek/Projects/index` is the main worktree and it stays on `dev`. Do not
`git checkout` or `git switch` to another branch there.

The point is that the root tree is always a known-good `dev` checkout — builds,
dev servers, editors, and other sessions can rely on it without first asking
what branch it happens to be on. Moving root's HEAD out from under those is what
this rule exists to prevent.

Branch work goes in a linked worktree under `.worktrees/` (gitignored):

```bash
# new branch
git -C /Users/yanek/Projects/index worktree add -b feat/some-thing .worktrees/feat-some-thing

# existing branch
git -C /Users/yanek/Projects/index worktree add .worktrees/feat-some-thing feat/some-thing
```

The directory name is the branch with `/` replaced by `-`, so `fix/mac-owner-sign-in`
lives at `.worktrees/fix-mac-owner-sign-in`. Once created, work inside that
directory — use absolute paths or `git -C <worktree> ...` rather than `cd`-ing
around, since the shell's working directory doesn't persist between tool calls.

A fresh worktree is a separate tree, so it needs its own dependency install
before anything will build.

When a branch is merged and done, `git worktree remove .worktrees/<slug>`.

### Enforcement

A `PreToolUse` hook (`.claude/hooks/guard-main-worktree-branch.sh`, wired up in
`.claude/settings.json`) blocks branch-changing `checkout`/`switch` in the main
worktree. If you see it fire, that's the rule working — create a worktree rather
than looking for a way around it. The hook deliberately leaves alone anything
that doesn't move HEAD: `git checkout -- <path>`, `git restore`, and any
checkout run inside a linked worktree.
