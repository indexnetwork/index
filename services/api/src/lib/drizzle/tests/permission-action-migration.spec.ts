import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { CANONICAL_AGENT_ACTIONS, RETIRED_AGENT_ACTIONS, actionsNeedMigration, migrateAgentPermissionActions } from '../permission-action-migration';

const apiRoot = path.resolve(import.meta.dir, '../../../..');
const migrationSql = readFileSync(
  path.join(apiRoot, 'drizzle/0109_migrate_agent_permission_actions.sql'),
  'utf8',
);
const runbookMd = readFileSync(
  path.join(apiRoot, 'drizzle/0109_migrate_agent_permission_actions.md'),
  'utf8',
);

/**
 * DB-free coverage for the durable permission-model migration (IND-606/607).
 *
 * The pure transform mirrors the SQL migration's per-row semantics; the
 * actual-SQL behavior is separately verified by the TEST_DATABASE_SAFE-gated
 * integration spec. These tests run everywhere with no database.
 */
describe('migrateAgentPermissionActions (mirrors 0109 SQL)', () => {
  it('expands manage:profile into manage:identity + manage:premises', () => {
    expect(migrateAgentPermissionActions(['manage:profile'])).toEqual([
      'manage:identity',
      'manage:premises',
    ]);
  });

  it('removes manage:contacts entirely', () => {
    expect(migrateAgentPermissionActions(['manage:contacts'])).toEqual([]);
    expect(migrateAgentPermissionActions(['manage:intents', 'manage:contacts'])).toEqual([
      'manage:intents',
    ]);
  });

  it('preserves every other valid grant exactly and in canonical order', () => {
    expect(
      migrateAgentPermissionActions([
        'manage:negotiations',
        'manage:intents',
        'manage:networks',
      ]),
    ).toEqual(['manage:intents', 'manage:networks', 'manage:negotiations']);
  });

  it('handles the legacy default profile+contacts pairing without broadening', () => {
    // Legacy chat orchestrator / personal-agent defaults granted
    // profile + contacts + intents + networks + opportunities.
    expect(
      migrateAgentPermissionActions([
        'manage:profile',
        'manage:contacts',
        'manage:intents',
        'manage:networks',
        'manage:opportunities',
      ]),
    ).toEqual([
      'manage:identity',
      'manage:premises',
      'manage:intents',
      'manage:networks',
      'manage:opportunities',
    ]);
  });

  it('de-duplicates when profile expansion overlaps existing grants', () => {
    expect(
      migrateAgentPermissionActions([
        'manage:identity',
        'manage:profile',
        'manage:premises',
      ]),
    ).toEqual(['manage:identity', 'manage:premises']);
  });

  it('de-duplicates repeated raw actions deterministically', () => {
    expect(
      migrateAgentPermissionActions(['manage:intents', 'manage:intents']),
    ).toEqual(['manage:intents']);
  });

  it('is idempotent — a second application is a no-op', () => {
    const once = migrateAgentPermissionActions([
      'manage:profile',
      'manage:contacts',
      'manage:intents',
    ]);
    expect(migrateAgentPermissionActions(once)).toEqual(once);
  });

  it('leaves empty input empty (contacts-only rows collapse to an empty set)', () => {
    expect(migrateAgentPermissionActions([])).toEqual([]);
  });

  it('preserves unknown/residual actions after the canonical block, alphabetically', () => {
    expect(
      migrateAgentPermissionActions([
        'manage:zeta',
        'manage:profile',
        'manage:alpha',
      ]),
    ).toEqual([
      'manage:identity',
      'manage:premises',
      'manage:alpha',
      'manage:zeta',
    ]);
  });

  it('never emits a retired action, and preserves the canonical action alongside the expansion', () => {
    // CANONICAL_AGENT_ACTIONS never contains a retired action, so each canonical
    // input survives verbatim while profile expands and contacts is dropped.
    for (const action of CANONICAL_AGENT_ACTIONS) {
      const out = migrateAgentPermissionActions([action, 'manage:profile', 'manage:contacts']);
      for (const retired of RETIRED_AGENT_ACTIONS) {
        expect(out).not.toContain(retired);
      }
      expect(out).toContain(action);
      expect(out).toContain('manage:identity');
      expect(out).toContain('manage:premises');
    }
  });
});

describe('actionsNeedMigration predicate (mirrors SQL overlap filter)', () => {
  it('matches rows containing a retired action', () => {
    expect(actionsNeedMigration(['manage:profile'])).toBe(true);
    expect(actionsNeedMigration(['manage:intents', 'manage:contacts'])).toBe(true);
  });

  it('excludes the control group (no retired action)', () => {
    expect(actionsNeedMigration(['manage:identity', 'manage:premises'])).toBe(false);
    expect(actionsNeedMigration([])).toBe(false);
  });

  it('flags rows purely by retired-action membership, independent of ordering', () => {
    // The SQL migration selects affected rows ONLY by retired-action membership
    // (the `&&` overlap filter) and leaves every control row byte-for-byte
    // unchanged. That predicate is deliberately NOT the same as "the pure helper
    // would rewrite this array": the helper also normalizes ordering, but the
    // SQL does not re-order control rows. This test pins that distinction so the
    // two are never conflated.
    const unorderedControl = ['manage:networks', 'manage:intents'];
    expect(actionsNeedMigration(unorderedControl)).toBe(false);
    // The helper would normalize ordering, but the SQL leaves this control row
    // exactly as-is because it does not match the predicate.
    expect(migrateAgentPermissionActions(unorderedControl)).toEqual([
      'manage:intents',
      'manage:networks',
    ]);
  });
});

describe('0109 migration SQL static invariants', () => {
  it('filters on the retired-action overlap predicate', () => {
    expect(migrationSql).toContain(
      "src.actions && ARRAY['manage:profile', 'manage:contacts']::text[]",
    );
  });

  it('expands profile to identity + premises and removes contacts', () => {
    expect(migrationSql).toContain(
      "WHEN 'manage:profile' THEN ARRAY['manage:identity', 'manage:premises']",
    );
    expect(migrationSql).toContain("WHEN 'manage:contacts' THEN ARRAY[]::text[]");
  });

  it('emits a deterministic canonical ordering', () => {
    expect(migrationSql).toContain('ORDER BY expanded.ord, expanded.action');
    expect(migrationSql).toContain('SELECT DISTINCT');
  });

  it('documents the snapshot-based recovery path', () => {
    expect(migrationSql).toContain('RECOVERY PATH');
    expect(migrationSql.toLowerCase()).toContain('backfill-production-data');
  });

  it('only rewrites the actions column, never owner/scope', () => {
    // A single SET target on `actions` guarantees the transform cannot touch
    // user_id / agent_id / scope / scope_id.
    expect(migrationSql).toContain('SET "actions" = rewrite.actions');
    expect(migrationSql).not.toMatch(/SET[^;]*"(user_id|agent_id|scope|scope_id)"/);
  });

  it('does not map anything onto a retired action (expansions are canonical only)', () => {
    // Retired actions may only appear as CASE match keys, the overlap predicate,
    // or documentation — never as an expansion output (`THEN ARRAY['manage:profile'`).
    expect(migrationSql).not.toContain("THEN ARRAY['manage:profile'");
    expect(migrationSql).not.toContain("THEN ARRAY['manage:contacts'");
  });
});

describe('0109 runbook mixed-version rolling-deploy invariants', () => {
  it('documents the preDeploy db:migrate old-replica writer race', () => {
    expect(runbookMd).toContain('preDeployCommand');
    expect(runbookMd.toLowerCase()).toContain('old replicas');
    // The pre-deploy run cannot prove completeness on its own.
    expect(runbookMd.toLowerCase()).toMatch(/cannot[\s\S]{0,40}prove/);
  });

  it('makes the post-drain final sweep mandatory and NOT the automatic db:migrate', () => {
    expect(runbookMd).toContain('post-drain final sweep');
    expect(runbookMd).toContain('MANDATORY and is NOT the automatic preDeploy');
    expect(runbookMd).toMatch(/post-drain[\s\S]*proves `retired_remaining = 0`/);
    expect(runbookMd).toMatch(/never by the automatic `db:migrate`/);
  });

  it('requires a mandatory retired-row inventory before the final sweep', () => {
    expect(runbookMd.toLowerCase()).toContain('retired_remaining');
    expect(runbookMd.toLowerCase()).toContain('inventory');
  });

  it('documents the temporary read-time projection and its removal gate', () => {
    expect(runbookMd).toContain('projectStoredPermissionActions');
    expect(runbookMd).toContain('Compatibility-removal gate');
    // Must not claim the single deploy removes compatibility.
    expect(runbookMd.toLowerCase()).toMatch(/only after|only once|do not claim/);
  });

  it('keeps the offline artifact + Neon backup recovery model (no in-DB recovery table)', () => {
    expect(runbookMd.toLowerCase()).toContain('offline');
    expect(runbookMd.toLowerCase()).toContain('neon backup branch');
    // No durable in-database recovery table is created.
    expect(runbookMd).toContain("to_regclass('public.agent_permissions_recovery_0109')");
  });
});

describe('0109 journal registration', () => {
  const journal = JSON.parse(
    readFileSync(path.join(apiRoot, 'drizzle/meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string; when: number }> };

  it('appends 0109 after the prior tip with a monotonic timestamp', () => {
    const entry = journal.entries.find(
      (e) => e.tag === '0109_migrate_agent_permission_actions',
    );
    expect(entry).toBeDefined();
    const previous = journal.entries.find((e) => e.idx === entry!.idx - 1);
    expect(previous).toBeDefined();
    expect(entry!.when).toBeGreaterThan(previous!.when);
  });

  it('keeps journal idx and tag sets unique', () => {
    expect(new Set(journal.entries.map((e) => e.idx)).size).toBe(journal.entries.length);
    expect(new Set(journal.entries.map((e) => e.tag)).size).toBe(journal.entries.length);
  });
});
