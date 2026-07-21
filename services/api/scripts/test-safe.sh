#!/usr/bin/env bash
# Run the complete baseline. Bare Bun discovery includes isolated-suite.spec.ts,
# which validates and executes every process-contaminating test in a fresh child.
set -euo pipefail
cd "$(dirname "$0")/.."

exec env NODE_ENV=test API_TEST_REQUIRE_DATABASE=1 bun test
