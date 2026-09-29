#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREES_DIR="$REPO_ROOT/.worktrees"

# (i) Current branch (root)
BRANCH="$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo "?")"

# Build selection list: root first, then each worktree
CHOICES=("Branch (root): $BRANCH")
WORKTREE_NAMES=()

if [ -d "$WORKTREES_DIR" ] && [ -n "$(ls -A "$WORKTREES_DIR" 2>/dev/null)" ]; then
  for wt in "$WORKTREES_DIR"/*/; do
    [ -d "$wt" ] || continue
    name="$(basename "$wt")"
    WORKTREE_NAMES+=("$name")
    setup="not set up"
    for ws in services/api apps/web; do
      if [ -d "$wt/$ws/node_modules" ]; then
        setup="set up"
        break
      fi
    done
    CHOICES+=("$name  ($setup)")
  done
fi

echo "Where do you want to run dev?"
echo ""

PS3="Select (1-${#CHOICES[@]}): "
select opt in "${CHOICES[@]}"; do
  if [ -z "${opt:-}" ]; then
    echo "Invalid choice. Try again."
    continue
  fi
  if [ "$opt" = "Branch (root): $BRANCH" ]; then
    echo ""
    echo "Building (api + web)..."
    cd "$REPO_ROOT"
    bun run build
    echo ""
    echo "Starting dev servers at root..."
    bun run dev:api &
    bun run dev:web &
    wait
    exit 0
  fi
  # opt is "name  (set up)" or "name  (not set up)" — worktree name is first word
  wt_name="${opt%%  *}"
  if [ -d "$WORKTREES_DIR/$wt_name" ]; then
    echo ""
    bash "$REPO_ROOT/scripts/worktree-dev.sh" "$wt_name"
    exit 0
  fi
  echo "Invalid choice. Try again."
done
