# Hermes emergency rollback

This runbook is **forward-fix-first**. Prefer disabling client rollout and deploying a corrected server over restoring an older binary. It **does not authorize production execution**: incident command must separately approve production mutation, release operations must approve the immutable older image, and database/migration authorization remains separate. Never down-migrate Hermes tables during this procedure.

The exact rollback order is:

1. Pause
2. Bulk revoke
3. Verify zero active dedicated credentials and zero selected Hermes
4. Restore older binary

Do not reorder or parallelize these steps. In particular, never start an older server while a dedicated Hermes credential or selected Hermes executor remains live.

## Preconditions

- Incident command records the reason, scope, approver, and observation owner without copying identities or credentials.
- The operator shell receives `DATABASE_URL` from the approved secret injector; never echo it or place it in a command argument.
- The current API remains reachable for owner pause operations.
- The immutable older image digest has passed the protected production compatibility gate. An image tag, PR fixture image, local image ID, or handwritten fixture is not acceptable.
- Workflow/database tests use only the dedicated disposable database named `hermes_assurance` with `TEST_DATABASE_SAFE=1`. That marker does not authorize a production command and must not be used to imply production safety.
- Use a private terminal with history disabled and `umask 077`. Do not use `set -x`.

## 1. Pause

1. Stop Hermes client rollout, new connector activation, and scheduled negotiator launches at the deployment/control-plane layer.
2. For each connection returned to an authorized owner by `GET /api/connected-agents/hermes`, call:

   ```text
   POST /api/connected-agents/hermes/:installationId/pause
   body: {}
   ```

   Require `selected:false` and `indexCovering:true`. Keep installation IDs only in the authorized operator/client session; never put them in incident evidence.
3. Confirm Index is covering new negotiation dispatch before proceeding. If individual owner pause cannot complete, do not restore the old binary; continue only when incident command explicitly authorizes the bulk emergency transaction in step 2, which atomically deselects every actionable Hermes installation before revocation commits.

## 2. Bulk revoke

The emergency command defaults to dry-run. The dry-run is safe to repeat and must occur immediately before confirmation. Confirmation requires the exact opaque plan ID and the exact installation count from that plan; a changed snapshot fails without partial mutation.

```bash
set +o history 2>/dev/null || true
umask 077
plan_file="$(mktemp)"
receipt_file="$(mktemp)"
cleanup_emergency_files() {
  rm -f "$plan_file" "$receipt_file"
}
trap cleanup_emergency_files EXIT

# Dry-run only: no --confirm.
bun run --cwd services/api maintenance:hermes-emergency-control -- \
  --audience hermes-agent >"$plan_file"

plan_id="$(jq -er '
  select(.audience == "hermes-agent" and .reason == "planned")
  | .planId
  | select(type == "string" and test("^hecp_[A-Za-z0-9_-]+$"))
' "$plan_file")"
expected_installations="$(jq -er '
  .installations
  | select(type == "number" and floor == . and . >= 0)
  | tostring
' "$plan_file")"

# Enforce a canonical non-negative decimal safe integer before mutation.
[[ "$expected_installations" =~ ^(0|[1-9][0-9]*)$ ]]
(( expected_installations <= 9007199254740991 ))

# Separately authorized mutation. All three confirmation fields are mandatory.
bun run --cwd services/api maintenance:hermes-emergency-control -- \
  --audience hermes-agent \
  --confirm \
  --plan-id "$plan_id" \
  --expected-installations "$expected_installations" >"$receipt_file"

jq -e '
  .audience == "hermes-agent"
  and (.reason == "executed" or .reason == "already-executed")
  and (.selectedPaused | type == "number")
  and (.credentialsRevoked | type == "number")
  and (.installationsDisconnected | type == "number")
' "$receipt_file" >/dev/null

unset plan_id expected_installations
cleanup_emergency_files
trap - EXIT
```

The transaction selects Index, generation-fences/disables actionable Hermes installations, revokes every pending/active exact-audience credential, removes only `manage:negotiations` from locked Hermes permission rows, and writes one credential-free receipt. A count mismatch, plan drift, concurrency loss, or injected failure rolls the whole transaction back. An exact rerun is idempotent and reports `already-executed` with zero new mutations.

Never upload the plan ID, receipt ID, plan/receipt file, command output, raw logs, database URL, IDs, hashes, credentials, or credential-derived data. The plan ID is operational confirmation material, not release evidence.

## 3. Verify zero active dedicated credentials and zero selected Hermes

Run this fixed count-only query through Bun so `DATABASE_URL` remains in process environment rather than command arguments. It checks both the requested active count and the stricter live (`pending` or `active`) count. Any nonzero value stops rollback; rerun dry-run/confirmation against a fresh plan rather than editing data manually.

```bash
bun --cwd services/api --eval '
  import postgres from "postgres";
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [counts] = await sql`
      SELECT
        count(*) FILTER (
          WHERE audience = ${"hermes-agent"}
            AND activation_state = ${"active"}
        )::int AS "activeDedicatedCredentials",
        count(*) FILTER (
          WHERE audience = ${"hermes-agent"}
            AND activation_state IN (${"pending"}, ${"active"})
        )::int AS "liveDedicatedCredentials",
        (
          SELECT count(*)::int
          FROM agents
          WHERE type = ${"external"}
            AND runtime_kind = ${"hermes"}
            AND handle_negotiations = true
            AND deleted_at IS NULL
        ) AS "selectedHermes"
      FROM hermes_agent_credentials
    `;
    const evidence = {
      activeDedicatedCredentials: Number(counts.activeDedicatedCredentials),
      liveDedicatedCredentials: Number(counts.liveDedicatedCredentials),
      selectedHermes: Number(counts.selectedHermes),
    };
    if (Object.values(evidence).some((value) => value !== 0)) {
      throw new Error("Hermes emergency zero-authority verification failed");
    }
    console.log(JSON.stringify(evidence));
  } finally {
    await sql.end({ timeout: 5 });
  }
'
```

Required output is exactly three decimal zero counts. Also require the runtime dashboard to show Index coverage and no new dedicated pickup success. Save only the three count names/values, fixed pass/fail, and approved timestamps; this is credential-free evidence.

## 4. Restore older binary

Only after step 3 passes:

1. Reconfirm the exact operator-supplied immutable digest and its protected 401 compatibility report. Do not use a mutable tag.
2. Restore that older API binary using the platform's separately approved immutable-image deployment procedure. Do not run reverse migrations and do not delete Hermes tables.
3. Hold client rollout and Hermes schedules paused. The older server must continue to reject dedicated credentials while Index handles negotiation work.
4. Watch health/error/latency plus `hermes.server_error`, `hermes.index_fallback`, `hermes.pending_outbox`, and `hermes.advisory_lock_wait_ms`. Confirm no live dedicated authority reappears by repeating step 3.
5. Prepare a forward fix. Re-enablement requires a new protected assurance run, new rollout approval, and fresh owner authorization; revoked credentials are never restored.

## Evidence handling

Permitted incident evidence is limited to fixed reasons, decimal counts, durations, timestamps, the approved public image reference in the protected compatibility report, and pass/fail states. Existing compatibility/preflight reports and the aggregate assurance JSON are already sanitized schemas. Do not attach raw terminal/workflow logs or any URL, ID, hash, secret, request header/body, metadata payload, owner content, memory, consultation text, or transcript prose.
