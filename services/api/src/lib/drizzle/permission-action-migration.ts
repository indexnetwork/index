/**
 * Deterministic, idempotent transform for the durable agent-permission model
 * migration (IND-606 / IND-607).
 *
 * This TypeScript helper mirrors the per-row semantics of the SQL data
 * migration in `drizzle/0109_migrate_agent_permission_actions.sql` so the exact
 * transformation can be unit-tested without a database. The SQL migration
 * remains the source of truth for the production/dev backfill; this helper is
 * verification/tooling-only and MUST stay in lockstep with the SQL ordering and
 * mapping rules.
 *
 * Row-level fields (`user_id`, `agent_id`, `scope`, `scope_id`) are owned by the
 * row, not by this array transform, and are never touched by either the SQL or
 * this helper.
 */

/** Canonical post-migration action set, in canonical (deterministic) order. */
export const CANONICAL_AGENT_ACTIONS = [
  'manage:identity',
  'manage:premises',
  'manage:intents',
  'manage:networks',
  'manage:opportunities',
  'manage:negotiations',
] as const;

export type CanonicalAgentAction = (typeof CANONICAL_AGENT_ACTIONS)[number];

/** Legacy actions retired from the durable model by this migration. */
export const RETIRED_AGENT_ACTIONS = ['manage:profile', 'manage:contacts'] as const;

export type RetiredAgentAction = (typeof RETIRED_AGENT_ACTIONS)[number];

/**
 * Canonical sort index. Mirrors the `CASE ... ORDER BY ord, action` ordering in
 * the SQL migration: canonical actions come first in this fixed order, and any
 * residual/unknown actions sort after them, alphabetically.
 */
const CANONICAL_ORDER = new Map<string, number>(
  CANONICAL_AGENT_ACTIONS.map((action, index) => [action, index + 1]),
);
const RESIDUAL_ORDER = 99;

/**
 * Expand a single legacy action into zero or more canonical actions:
 *   - `manage:profile`  -> `manage:identity` + `manage:premises`
 *   - `manage:contacts` -> removed (empty expansion)
 *   - anything else      -> preserved verbatim (including unknown actions)
 */
function expandAction(action: string): string[] {
  if (action === 'manage:profile') return ['manage:identity', 'manage:premises'];
  if (action === 'manage:contacts') return [];
  return [action];
}

function compareByCanonicalOrder(a: string, b: string): number {
  const aOrd = CANONICAL_ORDER.get(a) ?? RESIDUAL_ORDER;
  const bOrd = CANONICAL_ORDER.get(b) ?? RESIDUAL_ORDER;
  if (aOrd !== bOrd) return aOrd - bOrd;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * The retired-action predicate matching the SQL migration's
 * `actions && ARRAY['manage:profile', 'manage:contacts']` overlap filter.
 * Rows for which this is `false` form the control group and MUST remain
 * byte-for-byte unchanged.
 */
export function actionsNeedMigration(actions: readonly string[]): boolean {
  return actions.some(
    (action) => action === 'manage:profile' || action === 'manage:contacts',
  );
}

/**
 * Transform one `agent_permissions.actions` array onto the canonical action
 * model. Known canonical actions are emitted first, in canonical order; any
 * unknown/residual action strings are intentionally preserved and sorted after
 * the canonical block (never dropped, never promoted to canonical grants). The
 * output is therefore not guaranteed to be a subset of CANONICAL_AGENT_ACTIONS.
 *
 * Deterministic and idempotent: duplicates are removed and a second application
 * is a no-op because no retired action survives the first.
 */
export function migrateAgentPermissionActions(actions: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const action of actions) {
    for (const mapped of expandAction(action)) seen.add(mapped);
  }
  return [...seen].sort(compareByCanonicalOrder);
}
