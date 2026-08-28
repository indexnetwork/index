import { describe, expect, test } from 'bun:test';
import type { Opportunity } from '../../../platform/database.js';
import { assessIntroductionApproval, assessOpportunitySend, assessOpportunityStatusTransition, updateOpportunityLifecycle, type OpportunityLifecyclePort } from '../opportunity.lifecycle.js';

const OWNER_ID = 'u0000000-0000-4000-8000-000000000001';
const COUNTERPARTY_ID = 'u0000000-0000-4000-8000-000000000002';
const INTRODUCER_ID = 'u0000000-0000-4000-8000-000000000003';

function buildOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'op000000-0000-4000-8000-000000000001',
    status: 'draft',
    actors: [
      { userId: OWNER_ID, role: 'patient', networkId: 'net00000-0000-4000-8000-000000000001' },
      { userId: COUNTERPARTY_ID, role: 'agent', networkId: 'net00000-0000-4000-8000-000000000001' },
    ],
    detection: { source: 'manual' },
    interpretation: { reasoning: '', confidence: 1 },
    context: {},
    confidence: '1',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
    ...overrides,
  };
}

describe('opportunity lifecycle policies', () => {
  test('rejects an invalid status before reading persistence', async () => {
    let readCalled = false;
    const port = {
      getOpportunity: async () => {
        readCalled = true;
        return null;
      },
    } as OpportunityLifecyclePort;

    const result = await updateOpportunityLifecycle(port, {
      opportunityId: 'op000000-0000-4000-8000-000000000001',
      actorUserId: OWNER_ID,
      newStatus: 'pending',
    });

    expect(result).toEqual({ success: false, error: 'newStatus must be one of: accepted, rejected, expired.' });
    expect(readCalled).toBe(false);
  });

  test('keeps acceptance two-party while allowing a prior actor to reject', () => {
    const opportunity = buildOpportunity({
      status: 'pending',
      actors: [
        { userId: OWNER_ID, role: 'patient', networkId: 'net00000-0000-4000-8000-000000000001', actedAt: new Date() },
        { userId: COUNTERPARTY_ID, role: 'agent', networkId: 'net00000-0000-4000-8000-000000000001' },
      ],
    });

    expect(assessOpportunityStatusTransition(opportunity, OWNER_ID, 'accepted')).toMatchObject({
      success: false,
      error: expect.stringMatching(/already acted/i),
    });
    expect(assessOpportunityStatusTransition(opportunity, OWNER_ID, 'rejected')).toEqual({
      kind: 'set_terminal_status',
      status: 'rejected',
    });
  });

});
