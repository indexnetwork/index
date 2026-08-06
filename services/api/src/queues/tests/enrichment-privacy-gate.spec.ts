import { describe, expect, it } from 'bun:test';

import { EnrichmentQueue } from '../enrichment.queue';

// The adapter's data-source behavior is covered separately. These tests inject
// its narrow read contract and exercise the queue's real decision logic.
let privacyContext: {
  userExists: boolean;
  networkExists: boolean;
  hasActivePremise: boolean;
} = {
  userExists: true,
  networkExists: true,
  hasActivePremise: false,
};
const privacyContextCalls: Array<[string, string]> = [];

function callGate(data: { userId: string; networkId?: string }) {
  const queue = new EnrichmentQueue({
    privacyDatabase: {
      async getEnrichmentPrivacyContext(userId: string, networkId: string) {
        privacyContextCalls.push([userId, networkId]);
        return privacyContext;
      },
    } as never,
  });
  return (queue as unknown as {
    resolvePrivacyDecision(
      name: 'ensure_profile_hyde',
      data: { userId: string; networkId?: string },
    ): Promise<{ allowed: boolean; reason: string; hasExistingProfile: boolean }>;
  }).resolvePrivacyDecision('ensure_profile_hyde', data);
}

describe('EnrichmentQueue.resolvePrivacyDecision — enrichment signal (WS10)', () => {
  it('keys hasExistingProfile on the adapter-reported ACTIVE premise', async () => {
    privacyContextCalls.length = 0;
    privacyContext = {
      userExists: true,
      networkExists: true,
      hasActivePremise: true,
    };

    const decision = await callGate({ userId: 'u1', networkId: 'n1' });

    expect(decision.hasExistingProfile).toBe(true);
    expect(decision.reason).toBe('existing_profile_no_public_enrichment_needed');
    expect(decision.allowed).toBe(true);
    expect(privacyContextCalls).toContainEqual(['u1', 'n1']);
  });

  it('treats a user with no ACTIVE premises as not-yet-enriched', async () => {
    privacyContextCalls.length = 0;
    privacyContext = {
      userExists: true,
      networkExists: true,
      hasActivePremise: false,
    };

    const decision = await callGate({ userId: 'u2', networkId: 'n1' });

    expect(decision.hasExistingProfile).toBe(false);
    expect(decision.reason).not.toBe('existing_profile_no_public_enrichment_needed');
    expect(privacyContextCalls).toContainEqual(['u2', 'n1']);
  });

  it('short-circuits before any adapter read when the job has no network', async () => {
    privacyContextCalls.length = 0;
    privacyContext = {
      userExists: true,
      networkExists: true,
      hasActivePremise: true,
    };

    const decision = await callGate({ userId: 'u3' });

    expect(decision.reason).toBe('no_network_scope');
    expect(privacyContextCalls).toHaveLength(0);
  });
});
