import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { signConnectToken, verifyConnectToken } from '../src/services/connect-token.service';

// ---------------------------------------------------------------------------
// Fake IDs
// ---------------------------------------------------------------------------
const OPP_ID = '00000000-0000-4000-8000-000000000001';
const INTRODUCER_ID = '00000000-0000-4000-8000-000000000002';
const NON_INTRODUCER_ID = '00000000-0000-4000-8000-000000000003';
const OTHER_OPP_ID = '00000000-0000-4000-8000-000000000099';

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------
describe('connect-token helpers', () => {
  it('signConnectToken produces a token verifiable by verifyConnectToken', async () => {
    const token = await signConnectToken(INTRODUCER_ID, OPP_ID);
    const payload = await verifyConnectToken(token);
    expect(payload.sub).toBe(INTRODUCER_ID);
    expect(payload.opp).toBe(OPP_ID);
  });

  it('verifyConnectToken rejects malformed tokens', async () => {
    await expect(verifyConnectToken('garbage.token.here')).rejects.toThrow();
  });

  it('token opp mismatch is detectable', async () => {
    const token = await signConnectToken(INTRODUCER_ID, OTHER_OPP_ID);
    const payload = await verifyConnectToken(token);
    expect(payload.opp).not.toBe(OPP_ID);
  });
});

// ---------------------------------------------------------------------------
// OpportunityService.approveIntroduction unit tests
// ---------------------------------------------------------------------------
describe('OpportunityService.approveIntroduction', () => {
  const makeOpp = (overrides: Record<string, unknown> = {}) => ({
    id: OPP_ID,
    status: 'draft',
    actors: [{ userId: INTRODUCER_ID, role: 'introducer', approved: false }],
    ...overrides,
  });

  const makeDb = (oppOverrides: Record<string, unknown> = {}, dbOverrides: Record<string, unknown> = {}) => ({
    getOpportunity: mock(async () => makeOpp(oppOverrides)),
    updateOpportunityActorApproval: mock(async () => true),
    ...dbOverrides,
  });

  const makeService = (db: ReturnType<typeof makeDb>) => {
    const { OpportunityService } = require('../src/services/opportunity.service');
    const svc = new OpportunityService(db);
    svc.updateOpportunityStatus = mock(async () => null);
    return svc;
  };

  beforeEach(() => {
    mock.restore();
  });

  it('returns 404 when opportunity not found', async () => {
    const db = makeDb({}, { getOpportunity: mock(async () => null) });
    const svc = makeService(db);
    const result = await svc.approveIntroduction(OPP_ID, INTRODUCER_ID);
    expect(result).toMatchObject({ error: expect.any(String), status: 404 });
  });

  it('returns 403 when user is not an introducer', async () => {
    const db = makeDb({
      actors: [{ userId: NON_INTRODUCER_ID, role: 'candidate', approved: false }],
    });
    const svc = makeService(db);
    const result = await svc.approveIntroduction(OPP_ID, NON_INTRODUCER_ID);
    expect(result).toMatchObject({ error: expect.any(String), status: 403 });
  });

  it('returns success idempotently when actor already approved and status is terminal', async () => {
    const db = makeDb({
      status: 'pending',
      actors: [{ userId: INTRODUCER_ID, role: 'introducer', approved: true }],
    });
    const svc = makeService(db);
    const result = await svc.approveIntroduction(OPP_ID, INTRODUCER_ID);
    expect(result).toEqual({ success: true });
    expect(db.updateOpportunityActorApproval).not.toHaveBeenCalled();
  });

  it('retries status transition when actor already approved but status not terminal', async () => {
    const db = makeDb({
      status: 'draft',
      actors: [{ userId: INTRODUCER_ID, role: 'introducer', approved: true }],
    });
    const svc = makeService(db);
    const result = await svc.approveIntroduction(OPP_ID, INTRODUCER_ID);
    expect(result).toEqual({ success: true });
    expect(db.updateOpportunityActorApproval).not.toHaveBeenCalled();
    expect(svc.updateOpportunityStatus).toHaveBeenCalled();
  });

  it('flips approved flag and returns success', async () => {
    const db = makeDb();
    const svc = makeService(db);
    const result = await svc.approveIntroduction(OPP_ID, INTRODUCER_ID);
    expect(db.updateOpportunityActorApproval).toHaveBeenCalledWith(OPP_ID, INTRODUCER_ID, true);
    expect(result).toEqual({ success: true });
  });

  it('returns 500 when DB approval update fails', async () => {
    const db = makeDb({}, { updateOpportunityActorApproval: mock(async () => false) });
    const svc = makeService(db);
    const result = await svc.approveIntroduction(OPP_ID, INTRODUCER_ID);
    expect(result).toMatchObject({ error: expect.any(String), status: 500 });
  });

  it('returns 500 when status transition fails', async () => {
    const db = makeDb();
    const svc = makeService(db);
    svc.updateOpportunityStatus = mock(async () => ({ error: 'DB error', status: 500 }));
    const result = await svc.approveIntroduction(OPP_ID, INTRODUCER_ID);
    expect(result).toMatchObject({ error: expect.any(String), status: 500 });
  });
});
