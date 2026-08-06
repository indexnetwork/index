import { describe, expect, it } from 'bun:test';

import type { DrizzleDB } from '../../lib/drizzle/drizzle';
import { networks, premises, users } from '../../schemas/database.schema';

import { EnrichmentDatabaseAdapter } from '../enrichment.database.adapter';

// Fake drizzle db: getEnrichmentPrivacyContext issues three parallel reads
// (users, networks, premises). Branch on the `.from(table)` reference and let
// each test control the premises result. Recording the tables proves the gate
// reads `premises`, not the user_profiles table removed in WS8.
const fromTables: unknown[] = [];
let premiseRows: Array<{ id: string }> = [];
const userRows = [{ id: 'u1' }];
const networkRows = [{ id: 'n1' }];

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
    limit() { return Promise.resolve(builder._rows); },
    _rows: rows as unknown[],
  };
  return builder;
}

const fakeDb = {
  select: () => makeQuery([]),
} as unknown as DrizzleDB;

describe('EnrichmentDatabaseAdapter.getEnrichmentPrivacyContext — enrichment signal (WS10)', () => {
  it('reports hasActivePremise=true and reads `premises`, not user_profiles', async () => {
    fromTables.length = 0;
    premiseRows = [{ id: 'premise-1' }];

    const ctx = await new EnrichmentDatabaseAdapter(fakeDb).getEnrichmentPrivacyContext('u1', 'n1');

    expect(ctx.hasActivePremise).toBe(true);
    expect(ctx.userExists).toBe(true);
    expect(ctx.networkExists).toBe(true);
    expect(fromTables).toContain(premises);
    expect(fromTables).toContain(users);
    expect(fromTables).toContain(networks);
  });

  it('reports hasActivePremise=false when the user has no ACTIVE premise', async () => {
    fromTables.length = 0;
    premiseRows = [];

    const ctx = await new EnrichmentDatabaseAdapter(fakeDb).getEnrichmentPrivacyContext('u2', 'n1');

    expect(ctx.hasActivePremise).toBe(false);
    expect(fromTables).toContain(premises);
  });
});
