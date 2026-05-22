/**
 * Unit tests for OpportunityService.startChat — the atomic endpoint
 * introduced by Plan B Task 8. Exercises the service with a stubbed
 * OpportunityControllerDatabase so we can verify status transition rules,
 * authorization, and the pair → conversation resolution without the Postgres
 * adapter.
 */

import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, mock } from 'bun:test';
import type { Opportunity, OpportunityControllerDatabase } from '@indexnetwork/protocol';
import { OpportunityService } from '../opportunity.service';

const VIEWER_ID = 'user-viewer-001';
const PEER_ID = 'user-peer-002';
const OPP_ID = 'opp-001';
const CONV_ID = 'conv-001';

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: OPP_ID,
    detection: { source: 'opportunity_graph', timestamp: new Date().toISOString() },
    actors: [
      { networkId: 'idx-1', userId: VIEWER_ID, role: 'patient' },
      { networkId: 'idx-1', userId: PEER_ID, role: 'agent' },
    ],
    interpretation: {
      category: 'collaboration',
      reasoning: 'Strong match.',
      confidence: 0.85,
      signals: [],
    },
    context: { networkId: 'idx-1' },
    confidence: '0.85',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
    ...overrides,
  };
}

type DbStubOverrides = Partial<Record<keyof OpportunityControllerDatabase, unknown>>;

function makeServiceWithDb(opp: Opportunity, overrides: DbStubOverrides = {}) {
  const updated = { ...opp, status: 'accepted' as const };
  const db = {
    getOpportunity: mock(async () => opp),
    updateOpportunityStatus: mock(async () => updated),
    stampOpportunityActorAction: mock(async () => updated),
    acceptSiblingOpportunities: mock(async () => [] as string[]),
    upsertContactMembership: mock(async () => {}),
    getOrCreateDM: mock(async () => ({ id: CONV_ID })),
    unhideConversation: mock(async () => {}),
    ...overrides,
  } as unknown as OpportunityControllerDatabase;

  return { service: new OpportunityService(db), db };
}

describe('OpportunityService.startChat', () => {
  it('flips pending → accepted and returns the conversation from getOrCreateDM', async () => {
    const opp = makeOpportunity({ status: 'pending' });
    const { service, db } = makeServiceWithDb(opp);

    const result = await service.startChat(OPP_ID, VIEWER_ID);

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.conversationId).toBe(CONV_ID);
    expect(result.counterpartUserId).toBe(PEER_ID);
    expect(db.stampOpportunityActorAction).toHaveBeenCalledWith(OPP_ID, VIEWER_ID, 'accepted', VIEWER_ID);
    expect(db.getOrCreateDM).toHaveBeenCalledWith(VIEWER_ID, PEER_ID);

    // Both-way contact membership: accepter (restore:true) + counterpart (restore:false)
    expect(db.upsertContactMembership).toHaveBeenCalledTimes(2);
    expect(db.upsertContactMembership).toHaveBeenCalledWith(VIEWER_ID, PEER_ID, { restore: true });
    expect(db.upsertContactMembership).toHaveBeenCalledWith(PEER_ID, VIEWER_ID, { restore: false });

    // Unhide conversation so it appears in sidebar even if previously hidden
    expect(db.unhideConversation).toHaveBeenCalledWith(VIEWER_ID, CONV_ID);
  });

  it('flips draft → accepted for the orchestrator path', async () => {
    const opp = makeOpportunity({ status: 'draft' });
    const { service, db } = makeServiceWithDb(opp);

    const result = await service.startChat(OPP_ID, VIEWER_ID);

    expect('error' in result).toBe(false);
    expect(db.stampOpportunityActorAction).toHaveBeenCalledWith(OPP_ID, VIEWER_ID, 'accepted', VIEWER_ID);
  });

  it('returns conversation idempotently when opportunity is already accepted', async () => {
    const opp = makeOpportunity({ status: 'accepted' });
    const { service, db } = makeServiceWithDb(opp);

    const result = await service.startChat(OPP_ID, VIEWER_ID);

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.conversationId).toBe(CONV_ID);
    expect(result.counterpartUserId).toBe(PEER_ID);
    expect(db.getOrCreateDM).toHaveBeenCalledWith(VIEWER_ID, PEER_ID);
    expect(db.unhideConversation).toHaveBeenCalledWith(VIEWER_ID, CONV_ID);
    // No status change or side effects — those ran on the original accept
    expect(db.updateOpportunityStatus).not.toHaveBeenCalled();
    expect(db.acceptSiblingOpportunities).not.toHaveBeenCalled();
    expect(db.upsertContactMembership).not.toHaveBeenCalled();
  });

  it('rejects with 403 when caller is not an actor on an accepted opportunity', async () => {
    const opp = makeOpportunity({ status: 'accepted' });
    const { service, db } = makeServiceWithDb(opp);

    const result = await service.startChat(OPP_ID, 'user-stranger-999');

    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.status).toBe(403);
    expect(db.getOrCreateDM).not.toHaveBeenCalled();
  });

  it('rejects with 400 when opportunity is rejected or expired', async () => {
    for (const status of ['rejected', 'expired'] as const) {
      const opp = makeOpportunity({ status });
      const { service } = makeServiceWithDb(opp);

      const result = await service.startChat(OPP_ID, VIEWER_ID);

      expect('error' in result).toBe(true);
      if (!('error' in result)) return;
      expect(result.status).toBe(400);
    }
  });

  it('rejects with 403 when caller is not an actor', async () => {
    const opp = makeOpportunity({ status: 'pending' });
    const { service } = makeServiceWithDb(opp);

    const result = await service.startChat(OPP_ID, 'user-stranger-999');

    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.status).toBe(403);
  });

  it('rejects with 404 when opportunity does not exist', async () => {
    const db = {
      getOpportunity: mock(async () => null),
      updateOpportunityStatus: mock(async () => null),
      acceptSiblingOpportunities: mock(async () => []),
      upsertContactMembership: mock(async () => {}),
      getOrCreateDM: mock(async () => ({ id: CONV_ID })),
    } as unknown as OpportunityControllerDatabase;
    const service = new OpportunityService(db);

    const result = await service.startChat(OPP_ID, VIEWER_ID);

    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.status).toBe(404);
  });

  it('returns 500 when stampOpportunityActorAction returns null (DM already created)', async () => {
    const opp = makeOpportunity({ status: 'pending' });
    const { service, db } = makeServiceWithDb(opp, {
      stampOpportunityActorAction: mock(async () => null),
    });

    const result = await service.startChat(OPP_ID, VIEWER_ID);

    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.status).toBe(500);
    // DM is resolved BEFORE the status flip so the pair still has a
    // conversation even if the flip fails. On retry the opp is still
    // pending/draft and the button can recover.
    expect(db.getOrCreateDM).toHaveBeenCalledWith(VIEWER_ID, PEER_ID);
  });

  describe('partial-failure recovery', () => {
    it('leaves the opportunity at its original status when getOrCreateDM throws', async () => {
      const opp = makeOpportunity({ status: 'pending' });
      const { service, db } = makeServiceWithDb(opp, {
        getOrCreateDM: mock(async () => {
          throw new Error('redis unreachable');
        }),
      });

      const result = await service.startChat(OPP_ID, VIEWER_ID);

      expect('error' in result).toBe(true);
      if (!('error' in result)) return;
      expect(result.status).toBe(500);
      // Crucially: status flip never happens, so a retry sees pending and
      // the Start Chat button is not a dead end.
      expect(db.updateOpportunityStatus).not.toHaveBeenCalled();
      expect(db.acceptSiblingOpportunities).not.toHaveBeenCalled();
      expect(db.upsertContactMembership).not.toHaveBeenCalled();
    });

    it('still returns the conversation when acceptSiblingOpportunities throws (best-effort)', async () => {
      const opp = makeOpportunity({ status: 'pending' });
      const { service } = makeServiceWithDb(opp, {
        acceptSiblingOpportunities: mock(async () => {
          throw new Error('tx rollback');
        }),
      });

      const result = await service.startChat(OPP_ID, VIEWER_ID);

      // The user still gets navigated to their chat — siblings are a
      // home-feed-sync concern, not a blocking one.
      expect('error' in result).toBe(false);
      if ('error' in result) return;
      expect(result.conversationId).toBe(CONV_ID);
    });

    it('still returns the conversation when upsertContactMembership throws (best-effort)', async () => {
      const opp = makeOpportunity({ status: 'pending' });
      const { service, db } = makeServiceWithDb(opp, {
        upsertContactMembership: mock(async () => {
          throw new Error('contacts index locked');
        }),
      });

      const result = await service.startChat(OPP_ID, VIEWER_ID);

      expect('error' in result).toBe(false);
      if ('error' in result) return;
      expect(result.conversationId).toBe(CONV_ID);
      // Both directions attempted even when first throws
      expect(db.upsertContactMembership).toHaveBeenCalledTimes(2);
    });
  });
});
