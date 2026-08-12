#!/usr/bin/env bash
set -euo pipefail
set +x
readonly directory="$(cd "$(dirname "$0")" && pwd -P)"
: "${INDEX_RELEASE_WORK_ROOT:?INDEX_RELEASE_WORK_ROOT is required}"
readonly state="$INDEX_RELEASE_WORK_ROOT/authority/state"
readonly allowlist="$state/process.allow"
[[ -d "$state" && ! -L "$state" && -f "$allowlist" && ! -L "$allowlist" ]] || {
  printf 'production release isolation refused: external sealed state is missing\n' >&2
  exit 1
}
[[ -z "$(jobs -pr)" ]]
python3 "$directory/process-isolation.py" --root-pid "$PPID" --uid "$(id -u)" \
  --allowlist "$allowlist" --allowlist-sha256 "$INDEX_RELEASE_PROCESS_ALLOWLIST_SHA256" \
  --listener-path "$INDEX_RELEASE_RUNNER_LISTENER_PATH" \
  --listener-sha256 "$INDEX_RELEASE_RUNNER_LISTENER_SHA256" \
  --worker-path "$INDEX_RELEASE_RUNNER_WORKER_PATH" \
  --worker-sha256 "$INDEX_RELEASE_RUNNER_WORKER_SHA256"
