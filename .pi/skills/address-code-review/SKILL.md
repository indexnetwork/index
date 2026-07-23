---
name: address-code-review
description: Handle incoming PR review feedback, especially GitHub Copilot conversations, by fetching unresolved review threads, deciding whether fixes are needed, applying fixes, replying with reasoning, and resolving conversations. Use when the user asks to receive, address, or resolve PR review feedback.
---

# Receiving Code Review

Use this workflow to handle incoming PR review feedback on a GitHub pull request, with first-class support for GitHub Copilot review conversations.

## Goal

For every unresolved review conversation from Copilot:

1. inspect the comment and referenced code,
2. decide whether a code change is actually needed,
3. either fix the code or explain why no fix is needed,
4. reply in the review thread, and
5. manually resolve the conversation.

Then, when the PR is ready for another pass, ask the user to manually request a fresh Copilot review from the GitHub PR page. Repeat review rounds until Copilot stops finding substantive issues or starts producing low-signal/useless feedback.

Do not silently resolve Copilot conversations.

## Preconditions

- The repository uses GitHub pull requests.
- The `gh` CLI is installed and authenticated.
- Fetching threads, replying, and resolving are GitHub-side and work from any session. **Applying a code fix requires the PR's existing visible Herdr-managed Pi worktree session** — when this skill runs in the canonical-root coordinator, e.g. via `finish-pr`, give that session one consolidated fix prompt, poll it directly, and keep reply/resolve operations in the coordinator (see `run-worktree-session`).
- Do not use hidden `Agent` subagents for code-review fixes, and do not create a watcher process or watcher pane. Reuse one visible Herdr workspace/Pi agent for every review round on the PR.
- If the user does not provide a PR number, infer it from the current branch.

## Command safety rule

Do not guess GitHub API command shapes.

Use the command templates in this skill as the source of truth. If a command fails with 404, 422, or a schema error:

1. stop the workflow,
2. inspect the object you are using (`gh api repos/OWNER/REPO/pulls/comments/COMMENT_ID`, `gh pr view`, or the GraphQL thread payload),
3. fix the ID/path mismatch,
4. then retry.

Never resolve a thread until the reply succeeded or you have intentionally posted the no-fix explanation.

## Copilot identity matching

GitHub may expose Copilot review comments under different logins depending on API surface. Treat these as Copilot identities:

- `copilot-pull-request-reviewer`
- `github-copilot[bot]`
- `Copilot`

When filtering GraphQL review threads, match unresolved threads where any comment author login is one of the above.

## Workflow

### 1. Snapshot the PR and review threads

Use the factual snapshot helper with the supplied number, URL, or branch:

```bash
bun run pr:snapshot -- <number|URL|branch> [--repo owner/repo]
```

It normalizes repository and PR identity and fully paginates every review thread and
thread comment. Do not repeat GraphQL pagination or flatten comments by hand. Filter the
snapshot's `pullRequest.reviewThreads` to unresolved threads containing a Copilot
author identity.

Use the IDs directly from the snapshot:

- `reviewThreads[].id` is the GraphQL `THREAD_ID` used for resolution.
- `reviewThreads[].comments[].databaseId` is the REST `COMMENT_ID` used for replies.

The snapshot provides facts only. Evaluate each comment against the code; do not treat
its presence as proof that a fix is needed.

### 2. Refresh before every review-round decision

Call the same snapshot after pushed fixes and after replies/resolutions. A round is
complete only when the refreshed facts contain no unresolved Copilot threads. This
also prevents stale local status, check, or head-OID assumptions.

### 3. Evaluate each thread

For every unresolved Copilot thread:

1. Read the referenced file and surrounding code.
2. Check adjacent implementations or project conventions when relevant.
3. Decide whether Copilot's suggestion is correct.

Use this decision rule:

- **Fix needed**: the comment identifies a real bug, missing edge case, broken convention, maintainability issue, security issue, performance issue, or test gap.
- **No fix needed**: the suggestion is incorrect, already handled elsewhere, conflicts with architecture, adds unnecessary complexity, or breaks an intentional design.

### Optional: use rpiv skills for hard review work

Use rpiv skills as supporting workflows when the Copilot feedback is broader than a local one-file fix:

- Use `code-review` when multiple comments imply a broader diff-quality issue or when you want an independent review of your pending fixes before replying.
- Use `research` when a comment touches an unfamiliar subsystem and you need grounded codebase context before deciding fix vs no-fix.
- Use `validate` after applying a plan-backed or multi-phase fix to verify the implementation against existing plan success criteria.

Do not invoke heavyweight rpiv workflows for trivial mechanical comments. For simple comments, inspect the local code directly and proceed.

### Optional: update Copilot reviewer instructions

This repository may provide Copilot review guidance in `.github/instructions/pr-reviewer.instructions.md`.

Update that file when Copilot is producing wrong or noisy reviews because it lacks stable project context, for example:

- it repeatedly flags an intentional architecture boundary or layering pattern as a problem,
- it misunderstands generated files, subtree/submodule ownership, or source-of-truth files,
- it asks for tests/docs that conflict with the project's targeted-verification policy,
- it misses a recurring project convention that should guide future reviews,
- it keeps re-raising resolved non-issues across review rounds.

Keep instruction updates short, durable, and review-oriented. Do not add one-off explanations for a single PR unless they generalize to future reviews. Prefer bullets that tell Copilot what to prioritize, what to ignore, and where source-of-truth files live.

If you update `.github/instructions/pr-reviewer.instructions.md`:

1. read the existing file first,
2. make the smallest useful change,
3. commit and push it with the PR fixes,
4. mention the instruction update in your round summary,
5. ask the user to request a fresh Copilot review so the new context can affect the next round.

### 4. Apply fixes when needed

When a fix is needed, add every actionable thread to one complete prompt for the PR's
existing visible Herdr-managed Pi session. Include the absolute worktree path, PR head
branch, exact findings, requested changes, and targeted checks. Before delivery, verify
the existing agent and read its recent output:

```bash
herdr agent get "$AGENT_NAME"
herdr agent read "$AGENT_NAME" --source recent-unwrapped --lines 200
herdr agent prompt "$AGENT_NAME" "$(< /absolute/path/to/review-fixes.md)"
```

Use `herdr agent prompt` only when no structured question/editor draft is active.
Return immediately; do not poll, wait, sleep, or create a watcher. A registered child
callback wakes its dedicated root through the durable bridge, which then verifies the
PR facts independently. Continue only after the visible Pi has:

1. verified its cwd and PR head branch;
2. edited the code;
3. run targeted tests, lint, typecheck, or another focused check;
4. committed and pushed the fixes.

For routine implementation questions, inspect the output and answer the recommended or
safest project-compliant option automatically. Escalate only genuine
product/architecture ambiguity, destructive operations, external infrastructure
mutation, credentials/secrets, or merge approval. If a structured prompt is active,
answer it through targeted pane input instead of appending a new agent prompt:

```bash
herdr pane read "$PANE_ID" --source visible --lines 120
herdr pane send-text "$PANE_ID" "<safe answer>"
herdr pane send-keys "$PANE_ID" enter
```

After the pushed commit is verified, reply to each affected Copilot comment with a
concise summary referencing the commit, then resolve the thread. Reuse the same
workspace, pane, and agent for all review rounds; do not create a worktree/session per
thread.

Reply to a PR review comment using this exact REST endpoint shape:

```bash
gh api -X POST \
  "repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments/$COMMENT_ID/replies" \
  -f body="Fixed in COMMIT_SHA: ..."
```

Resolve a review thread using this GraphQL mutation:

```bash
gh api graphql \
  -f threadId="$THREAD_ID" \
  -f query='
mutation($threadId:ID!) {
  resolveReviewThread(input:{threadId:$threadId}) {
    thread { id isResolved }
  }
}'
```

### 5. Explain and resolve when no fix is needed

When no fix is needed:

1. Reply in the review thread with technical reasoning.
2. Then resolve the thread.

Good no-fix reply examples:

- `This is intentionally handled by <existing mechanism>; adding the suggested branch would duplicate behavior and diverge from <project pattern>.`
- `Leaving this unchanged because <reason>. The suggested change would break <specific contract>.`
- `This path is already covered by <guard/function/test>; no code change is needed.`

Use the same reply and resolve commands from the previous section.

### 6. Verify this review round

After all threads in the current round are handled:

1. Refresh the PR snapshot and inspect its review threads.
2. Confirm there are no unresolved Copilot threads.
3. Summarize the current round:
   - PR number and URL,
   - threads fixed,
   - threads resolved without code changes,
   - commits pushed,
   - verification commands run and their results,
   - any remaining blockers.

### 7. Request another Copilot review round

Copilot re-review is requested by the user — either via the Reviewers menu on the GitHub PR page, or by asking you to run the CLI equivalent (`gh pr edit PR_NUMBER --add-reviewer @copilot`, per CLAUDE.md). Do not assume Copilot will automatically review after you push or reply, and never re-request a review on your own initiative.

When the current round is clean and the PR still benefits from another Copilot pass:

1. If Copilot's last round exposed a repeat misunderstanding, consider whether `.github/instructions/pr-reviewer.instructions.md` needs a durable context update before asking for another review.
2. Tell the user: `Please request another Copilot review manually from the GitHub PR page. I'll wait for the next round.`
3. Explain that Copilot usually takes a couple of minutes.
4. After the user says the review was requested or enough time has passed, refresh the PR snapshot.
5. Treat newly unresolved Copilot threads as the next round and repeat this workflow.

Do not run `gh pr edit --add-reviewer @copilot` unless the user asks — re-review requests are always user-initiated, whether via the GitHub UI or the CLI.

### 8. Detect low-signal Copilot review rounds

At some point repeated Copilot reviews may stop being useful. Detect this and tell the user it is okay to stop requesting more Copilot reviews.

Mark a Copilot round as low-signal when most or all new comments are one or more of:

- speculative `consider`/`maybe` suggestions without a concrete bug, contract violation, or maintainability win,
- style-only suggestions that conflict with project conventions or add churn,
- comments on code already changed or explained in a previous round,
- suggestions that would weaken boundaries, tests, security, or intentional design,
- duplicate feedback already resolved earlier,
- requests for broad extra tests/docs where targeted verification is already adequate for the change scope,
- nitpicks that do not improve correctness, safety, or long-term maintainability.

Still reply to and resolve any unresolved low-signal threads with concise technical reasoning. Then stop the re-review loop and tell the user:

`Copilot's latest round looks low-signal: it did not identify substantive issues worth changing. It is okay to stop requesting additional Copilot reviews.`

Include the evidence: number of rounds, number of comments fixed vs no-fix, and why the latest round was considered low-signal.

## Important project-specific guidance

- GitHub Copilot does not auto-resolve conversations when commits are pushed or suggestions are applied. Resolve each thread manually.
- Copilot does not respond to follow-up comments in threads. Replies are for human context only.
- Re-requesting Copilot review is a separate user-initiated action (GitHub Reviewers menu, or the `gh pr edit --add-reviewer @copilot` CLI equivalent when the user asks).
- A fresh Copilot review commonly takes a couple of minutes to appear; do not assume immediate results.
- Repeat review rounds only while the feedback remains substantive.
- If Copilot re-raises a previously resolved comment on re-review, treat it as a new unresolved thread and evaluate it again, but count repeated non-actionable feedback toward the low-signal stopping condition.
- Prefer targeted tests over full suites unless the change scope requires broader verification.
- Never claim a thread is resolved until the GitHub API confirms it is resolved.
