import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

import { afterAll, describe, expect, it } from 'bun:test';

import { mock } from 'bun:test';

// ---------------------------------------------------------------------------
// The three privacy reads (users, networks, premises) now live in
// EnrichmentDatabaseAdapter.getEnrichmentPrivacyContext — see
// `src/adapters/tests/enrichment.database.adapter.privacy.spec.ts` for the
// data-source guard (reads `premises`, NOT `user_profiles`; WS10/IND-367).
// Here we stub that adapter method so the REAL gate DECISION logic runs (the
// path enrichment.queue.spec bypasses by injecting checkPrivacy) and assert how
// the gate maps the privacy context onto a decision.
// ---------------------------------------------------------------------------
let privacyContext: {
  user: { onboarding: unknown; isGhost: boolean } | null;
  network: { permissions: unknown } | null;
  hasActivePremise: boolean;
} = { user: { onboarding: null, isGhost: false }, network: { permissions: [] }, hasActivePremise: false };
const privacyContextCalls: Array<[string, string]> = [];

mock.module('../../adapters/database.adapter', () => ({
  EnrichmentDatabaseAdapter: class {
    async getEnrichmentPrivacyContext(userId: string, networkId: string) {
      privacyContextCalls.push([userId, networkId]);
      return privacyContext;
    }
  },
  ChatDatabaseAdapter: class {},
}));

// Heavy transitive imports that would otherwise eagerly construct LLM models /
// touch infra at module load. The gate under test uses none of them.
mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: async () => ({}), addBulk: async () => [], close: async () => {} }),
    createWorker: () => ({ close: async () => {} }),
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));
mock.module('@indexnetwork/protocol', () => ({
  EnrichmentGraphFactory: class { createGraph() { return { invoke: async () => ({}) }; } },
  PremiseGraphFactory: class { createGraph() { return { invoke: async () => ({}) }; } },
  QuestionerAgent: class {},
}));
mock.module('../../adapters/scraper.adapter', () => ({ ScraperAdapter: class {} }));
mock.module('../../adapters/embedder.adapter', () => ({ EmbedderAdapter: class {} }));
mock.module('../../lib/parallel/parallel', () => ({ enrichUserProfile: async () => ({}) }));
mock.module('../questioner.queue', () => ({ questionerEnqueueIfEnabled: () => undefined }));

const { EnrichmentQueue } = await import('../enrichment.queue');

afterAll(() => mock.restore());

// resolvePrivacyDecision is private; reach it directly (no injected checkPrivacy
// so the REAL gate logic runs — the path the existing enrichment.queue.spec
// bypasses by injecting checkPrivacy).
function callGate(data: { userId: string; networkId?: string }) {
  const queue = new EnrichmentQueue();
  return (queue as unknown as {
    resolvePrivacyDecision(name: string, data: unknown): Promise<{ allowed: boolean; reason: string; hasExistingProfile: boolean }>;
  }).resolvePrivacyDecision('ensure_profile_hyde', data);
}

describe('EnrichmentQueue.resolvePrivacyDecision — enrichment signal (WS10)', () => {
  it('keys hasExistingProfile on the adapter-reported ACTIVE premise', async () => {
    privacyContextCalls.length = 0;
    privacyContext = { user: { onboarding: null, isGhost: false }, network: { permissions: [] }, hasActivePremise: true };

    const decision = await callGate({ userId: 'u1', networkId: 'n1' });

    expect(decision.hasExistingProfile).toBe(true);
    // ensure_profile_hyde short-circuits once the user has been enriched.
    expect(decision.reason).toBe('existing_profile_no_public_enrichment_needed');
    expect(decision.allowed).toBe(true);
    // The gate delegates the (user, network) reads to the adapter.
    expect(privacyContextCalls).toContainEqual(['u1', 'n1']);
  });

  it('treats a user with no ACTIVE premises as not-yet-enriched', async () => {
    privacyContextCalls.length = 0;
    privacyContext = { user: { onboarding: null, isGhost: false }, network: { permissions: [] }, hasActivePremise: false };

    const decision = await callGate({ userId: 'u2', networkId: 'n1' });

    expect(decision.hasExistingProfile).toBe(false);
    // Not short-circuited; falls through to the policy decision.
    expect(decision.reason).not.toBe('existing_profile_no_public_enrichment_needed');
    expect(privacyContextCalls).toContainEqual(['u2', 'n1']);
  });

  it('short-circuits before any adapter read when the job has no network', async () => {
    privacyContextCalls.length = 0;
    privacyContext = { user: { onboarding: null, isGhost: false }, network: { permissions: [] }, hasActivePremise: true };

    const decision = await callGate({ userId: 'u3' });

    expect(decision.reason).toBe('no_network_policy');
    expect(privacyContextCalls).toHaveLength(0);
  });
});
