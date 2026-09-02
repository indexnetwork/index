#!/usr/bin/env bash
# Wipes the local dev state for examples/06-server.ts: every agent's sqlite
# store (negotiations, tasks, messages, intents, scope) and the shared match
# directory. Both are gitignored — this just gives you a clean slate without
# hunting the paths down by hand.
set -euo pipefail
cd "$(dirname "$0")"
rm -fv .sqlite-server.db .sqlite-server.db-wal .sqlite-server.db-shm .agents.json
