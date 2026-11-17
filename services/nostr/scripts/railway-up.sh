#!/usr/bin/env bash
# Deploy the Nostr node to the linked Railway service from a minimal build context
# (the repo is ~200 MB; the image needs four paths).
#
#   railway link -p <project> -s nostr   # once, inside $STAGE
#   STAGE=/tmp/index-nostr-deploy services/nostr/scripts/railway-up.sh
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
STAGE="${STAGE:-/tmp/index-nostr-deploy}"
mkdir -p "$STAGE"
find "$STAGE" -mindepth 1 -maxdepth 1 ! -name '.railway' -exec rm -rf {} +
cd "$ROOT"
git ls-files -co --exclude-standard bun.lock packages/protocol packages/nostr services/nostr | grep -v node_modules | tar -cf - -T - | tar -xf - -C "$STAGE"
cp services/nostr/Dockerfile "$STAGE/Dockerfile"
cat > "$STAGE/railway.toml" <<'TOML'
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/health"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
TOML
cd "$STAGE" && railway up -d --ci -s "${SERVICE:-nostr}"
