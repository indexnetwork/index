import { describe, expect, test } from 'bun:test';
import type { Opportunity } from '../../shared/interfaces/database.interface.js';
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

  test('routes an introducer send only to patient and party actors', () => {
    const opportunity = buildOpportunity({
      actors: [
        { userId: OWNER_ID, role: 'patient', networkId: 'net00000-0000-4000-8000-000000000001' },
        { userId: COUNTERPARTY_ID, role: 'agent', networkId: 'net00000-0000-4000-8000-000000000001' },
        { userId: INTRODUCER_ID, role: 'introducer', networkId: 'net00000-0000-4000-8000-000000000001' },
      ],
    });

    const plan = assessOpportunitySend(opportunity, INTRODUCER_ID);
    expect('recipients' in plan && plan.recipients.map((actor) => actor.userId)).toEqual([OWNER_ID]);
  });

  test('only the unapproved assigned introducer passes the approval gate', () => {
    const opportunity = buildOpportunity({
      actors: [
        { userId: OWNER_ID, role: 'patient', networkId: 'net00000-0000-4000-8000-000000000001' },
        { userId: INTRODUCER_ID, role: 'introducer', networkId: 'net00000-0000-4000-8000-000000000001', approved: false },
      ],
    });

    expect(assessIntroductionApproval(opportunity, INTRODUCER_ID)).toEqual({ kind: 'approve' });
    expect(assessIntroductionApproval(opportunity, OWNER_ID)).toMatchObject({ success: false });
  });

  test('explicit introduction approval cannot be replayed once approved (IND-608)', () => {
    // Anti-replay: an already-approved introducer re-approving is rejected
    // before any persistence, so a forged/replayed approval cannot re-trigger
    // negotiation.
    const opportunity = buildOpportunity({
      actors: [
        { userId: OWNER_ID, role: 'patient', networkId: 'net00000-0000-4000-8000-000000000001' },
        { userId: INTRODUCER_ID, role: 'introducer', networkId: 'net00000-0000-4000-8000-000000000001', approved: true },
      ],
    });

    expect(assessIntroductionApproval(opportunity, INTRODUCER_ID)).toEqual({
      success: false,
      error: 'Introduction already approved',
    });
  });

  test('explicit approval cannot be forged by a non-introducer actor (IND-608)', () => {
    // A counterparty/agent actor that is not the assigned introducer cannot
    // forge the introducer approval, regardless of the gate state.
    const opportunity = buildOpportunity({
      actors: [
        { userId: OWNER_ID, role: 'patient', networkId: 'net00000-0000-4000-8000-000000000001' },
        { userId: COUNTERPARTY_ID, role: 'agent', networkId: 'net00000-0000-4000-8000-000000000001' },
        { userId: INTRODUCER_ID, role: 'introducer', networkId: 'net00000-0000-4000-8000-000000000001', approved: false },
      ],
    });

    expect(assessIntroductionApproval(opportunity, COUNTERPARTY_ID)).toEqual({
      success: false,
      error: 'You are not the introducer for this opportunity',
    });
  });

  test('send cannot be replayed on an already-sent opportunity (IND-608)', () => {
    // Once an opportunity has left latent/draft, re-sending is rejected — a
    // replayed send cannot re-notify recipients.
    const opportunity = buildOpportunity({
      status: 'pending',
      actors: [
        { userId: OWNER_ID, role: 'patient', networkId: 'net00000-0000-4000-8000-000000000001' },
        { userId: COUNTERPARTY_ID, role: 'agent', networkId: 'net00000-0000-4000-8000-000000000001' },
      ],
    });

    expect(assessOpportunitySend(opportunity, OWNER_ID)).toMatchObject({
      success: false,
      error: expect.stringMatching(/already pending/i),
    });
  });
});
