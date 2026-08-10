# IND-638 historical-quality operator runbook

This is an operator-only, CLI-only procedure for the guarded historical shared-pool quality runtime. It provisions and mutates Neon resources and can spend provider tokens. **Do not execute any operational step from CI, an agent session, or an unapproved checkout.** Obtain a separate recorded authorization for each confirmation below.

Historical quality is intentionally absent from the Eval Ops launch registry. Eval Ops may continue launching legacy discovery A/B; when its server holds manifest v2, the legacy parser projects only the two writable child targets and never exposes the base read replica.

## Non-negotiable stop rules

- Work from the reviewed merged revision and record `git rev-parse HEAD` before every operation.
- Each confirmation and its one authorized operation must stay in the single isolated fail-closed shell block shown below. Never combine separate operation blocks into a script, `&&` chain, loop, retry wrapper, or job.
- A failed, timed-out, missing, malformed, or incomplete operation is a **stop**. Do not automatically rerun it. Record the exit, surviving report, and target identifiers; obtain a new authorization before any retry.
- Never paste a database URL, provider key, manifest, or secure record into a ticket, log, report, or command output.
- `eval-discovery-base` is non-primary. Its writable refresh endpoint and read-only verification endpoint are different roles. Refresh may use only `DISCOVERY_QUALITY_BASE_REFRESH_TARGET`; verify may use only `DISCOVERY_TARGETS.baseReadReplica`.
- Side `a` is the disposable selected child. Side `b` remains untouched by quality.
- **Run exactly one historical-quality invocation globally.** Do not overlap a smoke, pilot, retry, or any other historical-quality CLI process, regardless of checkout, terminal, user, launcher, or report path.
- The runtime acquires a host-local atomic lease before child preflight, control-plane attestation, restore, provider spend, or artifact preparation. A contention refusal is a stop: it has performed none of those operations.
- The lease does not coordinate filesystems on another machine. **Never run historical quality from a remote/parallel host**, even when that host shows no local lease.

## Historical-quality operation lease

The stable host-local lease directory is `~/.indexnetwork/historical-quality-leases/`. The filename is an opaque SHA-256 identifier derived only from the strict manifest-v2 `projectId` and side-`a` `branchId`: `<identifier>.lease`. The file is created atomically with mode `0600`, contains identifier/ownership metadata only, and never contains a manifest, URL, credential, writable target, or provider configuration. A normal process removes only the lease carrying its own random ownership token, in `finally`, after report/diagnostic handling and child-file cleanup.

A killed or crashed process deliberately leaves its lease in place. There is no timeout, PID-based expiry, stale detection, takeover, or automatic deletion. Every later invocation must continue to refuse before control-plane, restore, or spend until an operator reconciles it.

For identifier-only inspection, with the strict v2 manifest loaded without printing it:

```bash
cd services/api
LEASE_PATH="$(bun -e 'import { historicalQualityOperationLeasePath } from "./src/cli/discovery-quality-operation-lease.ts"; process.stdout.write(historicalQualityOperationLeasePath(process.env.DISCOVERY_TARGETS))')"
LEASE_IDENTIFIER="$(basename "$LEASE_PATH" .lease)"
printf 'historical-quality lease identifier: %s\n' "$LEASE_IDENTIFIER"
stat "$LEASE_PATH"
```

Do not `cat` the lease or print any environment value. The path and identifier do not establish that an operation is safe to resume. If a lease remains, stop and manually reconcile the originating host/process, surviving child process, Neon side-`a` operation state, and any report/diagnostic. Explicit manual removal is permitted only with separate recorded authorization **after proving that no historical-quality parent, child, restore, or other side-`a` operation is still running on any host**. Then remove exactly the inspected path with `rm -- "$LEASE_PATH"`; never use a wildcard, cleanup job, age rule, or retry wrapper. Removal does not authorize a rerun.

## Secret inputs

Load these from an approved secret manager without echoing them or saving them in shell history:

- `NEON_API_KEY`
- v2 `DISCOVERY_TARGETS`
- `DISCOVERY_QUALITY_BASE_REFRESH_TARGET`
- `OPENROUTER_API_KEY`
- exactly one Redis configuration
- `HISTORICAL_QUALITY_PROVIDER_ACCOUNT_FINGERPRINT` (a lowercase SHA-256 identifier digest)

The two target declarations have these placeholder-only shapes:

```json
{
  "version": 2,
  "projectId": "<project-id>",
  "baseBranchId": "<base-branch-id>",
  "baseReadReplica": {
    "endpointId": "<read-only-endpoint-id>",
    "databaseUrl": "<secret-postgresql-protocol_eval-url>"
  },
  "targets": [
    {
      "sideId": "a",
      "branchId": "<side-a-branch-id>",
      "endpointId": "<side-a-read-write-endpoint-id>",
      "databaseUrl": "<secret-postgresql-protocol_eval-url>"
    },
    {
      "sideId": "b",
      "branchId": "<side-b-branch-id>",
      "endpointId": "<side-b-read-write-endpoint-id>",
      "databaseUrl": "<secret-postgresql-protocol_eval-url>"
    }
  ]
}
```

```json
{
  "version": 2,
  "projectId": "<same-project-id>",
  "branchId": "<same-base-branch-id>",
  "endpointId": "<base-read-write-endpoint-id>",
  "databaseName": "protocol_eval",
  "databaseUrl": "<secret-postgresql-protocol_eval-url>"
}
```

Every URL must bind exactly to its declared endpoint and `/protocol_eval`. Do not add query strings, fragments, alternate ports, or crossed role IDs.

Build the protocol package before any API command:

```bash
cd services/api
bun run --cwd ../../packages/protocol build
```

## 1. Attest the writable refresh target

This is control-plane-only and performs no database or provider operation:

```bash
cd services/api
bun run eval:discovery-quality-base-refresh-target:attest
```

Expected output confirms only that the writable refresh target was attested. A failure is a stop.

## 2. Provision and attest exactly one base read replica

Choose a new secure-record path on encrypted operator storage. It must not exist; the command creates it mode `0600`. Keep it outside the repository.

Obtain authorization, then type the exact confirmation for this operation only:

Run exactly one provisioning invocation in the same fail-closed block as its confirmation:

```bash
(
  set -euo pipefail
  trap 'unset DISCOVERY_QUALITY_READ_REPLICA_CONFIRM' EXIT
  read -r -p 'Type "provision IND-638 base read replica": ' DISCOVERY_QUALITY_READ_REPLICA_CONFIRM
  test "$DISCOVERY_QUALITY_READ_REPLICA_CONFIRM" = 'provision IND-638 base read replica'
  export DISCOVERY_QUALITY_READ_REPLICA_CONFIRM
  cd services/api
  bun run eval:discovery-quality-read-replica:provision -- \
    --base-branch-name eval-discovery-base \
    --endpoint-type read_only \
    --database-name protocol_eval \
    --secure-record "$IND_638_READ_REPLICA_RECORD"
)
```

Expected output contains only project, base branch, endpoint ID, `read_only`, and `protocol_eval`. If creation is uncertain or a `recovery_required`/`create_uncertain` record remains, stop and reconcile the Neon control plane manually. Never remove the record and rerun provisioning.

Create the v2 manifest locally from the attested record and securely obtained URLs. Validate it without printing it:

```bash
cd services/api
bun -e 'import { parseHistoricalQualityManifest } from "./src/cli/discovery.neon.ts"; parseHistoricalQualityManifest(process.env.DISCOVERY_TARGETS); console.log("DISCOVERY_TARGETS v2 parsed")'
bun run eval:discovery-quality-read-replica:attest -- \
  --secure-record "$IND_638_READ_REPLICA_RECORD"
```

## 3. Atomically migrate the Eval Ops secret, with rollback retained

This migration changes one secret value, not the launch registry.

1. Export the current Eval Ops `DISCOVERY_TARGETS` value into an encrypted, access-controlled rollback record. Label it with service, environment, revision, and timestamp. Do not print it.
2. Keep the old value unchanged in that record. Prepare and locally validate the complete v2 replacement as above.
3. Obtain a separate secret-migration authorization.
4. Replace the Eval Ops `DISCOVERY_TARGETS` value in **one secret-manager update operation**. Do not delete then recreate it, update fields piecemeal, or change any other variable in the same operation.
5. Re-read the secret through the platform's non-printing metadata/digest facility and compare its locally computed digest with the prepared v2 value.
6. Re-run the provider-free parser in an environment populated from the updated secret. Obtain a separate validation authorization; the exact phrase and parser operation must remain in this one fail-closed block. It confirms that `parseLegacyAbManifest` returns exactly project/base plus side `a` and `b` and no `baseReadReplica`:

   ```bash
   (
     set -euo pipefail
     trap 'unset IND_638_CONFIRM' EXIT
     read -r -p 'Type "validate IND-638 secret migration": ' IND_638_CONFIRM
     test "$IND_638_CONFIRM" = 'validate IND-638 secret migration'
     export IND_638_CONFIRM
     cd services/api
     bun -e 'import { parseHistoricalQualityManifest, parseLegacyAbManifest } from "./src/cli/discovery.neon.ts"; const raw=process.env.DISCOVERY_TARGETS; const v2=parseHistoricalQualityManifest(raw); const legacy=parseLegacyAbManifest(raw); if (JSON.stringify(legacy)!==JSON.stringify({projectId:v2.projectId,baseBranchId:v2.baseBranchId,targets:v2.targets})) throw new Error("legacy projection mismatch"); console.log("v2 legacy child projection verified")'
   )
   ```

7. Do not delete the old value from the secure rollback record until all parsing, attestation, and the separately authorized legacy smoke pass.

Rollback is also exactly one secret-manager update: replace `DISCOVERY_TARGETS` with the retained previous value, verify its digest, then stop. Rollback does **not** authorize an automatic smoke retry or read-replica deletion.

## 4. Refresh the protected base (writable target only)

This operation writes fixture rows and calls the embedding provider. Obtain separate authorization and type:

Run exactly once in the same fail-closed block as the confirmation:

```bash
(
  set -euo pipefail
  trap 'unset IND_638_CONFIRM' EXIT
  read -r -p 'Type "refresh IND-638 historical quality base": ' IND_638_CONFIRM
  test "$IND_638_CONFIRM" = 'refresh IND-638 historical quality base'
  export IND_638_CONFIRM
  cd services/api
  bun run eval:discovery-quality-base
)
```

The command first checks current integrity. A classified stale state enters refresh; an unclassified verifier failure never falls through to writes. Refresh publishes documents, round-tripped vectors, and quality metadata in one final transaction. Failure is a stop, not permission to rerun.

## 5. Verify through the read replica (never the writable endpoint)

Obtain separate authorization and type:

Run verification in the same fail-closed block as its separate confirmation:

```bash
(
  set -euo pipefail
  trap 'unset IND_638_CONFIRM' EXIT
  read -r -p 'Type "verify IND-638 historical quality read replica": ' IND_638_CONFIRM
  test "$IND_638_CONFIRM" = 'verify IND-638 historical quality read replica'
  export IND_638_CONFIRM
  cd services/api
  bun run eval:discovery-quality-base:verify
)
```

The bootstrap jointly attests manifest v2 and the separate writable refresh declaration, but hands the verifier only `DISCOVERY_TARGETS.baseReadReplica.databaseUrl`. The fresh verifier strips Neon, provider, embedding, model, and Redis secrets; forces `transaction_read_only=on`; constructs no refresh/provider dependency; and prints only read-only status plus sanitized version/embedding/corpus identifiers.

## 6. Hard pre-merge guarded DB gate

PR B is not merge-ready until both commands below actually pass at the reviewed revision. `not run`, skipped, partial, or prose-only evidence blocks merge and rollout.

First bind `DATABASE_URL` to the exact selected side `a` URL from manifest v2. Do not copy any other URL.

```bash
cd services/api
test "${TEST_DATABASE_SAFE:-}" = '1'
test -n "${DATABASE_URL:-}"
test -n "${NEON_API_KEY:-}"
test -n "${DISCOVERY_TARGETS:-}"
bun run eval:discovery-quality-db-target:prove -- --side a
```

The proof must identify only project, non-primary side-a branch, `read_write` endpoint ID/type, parent base branch, and `databaseName=protocol_eval`. If it fails, do not run the suite.

Only after that proof succeeds:

```bash
cd services/api
TEST_DATABASE_SAFE=1 bun test src/cli/tests/discovery-quality-base.integration.spec.ts
```

Record command, git revision, identifier-only proof output, exit code, and test counts in the PR validation receipt. The integration suite repeats the internal proof before opening a DB connection and mocks all provider seams.

## 7. Separately confirmed legacy A/B smoke

This is a paid two-side legacy smoke and is distinct from quality. Obtain a separate authorization and type:

Run once in the same fail-closed block as its confirmation:

```bash
(
  set -euo pipefail
  trap 'unset IND_638_CONFIRM DISCOVERY_CONFIRM TEST_DATABASE_SAFE' EXIT
  read -r -p 'Type "run IND-638 legacy A/B smoke": ' IND_638_CONFIRM
  test "$IND_638_CONFIRM" = 'run IND-638 legacy A/B smoke'
  export IND_638_CONFIRM
  export DISCOVERY_CONFIRM=1 TEST_DATABASE_SAFE=1
  cd services/api
  bun run eval:discovery -- \
    --case historical/builder-and-operator --runs 1 \
    --a DISCOVERY_ALLOWED_TYPES=intent \
    --b DISCOVERY_ALLOWED_TYPES=intent,profile
)
```

Confirm the legacy run used only the projected writable children. Do not infer quality readiness from this smoke.

## 8. Separately confirmed quality smokes

Both smokes use only `historical/builder-and-operator`, one repetition, and one trigger. Each restores side `a`, invokes one graph slot, and makes one evaluator call.

For the intent smoke, obtain authorization and type:

Run once in the same fail-closed block as its confirmation:

```bash
(
  set -euo pipefail
  trap 'unset IND_638_CONFIRM DISCOVERY_CONFIRM TEST_DATABASE_SAFE' EXIT
  read -r -p 'Type "run IND-638 intent quality smoke": ' IND_638_CONFIRM
  test "$IND_638_CONFIRM" = 'run IND-638 intent quality smoke'
  export IND_638_CONFIRM
  export DISCOVERY_CONFIRM=1 TEST_DATABASE_SAFE=1
  cd services/api
  bun run eval:discovery -- \
    --historical-quality --env DISCOVERY_ALLOWED_TYPES=intent,profile \
    --case historical/builder-and-operator --trigger intent --runs 1
)
```

Stop and review the artifact. Then obtain a new authorization for enrichment and type:

Run once in its own fail-closed block:

```bash
(
  set -euo pipefail
  trap 'unset IND_638_CONFIRM DISCOVERY_CONFIRM TEST_DATABASE_SAFE' EXIT
  read -r -p 'Type "run IND-638 enrichment quality smoke": ' IND_638_CONFIRM
  test "$IND_638_CONFIRM" = 'run IND-638 enrichment quality smoke'
  export IND_638_CONFIRM
  export DISCOVERY_CONFIRM=1 TEST_DATABASE_SAFE=1
  cd services/api
  bun run eval:discovery -- \
    --historical-quality --env DISCOVERY_ALLOWED_TYPES=intent,profile \
    --case historical/builder-and-operator --trigger enrichment --runs 1
)
```

Any exit other than a complete expected result is a stop. Never automatically run the other smoke after a failure.

## 9. Separately confirmed ten-slot pilot

Only after both smoke artifacts are independently reviewed, obtain pilot authorization and type:

Run exactly five approved cases × two triggers × one repetition in the same fail-closed block:

```bash
(
  set -euo pipefail
  trap 'unset IND_638_CONFIRM DISCOVERY_CONFIRM TEST_DATABASE_SAFE' EXIT
  read -r -p 'Type "run IND-638 ten-slot quality pilot": ' IND_638_CONFIRM
  test "$IND_638_CONFIRM" = 'run IND-638 ten-slot quality pilot'
  export IND_638_CONFIRM
  export DISCOVERY_CONFIRM=1 TEST_DATABASE_SAFE=1
  cd services/api
  bun run eval:discovery -- \
    --historical-quality --env DISCOVERY_ALLOWED_TYPES=intent,profile --runs 1
)
```

A complete artifact supports the documented quality verdict. Exit `3` means paid but insufficient evidence and no quality verdict. Exit `4` means an operational failure after mutation/spend may have begun. Neither authorizes a rerun.

## Closeout

Record identifier-only outputs, revisions, confirmations, exits, test counts, report paths, and artifact review. Keep secrets and URLs out of the receipt. Retain the previous Eval Ops secret until migration validation and the legacy smoke are accepted. Read-replica deletion, further pilots, rollout, merge, or registry/UI launch support all require separate scope and authorization.
