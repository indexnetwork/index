# AASA universal-link rollout design

## Purpose

Enable Apple universal links for the macOS bundle `network.index.system6` without exposing a malformed association file or changing API routing before the web fallback is deployed.

## Current state

- `apps/web/server.ts` renders `/.well-known/apple-app-site-association` from `APPLE_TEAM_ID`; when absent it serves `TEAMIDPLACEHOLDER.network.index.system6`.
- The approved Apple Developer Team ID is `LMQ3XNXLAD`.
- Railway `dev` frontend already serves the AASA route but currently contains the placeholder.
- Railway `main` frontend serves `index.network` but currently deploys a pre-deep-link revision, so its AASA route returns HTTP 404.

## Rollout

1. Set `APPLE_TEAM_ID=LMQ3XNXLAD` only on Railway's `frontend` service in the `dev` environment.
2. Wait for the variable-triggered deployment to reach a terminal successful state.
3. Verify `https://dev.index.network/.well-known/apple-app-site-association` from outside Railway:
   - HTTP 200;
   - no redirect;
   - `Content-Type: application/json`;
   - JSON `applinks.details[0].appIDs` exactly equals `["LMQ3XNXLAD.network.index.system6"]`.
4. Check the dev frontend logs to confirm the missing-`APPLE_TEAM_ID` startup warning is absent.
5. Do not configure or claim production universal-link readiness until a release deploys the web AASA route to Railway `main`. The web deployment must precede any API deployment that removes the legacy `/c/:code/go` behavior.
6. During that production web release, set the same variable on Railway `main` frontend and repeat the public AASA verification at `https://index.network/.well-known/apple-app-site-association`.

## Error handling and rollback

If the dev deployment fails, inspect its Railway logs and do not continue to production. If the AASA response is malformed, redirected, or contains another app ID, correct the dev configuration and re-verify before any production action. Removing the variable restores the existing placeholder behavior but does not repair an unrelated failed deployment; use it only to undo an incorrect value.

## Validation

This is an infrastructure-only change. Validation is the external AASA response, Railway deployment status, and frontend startup logs; source tests are unaffected.
