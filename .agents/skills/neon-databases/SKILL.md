---
name: neon-databases
description: Use before choosing, inspecting, migrating, resetting, or testing against any Neon/Postgres target in this repository — DATABASE_URL, protocol, protocol_sandbox, neondb, index_test, Railway dev, local-dev, or database-backed tests.
---

# Neon database targets

## Mental model

A target has three levels: Neon **project** → **branch** → Postgres **database**.
Database names repeat across branches and projects: `protocol` exists on every
branch in both projects, and every copy holds real user data. The branch name does
not tell you whether a target is disposable; the endpoint hostname plus the
database name identify it.

Never print or commit a connection URL. Describe a target as
`project / branch / database (hostname)`.

## Targets

The Protocol project (us-east-1) serves Railway. Local development never runs
against it; it only reads production to clone it into Protocol-dev-europe
(eu-central-1), which only local machines use. Neon cannot branch across
regions, so the clone is a dump and restore, not a Neon branch.

| Project | Branch | Database | Data | Use |
|---|---|---|---|---|
| Protocol (`shiny-cloud-34341469`) | `production` (protected) | `protocol` | Live | Read-only source for the EU clone; never write |
| Protocol | `dev` | `protocol` | Production copy (endpoint `ep-divine-hall-ahr3jr7p`) | Railway dev only |
| Protocol-dev-europe (`patient-pine-89907813`) | `production` | `protocol` | Production clone | Root `.env.development`; local development only, migrated locally |
| Local Postgres | — | `index_test` | Disposable | Root `.env.test`; database-backed tests |

Protocol's `local-dev` branch (with `protocol_sandbox`) is a leftover from
before the EU clone. Do not use it as a target.

## Preflight

Before any migration, reset, seed, flush, or test run:

1. Read the hostname and database name from `DATABASE_URL` without echoing it.
2. Map them to a row above. If none matches, stop and ask.
3. `protocol` (or any `*_prod`/`*_production` name) means real data. Any other
   name does not prove the target is disposable.
4. State the sanitized target before running anything that writes.

## Commands

- EU clone: `bun run db:eu:refresh --confirm` (needs Postgres 17 client tools
  and `NEON_API_KEY` in the shell environment, not in a repo env file). It dumps US `production / protocol`, replaces the EU
  `protocol`, and runs `db:migrate`. It refuses to run unless
  `.env.development` points at the EU clone (`scripts/eu-refresh.ts`).
- Tests: `bun run db:setup:local` provisions and migrates `index_test`; run
  database-backed tests with `TEST_DATABASE_SAFE=1`. The guard in
  `services/api/src/lib/drizzle/test-database-readiness.ts` refuses
  production-like database names.
- Intent replay: `bun run db:dev:resume --confirm [count]` (default 5) / `bun run db:dev:reset --confirm`
  run against whatever `.env.development` names, which is the EU clone
  (`scripts/dev-intents.ts`). The reset is a scoped cleanup of discovery state,
  not a refresh.
- Resetting Neon `dev` from `production` is the manual GitHub workflow
  `.github/workflows/neon-reset-dev.yml`.
- Migrations: `bun run db:migrate` from `services/api` targets whatever the root
  env file names. Run the preflight first; never migrate production locally.
