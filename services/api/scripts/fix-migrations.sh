#!/usr/bin/env bash
# Fix a ruined Drizzle migration on local: reset DB, generate one fresh migration
# with pgvector, apply it, then restore the original drizzle folder.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "Resetting Postgres..."
docker compose down -v && docker compose up -d

echo "Stashing drizzle folder, generating fresh migration..."
mv drizzle .drizzle
bun run db:generate

echo "Adding pgvector extension to new migration..."
MIGRATION=$(ls drizzle/*.sql 2>/dev/null | head -1)
if [ -n "$MIGRATION" ]; then
  echo 'CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint' | cat - "$MIGRATION" > "$MIGRATION.tmp" && mv "$MIGRATION.tmp" "$MIGRATION"
fi

echo "Applying migration..."
bun run db:migrate

echo "Restoring original drizzle folder..."
rm -rf drizzle
mv .drizzle drizzle

echo "Done."
