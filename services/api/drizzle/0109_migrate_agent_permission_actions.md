# 0109 — Agent-permission action backfill runbook (IND-606 / IND-607)

Operational, auditable procedure for applying
`0109_migrate_agent_permission_actions.sql` to a live database. The SQL itself
is deterministic and idempotent; this runbook adds the predicate / control-group
/ dry-run / snapshot / execute / postcondition discipline required by IND-607.

> **Safety.** Production execution requires a **separate explicit user
> authorization** and MUST follow the `backfill-production-data` skill workflow
> (Neon project `Protocol`, database `protocol_prod`, `branchId` +
> `databaseName=protocol_prod`). Nothing here may be run against Neon, dev,
> shared, staging, or production without that authorization. The wave that
> produced this migration ran **no** database mutation.

## Transformation (per row)

| Legacy action     | Result                                   |
| ----------------- | ---------------------------------------- |
| `manage:profile`  | `manage:identity` **and** `manage:premises` |
| `manage:contacts` | removed                                  |
| any other action  | preserved verbatim                       |

Row identity and authority (`id`, `agent_id`, `user_id`, `scope`, `scope_id`)
are never modified. Known canonical actions are emitted first, in canonical
order; any unknown/residual action strings are intentionally preserved and
sorted after the canonical block (they are neither dropped nor promoted to
canonical grants). Output is de-duplicated. A row whose only action was
`manage:contacts` becomes an empty (non-null) `actions` array; no row is
deleted.

Only rows matching the retired-action overlap predicate are rewritten. Every
other row (the control group) is left **byte-for-byte unchanged** — the
migration does not re-order or normalize control rows even if they are not in
canonical order.

## 1. Validate the predicate and a control group (read-only)

```sql
-- Rows that WILL change (predicate == SQL overlap filter).
SELECT COUNT(*) AS affected_rows
FROM agent_permissions
WHERE actions && ARRAY['manage:profile', 'manage:contacts']::text[];

-- Control group that MUST remain byte-for-byte unchanged.
SELECT COUNT(*) AS control_rows
FROM agent_permissions
WHERE NOT (actions && ARRAY['manage:profile', 'manage:contacts']::text[]);

-- Sanity: affected + control == total.
SELECT COUNT(*) AS total_rows FROM agent_permissions;

-- Distinct legacy shapes, for an auditable before/after review.
SELECT actions, COUNT(*) AS n
FROM agent_permissions
WHERE actions && ARRAY['manage:profile', 'manage:contacts']::text[]
GROUP BY actions
ORDER BY n DESC;
```

Record `affected_rows`, `control_rows`, and `total_rows`. These are the exact
expected counts for the dry run and postconditions.

## 2. Dry-run on dev (read-only preview of every rewrite)

Run inside a transaction you will `ROLLBACK`, or as a pure `SELECT` preview:

```sql
SELECT
  ap.id,
  ap.actions AS before_actions,
  ARRAY(
    SELECT expanded.action
    FROM (
      SELECT DISTINCT
        m.action AS action,
        CASE m.action
          WHEN 'manage:identity' THEN 1
          WHEN 'manage:premises' THEN 2
          WHEN 'manage:intents' THEN 3
          WHEN 'manage:networks' THEN 4
          WHEN 'manage:opportunities' THEN 5
          WHEN 'manage:negotiations' THEN 6
          ELSE 99
        END AS ord
      FROM unnest(ap.actions) AS orig(action)
      CROSS JOIN LATERAL unnest(
        CASE orig.action
          WHEN 'manage:profile' THEN ARRAY['manage:identity', 'manage:premises']
          WHEN 'manage:contacts' THEN ARRAY[]::text[]
          ELSE ARRAY[orig.action]
        END
      ) AS m(action)
    ) AS expanded
    ORDER BY expanded.ord, expanded.action
  ) AS after_actions
FROM agent_permissions AS ap
WHERE ap.actions && ARRAY['manage:profile', 'manage:contacts']::text[]
ORDER BY ap.id;
```

Confirm the preview `after_actions` matches expectations for every distinct
legacy shape from step 1. The preview expression is identical to the migration's
rewrite expression and to the `migrateAgentPermissionActions` unit helper.

## 3. Recovery points (Neon backup branch + protected offline artifact)

The migration is intentionally not auto-reversible and is a pure `UPDATE`: it
creates **no** table and leaves **no** durable app schema behind. Recovery
therefore uses two artifacts captured **before the deploy** that runs `0109` —
never an in-database recovery table and never a cross-branch join (Neon branches
are separate endpoints).

**(a) Mandatory Neon backup branch.** Per the `backfill-production-data`
workflow, take a backup branch of `protocol_prod` and record its `branchId` and
timestamp. Coarse incident restore = the approved Neon branch **restore/reset**
workflow (an operational action, not SQL).

**(b) Mandatory protected offline artifact.** Export the exact affected rows
from the step-2 dry-run — before the migration runs — as
`(id, before_actions, after_actions)`, plus the row count and a content
checksum, to secure **offline** storage (not a DB table):

```sql
-- Run the step-2 dry-run SELECT and export its rows verbatim to the artifact.
-- Then compute the integrity metadata that the artifact must record:
WITH affected AS (
  SELECT id, actions AS before_actions
  FROM agent_permissions
  WHERE actions && ARRAY['manage:profile', 'manage:contacts']::text[]
)
SELECT
  COUNT(*) AS affected_rows,
  md5(string_agg(id || ':' || array_to_string(before_actions, ','), '|'
                 ORDER BY id)) AS before_checksum
FROM affected;
```

Artifact contract:

- **Exact fields:** `id`, `before_actions` (text[]), `after_actions` (text[]),
  captured from the step-2 dry-run (whose `after_actions` expression is
  identical to the migration and to `migrateAgentPermissionActions`).
- **Counts & checksum:** `affected_rows` and `before_checksum` above; record
  them in the artifact header and in the release ticket.
- **Secure storage / access owner:** store in the team's protected secrets/
  artifact store; the **release owner** is the named access owner.
- **Timing:** exported and checksum-verified **before** the auto migration runs.

**Fine-grained incident restore** replays `before_actions` by `id` from the
artifact via a controlled one-off script (idempotent, keyed on `id`), e.g. a
`VALUES`-driven `UPDATE ... FROM (VALUES ...) AS restore(id, actions)`. This
leaves no lingering table and performs no cross-branch join.

**Retention & cleanup.** Retain both artifacts through the post-deploy
verification window plus the monitoring window in the IND-609 rollout doc. After
sign-off, the **release owner** deletes the offline artifact and expires the
Neon backup branch. Because the migration creates no table, confirm no durable
recovery schema remains:

```sql
SELECT to_regclass('public.agent_permissions_recovery_0109') AS should_be_null;
-- expect NULL (no recovery table is ever created by this migration)
```

## 4. Execute transactionally

Applied automatically by `drizzle-kit migrate` during deploy (journal entry
`0109`), or manually:

```sql
BEGIN;
\i services/api/drizzle/0109_migrate_agent_permission_actions.sql
-- verify step 5 postconditions here, then:
COMMIT;  -- or ROLLBACK on any mismatch
```

The `UPDATE` reports its affected row count; it MUST equal `affected_rows`.

## 5. Verify with an idempotent post-cutover sweep

Verification is an **idempotent sweep** on the current table plus the recorded
step-1 counts and the offline artifact from step 3. It is **independent of the
deploy's reported UPDATE count** (Railway/`drizzle-kit` may not surface it), so
it can be re-run at any time and by any operator. No in-DB recovery table and no
cross-branch join are used.

```sql
-- (1) Zero rows may still carry a retired action. Re-runnable; must stay 0.
SELECT COUNT(*) AS retired_remaining
FROM agent_permissions
WHERE actions && ARRAY['manage:profile', 'manage:contacts']::text[];
-- expect 0

-- (2) Row count is unchanged (no row dropped or duplicated).
SELECT COUNT(*) AS total_rows FROM agent_permissions;  -- expect recorded step-1 total

-- (3) Every row that the artifact recorded as previously-profile now holds
--     identity AND premises. Driven by the OFFLINE artifact, replayed as
--     inline VALUES (no recovery table, no cross-branch join):
--       SELECT COUNT(*) FROM (VALUES ('id-1'), ('id-2'), ...) AS prof(id)
--       JOIN agent_permissions ap ON ap.id = prof.id
--       WHERE NOT (ap.actions @> ARRAY['manage:identity','manage:premises']::text[]);
--     expect 0
```

**Idempotence sweep (the primary, count-independent check).** Re-applying the
migration SQL affects **0** rows once convergence is reached, because no row
overlaps the retired-action predicate anymore:

```sql
BEGIN;
\i services/api/drizzle/0109_migrate_agent_permission_actions.sql  -- reports 0 rows
ROLLBACK;
```

Control-group integrity is asserted by construction: the migration's
`WHERE actions && ARRAY['manage:profile','manage:contacts']` filter touches only
affected rows, so `total_rows` unchanged plus `retired_remaining = 0` plus a
zero-row re-run proves no control row was modified — without relying on the
deploy's UPDATE count. Diff the retained artifact counts before/after for an
independent record; never join across Neon branches.

## 6. Mixed-version rolling deploy — the pre-deploy migration is NOT the proof

`railway.toml` runs `db:migrate` as `preDeployCommand`, i.e. migration `0109`
executes **before** the new release replaces/drains the old replicas. The
currently deployed code (`origin/dev`) still WRITES `manage:profile` /
`manage:contacts` grants (agent service defaults, network-invitation defaults,
participant-agent `register_agent`). Therefore, during the rolling window, old
replicas can re-introduce retired-action rows **after** `0109` has run.

**Consequences (do not skip):**

1. The pre-deploy `0109` run + a zero-row re-run at deploy time **cannot** prove
   backfill completeness. New retired rows may appear until the last old replica
   drains. `retired_remaining = 0` is proven only by the **post-drain final
   sweep** (below), never by the automatic `db:migrate` alone.
2. **No access loss / no over-authorization in the meantime.** The new runtime
   interprets residual legacy stored rows at the capability-loading boundary
   (`projectStoredPermissionActions` in
   `packages/protocol/src/mcp/mcp.authorization-policy.ts`):
   `manage:profile` → `manage:identity` + `manage:premises`; `manage:contacts` →
   no capability; owner/scope matching preserved; unknown actions fail closed.
   This is temporary rolling-data compatibility for STORED rows only — the legacy
   names are never accepted as input or surfaced.

### Mandatory post-drain final sweep (separately approved)

> The post-drain final sweep is MANDATORY and is NOT the automatic preDeploy
> `db:migrate`. `db:migrate` runs `0109` once, before drain; only the separately
> approved post-drain sweep proves `retired_remaining = 0`.

After **all** old replicas have drained (only new, canonical-only writers
remain), run — via the separately approved `backfill-production-data` workflow,
with the pre-action Neon backup branch and protected offline artifact from §3:

```sql
-- Inventory: retired rows remaining after drain (expected > 0 only if old
-- replicas wrote new ones during the window; the sweep converges them).
SELECT COUNT(*) AS retired_remaining
FROM agent_permissions
WHERE actions && ARRAY['manage:profile', 'manage:contacts']::text[];
```

Then apply the same idempotent transform (`0109`'s SQL) as the final sweep and
re-run the inventory until `retired_remaining = 0`. This final-sweep result — not
the pre-deploy migration — is what proves completeness. Backup / offline
artifact / recovery requirements from §3 apply to the final sweep exactly as to
the initial run.

### Compatibility-removal gate

The read-time legacy projection is **temporary**. It may be removed only after
ALL of the following hold (do not claim the single deploy removes it):

1. all old replicas are drained (no instance running pre-cutover code);
2. the post-drain final sweep is complete and `retired_remaining = 0`;
3. a monitoring window has elapsed with **no new legacy writes** observed
   (retired-row inventory stays at 0 across the window).

Only then may `projectStoredPermissionActions` (and this compatibility note) be
retired in a follow-up release.

## Automated verification

- DB-free exactness + static/journal invariants:
  `services/api/src/lib/drizzle/tests/permission-action-migration.spec.ts`
- Actual-SQL behavior (owner/scope preservation, control group, idempotence),
  `TEST_DATABASE_SAFE`-gated (skipped where no disposable DB is proven):
  `services/api/src/lib/drizzle/tests/permission-action-migration.integration.spec.ts`
