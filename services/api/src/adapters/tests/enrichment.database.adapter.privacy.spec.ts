import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, describe, expect, it, mock } from 'bun:test';

import { premises, users, networks } from '../../schemas/database.schema';

// ---------------------------------------------------------------------------
// Fake drizzle db: getEnrichmentPrivacyContext issues three parallel reads
// (users, networks, premises). We branch on the `.from(table)` reference and
// let each test control what the premises read returns. We also record which
// tables were queried so we can assert the gate reads `premises`, NOT
// `user_profiles` (the WS10/IND-367 repoint — user_profiles was dropped in WS8).
// `db` is sourced by the adapter from database.shared, which re-exports the
// default import of lib/drizzle/drizzle — so mocking that path here propagates.
// ---------------------------------------------------------------------------
const fromTables: unknown[] = [];
let premiseRows: Array<{ id: string }> = [];
const userRows = [{ onboarding: null, isGhost: false }];
const networkRows = [{ permissions: [] as unknown }];

function makeQuery(rows: unknown[]) {
  const builder = {
    from(table: unknown) {
      fromTables.push(table);
      if (table === premises) builder._rows = premiseRows;
      else if (table === users) builder._rows = userRows;
      else if (table === networks) builder._rows = networkRows;
      else builder._rows = rows;
      return builder;
    },
    where() { return builder; },
    // getEnrichmentPrivacyContext awaits the builder after .limit(1)
    limit() { return Promise.resolve(builder._rows); },
    _rows: rows as unknown[],
  };
  return builder;
}

mock.module('../../lib/drizzle/drizzle', () => ({
  default: { select: () => makeQuery([]) },
  closeDb: async () => {},
}));

const { EnrichmentDatabaseAdapter } = await import('../enrichment.database.adapter');

afterAll(() => mock.restore());

describe('EnrichmentDatabaseAdapter.getEnrichmentPrivacyContext — enrichment signal (WS10)', () => {
  it('reports hasActivePremise=true and reads `premises`, not user_profiles', async () => {
    fromTables.length = 0;
    premiseRows = [{ id: 'premise-1' }];

    const ctx = await new EnrichmentDatabaseAdapter().getEnrichmentPrivacyContext('u1', 'n1');

    expect(ctx.hasActivePremise).toBe(true);
    expect(ctx.user).toEqual({ onboarding: null, isGhost: false });
    expect(ctx.network).toEqual({ permissions: [] });
    // The "has been enriched?" signal keys on `premises` (WS8 dropped user_profiles).
    expect(fromTables).toContain(premises);
    expect(fromTables).toContain(users);
    expect(fromTables).toContain(networks);
  });

  it('reports hasActivePremise=false when the user has no ACTIVE premise', async () => {
    fromTables.length = 0;
    premiseRows = [];

    const ctx = await new EnrichmentDatabaseAdapter().getEnrichmentPrivacyContext('u2', 'n1');

    expect(ctx.hasActivePremise).toBe(false);
    expect(fromTables).toContain(premises);
  });
});
