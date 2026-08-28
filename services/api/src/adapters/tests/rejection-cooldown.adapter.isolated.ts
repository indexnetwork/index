/**
 * IND-567 — Unit tests for OpportunityDatabaseAdapter.getRecentlyRejectedOpportunityCounterparties
 * and the delegation chain through ChatDatabaseAdapter.
 *
 * Runs in an isolated process (*.isolated.ts) because it uses mock.module() to
 * replace the Drizzle DB client, keeping these tests provider-free.
 *
 * All adapter imports are done via dynamic import() in beforeAll — after the
 * module mock is registered — so the Bun ES-module static-import hoisting
 * cannot evaluate the real drizzle client before the mock is in place.
 */
import { describe, it, expect, mock, beforeAll } from 'bun:test';

// ── Shared mock state: tests swap mockRows before each assertion ──────────────
let mockRows: Array<{ actors: unknown }> = [];

function makeRow(actors: Array<{ userId: string; role: string }>) {
  return { actors };
}

// ── Register the drizzle mock BEFORE any import that touches drizzle ─────────
// The chainable query builder resolves to mockRows via Promise, mimicking
// Drizzle's .select().from().where() return type.
mock.module('../../lib/drizzle/drizzle', () => {
  const chain: {
    select: () => typeof chain;
    from: () => typeof chain;
    where: () => typeof chain;
    then<T>(resolve: (v: Array<{ actors: unknown }>) => T, reject?: (e: unknown) => T): Promise<T>;
  } = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    then<T>(resolve: (v: Array<{ actors: unknown }>) => T, reject?: (e: unknown) => T): Promise<T> {
      return Promise.resolve(mockRows).then(resolve, reject);
    },
  };
  return { default: chain, closeDb: async () => {} };
});

// ── Dynamically import adapters AFTER the mock is registered ─────────────────
// Using module-level `let` + `beforeAll` dynamic import avoids static-import
// hoisting, which would evaluate drizzle before mock.module() fires.
let OpportunityDatabaseAdapter: typeof import('../opportunity.database.adapter').OpportunityDatabaseAdapter;
let ChatDatabaseAdapter: typeof import('../chat.database.adapter').ChatDatabaseAdapter;
let OpportunityGraphDatabase: unknown; // type-only; unused at runtime

beforeAll(async () => {
  const oppMod = await import('../opportunity.database.adapter');
  OpportunityDatabaseAdapter = oppMod.OpportunityDatabaseAdapter;
  const chatMod = await import('../chat.database.adapter');
  ChatDatabaseAdapter = chatMod.ChatDatabaseAdapter;
});

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DISCOVERER = 'user-discoverer';
const CANDIDATE_A = 'user-candidate-a';
const CANDIDATE_B = 'user-candidate-b';
const CANDIDATE_C = 'user-candidate-c';

// ── Delegation chain ─────────────────────────────────────────────────────────
describe('ChatDatabaseAdapter delegation chain (IND-567)', () => {
  it('exposes getRecentlyRejectedOpportunityCounterparties as a function', () => {
    const chat = new ChatDatabaseAdapter();
    expect(typeof chat.getRecentlyRejectedOpportunityCounterparties).toBe('function');
  });
});

// ── Core filtering logic ─────────────────────────────────────────────────────
describe('OpportunityDatabaseAdapter.getRecentlyRejectedOpportunityCounterparties (IND-567)', () => {
  it('returns empty array when candidateUserIds is empty (skips DB call)', async () => {
    mockRows = [makeRow([{ userId: DISCOVERER, role: 'patient' }, { userId: CANDIDATE_A, role: 'agent' }])];
    const adapter = new OpportunityDatabaseAdapter();
    const result = await adapter.getRecentlyRejectedOpportunityCounterparties(DISCOVERER, [], WINDOW_MS);
    expect(result).toEqual([]);
  });

  it('returns empty array when DB returns no rows', async () => {
    mockRows = [];
    const adapter = new OpportunityDatabaseAdapter();
    const result = await adapter.getRecentlyRejectedOpportunityCounterparties(
      DISCOVERER,
      [CANDIDATE_A, CANDIDATE_B],
      WINDOW_MS,
    );
    expect(result).toEqual([]);
  });

  it('returns matching candidateUserId from a matching row', async () => {
    mockRows = [
      makeRow([{ userId: DISCOVERER, role: 'patient' }, { userId: CANDIDATE_A, role: 'agent' }]),
    ];
    const adapter = new OpportunityDatabaseAdapter();
    const result = await adapter.getRecentlyRejectedOpportunityCounterparties(
      DISCOVERER,
      [CANDIDATE_A, CANDIDATE_B],
      WINDOW_MS,
    );
    expect(result).toContain(CANDIDATE_A);
    expect(result).not.toContain(CANDIDATE_B);
    expect(result).not.toContain(DISCOVERER);
  });

  it('returns multiple matched candidates across different rows', async () => {
    mockRows = [
      makeRow([{ userId: DISCOVERER, role: 'patient' }, { userId: CANDIDATE_A, role: 'agent' }]),
      makeRow([{ userId: DISCOVERER, role: 'patient' }, { userId: CANDIDATE_B, role: 'agent' }]),
    ];
    const adapter = new OpportunityDatabaseAdapter();
    const result = await adapter.getRecentlyRejectedOpportunityCounterparties(
      DISCOVERER,
      [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C],
      WINDOW_MS,
    );
    expect(result.sort()).toEqual([CANDIDATE_A, CANDIDATE_B].sort());
    expect(result).not.toContain(CANDIDATE_C);
  });

  it('does NOT include the discoverer even if passed in candidateUserIds', async () => {
    mockRows = [
      makeRow([{ userId: DISCOVERER, role: 'patient' }, { userId: CANDIDATE_A, role: 'agent' }]),
    ];
    const adapter = new OpportunityDatabaseAdapter();
    const result = await adapter.getRecentlyRejectedOpportunityCounterparties(
      DISCOVERER,
      [DISCOVERER, CANDIDATE_A],
      WINDOW_MS,
    );
    expect(result).not.toContain(DISCOVERER);
    expect(result).toContain(CANDIDATE_A);
  });

  it('deduplicates when a candidate appears in multiple matching rows', async () => {
    mockRows = [
      makeRow([{ userId: DISCOVERER, role: 'patient' }, { userId: CANDIDATE_A, role: 'agent' }]),
      makeRow([{ userId: DISCOVERER, role: 'patient' }, { userId: CANDIDATE_A, role: 'agent' }]),
    ];
    const adapter = new OpportunityDatabaseAdapter();
    const result = await adapter.getRecentlyRejectedOpportunityCounterparties(
      DISCOVERER,
      [CANDIDATE_A],
      WINDOW_MS,
    );
    expect(result.filter((id) => id === CANDIDATE_A).length).toBe(1);
  });

  it('only returns candidates present in the provided candidateUserIds set', async () => {
    const STRANGER = 'user-stranger-not-in-list';
    mockRows = [
      makeRow([{ userId: DISCOVERER, role: 'patient' }, { userId: STRANGER, role: 'agent' }]),
    ];
    const adapter = new OpportunityDatabaseAdapter();
    const result = await adapter.getRecentlyRejectedOpportunityCounterparties(
      DISCOVERER,
      [CANDIDATE_A],
      WINDOW_MS,
    );
    expect(result).toEqual([]);
    expect(result).not.toContain(STRANGER);
  });
});
