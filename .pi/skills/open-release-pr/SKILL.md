---
name: open-release-pr
description: Open a dated release branch from dev and create a GitHub pull request into main with a generated changelog from git log and git diff. Use when preparing a dev-to-main release PR or when the user asks to cut/open a release PR.
---

# Open Release PR

Use this workflow to cut a release PR from `dev` to `main` with a changelog that summarizes all changes and linked issues included in the release.

## Goal

1. Create a `release/<DATE>` branch from the latest `dev`.
2. Push that branch to GitHub.
3. Open a PR targeting `main`.
4. Generate the PR body from `git log` and `git diff` so it includes:
   - all meaningful changes between `main` and `dev`,
   - related GitHub issues/PRs when discoverable,
   - related Linear issues when identifiers are present,
   - a diff/file summary and verification state.

## Preconditions

- Work from the repository checkout that should release to GitHub.
- `gh` CLI is installed and authenticated.
- `dev` and `main` exist locally or on `origin`.
- The current working tree must be clean before creating the release branch.

## Safety rules

- Do not merge the release PR. This skill only opens or updates the PR.
- Do not create a release branch while there are uncommitted changes; stop and ask the user what to do.
- Do not overwrite an existing `release/<DATE>` branch without explicit user confirmation.
- Do not invent issue links. Only mention GitHub or Linear issues that are present in commit messages, PR metadata, branch names, or other inspected repository/GitHub data.
- If changelog generation is ambiguous, include the raw evidence section instead of omitting changes.
- If GitHub commands fail, stop and report the exact failing command and stderr.

## Date and branch naming

Use today's local date unless the user supplies a date. Format it as ISO `YYYY-MM-DD`.

```bash
DATE="$(date +%F)"
BRANCH="release/$DATE"
```

If `release/$DATE` already exists locally or remotely, inspect it:

```bash
git branch --list "$BRANCH"
git ls-remote --heads origin "$BRANCH"
```

Then ask the user whether to reuse it, delete/recreate it, or use a suffixed branch like `release/$DATE-2`.

## Workflow

### 1. Verify repository and branch state

Identify GitHub repository metadata:

```bash
gh repo view --json owner,name,url,defaultBranchRef
```

Check local state:

```bash
git status --short --branch
git remote -v
```

Stop if `git status --short` shows uncommitted changes.

Fetch release branches and base branches:

```bash
git fetch origin dev main --prune
```

Verify both refs exist:

```bash
git rev-parse --verify origin/dev
git rev-parse --verify origin/main
```

### 2. Compute release range

Use the merge base between `origin/main` and `origin/dev` as the release base:

```bash
BASE="$(git merge-base origin/main origin/dev)"
HEAD="$(git rev-parse origin/dev)"
```

#### Squash-release divergence check

If the previous release PR was squash-merged into `main`, `dev` may still contain the same changes as individual commits. That makes `merge-base` look old and causes the next release PR to re-include already-shipped commits, often with conflicts. Follow the detection/rebuild steps in `../_shared/squash-release-reconciliation.md` before trusting `BASE..HEAD`.

After the release PR merges, `finish-pr` should reconcile `main` back into `dev` with a no-content merge so the next release starts from sane ancestry.

Collect the required evidence from git log and git diff:

```bash
git log --reverse --date=short --pretty=format:'%h%x09%ad%x09%an%x09%s' "$BASE..$HEAD"
git log --reverse --pretty=format:'%H%n%B%n---END-COMMIT---' "$BASE..$HEAD"
git diff --stat "$BASE..$HEAD"
git diff --name-status "$BASE..$HEAD"
```

If there are no commits between `BASE` and `HEAD`, stop: there is nothing to release.

### 3. Detect included PRs and issues

Extract references from commit subjects and bodies:

- GitHub issue/PR references: `#123`, `GH-123`, full GitHub issue/PR URLs.
- Closing keywords: `fixes #123`, `closes #123`, `resolves #123`.
- Linear issue identifiers: uppercase project keys like `ABC-123`.

Useful commands:

```bash
git log --reverse --pretty=format:'%s%n%b%n' "$BASE..$HEAD" > /tmp/release-log.txt
rg -o '#[0-9]+' /tmp/release-log.txt | sort -u
rg -o '[A-Z][A-Z0-9]+-[0-9]+' /tmp/release-log.txt | sort -u
rg -o 'https://github\.com/[^ ]+/(issues|pull)/[0-9]+' /tmp/release-log.txt | sort -u
```

For each GitHub issue or PR number found, inspect it when possible:

```bash
gh issue view ISSUE_NUMBER --json number,title,state,url,labels
# If it is not an issue, try:
gh pr view PR_NUMBER --json number,title,state,url,mergedAt,baseRefName,headRefName
```

For Linear identifiers, use available Linear tools when present:

- `linear_indexnetwork_get_issue` for exact IDs like `ABC-123`,
- `linear_indexnetwork_list_comments` only if issue context is needed.

If a detected identifier cannot be fetched, still list it as an unverified reference.

### 4. Build the changelog

Create a temporary PR body file. The changelog must be derived from the collected `git log` and `git diff` evidence.

Recommended structure:

````markdown
## Release changelog

### Highlights
- Concise human summary of the main release themes, derived from the commits and diff.

### Changes
- `<commit subject>` (`<short-sha>`)
- Group related commits when that makes the changelog easier to read, but do not drop meaningful changes.

### Issues and PRs
- Closes/updates/fixes #123 — issue title if available.
- Linear ABC-123 — issue title if available.
- If none were found: `No linked GitHub or Linear issues were detected in the release commits.`

### Diff summary
```text
<paste git diff --stat BASE..HEAD>
```

### Changed files
```text
<paste git diff --name-status BASE..HEAD>
```

### Verification
- [ ] Release branch created from `origin/dev` at `<HEAD>`.
- [ ] GitHub checks pass on this PR.
- [ ] Release PR reviewed and approved.
````

Keep the changelog concise but complete. For a long release, group changes under Conventional Commit headings when possible:

- New Features (`feat`)
- Bug Fixes (`fix`)
- Refactors (`refactor`, `perf`)
- Documentation (`docs`)
- Tests (`test`)
- Chores (`chore`, `build`, `ci`, `style`)
- Other

### 5. Create and push the release branch

Create the release branch from `origin/dev`:

```bash
git switch --detach origin/dev
git switch -c "$BRANCH"
git push -u origin "$BRANCH"
```

If branch creation or push fails because the branch already exists, stop and ask the user how to proceed.

### 6. Open the GitHub PR into main

Open the PR targeting `main`:

```bash
gh pr create \
  --base main \
  --head "$BRANCH" \
  --title "Release $DATE" \
  --body-file /tmp/release-pr-body.md
```

After creation, fetch and report the PR:

```bash
gh pr view "$BRANCH" --json number,title,url,baseRefName,headRefName,state,isDraft,statusCheckRollup
```

### 7. If the PR already exists

If `gh pr create` reports that a PR already exists for the branch, update its body instead of creating a duplicate:

```bash
gh pr edit "$BRANCH" --title "Release $DATE" --body-file /tmp/release-pr-body.md
```

Then fetch the PR details with `gh pr view`.

### 8. Final summary

Report:

- release branch name,
- PR number and URL,
- base/head commit range,
- number of commits included,
- detected GitHub issues/PRs,
- detected Linear issues,
- verification/check status if available,
- any changelog caveats or references that could not be resolved.

Do not claim the release has shipped. It has only been opened for review.
