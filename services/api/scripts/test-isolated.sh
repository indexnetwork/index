#!/usr/bin/env bash
# Validate .test-isolated against the filesystem, then run every manifest entry
# in a fresh Bun process through the discoverable isolated-suite orchestrator.
set -euo pipefail
cd "$(dirname "$0")/.."

exec env NODE_ENV=test API_TEST_ISOLATED_ONLY=1 bun test ./tests/isolated-suite.spec.ts
