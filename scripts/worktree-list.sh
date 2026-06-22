#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREES_DIR="$REPO_ROOT/.worktrees"

if [ ! -d "$WORKTREES_DIR" ] || [ -z "$(ls -A "$WORKTREES_DIR" 2>/dev/null)" ]; then
  echo "No worktrees found in .worktrees/"
  exit 0
fi

echo "Worktrees:"
echo ""

for wt in "$WORKTREES_DIR"/*/; do
  [ -d "$wt" ] || continue
  name="$(basename "$wt")"

  # Check setup status by looking for any node_modules directory
  setup="not set up"
  for ws in services/api apps/web evaluator; do
    if [ -d "$wt/$ws/node_modules" ]; then
      setup="set up"
      break
    fi
  done

  echo "  $name  ($setup)"
done
