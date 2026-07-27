/**
 * Hermetic wiring tests for ChatDatabaseAdapter opportunity delegations.
 *
 * No database, no credentials: the inner OpportunityDatabaseAdapter is stubbed
 * and the test asserts the delegation forwards, so a missing pass-through
 * (which makes the discovery graph silently no-op in prod) fails on every run
 * instead of only in the DB-backed adapter specs.
 */
import { describe, expect, it } from 'bun:test';

// The adapter module chain requires DATABASE_URL at import time and probes a
// disposable test DB when NODE_ENV === 'test'. Stub the URL and present the
// isolated-child readiness markers just for the import, then restore, so this
// spec stays hermetic and cannot mask readiness for other test files.
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

const { ChatDatabaseAdapter } = await import('../chat.database.adapter.js');

for (const [key, value] of Object.entries(savedEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('ChatDatabaseAdapter opportunity delegations', () => {
  it('searchUserContextsBySimilarity forwards to the inner OpportunityDatabaseAdapter', async () => {
    const adapter = new ChatDatabaseAdapter();
    const calls: unknown[] = [];
    const expected = [{ userContextId: 'ctx-1', score: 0.9 }];
    (adapter as unknown as { _opportunityAdapter: unknown })._opportunityAdapter = {
      searchUserContextsBySimilarity: async (params: unknown) => {
        calls.push(params);
        return expected;
      },
    };

    expect(typeof adapter.searchUserContextsBySimilarity).toBe('function');
    const params = {
      embedding: [0.1, 0.2],
      networkIds: ['net-1'],
      excludeUserId: 'user-1',
      limit: 5,
      minScore: 0.4,
    };
    const result = await adapter.searchUserContextsBySimilarity(params);
    expect(calls).toEqual([params]);
    expect(result).toBe(expected);
  });

  it('searchPremisesBySimilarity forwards to the inner OpportunityDatabaseAdapter', async () => {
    const adapter = new ChatDatabaseAdapter();
    const calls: unknown[] = [];
    (adapter as unknown as { _opportunityAdapter: unknown })._opportunityAdapter = {
      searchPremisesBySimilarity: async (params: unknown) => {
        calls.push(params);
        return [];
      },
    };

    const params = {
      embedding: [0.1, 0.2],
      networkIds: ['net-1'],
      excludeUserId: 'user-1',
      limit: 5,
    };
    const result = await adapter.searchPremisesBySimilarity(params);
    expect(calls).toEqual([params]);
    expect(result).toEqual([]);
  });
});
