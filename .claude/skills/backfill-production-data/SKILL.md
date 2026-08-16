---
name: backfill-production-data
description: "Safely run an ad-hoc backfill or UPDATE against the production database via the Neon MCP tools. Use for reclassifying rows, fixing bad statuses, or any one-off prod data mutation outside Drizzle migrations. Covers the mandatory sequence — control group, dev-branch dry run, backup branch, transaction, exact count verification — and the Neon MCP branch/database gotchas."

---

# backfill-production-data

Ad-hoc prod data mutations (not schema migrations — those go through Drizzle) run
through the **Neon MCP** tools. This is the narrow exception to the repository's
ordinary “production: never touch” rule: enter it only for an explicitly requested
backfill, require user confirmation immediately before the write, and follow every
safety step below. The sequence was proven in the 2026-07-06 stalled-opportunities
backfill (299 rows reclassified, zero surprises).

## Topology (also in the Development Reference → Neon Database Topology)

| Thing | Value |
|---|---|
| Prod project | `Protocol` → `shiny-cloud-34341469` |
| Prod branch | `production` → `br-fragrant-brook-ahexgsek` (protected) |
| Dev branch (Railway dev env) | `dev` → `br-late-tooth-ahlsfgdb` — periodically reset from prod, realistic data |
| **Database name** | `protocol_prod` on **both** branches |
| Local-dev project | `Protocol-dev-europe` → `patient-pine-89907813` (not for this) |

**Gotcha:** omitting `branchId`/`databaseName` resolves to the default `neondb`, which is
**empty** — you get `relation "opportunities" does not exist`. Always pass all three:
`projectId`, `branchId`, `databaseName: "protocol_prod"`.

**Endpoint drift between local and Railway dev is expected:** the Railway dev `protocol`
service's `DATABASE_URL` resolves to the pooled endpoint of `br-late-tooth-ahlsfgdb`
(e.g. `ep-divine-hall-…-pooler.c-3.us-east-1.aws.neon.tech`). The root `.env.development`
`DATABASE_URL` intentionally points at a *different* endpoint (`ep-weathered-poetry-…`) —
the owner's **personal dev branch**, not staleness; do not flag or "fix" it. When
verifying Railway dev deploys or migrations (e.g. checking a Drizzle migration landed),
treat the Railway dev service's `DATABASE_URL` as authoritative — read it via
`railway run --environment dev --service protocol` env injection, never print it —
not the local `.env`.

## The sequence (do not skip steps)

1. **Size the problem + validate the discriminator with a control group** (read-only,
   prod branch). A predicate that matches ~100% of the target population means nothing
   until you show it matches ~0% of a healthy control population. Example: stalled rows
   matched "actor premise lapse within ±10 min of `updated_at`" 299/299 while `pending`
   rows matched 20/1398 (1.4% base rate) — that gap is the proof.
2. **Dry-run on the dev branch** (`br-late-tooth-ahlsfgdb`): run the *sizing SELECT*,
   then the *actual UPDATE*, then verify counts moved exactly (before + delta = after).
3. **Snapshot a backup branch** from production right before the write:
   `neon_create_branch` with a dated name like `backup-pre-<what>-YYYY-MM-DD`.
   (Prod also has 7-day PITR, but a named branch is an instant, explicit restore point.)
4. **Execute on prod** with `neon_run_sql_transaction`, bundling the UPDATE **and** the
   verification SELECTs in one call. Keep the WHERE predicate in the UPDATE even if it
   currently matches everything — it's the guard against racing writes.
5. **Verify exact arithmetic**: target count → 0 (or expected), destination count ==
   before + moved. Any off-by-N means stop and investigate via the backup branch.
6. Preserve `updated_at` unless the product needs it bumped — it's your audit trail for
   provenance (and often the discriminator itself).

## Tool call shape

```
neon_run_sql_transaction {
  projectId: "shiny-cloud-34341469",
  branchId: "br-fragrant-brook-ahexgsek",   // or br-late-tooth-ahlsfgdb for the dev dry-run
  databaseName: "protocol_prod",
  sqlStatements: ["UPDATE ...", "SELECT status, count(*) ... GROUP BY status"]
}
```

Useful JSONB patterns for this schema: `jsonb_array_elements(o.actors) a` +
`a->>'userId'`; timing correlation via
`abs(extract(epoch FROM (o.updated_at - COALESCE(p.retracted_at, p.updated_at)))) < 600`.

## Guardrails

- Prod writes need **explicit user confirmation** in the session; read-only sizing does not.
- Clean up the backup branch after a few days of confidence (`neon_delete_branch`).
- If the mutation is repeatable/ongoing, promote it to a maintained CLI under
  `services/api/src/cli/` instead of re-running raw SQL. Follow the current root env-file
  conventions in `docs/guides/getting-started.md`; do not copy legacy `.env.production`
  loading from older maintenance scripts.

## See also

- `verify-production-release` — for schema-migration-level prod risk (frozen lockfile, destructive Drizzle migrations); this skill is for *data* fixes.
