#!/usr/bin/env bash
# PreToolUse hook: block git commit if tsc or eslint fails on staged .ts/.tsx files

echo "$CLAUDE_TOOL_INPUT" | grep -q '"command".*git commit' || exit 0

root=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$root" ] && exit 0
cd "$root"

staged=$(git diff --cached --name-only --diff-filter=d | grep -E '\.tsx?$' || true)
[ -z "$staged" ] && exit 0

errors=""

# Type-check workspaces with staged files
api_files=$(echo "$staged" | grep '^services/api/' || true)
if [ -n "$api_files" ]; then
  tsc_out=$(cd services/api && bunx tsc --noEmit 2>&1) || errors="${errors}
--- api tsc ---
${tsc_out}"
fi

web_files=$(echo "$staged" | grep '^apps/web/' || true)
if [ -n "$web_files" ]; then
  tsc_out=$(cd apps/web && bunx tsc --noEmit 2>&1) || errors="${errors}
--- web tsc ---
${tsc_out}"
fi

# Lint all staged files via root config
lint_out=$(npx eslint --no-warn-ignored $staged 2>&1) || errors="${errors}
--- eslint ---
${lint_out}"

if [ -n "$errors" ]; then
  echo "COMMIT BLOCKED — fix these issues first:${errors}" >&2
  exit 2
fi
