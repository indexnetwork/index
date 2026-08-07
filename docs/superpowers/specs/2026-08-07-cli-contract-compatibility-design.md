# CLI Contract Compatibility Design

**Date:** 2026-08-07
**Status:** Design approved; written spec pending review
**Scope:** `packages/cli` compatibility and release-integrity batch

## Context

The CLI source last changed on 2026-07-30, while protocol and API contracts continued evolving. The audit found one post-anchor command regression, several stale integrations with newer API surfaces, two pre-existing broken mutation contracts, and a red release baseline.

Current evidence:

- `bun run lint` passes in `packages/cli`.
- `bun run build` completes, but the build rewrites tracked platform manifests when versions drift.
- `bun test` reports 358 passing and 6 failing tests because the main package is `0.13.1` while the runtime, optional platform dependencies, and platform manifests are `0.13.0`.
- Ordinary non-staff `index network create` calls an endpoint that now returns the early-access 403 and directs clients to `/api/network-requests`.
- `index intent update` sends `newDescription`, while the protocol tool requires `description`.
- `index opportunity reject` calls the owner-gated tool API with a CLI API key, which cannot provide trusted owner provenance; the REST status endpoint remains the correct owner-action surface.
- Profile commands still use deprecated REST-only `*_user_profile` aliases, and `profile sync` does not use the new synchronous enrichment endpoint.
- Email invitation still performs search-then-add rather than using the dedicated invitation endpoint.

## Goals

1. Restore a green, internally consistent CLI release baseline.
2. Make the affected CLI commands conform to current API and protocol contracts.
3. Centralize touched request construction in typed `ApiClient` methods.
4. Preserve existing user-facing command names and authentication behavior.
5. Add focused regression coverage for every repaired contract.

## Non-goals

- Splitting `ApiClient`, formatters, or command files by domain.
- Refactoring the argument parser.
- Consolidating SSE parsing.
- Changing API or protocol behavior.
- Adding database-backed or live-provider tests.
- Renaming the user-facing `profile`, `intent`, `network`, or `opportunity` commands.
- Fixing unrelated CLI findings such as conversation hiding, Gmail OAuth presentation, or broader snapshot schema/versioning.

## Architecture

The CLI remains a flat TypeScript application. `ApiClient` continues to be the only HTTP boundary. Command modules decide user flow and rendering, but no longer construct the touched endpoint paths or backend payloads directly.

Add focused typed client methods:

- `createNetworkOrRequest(title, prompt?)`
- `inviteNetworkMember(networkId, email, name?)`
- `enrichProfile()`
- `updateIntent(intentId, description)`
- `updateOpportunityStatus(id, status, acknowledgedUptakeQuestionIds?)`
- canonical profile/context tool wrappers where a command needs direct tool access

Do not introduce domain client classes or a generated SDK in this batch.

## Command Behavior

### Network creation

`index network create <name> [--prompt <text>]` first calls the existing direct network-creation endpoint.

- Staff success returns a tagged `{ kind: "created", network }` result and prints `Network created`.
- A non-staff early-access response falls back to `POST /api/network-requests` with:
  - CLI `name` mapped to API `name`;
  - CLI `--prompt` mapped to API `purpose`.
- Request success returns `{ kind: "requested", request }` and prints `Network request submitted`.
- The CLI exits successfully when the request was successfully submitted, but never claims that a network was created.
- Fallback is allowed only for an `ApiError` with status 403 whose structured response identifies the early-access network-creation restriction. Other 403 responses remain failures.
- `--json` emits the tagged result without ANSI or progress output.

### Network invitation

`index network invite <network-id> <email>` calls `POST /api/networks/:id/members/invite` directly. It no longer requires the invitee to be discoverable through the caller's existing personal-network contacts. Terminal output distinguishes a newly created invitee from an already-existing member when the API reports that distinction; JSON output preserves the typed response.

### Profile commands

The user-facing `profile` terminology remains unchanged.

- Search, create, update, and the profile portion of `index sync` use canonical `read_user_contexts`, `create_user_context`, and `update_user_context` tool names where direct tools remain appropriate.
- `index profile sync` calls `POST /api/enrichment/enrich`, waits for the synchronous response, and reports completed enrichment rather than saying an asynchronous regeneration was merely triggered.
- JSON mode prints the raw enrichment response without ANSI.

### Intent update

`index intent update` delegates to `ApiClient.updateIntent`, which calls `update_intent` with exactly `{ intentId, description }`. The old `newDescription` key is removed from source and tests.

### Opportunity status

Acceptance and rejection share `ApiClient.updateOpportunityStatus` over `PATCH /api/opportunities/:id/status`.

- Acceptance may include `acknowledgedUptakeQuestionIds` and retains the existing 409 advisory flow.
- Rejection never calls `update_opportunity` through the direct Tool API.
- Uptake acknowledgement is not sent for rejection.

## Error Handling

- REST methods continue throwing `ApiError` on non-2xx responses.
- Tool wrappers return `ToolResult`; commands treat `success: false` as failure and do not print success messages.
- The network-request fallback checks both HTTP status and the structured early-access error. It does not catch arbitrary permission failures.
- Synchronous enrichment failure propagates as an ordinary CLI error.
- Existing session/API-key migration, credential storage, and reauthentication behavior are unchanged.
- Terminal and JSON branches describe the same outcome; JSON mode remains free of ANSI and progress text.

## Version and Packaging Integrity

This fix changes the CLI package and therefore receives a patch bump from `0.13.1` to `0.13.2`.

`packages/cli/package.json` is the version source of truth for runtime reporting. The implementation removes the independent hard-coded runtime version. The following must align at `0.13.2`:

- main CLI package version;
- runtime `index --version` output;
- four optional platform dependency pins;
- four platform package manifests;
- applicable root/package lockfiles.

The build may generate ignored binaries, but a completed build must not leave tracked source or manifests dirty.

## Testing Strategy

Implementation follows red-green TDD. Add or update tests before each production change.

### Client and command contracts

- Direct network creation returns `kind: "created"`.
- Only the specific early-access 403 falls back to a request and returns `kind: "requested"`.
- An unrelated 403 does not submit a request.
- Network request payload maps title/name and prompt/purpose correctly.
- Network invite uses the dedicated email invitation endpoint.
- Profile sync uses `/api/enrichment/enrich`.
- Profile commands use canonical context tool names; deprecated profile tool names are absent from CLI source.
- Intent update sends `{ intentId, description }`.
- Accept and reject both use the REST status endpoint.
- Only accept may send uptake acknowledgement IDs.
- Existing acceptance advisory rendering remains covered.
- Terminal and JSON output distinguish network creation from request submission.

### Release integrity

- Runtime version equals the main package version.
- Optional dependency versions equal the main package version.
- Every platform package version equals the main package version.
- Build leaves tracked manifests unchanged.

## Validation

Run from the implementation worktree:

1. `cd packages/cli && bun test <affected-test-file>` during each red-green cycle.
2. `cd packages/cli && bun run lint`.
3. `cd packages/cli && bun test`.
4. `cd packages/cli && bun run build`.
5. Verify `git status --short` shows no tracked build mutation.
6. `cd packages/cli && bun scripts/publish.ts --dry-run`.
7. From the repository root, run `bun run check:subtree-parity` and applicable lockfile/static checks from the Development Reference.

No database-backed tests are required because the implementation changes only the CLI and consumes existing HTTP/tool contracts.

## Acceptance Criteria

1. All CLI tests pass with no version-alignment failures.
2. Non-staff network creation submits a pending request and never claims immediate creation.
3. Staff network creation retains direct creation behavior.
4. Email invitation no longer requires prior contact discovery.
5. Profile sync returns completed synchronous enrichment, including the API's avatar/social payload in JSON mode.
6. No deprecated `*_user_profile` tool name remains in CLI source.
7. Intent update passes current protocol validation.
8. Opportunity rejection succeeds through the REST owner-action surface.
9. Acceptance uptake behavior remains unchanged.
10. `index --version`, all package manifests, optional dependency pins, and lockfiles agree on `0.13.2`.
11. Lint, complete CLI tests, cross-platform build, publish dry-run, and subtree parity pass.
12. The worktree contains no unintended generated or tracked build changes.
