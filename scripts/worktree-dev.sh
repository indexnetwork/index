#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREES_DIR="$REPO_ROOT/.worktrees"

if [ -z "${1:-}" ]; then
  echo "Usage: bun run worktree:dev <worktree-name>"
  echo ""
  echo "Available worktrees:"
  bash "$REPO_ROOT/scripts/worktree-list.sh"
  exit 1
fi

WORKTREE="$WORKTREES_DIR/$1"

if [ ! -d "$WORKTREE" ]; then
  echo "Error: worktree '$1' not found at $WORKTREE"
  echo ""
  echo "Available worktrees:"
  bash "$REPO_ROOT/scripts/worktree-list.sh"
  exit 1
fi

# Auto-setup if not already done
has_node_modules=false
for ws in services/api apps/web; do
  [ -d "$WORKTREE/$ws/node_modules" ] && has_node_modules=true && break
done
if [ "$has_node_modules" = false ]; then
  echo "Worktree not set up yet — running worktree:setup first..."
  echo ""
  bash "$REPO_ROOT/scripts/worktree-setup.sh" "$1"
  echo ""
fi

echo "Starting dev servers in worktree: $1"
echo "Working directory: $WORKTREE"
echo ""

cd "$WORKTREE"
bun run dev
