# Hermes backend production rollout assurance

This is an operator checklist, not a deployment approval. It **does not authorize production execution**. Release approval, migration approval, and any production mutation approval are separate decisions. Use a dedicated approved smoke account and the release change record; never create ad-hoc production fixtures.

## Release inputs and evidence

Release operations supply all three values; do not infer or copy them from an earlier run:

```bash
export PREVIOUS_API_IMAGE='registry.example/index-api@sha256:<operator-supplied immutable digest>'
export HERMES_PREFLIGHT_MAX_LOCK_MS='<release-approved positive milliseconds>'
export HERMES_PREFLIGHT_MAX_TOTAL_MS='<release-approved positive milliseconds>'

gh workflow run hermes-backend-production-assurance.yml \
  --ref '<release commit>' \
  -f PREVIOUS_API_IMAGE="$PREVIOUS_API_IMAGE" \
  -f HERMES_PREFLIGHT_MAX_LOCK_MS="$HERMES_PREFLIGHT_MAX_LOCK_MS" \
  -f HERMES_PREFLIGHT_MAX_TOTAL_MS="$HERMES_PREFLIGHT_MAX_TOTAL_MS"
```

The protected previous-image gate is mandatory, has no skip/continue-on-error path, and uses the GitHub `production` environment. PR image evidence is clearly non-production: it is built from the pinned real rollback base only to prove old-code denial and is not evidence about the currently deployed image.

Download only the `hermes-backend-production-assurance` aggregate artifact and the established previous-API compatibility JSON reports. The aggregate must contain exactly these fixed passed gates: `migrations`, `authority`, `lifecycle`, `preflight-100k`, `telemetry-aggregate`, `emergency-concurrency-rollback`, `emergency-dry-run`, `stale-index-coverage`, `expired-index-coverage`, `build`, `typecheck`, `cli-typecheck`, `lint`, `static-inventory`, `telemetry-privacy`, `assurance-output-sanitization`, and `sentry-sink`. It also contains the approved thresholds and sanitized measured `lockDurationMs` and `totalDurationMs`; the accompanying exact-schema preflight report contains the same durations. Require both measured values to be finite, nonnegative, and no greater than their approved maxima. Treat evidence as **credential-free**: never attach raw workflow logs, database URLs, owner/agent/installation/negotiation IDs, plan IDs, credential values or hashes, request headers, payloads, transcripts, or credential-derived material.

## Pre-deploy gates

1. Confirm the workflow migrated only its disposable PostgreSQL 16 database named `hermes_assurance` and ran authority, lifecycle, 100k preflight, telemetry aggregate, emergency concurrency/rollback, and stale/expired fallback suites.
2. Confirm build, API typecheck, CLI-spec typecheck, lint, and static isolated inventory passed provider-free.
3. Confirm preflight counts are all zero and its measured durations are within the two release-approved inputs.
4. Confirm the protected report records exact 401 denial by the operator-supplied immutable digest.
5. Confirm emergency control was dry-run only. The workflow must never contain or invoke `--confirm`.
6. Confirm the stale and expired smoke reports `indexCovering: true` in both cases.

## Deployment order: server before client

Deploy the server before client. Do not distribute or enable a Hermes client that depends on API 0.80.0 until the server is healthy.

1. Under separate migration authorization, inject the production `DATABASE_URL` without printing it and run:

   ```bash
   bun run --cwd services/api db:migrate
   bun run --cwd services/api maintenance:hermes-preflight -- \
     --json \
     --max-lock-ms "$HERMES_PREFLIGHT_MAX_LOCK_MS" \
     --max-total-ms "$HERMES_PREFLIGHT_MAX_TOTAL_MS"
   ```

   Save only the fixed count/duration report. A nonzero count, timeout, malformed report, or missing threshold stops rollout.
2. Deploy API 0.80.0. Wait for health, migration, error-rate, and latency checks. Do not deploy the client yet.
3. Run the server smoke below.
4. Only after the server smoke and dashboard hold period pass, distribute/enable the matching notarized client through its separately approved release procedure.

## Exact smoke sequence

The required order is **prepare → select → pickup → respond → consult → Index → reselect → disconnect**. Use a dedicated approved smoke owner and two sanctioned smoke turns because respond and consult are mutually exclusive mutations for one claimed turn. Keep the browser session, `idxh_` credential, run capability, and every returned ID in memory/Keychain only; do not paste them into tickets, shell history, or evidence.

1. **Prepare.** From the approved client, initiate the fresh PKCE browser authorization with `POST /api/hermes-authorizations`, then complete browser consent, exchange, Keychain storage, and `/hermes-authorizations/activate`. This is the entire Prepare phase: never call the legacy `/api/agent-runtime/hermes/prepare` route. Treat the nonsecret activated connector tuple as authoritative: its `installationId`, `agentId` (used as `executorId`), and `setupAttemptId` must be the values used below; do not use caller-generated or legacy tuple values.
2. **Select Hermes.** Call `PUT /api/agent-runtime` with exactly `{runtime:"hermes",installationId,executorId,setupAttemptId}` from that activated connector tuple. Read `GET /api/agent-runtime?installationId=...` and require that the selected executor and all three tuple fields match exactly. Before any pickup for this generation, the expected state is `health:"never-seen"` and `indexCovering:true`; do not treat previous-generation health as evidence for this tuple.
3. **Pickup.** Run the native Hermes command `index_pickup_negotiation({})` once against the first sanctioned turn. Require `pending:true`, an exact closed `allowedActions` list, and no private owner context/prose. Only after that successful pickup, refresh `GET /api/agent-runtime?installationId=...`, re-verify the exact activated connector tuple, and require `health:"active"` with `indexCovering:false`.
4. **Respond.** Run `index_respond_negotiation({negotiationId:<pickup value>,action:<one allowed action>,roleAlignment:<peers|owner_leads|counterparty_leads>})` once. Require one server-confirmed receipt and no duplicate effects.
5. **Consult.** On the second sanctioned eligible turn, run `index_pickup_negotiation({})` in a new pass, require `canConsultOwner:true`, then run `index_consult_owner({negotiationId:<pickup value>,reason:<one returned closed category>})`. Require `input_required`; verify the owner receives only fixed server-authored question copy and that settlement resumes exactly once after the approved smoke answer/dismissal.
6. **Select Index.** Call `PUT /api/agent-runtime` with exactly `{runtime:"index"}`. Require selected Index and `indexCovering:true`; a subsequent Hermes pickup must be denied.
7. **Reselect Hermes.** Call `PUT /api/agent-runtime` again with the same still-active exact generation. Require selected Hermes, then require `pending:false` from the pickup before disconnect. If pickup unexpectedly returns `pending:true`, it has claimed a turn: do not disconnect. Complete exactly one sanctioned respond or consult mutation permitted by that turn, verify settlement completed with no outstanding claimed work, select Index if needed, and restart the final reselect → empty pickup → disconnect sequence from the beginning. An unexpected claimed turn is cleanup work, never successful reselect evidence.
8. **Disconnect through the production saga.** Use only the approved client Disconnect control; do not issue a direct server disconnect request. The approved client Disconnect control must complete this source-contracted order for the same exact activated generation:
   1. Persist the disconnect intent and pause the matching local negotiator/plugin schedule. The preflight must leave the schedule disabled and scrub the app-owned dedicated environment wiring, but it is not terminal disconnect evidence.
   2. Ask the signed connector to disconnect that exact tuple. The connector internally sends authenticated `POST /api/hermes-authorizations/disconnect` with exactly `{protocolVersion:1}`, validates the matching revocation receipt, proves the old credential is terminally denied when `GET /api/auth/me` returns `401`, and deletes its credential from Keychain. Do not expose the credential or reproduce these connector-owned requests manually. A pending or ambiguous result stops the smoke; proceed only when connector status is exactly `connected:false`, `revocationPending:false`, `health:"disconnected"`, with `agentId:null`, `setupAttemptId:null`, and the same nonsecret installation ID.
   3. Only after that terminal connector proof, require the owner-authenticated exact-generation CAS at `POST /api/agent-runtime/reconcile-index` with exactly `{agentId,installationId,setupAttemptId}` from the activated tuple. Accept only `selected` or `already_index` with selected Index and no executor; a preserved/newer generation is not success.
   4. Only after the Index CAS, let the approved client remove the matching local schedule, `index-network` plugin, dashboard, and owned environment wiring. Require terminal local state with `pluginInstalled:false`, `schedulePresent:false`, `scheduleEnabled:false`, negotiator mode false, and cleared generation fields.

   Verify the final state from both boundaries: refresh the owner server binding and require selected Index, no executor, inactive old installation, revoked dedicated credential, removed negotiation authority, and `indexCovering:true`; then refresh signed connector status and require the same terminal disconnected/null-authority state. A Hermes pickup with the old credential/generation must remain denied, and reconnect must require fresh authorization rather than extending the old credential.

The release contract for this order is the combination of `apps/mac/api/agent-runtime-saga.mjs`, `apps/mac/api/agent-runtime-saga.spec.mjs`, `apps/mac/api/client.mjs`, `apps/mac/IndexConnector/Sources/ConnectorHTTPClient.swift`, `apps/mac/IndexConnector/Sources/ConnectorRuntime.swift`, `apps/mac/IndexApp/Sources/HermesRuntime.swift`, `services/api/src/controllers/hermes-authorization.controller.ts`, `services/api/src/controllers/agent-runtime.controller.ts`, and `services/api/src/cli/tests/hermes-production-assurance-release.spec.ts`. The production-assurance workflow triggers on the complete `apps/mac/**` trust surface and runs `bun test apps/mac/api/agent-runtime-saga.spec.mjs` provider-free on Ubuntu. This portable gate does not claim a Swift or macOS build; native validation remains in the separate existing Mac workflow.

Do not record the smoke's IDs or secrets. Record only step names, pass/fail, fixed health/reason enums, counts, and durations.

## Dashboards, alerts, and hold period

During rollout and the approved observation window, watch these bounded metrics (all prefixed `hermes.`):

- lifecycle/authority: `authorization_started`, `authorization_completed`, `authorization_expired`, `authorization_replayed`, `credential_rejected`, `credential_rotated`, `credential_revoked`, `credential_revocation_pending`, `auth_denied`;
- fallback/errors: `runtime_stale`, `index_fallback`, `conflict`, `server_error`, `outbox_replay_attempted`;
- gauges: `credentials_near_expiry`, `credentials_expired`, `pending_outbox`;
- latency: `advisory_lock_wait_ms`.

Before client enablement, dashboards must be receiving metrics with only the bounded `reason` label and no identity/free-text dimensions. Alert on sustained server errors, rising authorization replay/rejection, nonzero or increasing `pending_outbox`, abnormal lock-wait latency, or fallback spikes. `credentials_near_expiry` is a seven-day action queue: owners must reauthorize before expiry. `credentials_expired` requires Index coverage and fresh authorization; expiry never refreshes or extends a credential.

If any gate or smoke fails, stop client rollout and prefer a server forward fix. Use the emergency runbook only after its separate incident authorization.
