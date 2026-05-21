import { config } from 'dotenv';
config({ path: '.env.development' });

// Set OPENROUTER_API_KEY before any protocol module is imported so that
// the model.config.ts module-level guard does not throw.
process.env.OPENROUTER_API_KEY ??= 'test-key-placeholder';

import { describe, it, expect, mock } from 'bun:test';
import { OpportunityService } from '../src/services/opportunity.service';

// ---------------------------------------------------------------------------
// Fake IDs
// ---------------------------------------------------------------------------
const OPP_ID = '00000000-0000-4000-8000-000000000001';
const SENDER_ID = '00000000-0000-4000-8000-000000000002';
const COUNTERPART_ID = '00000000-0000-4000-8000-000000000003';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeOpp = (overrides: Record<string, unknown> = {}) => ({
  id: OPP_ID,
  status: 'pending',
  actors: [
    { userId: SENDER_ID, role: 'peer', actedAt: '2026-05-12T10:00:00.000Z' },
    { userId: COUNTERPART_ID, role: 'peer' },
  ],
  ...overrides,
});

type MockDb = {
  getOpportunity: ReturnType<typeof mock>;
  updateOpportunityStatus: ReturnType<typeof mock>;
  stampOpportunityActorAction: ReturnType<typeof mock>;
  getOrCreateDM: ReturnType<typeof mock>;
  acceptSiblingOpportunities: ReturnType<typeof mock>;
  upsertContactMembership: ReturnType<typeof mock>;
  [key: string]: unknown;
};

const makeDb = (
  oppOverrides: Record<string, unknown> = {},
  dbOverrides: Record<string, unknown> = {},
): MockDb => ({
  getOpportunity: mock(async () => makeOpp(oppOverrides)),
  updateOpportunityStatus: mock(async () => makeOpp(oppOverrides)),
  stampOpportunityActorAction: mock(async () => makeOpp({ ...oppOverrides, status: 'accepted' })),
  getOrCreateDM: mock(async () => ({ id: 'dm-conv-id' })),
  acceptSiblingOpportunities: mock(async () => undefined),
  upsertContactMembership: mock(async () => undefined),
  ...dbOverrides,
});

const makeService = (db: MockDb) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new OpportunityService(db as any);

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('OpportunityService — self-accept guard', () => {
  // -------------------------------------------------------------------------
  // Test 1: updateOpportunityStatus blocks self-accept when actedAt is set
  // -------------------------------------------------------------------------
  it('updateOpportunityStatus: blocks self-accept when caller has actedAt set', async () => {
    const db = makeDb();
    const svc = makeService(db);

    const result = await svc.updateOpportunityStatus(OPP_ID, 'accepted', SENDER_ID);

    expect(result).toMatchObject({ error: expect.stringMatching(/already acted/i), status: 409 });
    expect(db.stampOpportunityActorAction).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 2: updateOpportunityStatus allows counterparty to accept
  // -------------------------------------------------------------------------
  it('updateOpportunityStatus: allows counterparty to accept when their actedAt is unset', async () => {
    const db = makeDb();
    const svc = makeService(db);

    const result = await svc.updateOpportunityStatus(OPP_ID, 'accepted', COUNTERPART_ID);

    expect('opportunity' in result).toBe(true);
    const opp = (result as { opportunity: { status: string } }).opportunity;
    expect(opp.status).toBe('accepted');
    expect(db.stampOpportunityActorAction).toHaveBeenCalledWith(
      OPP_ID,
      COUNTERPART_ID,
      'accepted',
      COUNTERPART_ID,
    );
  });

  // -------------------------------------------------------------------------
  // Test 3: rejected status by sender bypasses self-accept guard (terminal flip)
  // -------------------------------------------------------------------------
  it('updateOpportunityStatus: rejected by sender does NOT trigger the self-accept guard', async () => {
    const rejectedOpp = makeOpp({ status: 'rejected' });
    const db = makeDb({}, {
      getOpportunity: mock(async () => makeOpp()), // opp with actedAt set on sender
      updateOpportunityStatus: mock(async () => rejectedOpp),
    });
    const svc = makeService(db);

    const result = await svc.updateOpportunityStatus(OPP_ID, 'rejected', SENDER_ID);

    // Should succeed — rejected is a terminal flip, not subject to the guard
    expect('error' in result).toBe(false);
    expect(db.updateOpportunityStatus).toHaveBeenCalledWith(OPP_ID, 'rejected');
    expect(db.stampOpportunityActorAction).not.toHaveBeenCalled();
  });
});
