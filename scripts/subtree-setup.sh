#!/usr/bin/env bash
# Sets up local Claude configuration for subtree packages.
# Run after cloning or pulling — creates .claude symlinks and CLAUDE.md files
# that must not be committed to the subtree repos.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_SRC_DIR="$REPO_ROOT/scripts/claude"

setup_package() {
  local pkg="$1"
  local pkg_dir="$REPO_ROOT/packages/$pkg"

  if [ ! -d "$pkg_dir" ]; then
    echo "  [$pkg] not found, skipping"
    return
  fi

  # Symlink .claude → monorepo root .claude so tool permissions & config stay in sync.
  local claude_link="$pkg_dir/.claude"
  if [ -L "$claude_link" ]; then
    echo "  [$pkg] .claude already linked"
  elif [ -d "$claude_link" ]; then
    echo "  [$pkg] .claude is a real directory (skipping)"
  else
    ln -s "$REPO_ROOT/.claude" "$claude_link"
    echo "  [$pkg] .claude -> linked"
  fi

  # Write CLAUDE.md from the tracked source in scripts/claude/.
  local claude_md_src="$CLAUDE_SRC_DIR/$pkg.CLAUDE.md"
  if [ -f "$claude_md_src" ]; then
    cp "$claude_md_src" "$pkg_dir/CLAUDE.md"
    echo "  [$pkg] CLAUDE.md -> written"
  fi
}

echo "Setting up subtree Claude configs..."
echo ""
setup_package "protocol"
echo ""
echo "Done."
