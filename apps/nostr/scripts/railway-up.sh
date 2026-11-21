#!/usr/bin/env bash
# Deploy the web client to the linked Railway service from a minimal build context.
#   STAGE=/tmp/index-nostr-web-deploy SERVICE=web apps/nostr/scripts/railway-up.sh
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
STAGE="${STAGE:-/tmp/index-nostr-web-deploy}"
mkdir -p "$STAGE"
find "$STAGE" -mindepth 1 -maxdepth 1 ! -name '.railway' -exec rm -rf {} +
cd "$ROOT"
git ls-files -co --exclude-standard bun.lock packages/protocol packages/nostr apps/nostr | grep -v -e node_modules -e '/dist/' | tar -cf - -T - | tar -xf - -C "$STAGE"
cp apps/nostr/Dockerfile "$STAGE/Dockerfile"
printf '[build]\nbuilder = "DOCKERFILE"\ndockerfilePath = "Dockerfile"\n\n[deploy]\nhealthcheckPath = "/health"\nrestartPolicyType = "ON_FAILURE"\n' > "$STAGE/railway.toml"
cd "$STAGE" && railway up -d --ci -s "${SERVICE:-web}"
