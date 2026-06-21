import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

import { afterAll, describe, expect, it, mock } from 'bun:test';

const mockAdd = mock(async (name: string, data: unknown) => ({ id: 'job-1', name, data }));
const mockAddBulk = mock(async (jobs: Array<{ name: string; data: unknown }>) => jobs.map((job, index) => ({ id: `job-${index}`, name: job.name, data: job.data })));
const mockCreateWorker = mock(() => ({ close: async () => {} }));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd, addBulk: mockAddBulk, close: async () => {} }),
    createWorker: mockCreateWorker,
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));

mock.module('@indexnetwork/protocol', () => ({
  EnrichmentGraphFactory: class {
    createGraph() {
      return { invoke: async () => ({}) };
    }
  },
  PremiseGraphFactory: class {
    createGraph() {
      return { invoke: async () => ({}) };
    }
  },
  // enrichment.queue -> questioner.queue imports QuestionerAgent at module load.
  // The env-gated enqueue is never armed in these tests, so a stub class is enough
  // to satisfy the named import (the partial mock would otherwise fail to resolve it).
  QuestionerAgent: class {},
}));

const { EnrichmentQueue, QUEUE_NAME } = await import('../enrichment.queue');
type EnrichmentPrivacyDecision = import('../enrichment.queue').EnrichmentPrivacyDecision;

afterAll(() => {
  mock.restore();
});

const allow = (policy: EnrichmentPrivacyDecision['policy'] = 'auto'): EnrichmentPrivacyDecision => ({
  allowed: true,
  policy,
  reason: 'ok',
  hasExistingProfile: false,
});

const deny = (reason: string, policy: EnrichmentPrivacyDecision['policy'] = 'consent_required'): EnrichmentPrivacyDecision => ({
  allowed: false,
  policy,
  reason,
  hasExistingProfile: false,
});

describe('EnrichmentQueue', () => {
  it('enqueues ensure_profile_hyde with network context', async () => {
    const queue = new EnrichmentQueue({ checkPrivacy: async () => allow() });
    const data = { userId: 'u1', networkId: 'n1', reason: 'network_membership' };
    const job = await queue.addEnsureProfileHydeJob(data);
    expect(job.name).toBe('ensure_profile_hyde');
    expect(job.data).toEqual(data);
    expect(mockAdd).toHaveBeenCalledWith('ensure_profile_hyde', data, expect.any(Object));
  });

  it('skips enrich.user under consent_required without consent', async () => {
    const invokeEnrichUser = mock(async (_userId: string) => {});
    const onComplete = mock((_userId: string) => {});
    const queue = new EnrichmentQueue({
      invokeEnrichUser,
      checkPrivacy: async () => deny('public_profile_lookup_consent_missing'),
    });
    queue.onEnrichmentComplete = onComplete;

    await queue.processJob('enrich.user', { userId: 'u1', networkId: 'n1', reason: 'experiment_signup' });

    expect(invokeEnrichUser).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('runs enrich.user when consent_required policy is allowed', async () => {
    const invokeEnrichUser = mock(async (_userId: string) => {});
    const onComplete = mock((_userId: string) => {});
    const queue = new EnrichmentQueue({
      invokeEnrichUser,
      checkPrivacy: async () => allow('consent_required'),
    });
    queue.onEnrichmentComplete = onComplete;

    await queue.processJob('enrich.user', { userId: 'u1', networkId: 'n1', reason: 'experiment_signup' });

    expect(invokeEnrichUser).toHaveBeenCalledWith('u1');
    expect(onComplete).toHaveBeenCalledWith('u1');
  });

  it('skips ghost users under consent_required policy', async () => {
    const invokeEnrichUser = mock(async (_userId: string) => {});
    const queue = new EnrichmentQueue({
      invokeEnrichUser,
      checkPrivacy: async () => deny('ghost_user_cannot_consent'),
    });

    await queue.processJob('enrich.user', { userId: 'ghost', networkId: 'n1', reason: 'experiment_import' });

    expect(invokeEnrichUser).not.toHaveBeenCalled();
  });

  it('skips stale jobs when the scoped network is missing', async () => {
    const invokeEnrichUser = mock(async (_userId: string) => {});
    const queue = new EnrichmentQueue({
      invokeEnrichUser,
      checkPrivacy: async () => deny('network_not_found', 'disabled'),
    });

    await queue.processJob('enrich.user', { userId: 'u1', networkId: 'deleted-network', reason: 'experiment_import' });

    expect(invokeEnrichUser).not.toHaveBeenCalled();
  });

  it('skips ensure_profile_hyde for missing profile when policy denies', async () => {
    const invokeProfileWrite = mock(async (_userId: string) => {});
    const queue = new EnrichmentQueue({
      invokeProfileWrite,
      checkPrivacy: async () => deny('public_profile_lookup_consent_missing'),
    });

    await queue.processJob('ensure_profile_hyde', { userId: 'u1', networkId: 'n1', reason: 'network_membership' });

    expect(invokeProfileWrite).not.toHaveBeenCalled();
  });

  it('runs ensure_profile_hyde when helper allows existing profiles', async () => {
    const invokeProfileWrite = mock(async (_userId: string) => {});
    const queue = new EnrichmentQueue({
      invokeProfileWrite,
      checkPrivacy: async () => ({ ...allow('consent_required'), reason: 'existing_profile_no_public_enrichment_needed', hasExistingProfile: true }),
    });

    await queue.processJob('ensure_profile_hyde', { userId: 'u1', networkId: 'n1', reason: 'network_membership' });

    expect(invokeProfileWrite).toHaveBeenCalledWith('u1');
  });

  it('exposes queue name', () => {
    expect(EnrichmentQueue.QUEUE_NAME).toBe(QUEUE_NAME);
    expect(QUEUE_NAME).toBe('profile-hyde-queue');
  });
});
