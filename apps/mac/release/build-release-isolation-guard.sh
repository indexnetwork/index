#!/usr/bin/env bash
set -euo pipefail
set +x
readonly directory="$(cd "$(dirname "$0")" && pwd -P)"
readonly state="$(cd "$directory/../dist/.production-release-state" && pwd -P)"
[[ -z "$(jobs -pr)" ]]
python3 "$directory/process-isolation.py" --root-pid "$PPID" --uid "$(id -u)" \
  --allowlist "$state/process.allow" --allowlist-sha256 "$INDEX_RELEASE_PROCESS_ALLOWLIST_SHA256"
