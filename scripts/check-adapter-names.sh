#!/usr/bin/env bash
set -euo pipefail

# Check that adapter files are named by concept, not technology.
# See: docs/superpowers/specs/2026-04-02-architectural-enforcement-design.md

ADAPTER_DIR="protocol/src/adapters"
VIOLATIONS=0

TECH_NAMES="drizzle|redis|bullmq|s3|resend|composio|postgres|pgvector|ioredis"

for file in "$ADAPTER_DIR"/*.ts; do
  basename=$(basename "$file")
  if echo "$basename" | grep -qiE "^($TECH_NAMES)\."; then
    echo "ERROR: Adapter file named after technology: $basename"
    echo "  Adapters must be named by concept (e.g. database.adapter.ts, cache.adapter.ts)"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

if [ "$VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "$VIOLATIONS adapter naming violation(s) found."
  exit 1
fi

echo "Adapter naming check passed."
exit 0
