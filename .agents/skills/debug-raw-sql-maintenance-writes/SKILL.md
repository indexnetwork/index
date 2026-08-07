---
name: debug-raw-sql-maintenance-writes
description: Diagnose and prevent silent no-op writes in maintenance CLIs under services/api/src/cli that use raw drizzle `sql` templates instead of the query builder. Use when a backfill reports attempted > 0 but updated = 0, when attempts land as status "failed" with a generic error_code like "Error", when a write path has never successfully run despite shipping, or before adding a raw-SQL UPDATE against enum, timestamp, or vector columns. Covers the three postgres.js binding traps and how to test the rendered statement without a database.
---

# debug-raw-sql-maintenance-writes

Maintenance CLIs bypass the Drizzle query builder when they need many
unchanged-control predicates, and raw `sql` templates bind values as plain
parameters. Three binding traps make a write path fail **100% of the time** while
looking like ordinary per-row failures. All three shipped together undetected in
`backfill-intent-verification-analysis` (IND, 2026-07-30) — the audit tables were
empty in every environment not because nobody ran it, but because nothing could
ever succeed.

## The tell

```
attempted: 5   updated: 0   failed: 3   skipped: 2
```

A run loop that records `error_code: error.name` reports these as `"Error"`. That is
not a per-row data problem — a whole-path binding defect looks exactly like this.
`updated: 0` with `failed > 0` on **every** candidate means suspect the statement,
not the data.

## The three traps

### 1. Enum columns bound as text

`intents.intent_mode` and `intents.speech_act_type` are Postgres enums
(`CREATE TYPE ... AS ENUM`, declared as `pgEnum` in `database.schema.ts`). A bound
parameter arrives as `text`, and Postgres refuses the implicit coercion at plan
time — before a single row is examined:

```
column "intent_mode" is of type intent_mode but expression is of type text
```

Every bound enum value needs an explicit cast, **written and compared**:

```ts
SET intent_mode = ${analysis.intentMode}::intent_mode
...
AND intent_mode IS NOT DISTINCT FROM ${candidate.intentMode}::intent_mode
```

Reproduce the class of failure in one read-only statement (a literal is coerced
fine, an explicit `::text` is not):

```sql
UPDATE intents SET intent_mode = 'REFERENTIAL'::text
WHERE id = '00000000-0000-0000-0000-000000000000';  -- errors at plan time
```

### 2. `Date` bound as a raw parameter

postgres.js rejects it outright:

```
TypeError [ERR_INVALID_ARG_TYPE]: The "string" argument must be of type string
or an instance of Buffer or ArrayBuffer. Received an instance of Date
```

Bind an ISO string with an explicit cast instead: `${value.toISOString()}::timestamptz`.
This applies to audit stamps too (`applied_at`), where the `UPDATE` succeeds and the
follow-up `INSERT` then rolls the whole transaction back.

### 3. Timestamp *controls* compared after a Date round-trip

The dangerous one, because it **fails silently instead of erroring**. Postgres
`timestamptz` holds microseconds; a JS `Date` holds milliseconds. Any control
predicate that round-trips through `Date` (or `.toISOString()`) truncates, matches
zero rows, and the guard reports `unchanged_control` — indistinguishable from
"someone else changed the row underneath me".

Check before choosing a fix:

```sql
SELECT count(*) FILTER (WHERE (extract(microseconds FROM created_at)::bigint % 1000) <> 0)
FROM intents WHERE <candidate predicate>;
```

If that is nonzero (it was 123/123 for the live candidate set), carry timestamps as
**exact text** end to end — select `created_at::text AS created_at`, type the control
as `string`, and compare `created_at::text IS NOT DISTINCT FROM ${c.createdAt}`. Same
pattern the file already uses for `embedding::text`.

Keep any `i.`-qualified projection qualified when adding the cast
(`i.created_at::text AS created_at`) — the candidate query joins `intent_proposals`,
which exposes `created_at` and `status` too, so an unqualified projection is ambiguous.

## Test the rendered statement, not a stub

The reason all three shipped: every test injected a stubbed `applyAnalysis`, so the
real statement was never produced. `createRuntimeDeps(options, registerCloseDb, runtimeLoader)`
takes a runtime seam — pass the real drizzle `sql` tag with a recording `db`, then render:

```ts
const statements: unknown[] = [];
const record = { execute: async (q: unknown) => { statements.push(q); return []; } };
const db = { ...record, transaction: async (run) => run(record) };
const deps = await createRuntimeDeps({ dryRun: false }, undefined,
  async () => ({ sql, db: db as never, getProfileContext: async () => ({}) }));
await deps.applyAnalysis(candidate(), analysis, provenance);
const { sql: text, params } = new PgDialect().sqlToQuery(statements[0] as never);
```

Assert the **invariant** that catches all three at once, not just the symptom:

```ts
expect(params.filter((p) => p instanceof Date)).toEqual([]);
```

No database, no credentials, no socket.

## Operational rule

Never run a maintenance write against prod without first running the identical
command (same `NODE_ENV`, same flags, only `DATABASE_URL` differing) against the Neon
dev branch and confirming `updated > 0` and `failed = 0`. A dry-run report proves the
*predicate*; only a real write proves the *statement*. Here the dry run was perfectly
clean — 121 candidates, 431 controls, all `ready_for_verification` — while the write
path could not update a single row.

## See also

- `backfill-production-data` — the prod write sequence (control group, dev dry-run, backup branch, exact count verification) this feeds into.
- `verify-production-release` — release-time checks, including operational backfills that shipped but never ran.
