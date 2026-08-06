# PR #1340 Review Fixes Design

**Date:** 2026-08-06

**Branch:** `refactor/remove-network-enrichment-consent`
**PR:** #1340

## Goal

Make PR #1340 merge-ready while preserving its approved product direction: network-level and onboarding consent gates are removed, and enrichment remains automatic until a separate per-application enrichment service is introduced.

The fix must harden automatic enrichment boundaries, make public API behavior truthful, reconcile the branch with current `dev`, align release metadata, and provide focused verification evidence without bypassing database safety controls.

## Decisions

1. Merge current `origin/dev` into the PR branch rather than rebasing. This resolves the reported conflicts without rewriting the published branch.
2. Preserve immediate signup/import identity application and automatic enrichment.
3. Require current active membership for every network-scoped enrichment job at worker execution time.
4. Allow scoped onboarding preview/confirmation to use only a profile seed from the exact focused network. Unscoped onboarding may use the latest seed.
5. Continue passing email to the configured external identity enricher, but never include email in fallback text sent to premise decomposition.
6. Preserve retired JSON keys in storage for rolling-data compatibility while omitting `profileEnrichment` from every public network response.
7. Keep legacy `create_user_context` onboarding behavior for compatibility; this PR will not introduce the future enrichment preference service.

## Branch Integration

Merge `origin/dev` into the feature branch before implementation. Resolve the two expected overlapping surfaces as follows:

- `apps/web/package.json`: retain PR version `0.49.0`, which supersedes `dev`'s `0.48.1`.
- `docs/specs/api-reference.md`: retain both the new universal-link documentation from `dev` and the corrected enrichment behavior from this PR.
- `bun.lock`: preserve all current `dev` dependency data and set workspace metadata to the final package versions.

No force-push is required.

## Enrichment Admission

Replace the residual privacy-named execution context with an admission context that reports:

- whether the user exists and is not soft-deleted;
- whether a scoped network exists and is not soft-deleted;
- whether the user has an active, non-deleted membership in that network;
- whether the user already has an active premise.

Admission rules:

- Every job requires a live user.
- A network-scoped job additionally requires a live network and active membership.
- A missing network or membership causes a logged skip, not a retrying failure.
- An unscoped job does not query or require a network, but still checks the user.
- The existing active-premise short-circuit for `ensure_profile_hyde` remains unchanged.

This check runs when the BullMQ worker processes the job, closing the removal race between enqueue and execution.

## Scoped Seed Isolation

`selectProfileSeed` will have two explicit modes:

- With `networkId`: return the latest seed for exactly that network, or `undefined` when none exists.
- Without `networkId`: return the latest seed across all sources.

Both preview generation and approved-profile social merging use the same rule. A network-scoped credential can therefore neither preview nor activate another network's organizer-supplied seed.

## Contact-Identifier Safety

Automatic identity enrichment may continue to use account email as an external lookup identifier. However, the low-signal/no-enricher fallback passed to premise decomposition will include only name, location, and bio. Email is excluded so it cannot become a durable premise or user-context fact.

This is deliberately narrower than redesigning external enrichment consent, which belongs to the future per-application service.

## Public Network Permission Projection

Introduce one canonical projection for public network permissions. It returns only:

- `joinPolicy`;
- `invitationLink`;
- `allowGuestVibeCheck`;
- optional `contextInjection`.

Apply it to network list, network detail, create/update settings, and invitation-link responses. Database writes continue spreading existing JSON so retired or unknown rolling-data keys are not destructively removed from storage.

## Release and Documentation Consistency

- Set Hermes plugin versions to `0.16.0` in `plugin.yaml`, `package.json`, and `dashboard/manifest.json`.
- Update `bun.lock` workspace metadata for web `0.49.0`, Hermes `0.16.0`, protocol `10.0.0`, and API `0.77.0` while retaining current `dev` lock data.
- Remove stale public-lookup-consent wording from the web changelog and protocol design documentation.
- State truthfully that signup/import fields are applied immediately, automatically enriched, and also retained as provenance seeds for onboarding review.
- Update the PR comment with the final behavior and verification evidence. The existing PR body need not be rewritten if the final comment clearly supersedes stale wording.

## Error Handling

- Missing user, network, or membership produces a deterministic denied admission reason and skips the job.
- Existing queue error/retry behavior remains for actual graph or external service failures.
- Seed absence is not an error; preview falls back to authenticated identity and explicit user input.
- Legacy stored permission fields are silently omitted from responses rather than rejected or deleted.

## Testing Strategy

Use red-green-refactor for every production behavior change:

1. Admission tests fail while a missing user, missing network, or missing membership is still admitted.
2. Seed-isolation tests fail while scoped lookup falls back to another network.
3. Enrichment graph fallback test fails while email remains in decomposition input.
4. Network projection tests fail while raw legacy `profileEnrichment` is returned.
5. Hermes smoke fails before version metadata is aligned.
6. Lock metadata assertions fail before workspace versions are corrected.

Then run:

- focused protocol typecheck and affected protocol tests;
- API build and affected hermetic tests;
- web build, lint, and relevant tests;
- Hermes smoke test;
- protocol architecture/export checks where affected;
- subtree dependency parity, generated-skill check, and `git diff --check`;
- `bun install --frozen-lockfile`;
- fresh PR status/check inspection after push.

Database-backed tests run only if `DATABASE_URL` is independently proven dedicated and disposable and `TEST_DATABASE_SAFE=1` is set. Otherwise, report them as intentionally not run.

## Delivery

After verification:

1. Delete this design and its implementation plan as required by the repository finishing policy.
2. Commit the reviewed implementation with conventional commit messages.
3. Push the feature branch normally.
4. Fetch the pushed branch and prove no ahead/behind drift.
5. Confirm GitHub recomputes mergeability and starts fresh checks.
6. Post a top-level PR comment summarizing fixes, exact commands/results, and any database-test caveat.

## Non-goals

- Implementing the future per-application enrichment preference service.
- Restoring network-level or onboarding consent gates.
- Removing legacy consent JSON from stored rows via migration or backfill.
- Changing the legacy `create_user_context` compatibility surface.
- Running database-backed tests against an unverified shared database.
