#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREES_DIR="$REPO_ROOT/.worktrees"
INSTALL_WORKSPACES=("services/api" "apps/web")

# Runtime env files live at the REPO ROOT (see .env.example) and are symlinked
# into the worktree root — every loader (API, Vite, drizzle, CLIs, tests)
# resolves them there. During the per-package -> root transition, developers
# may still have .env files in the legacy package directories, so those are
# used as fallback sources (still linked into the worktree ROOT, because code
# no longer reads package-local env files).
LEGACY_ENV_DIRS=("services/api" "backend" "apps/web" "frontend" "packages/protocol" "packages/cli")

if [ -z "${1:-}" ]; then
  echo "Usage: bun run worktree:setup <worktree-name>"
  echo ""
  echo "Available worktrees:"
  ls -1 "$WORKTREES_DIR" 2>/dev/null || echo "  (none)"
  exit 1
fi

WORKTREE="$WORKTREES_DIR/$1"

if [ ! -d "$WORKTREE" ]; then
  echo "Error: worktree '$1' not found at $WORKTREE"
  echo ""
  echo "Available worktrees:"
  ls -1 "$WORKTREES_DIR" 2>/dev/null || echo "  (none)"
  exit 1
fi

echo "Setting up worktree: $1"
echo ""

for ws in "${INSTALL_WORKSPACES[@]}"; do
  ws_dst="$WORKTREE/$ws"

  if [ ! -d "$ws_dst" ]; then
    echo "  [$ws] skipped (not present in worktree)"
    continue
  fi

  if [ -d "$ws_dst/node_modules" ]; then
    echo "  [$ws] node_modules already installed"
  else
    echo "  [$ws] node_modules -> installing..."
    (cd "$ws_dst" && bun install --frozen-lockfile 2>&1 | tail -1)
  fi
done

# Symlink root .env* files (excluding .env.example) into the worktree root.
link_env_to_worktree_root() {
  env_src="$1"
  env_label="$2"
  env_name="$(basename "$env_src")"
  env_dst="$WORKTREE/$env_name"

  if [ -e "$env_dst" ] || [ -L "$env_dst" ]; then
    if [ -L "$env_dst" ]; then
      echo "  [$env_label] $env_name already linked"
    else
      echo "  [$env_label] $env_name exists (not a symlink, skipping)"
    fi
  else
    ln -s "$env_src" "$env_dst"
    echo "  [$env_label] $env_name -> linked"
  fi
}

for env_file in "$REPO_ROOT"/.env*; do
  [ -e "$env_file" ] || continue
  [ "$(basename "$env_file")" = ".env.example" ] && continue
  link_env_to_worktree_root "$env_file" "root"
done

# Legacy fallback: link package-local env files into the worktree ROOT when no
# root file of the same name exists. Remind the developer to migrate.
for legacy_dir in "${LEGACY_ENV_DIRS[@]}"; do
  for env_file in "$REPO_ROOT/$legacy_dir"/.env*; do
    [ -e "$env_file" ] || continue
    env_name="$(basename "$env_file")"
    [ "$env_name" = ".env.example" ] && continue
    [ -e "$REPO_ROOT/$env_name" ] && continue                        # root version wins
    [ -e "$WORKTREE/$env_name" ] || [ -L "$WORKTREE/$env_name" ] && continue
    ln -s "$env_file" "$WORKTREE/$env_name"
    echo "  [legacy:$legacy_dir] $env_name -> linked into worktree root (please migrate this file to the repo root: mv $legacy_dir/$env_name $env_name)"
  done
done

# Configure git hooks path (points to committed scripts/hooks/)
git -C "$WORKTREE" config core.hooksPath scripts/hooks
echo "  [git] hooksPath -> scripts/hooks"

echo ""
echo "Done. Worktree '$1' is ready."
