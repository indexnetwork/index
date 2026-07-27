-- Durable agent-permission model migration (IND-606 / IND-607).
--
-- Retires the legacy `manage:profile` and `manage:contacts` grant actions from
-- the durable permission model and rewrites every affected row onto the
-- canonical action model. Known canonical actions are emitted first in canonical
-- order; any unknown/residual action strings are preserved (never dropped and
-- never promoted to canonical grants) and sorted after the canonical block:
--
--   * `manage:profile`  -> `manage:identity` + `manage:premises`
--   * `manage:contacts` -> removed
--   * every other action -> preserved verbatim
--
-- Per-row invariants (verified by the migration integration spec and the pure
-- transform unit spec that mirrors this SQL):
--   * owner (`user_id`), `agent_id`, `scope`, and `scope_id` are never touched;
--   * no valid grant is dropped and no action is broadened beyond the explicit
--     profile -> identity+premises expansion;
--   * results are de-duplicated and emitted in a deterministic canonical order
--     (identity, premises, intents, networks, opportunities, negotiations, then
--     any residual/unknown actions alphabetically);
--   * rows whose only action was `manage:contacts` become an empty (non-null)
--     action array — no row is deleted;
--   * the statement is idempotent: after it runs no row overlaps the retired
--     action set, so a re-run matches zero rows.
--
-- RECOVERY PATH (this data migration is intentionally not auto-reversible):
--   `manage:contacts` removal and the `manage:profile` -> identity+premises
--   expansion are lossy (a down migration cannot distinguish a backfilled
--   identity/premises pair from an independently granted one). This migration is
--   a pure UPDATE: it creates NO table and leaves NO durable app schema behind.
--
--   Recovery does NOT use an in-database recovery table (none is created) and
--   NEVER a cross-branch join (Neon branches are separate endpoints). Instead:
--     1. MANDATORY Neon backup branch of protocol_prod, taken BEFORE the deploy
--        that runs this migration (per the backfill-production-data workflow).
--        Incident restore = the approved Neon branch restore/reset workflow.
--     2. MANDATORY protected OFFLINE artifact exported BEFORE the deploy: the
--        exact affected rows as (id, before_actions, after_actions), plus row
--        count and a sha256 checksum, stored in secure offline storage with a
--        named access owner. Fine-grained incident restore replays
--        before_actions by id from this artifact via a controlled one-off script
--        (never a cross-branch join, never a lingering table).
--   Verification is an idempotent post-cutover sweep independent of the deploy's
--   reported UPDATE count (retired_remaining = 0 and a re-run affects 0 rows).
--
--   See services/api/drizzle/0109_migrate_agent_permission_actions.md and
--   docs/rollout/IND-609-mcp-permission-rollout.md for the full predicate /
--   control-group / dry-run / artifact / execute / idempotent-sweep sequence,
--   rolling-deploy writer behavior, retention, and artifact cleanup owner.
UPDATE "agent_permissions" AS ap
SET "actions" = rewrite.actions
FROM (
  SELECT
    src.id AS id,
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
        FROM unnest(src.actions) AS orig(action)
        CROSS JOIN LATERAL unnest(
          CASE orig.action
            WHEN 'manage:profile' THEN ARRAY['manage:identity', 'manage:premises']
            WHEN 'manage:contacts' THEN ARRAY[]::text[]
            ELSE ARRAY[orig.action]
          END
        ) AS m(action)
      ) AS expanded
      ORDER BY expanded.ord, expanded.action
    ) AS actions
  FROM "agent_permissions" AS src
  WHERE src.actions && ARRAY['manage:profile', 'manage:contacts']::text[]
) AS rewrite
WHERE ap.id = rewrite.id;
