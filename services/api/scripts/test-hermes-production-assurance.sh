#!/usr/bin/env bash
# Run each exact database assurance target in a fresh Bun process. Each child
# independently executes the guarded preload readiness check inherited from CI.
# Successful child logs stay quiet; failures retain diagnostics after identity,
# credential, and credential-hash redaction.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${HERMES_PREFLIGHT_MAX_LOCK_MS:?release-approved max lock threshold is required}"
: "${HERMES_PREFLIGHT_MAX_TOTAL_MS:?release-approved max total threshold is required}"
export HERMES_PREFLIGHT_MAX_LOCK_MS HERMES_PREFLIGHT_MAX_TOTAL_MS

output="$(mktemp)"
trap 'rm -f "$output"' EXIT

for target in \
  src/lib/drizzle/tests/hermes-migration-preflight.database.isolated.ts \
  src/lib/drizzle/tests/hermes-runtime-telemetry.database.isolated.ts \
  tests/hermes-runtime-lifecycle.database.isolated.ts \
  tests/negotiation-runtime-authority.database.isolated.ts \
  src/lib/drizzle/tests/hermes-emergency-control.database.isolated.ts
do
  if env API_TEST_HERMES_ASSURANCE_QUIET=1 API_TEST_ISOLATED_TARGET="$target" \
    bun test src/lib/testing/isolated-test-import-harness.spec.ts >"$output" 2>&1
  then
    printf 'PASS %s\n' "$target"
  else
    status=$?
    printf 'FAIL %s\n' "$target" >&2
    bun scripts/sanitize-hermes-assurance-output.ts <"$output" >&2 \
      || printf 'Hermes assurance output sanitizer failed.\n' >&2
    exit "$status"
  fi
  : >"$output"
done

# The CLI intentionally owns no fallback thresholds. The workflow and operator
# must supply the two values approved for this release.
if [[ -n "${HERMES_PREFLIGHT_REPORT:-}" ]]; then
  bun run maintenance:hermes-preflight -- \
    --json \
    --max-lock-ms "$HERMES_PREFLIGHT_MAX_LOCK_MS" \
    --max-total-ms "$HERMES_PREFLIGHT_MAX_TOTAL_MS" \
    >"$HERMES_PREFLIGHT_REPORT"
else
  bun run maintenance:hermes-preflight -- \
    --json \
    --max-lock-ms "$HERMES_PREFLIGHT_MAX_LOCK_MS" \
    --max-total-ms "$HERMES_PREFLIGHT_MAX_TOTAL_MS"
fi
