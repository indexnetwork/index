import { describe, expect, test } from 'bun:test';

import type { Opportunity } from '@indexnetwork/protocol';

import { scheduleOpportunityPresentationPreload } from './opportunity.preload';

describe('scheduleOpportunityPresentationPreload', () => {
  test('does not block the caller while presenter work runs', async () => {
    let presenterStarted = false;
    let presenterFinished = false;

    const opportunity = {
      id: 'opp-1',
      status: 'pending',
      actors: [
        { userId: 'viewer-1', role: 'party' },
        { userId: 'viewer-2', role: 'party' },
      ],
      interpretation: { reasoning: 'test' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Opportunity;

    scheduleOpportunityPresentationPreload(
      {
        db: {
          getUser: async () => ({ id: 'viewer-2', name: 'Peer', avatar: null }),
        } as never,
        cache: {
          set: async () => {},
        },
        presenter: {
          present: async () => {
            presenterStarted = true;
            await new Promise((resolve) => setTimeout(resolve, 25));
            presenterFinished = true;
            return {
              headline: 'Hello',
              personalizedSummary: 'Summary',
              suggestedAction: 'Connect',
              mutualIntentsLabel: 'Shared interests',
            };
          },
        },
        gatherContext: async () => ({
          opportunityStatus: 'pending',
          matchReasoning: 'reason',
        }) as never,
      },
      opportunity,
      ['viewer-1'],
    );

    expect(presenterStarted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(presenterStarted).toBe(true);
    expect(presenterFinished).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(presenterFinished).toBe(true);
  });
});
