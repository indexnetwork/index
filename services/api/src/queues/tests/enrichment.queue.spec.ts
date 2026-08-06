import { describe, expect, it, mock } from 'bun:test';

import { EnrichmentQueue, QUEUE_NAME, type EnrichmentPrivacyDecision, type EnrichmentQueueDeps } from '../enrichment.queue';

const mockAdd = mock(async (name: string, data: unknown) => ({ id: 'job-1', name, data }));
const mockAddBulk = mock(async (jobs: Array<{ name: string; data: unknown }>) =>
  jobs.map((job, index) => ({ id: `job-${index}`, name: job.name, data: job.data }))
);
const queue = {
  add: mockAdd,
  addBulk: mockAddBulk,
  close: async () => {},
};

function createQueue(deps: EnrichmentQueueDeps = {}): EnrichmentQueue {
  return new EnrichmentQueue({ queue: queue as never, ...deps });
}

const allow = (): EnrichmentPrivacyDecision => ({
  allowed: true,
  reason: 'ok',
  hasExistingProfile: false,
});

const deny = (reason: string): EnrichmentPrivacyDecision => ({
  allowed: false,
  reason,
  hasExistingProfile: false,
});

describe('EnrichmentQueue', () => {
  it('enqueues ensure_profile_hyde with network context', async () => {
    const queue = createQueue({ checkPrivacy: async () => allow() });
    const data = { userId: 'u1', networkId: 'n1', reason: 'network_membership' };
    const job = await queue.addEnsureProfileHydeJob(data);
    expect(job.name).toBe('ensure_profile_hyde');
    expect(job.data).toEqual(data);
    expect(mockAdd).toHaveBeenCalledWith('ensure_profile_hyde', data, expect.any(Object));
  });

  it('skips enrich.user when the privacy check denies enrichment', async () => {
    const invokeEnrichUser = mock(async (_userId: string) => {});
    const onComplete = mock((_userId: string) => {});
    const queue = createQueue({
      invokeEnrichUser,
      checkPrivacy: async () => deny('user_not_found'),
    });
    queue.onEnrichmentComplete = onComplete;

    await queue.processJob('enrich.user', { userId: 'u1', networkId: 'n1', reason: 'experiment_signup' });

    expect(invokeEnrichUser).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('runs enrich.user when the privacy check allows enrichment', async () => {
    const invokeEnrichUser = mock(async (_userId: string) => {});
    const onComplete = mock((_userId: string) => {});
    const queue = createQueue({
      invokeEnrichUser,
      checkPrivacy: async () => allow(),
    });
    queue.onEnrichmentComplete = onComplete;

    await queue.processJob('enrich.user', { userId: 'u1', networkId: 'n1', reason: 'experiment_signup' });

    expect(invokeEnrichUser).toHaveBeenCalledWith('u1');
    expect(onComplete).toHaveBeenCalledWith('u1');
  });

  it('skips stale jobs when the scoped network is missing', async () => {
    const invokeEnrichUser = mock(async (_userId: string) => {});
    const queue = createQueue({
      invokeEnrichUser,
      checkPrivacy: async () => deny('network_not_found'),
    });

    await queue.processJob('enrich.user', { userId: 'u1', networkId: 'deleted-network', reason: 'experiment_import' });

    expect(invokeEnrichUser).not.toHaveBeenCalled();
  });

  it('skips ensure_profile_hyde when the privacy check denies', async () => {
    const invokeProfileWrite = mock(async (_userId: string) => {});
    const queue = createQueue({
      invokeProfileWrite,
      checkPrivacy: async () => deny('user_not_found'),
    });

    await queue.processJob('ensure_profile_hyde', { userId: 'u1', networkId: 'n1', reason: 'network_membership' });

    expect(invokeProfileWrite).not.toHaveBeenCalled();
  });

  it('runs ensure_profile_hyde when helper allows existing profiles', async () => {
    const invokeProfileWrite = mock(async (_userId: string) => {});
    const queue = createQueue({
      invokeProfileWrite,
      checkPrivacy: async () => ({ ...allow(), reason: 'existing_profile_no_public_enrichment_needed', hasExistingProfile: true }),
    });

    await queue.processJob('ensure_profile_hyde', { userId: 'u1', networkId: 'n1', reason: 'network_membership' });

    expect(invokeProfileWrite).toHaveBeenCalledWith('u1');
  });

  it('exposes queue name', () => {
    expect(EnrichmentQueue.QUEUE_NAME).toBe(QUEUE_NAME);
    expect(QUEUE_NAME).toBe('profile-hyde-queue');
  });
});
