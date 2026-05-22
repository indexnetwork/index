#!/usr/bin/env bash
# Run bun test excluding files that use mock.module() (listed in .test-isolated).
# Those files permanently contaminate Bun's module cache and must run in their
# own process. Use `bun run test:isolated` to run them individually.
set -euo pipefail
cd "$(dirname "$0")/.."

files=$(find src tests -name '*.spec.ts' -o -name '*.test.ts' | grep -vFf .test-isolated | sort)
exec bun test $files
