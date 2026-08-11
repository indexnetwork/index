#!/usr/bin/env bash
# Run each exact database assurance target in a fresh Bun process. Each child
# independently executes the guarded preload readiness check inherited from CI.
set -euo pipefail
cd "$(dirname "$0")/.."

for target in \
  tests/hermes-runtime-lifecycle.database.isolated.ts \
  tests/negotiation-runtime-authority.database.isolated.ts
do
  env API_TEST_ISOLATED_TARGET="$target" \
    bun test src/lib/testing/isolated-test-import-harness.spec.ts
done
