# Eval Ops Reset Environment File Design

## Problem

The deployed `eval-ops` Railway service receives a validated `DATABASE_URL`, but the repository-root `.env.test` is gitignored and is not present in the `/app` image. The reset endpoint currently refuses before launching its migrate step whenever that file does not define `DATABASE_URL`:

> Refusing to reset: /app/.env.test does not set DATABASE_URL, so the migrate step would target an unknown database.

This makes deployed fixture reset permanently unavailable even though the child process already receives the same validated URL through its environment. The Railway service config correctly has no pre-deploy migration; this is an eval-ops reset preflight issue.

## Decision

Allow the injected `DATABASE_URL` when `.env.test` is absent. Preserve strict local safety when the file exists:

1. Run the existing `assessFixtureTarget` validation first. Production database names, redirecting query parameters, malformed URLs, and missing injected URLs remain refused.
2. If `.env.test` does not exist, accept the validated injected URL. `drizzle.config.ts` already leaves the process-provided URL in place when no env file is available, and the reset child also receives `NODE_ENV=test` and `TEST_DATABASE_SAFE=1`.
3. If `.env.test` exists, require a non-empty `DATABASE_URL` and require exact equality with the validated injected URL. This prevents a local or partially mounted deployment from flushing one target while migrating another.
4. Keep all existing credential redaction and fail-closed validation behavior.

## Implementation shape

Add a small environment-file inspection result that distinguishes “file absent” from “file present but key missing.” Use it in `resolveResetTarget` rather than treating both states as `DATABASE_URL` missing. Keep the existing `readEnvValue` parsing semantics, including last assignment wins, comments, blank values, and quoted values.

## Testing

Add focused provider-free tests for the preflight helper:

- absent `.env.test` accepts a safe injected disposable URL;
- present `.env.test` without `DATABASE_URL` refuses;
- present `.env.test` with a different URL refuses;
- present `.env.test` with the same URL accepts.

Run the eval-ops ops test suite and TypeScript checks. Confirm the canonical root remains on `dev` and all changes are isolated to the fix worktree.
