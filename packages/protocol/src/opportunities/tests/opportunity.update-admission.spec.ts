import { describe, expect, test } from 'bun:test';
import type { Opportunity } from '../../shared/interfaces/database.interface.js';
import { admitOpportunityUpdate, type OpportunityUpdateAdmissionPort } from '../application/opportunity.update-admission.js';

const OWNER = 'owner';
const COUNTERPART = 'counterpart';

function port(opportunity: Opportunity | null): OpportunityUpdateAdmissionPort {
  return { getOpportunity: async () => opportunity } as OpportunityUpdateAdmissionPort;
}

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'opp-1',
    status: 'pending',
    actors: [
      { userId: OWNER, role: 'party', networkId: 'network-owner', intent: 'intent-owner' },
      { userId: COUNTERPART, role: 'party', networkId: 'network-counterpart' },
    ],
    detection: { source: 'opportunity_graph', triggeredBy: 'intent-owner' },
    ...overrides,
  } as unknown as Opportunity;
}

describe('admitOpportunityUpdate', () => {
  test('returns an opaque denial before later scope checks for a non-actor', async () => {
    const result = await admitOpportunityUpdate(port(opportunity()), {
      opportunityId: 'opp-1',
      viewerId: 'outsider',
      scopedNetworkId: 'network-counterpart',
    });

    expect(result).toEqual({ kind: 'denied', message: 'Opportunity not found.' });
  });

  test('blocks terminal and negotiating lifecycle states', async () => {
    for (const status of ['accepted', 'rejected', 'expired', 'negotiating'] as const) {
      const result = await admitOpportunityUpdate(port(opportunity({ status })), {
        opportunityId: 'opp-1',
        viewerId: OWNER,
      });
      expect(result).toEqual({
        kind: 'denied',
        message: `This opportunity is already ${status} and cannot be updated.`,
      });
    }
  });

  test('requires the caller’s own bound network and selected intent anchor', async () => {
    const allowed = await admitOpportunityUpdate(port(opportunity()), {
      opportunityId: 'opp-1',
      viewerId: OWNER,
      scopedNetworkId: 'network-owner',
      selectedIntentScope: { scopeType: 'intent', scopeId: 'intent-owner' },
    });
    const denied = await admitOpportunityUpdate(port(opportunity()), {
      opportunityId: 'opp-1',
      viewerId: OWNER,
      scopedNetworkId: 'network-owner',
      selectedIntentScope: { scopeType: 'intent', scopeId: 'other-intent' },
    });

    expect(allowed.kind).toBe('admitted');
    expect(denied).toEqual({ kind: 'denied', message: 'Opportunity not found.' });
  });
});
