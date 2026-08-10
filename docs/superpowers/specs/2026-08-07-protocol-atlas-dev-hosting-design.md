# Protocol Atlas Dev Hosting Design

## Summary

Publish the existing dependency-free Protocol Atlas at `https://dev.index.network/protocol-atlas/` without exposing it on production hosts. Keep `docs/protocol-atlas/` as the only tracked source of atlas assets and preserve direct `file://` and ordinary static-HTTP use.

## Goals

- Serve the atlas at `/protocol-atlas/` on `dev.index.network`.
- Keep the route unlisted and reachable only by its direct URL.
- Keep `docs/protocol-atlas/` canonical; do not commit a duplicate under `apps/web/public`.
- Fail the frontend build when the generated atlas is stale or required assets are missing.
- Ensure atlas and protocol-source changes trigger a development frontend deployment.
- Bump the affected `apps/web` package version and changelog before integration.
- Verify the Railway deployment and live URL before reporting success.

## Non-goals

- Do not add the atlas to web navigation.
- Do not expose the atlas on `index.network`, `www.index.network`, or unknown hosts.
- Do not change atlas content, interactions, configuration semantics, or protocol scope.
- Do not create a separate Railway service or domain.
- Do not read live protocol configuration values or credentials.

## Architecture

### Canonical source

`docs/protocol-atlas/` remains the single tracked source. Its required deployment assets are explicitly allowlisted:

- `index.html`
- `atlas.css`
- `atlas-content.js`
- `atlas-core.js`
- `atlas.js`
- `protocol.generated.js`

The existing generator and `bun run check:protocol-atlas` remain authoritative for generated evidence.

### Build-time publication

Add a small dependency-free web build module under `apps/web` that:

1. Runs only after Vite has produced `apps/web/dist`.
2. Verifies all allowlisted source files exist and are regular files before touching the current destination.
3. Copies the allowlist in deterministic order into a sibling staging directory.
4. Replaces `apps/web/dist/protocol-atlas` with the completed staging directory only after every copy succeeds.
5. Preserves file bytes unchanged so relative classic-script and stylesheet references continue to work.

The web build runs `bun run check:protocol-atlas` before the copy. A stale generated artifact, missing source, or copy failure fails the build and prevents deployment. No atlas files are generated from live environment state.

### Host boundary

`apps/web/server.ts` recognizes `/protocol-atlas` and `/protocol-atlas/**` as a restricted static subtree before ordinary static-file or SPA handling.

Allowed hostnames:

- `dev.index.network`
- `localhost`
- `127.0.0.1`
- `[::1]`

All other hosts receive the server's existing uncached plain-text 404 for the atlas entry point and every atlas asset, even when the file exists in `dist`. The production deployment may contain the copied bytes, but cannot serve them through this server. Requests outside the atlas subtree keep their current behavior.

On an allowed host, `/protocol-atlas` returns a `308` redirect to `/protocol-atlas/`, ensuring relative assets resolve beneath the atlas subtree. `/protocol-atlas/` serves the copied `index.html`. On a disallowed host, both forms return 404 without redirecting.

### Railway rebuild triggers

Extend `apps/web/railway.toml` watch patterns to include:

- `/docs/protocol-atlas/**`
- `/scripts/build-protocol-atlas.ts`
- `/scripts/tests/build-protocol-atlas.spec.ts`
- `/packages/protocol/**`

This ensures changes that alter atlas evidence or presentation rebuild the frontend. Existing web, root package, and lockfile watch patterns remain.

## Data Flow

1. Protocol source and curated atlas files live in the repository.
2. `check:protocol-atlas` validates the committed generated artifact against protocol source.
3. Vite builds the web application into `apps/web/dist`.
4. The atlas publisher copies the allowlisted canonical files into `dist/protocol-atlas`.
5. Railway starts the existing Bun web server.
6. The server checks the request hostname before serving anything under `/protocol-atlas`.
7. The atlas loads its relative assets from the same restricted subtree.

## Error Handling

- **Stale generated evidence:** fail the frontend build via `check:protocol-atlas`.
- **Missing or non-file source asset:** fail before changing the atlas destination.
- **Copy failure:** remove the incomplete staging directory, leave any prior destination unchanged, and fail the build; Railway must not promote the deployment.
- **Disallowed hostname:** return the existing `404 Not Found` response with `Cache-Control: no-store`.
- **Missing deployed atlas asset:** return a real 404 rather than the SPA entry point.
- **Railway deployment not terminal-successful:** stop and report the exact state; do not claim the atlas is live.

## Testing

Implementation is test-driven.

### Publisher tests

- Copies exactly the allowlisted files into a temporary destination.
- Preserves bytes and nested deployment path.
- Removes stale destination files.
- Fails without partially replacing the destination when a required source is missing.
- Rejects non-file source entries.

### Server tests

- `dev.index.network` redirects the slashless route and serves atlas HTML and assets from a fixture `dist`.
- Localhost hosts apply the same redirect and serving behavior for local verification.
- Production and unknown hosts return 404 for the entry point and assets.
- Missing atlas assets return 404 instead of the SPA shell.
- Existing SPA, public-file, caching, and AASA behavior remains unchanged.

### Repository gates

- Protocol Atlas test suite and generated-artifact check.
- Focused publisher and web server tests.
- Web lint and production build.
- Static HTTP smoke test against the built server.
- `git diff --check` and affected static/config checks.

## Rollout

1. Commit and independently review the hosting change.
2. Bump `apps/web` from `0.49.0` to `0.50.0`, update its changelog, and regenerate the root lockfile.
3. Remove this transient design spec and its implementation plan before branch closeout.
4. Push the feature branch and open a pull request into `dev` with exact verification evidence.
5. Complete project-required PR review and obtain separate explicit merge authorization after every gate is green.
6. Merge the PR into `dev`, which triggers the development frontend deployment.
7. Poll the Railway `frontend` deployment until it reaches `SUCCESS` or another terminal state.
8. Verify `https://dev.index.network/protocol-atlas/` and representative assets return 200.
9. Verify production hosts return 404 for the same paths.

## Rollback

Revert the hosting commit and push `dev` again. The next successful frontend deployment removes the copied atlas subtree and host-routing rule. The canonical atlas under `docs/protocol-atlas/` remains intact.
