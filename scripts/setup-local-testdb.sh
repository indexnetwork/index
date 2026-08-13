#!/usr/bin/env bash
#
# Provision the local Postgres that database-backed tests run against.
#
# The suite used to point at a remote Neon branch, which made it slow enough
# that nobody ran it: individual adapter specs took 25-90 s and one stalled for
# 905 s, and the flakiness that produced was indistinguishable from real
# failures. Against local Postgres the same four questioner suites finish in
# under a second.
#
# Requirements this has to satisfy:
#   - Postgres 17, matching the Neon branches the app runs against
#   - the `vector` extension (the schema stores 2000-dimension embeddings)
#   - a database whose NAME is not production-like, because the fail-closed
#     guard in services/api/src/lib/drizzle/test-database-readiness.ts refuses
#     anything matching /^(.*_)?(prod|production)$/
#
# Idempotent: safe to re-run. Re-running does not drop data; use --recreate for
# a clean database.
#
# Usage:
#   bun run db:setup:local
#   bun run db:setup:local --recreate

set -euo pipefail

PG_FORMULA="postgresql@17"
DB_NAME="${LOCAL_TEST_DB_NAME:-index_test}"
RECREATE=0
[ "${1:-}" = "--recreate" ] && RECREATE=1

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v brew >/dev/null 2>&1; then
  echo "Error: Homebrew is required. See https://brew.sh" >&2
  exit 1
fi

PG_BIN="$(brew --prefix)/opt/${PG_FORMULA}/bin"

if [ ! -x "$PG_BIN/psql" ]; then
  echo "Installing ${PG_FORMULA}..."
  brew install "$PG_FORMULA"
else
  echo "  [postgres] ${PG_FORMULA} already installed"
fi

# Check pgvector independently: PostgreSQL may already be installed while the
# extension is absent. `CREATE EXTENSION` below cannot install the extension.
if ! brew list --formula pgvector >/dev/null 2>&1; then
  echo "Installing pgvector..."
  brew install pgvector
else
  echo "  [pgvector] already installed"
fi

export PATH="$PG_BIN:$PATH"

if ! pg_isready -q 2>/dev/null; then
  echo "  [postgres] starting service..."
  brew services start "$PG_FORMULA" >/dev/null
  until pg_isready -q 2>/dev/null; do sleep 1; done
fi
echo "  [postgres] ready"

if [ "$RECREATE" = "1" ]; then
  echo "  [database] dropping ${DB_NAME}"
  dropdb --if-exists "$DB_NAME"
fi

if psql -lqt | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
  echo "  [database] ${DB_NAME} already exists"
else
  createdb "$DB_NAME"
  echo "  [database] ${DB_NAME} created"
fi

# The migrations also declare this, but creating it up front means a failure
# here reports "pgvector missing" rather than a confusing migration error.
psql -d "$DB_NAME" -qtAc "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null
echo "  [extension] vector $(psql -d "$DB_NAME" -tAc "SELECT extversion FROM pg_extension WHERE extname='vector';")"

DB_URL="postgresql://$(whoami)@localhost:5432/${DB_NAME}"

echo "  [migrations] applying..."
(cd "$REPO_ROOT/services/api" && TEST_DATABASE_SAFE=1 NODE_ENV=test DATABASE_URL="$DB_URL" bun run db:migrate:test 2>&1 | tail -1)

cat <<EOF

Done. Point the test environment at it by setting this in the repo-root .env.test:

  DATABASE_URL=${DB_URL}

Then run database-backed tests with TEST_DATABASE_SAFE=1, for example:

  cd services/api && TEST_DATABASE_SAFE=1 bun test src/adapters/tests/questioner.lifecycle.spec.ts

EOF
