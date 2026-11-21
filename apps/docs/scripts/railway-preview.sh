#!/usr/bin/env bash
# Deploy a docs preview of the current branch to the linked Railway service.
#
#   STAGE=/tmp/index-docs-deploy SERVICE=docs SOURCE_REF=my-branch apps/docs/scripts/railway-preview.sh
#
# Vocs makes internal links absolute against DOCS_BASE_URL, so set that
# variable on the preview service to its own domain. Links to Nostr source on
# GitHub point at `dev`, where an unmerged branch's files don't exist yet;
# SOURCE_REF rewrites those links in the staged copy only.
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
STAGE="${STAGE:-/tmp/index-docs-deploy}"
REF="${SOURCE_REF:-$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)}"
mkdir -p "$STAGE"
find "$STAGE" -mindepth 1 -maxdepth 1 ! -name '.railway' -exec rm -rf {} +
cd "$ROOT"
git ls-files -co --exclude-standard apps/docs | grep -v -e node_modules -e '/dist/' | tar -cf - -T - | tar -xf - -C "$STAGE" --strip-components=2
if [ "$REF" != "dev" ]; then
  grep -rlE 'indexnetwork/index/(blob|tree)/dev/(packages/nostr|services/nostr|apps/nostr)' "$STAGE/src" | while read -r file; do
    sed -i -E "s#indexnetwork/index/(blob|tree)/dev/(packages/nostr|services/nostr|apps/nostr)#indexnetwork/index/\\1/${REF}/\\2#g" "$file"
  done
fi
cd "$STAGE" && railway up -d --ci -s "${SERVICE:-docs}"
