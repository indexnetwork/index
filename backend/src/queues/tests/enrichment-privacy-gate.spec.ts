import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

import { afterAll, describe, expect, it, mock } from 'bun:test';

import { premises, users, networks } from '../../schemas/database.schema';

// ---------------------------------------------------------------------------
// Fake drizzle db: resolvePrivacyDecision issues three parallel reads
// (users, networks, premises). We branch on the `.from(table)` reference and
// let each test control what the premises read returns. We also record which
// tables were queried so we can assert the gate reads `premises`, NOT
// `user_profiles` (the WS10/IND-367 repoint).
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
    // resolvePrivacyDecision awaits the builder after .limit(1)
    limit() { return Promise.resolve(builder._rows); },
    _rows: rows as unknown[],
  };
  return builder;
}

mock.module('../../lib/drizzle/drizzle', () => ({
  default: { select: () => makeQuery([]) },
  closeDb: async () => {},
}));

// Heavy transitive imports that would otherwise eagerly construct LLM models /
// touch infra at module load. The gate under test uses none of them.
mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: async () => ({}), addBulk: async () => [], close: async () => {} }),
    createWorker: () => ({ close: async () => {} }),
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));
mock.module('@indexnetwork/protocol', () => ({
  EnrichmentGraphFactory: class { createGraph() { return { invoke: async () => ({}) }; } },
  PremiseGraphFactory: class { createGraph() { return { invoke: async () => ({}) }; } },
  QuestionerAgent: class {},
}));
mock.module('../../adapters/database.adapter', () => ({ EnrichmentDatabaseAdapter: class {}, ChatDatabaseAdapter: class {} }));
mock.module('../../adapters/scraper.adapter', () => ({ ScraperAdapter: class {} }));
mock.module('../../adapters/embedder.adapter', () => ({ EmbedderAdapter: class {} }));
mock.module('../../lib/parallel/parallel', () => ({ enrichUserProfile: async () => ({}) }));
mock.module('../questioner.queue', () => ({ questionerEnqueueIfEnabled: () => undefined }));

const { EnrichmentQueue } = await import('../enrichment.queue');

afterAll(() => mock.restore());

// resolvePrivacyDecision is private; reach it directly (no injected checkPrivacy
// so the REAL gate logic runs — the path the existing enrichment.queue.spec
// bypasses by injecting checkPrivacy).
function callGate(data: { userId: string; networkId?: string }) {
  const queue = new EnrichmentQueue();
  return (queue as unknown as {
    resolvePrivacyDecision(name: string, data: unknown): Promise<{ allowed: boolean; reason: string; hasExistingProfile: boolean }>;
  }).resolvePrivacyDecision('ensure_profile_hyde', data);
}

describe('EnrichmentQueue.resolvePrivacyDecision — enrichment signal (WS10)', () => {
  it('keys hasExistingProfile on ACTIVE premises, not user_profiles', async () => {
    fromTables.length = 0;
    premiseRows = [{ id: 'premise-1' }];

    const decision = await callGate({ userId: 'u1', networkId: 'n1' });

    expect(decision.hasExistingProfile).toBe(true);
    // ensure_profile_hyde short-circuits once the user has been enriched.
    expect(decision.reason).toBe('existing_profile_no_public_enrichment_needed');
    expect(decision.allowed).toBe(true);
    // The gate keys enrichment-existence on `premises` (user_profiles was dropped in WS8).
    expect(fromTables).toContain(premises);
  });

  it('treats a user with no ACTIVE premises as not-yet-enriched', async () => {
    fromTables.length = 0;
    premiseRows = [];

    const decision = await callGate({ userId: 'u2', networkId: 'n1' });

    expect(decision.hasExistingProfile).toBe(false);
    // Not short-circuited; falls through to the policy decision.
    expect(decision.reason).not.toBe('existing_profile_no_public_enrichment_needed');
    expect(fromTables).toContain(premises);
  });

  it('short-circuits before any DB read when the job has no network', async () => {
    fromTables.length = 0;
    premiseRows = [{ id: 'premise-1' }];

    const decision = await callGate({ userId: 'u3' });

    expect(decision.reason).toBe('no_network_policy');
    expect(fromTables).toHaveLength(0);
  });
});
