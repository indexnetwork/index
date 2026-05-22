#!/usr/bin/env bash
# Run each file listed in .test-isolated in its own bun test process.
# These files use mock.module() which permanently contaminates Bun's module
# cache — they MUST run in isolation.
set -euo pipefail
cd "$(dirname "$0")/.."

failed=0
total=0

while IFS= read -r file; do
  [[ -z "$file" || "$file" == \#* ]] && continue
  [[ ! -f "$file" ]] && { echo "SKIP (not found): $file"; continue; }
  [[ "$file" == *.e2e.* ]] && { echo "SKIP (E2E — needs dev server): $file"; continue; }
  total=$((total + 1))
  if ! bun test "$file" 2>&1; then
    failed=$((failed + 1))
  fi
done < .test-isolated

echo ""
echo "=== Isolated tests: $total files, $failed failed ==="
[[ $failed -eq 0 ]]
