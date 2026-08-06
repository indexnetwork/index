import { describe, expect, it } from 'bun:test';

import type { DrizzleDB } from '../../lib/drizzle/drizzle';

// The adapter module chain requires DATABASE_URL at import time and probes a
// disposable test DB when NODE_ENV === 'test'. Present isolated-child readiness
// markers only for the import so this fake-DB spec remains hermetic.
const savedEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  API_TEST_ISOLATED_CHILD: process.env.API_TEST_ISOLATED_CHILD,
  API_TEST_DATABASE_READY: process.env.API_TEST_DATABASE_READY,
  API_TEST_PARENT_PID: process.env.API_TEST_PARENT_PID,
};
process.env.DATABASE_URL ||= 'postgres://stub:stub@localhost:5432/stub';
process.env.API_TEST_ISOLATED_CHILD = '1';
process.env.API_TEST_DATABASE_READY = '1';
process.env.API_TEST_PARENT_PID = String(process.ppid);

const { networkMembers, networks, premises, users } = await import('../../schemas/database.schema.js');
const { EnrichmentDatabaseAdapter } = await import('../enrichment.database.adapter.js');

for (const [key, value] of Object.entries(savedEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

// Fake drizzle db: getEnrichmentAdmissionContext reads users and premises for
// every job, plus networks and network_members for scoped jobs. Branch on the
// `.from(table)` reference and let each test control the returned rows.
const fromTables: unknown[] = [];
let premiseRows: Array<{ id: string }> = [];
let membershipRows: Array<{ userId: string }> = [{ userId: 'u1' }];
const userRows = [{ id: 'u1' }];
const networkRows = [{ id: 'n1' }];

function makeQuery(rows: unknown[]) {
  const builder = {
    from(table: unknown) {
      fromTables.push(table);
      if (table === premises) builder._rows = premiseRows;
      else if (table === users) builder._rows = userRows;
      else if (table === networks) builder._rows = networkRows;
      else if (table === networkMembers) builder._rows = membershipRows;
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

describe('EnrichmentDatabaseAdapter.getEnrichmentAdmissionContext — enrichment signal (WS10)', () => {
  it('reports active premise and scoped membership from their source tables', async () => {
    fromTables.length = 0;
    premiseRows = [{ id: 'premise-1' }];
    membershipRows = [{ userId: 'u1' }];

    const ctx = await new EnrichmentDatabaseAdapter(fakeDb).getEnrichmentAdmissionContext('u1', 'n1');

    expect(ctx).toEqual({
      userExists: true,
      networkExists: true,
      membershipExists: true,
      hasActivePremise: true,
    });
    expect(fromTables).toContain(premises);
    expect(fromTables).toContain(users);
    expect(fromTables).toContain(networks);
    expect(fromTables).toContain(networkMembers);
  });

  it('reports membershipExists=false when scoped membership was removed', async () => {
    fromTables.length = 0;
    premiseRows = [];
    membershipRows = [];

    const ctx = await new EnrichmentDatabaseAdapter(fakeDb).getEnrichmentAdmissionContext('u1', 'n1');

    expect(ctx.membershipExists).toBe(false);
    expect(ctx.hasActivePremise).toBe(false);
    expect(fromTables).toContain(networkMembers);
  });

  it('skips network reads for an unscoped job while still reading user and premises', async () => {
    fromTables.length = 0;
    premiseRows = [];
    membershipRows = [];

    const ctx = await new EnrichmentDatabaseAdapter(fakeDb).getEnrichmentAdmissionContext('u1');

    expect(ctx).toEqual({
      userExists: true,
      networkExists: true,
      membershipExists: true,
      hasActivePremise: false,
    });
    expect(fromTables).toContain(users);
    expect(fromTables).toContain(premises);
    expect(fromTables).not.toContain(networks);
    expect(fromTables).not.toContain(networkMembers);
  });
});
