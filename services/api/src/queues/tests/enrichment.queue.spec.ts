import { describe, expect, it, mock } from 'bun:test';

import type { EnrichmentAdmissionDecision, EnrichmentQueueDeps } from '../enrichment.queue';

// Keep this injected-dependency queue spec hermetic even though the production
// queue module imports the default database adapter.
const savedEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  API_TEST_ISOLATED_CHILD: process.env.API_TEST_ISOLATED_CHILD,
  API_TEST_DATABASE_READY: process.env.API_TEST_DATABASE_READY,
  API_TEST_PARENT_PID: process.env.API_TEST_PARENT_PID,
};
process.env.DATABASE_URL ||= 'postgres://stub:stub@localhost:5432/stub';
process.env.API_TEST_ISOLATED_CHILD = '1';
process.env.API_TEST_DATABASE_READY = '1';
process.env.API_TEST_PARENT_PID = String(process.ppid);

const { EnrichmentQueue, QUEUE_NAME } = await import('../enrichment.queue.js');

for (const [key, value] of Object.entries(savedEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const mockAdd = mock(async (name: string, data: unknown) => ({ id: 'job-1', name, data }));
const mockAddBulk = mock(async (jobs: Array<{ name: string; data: unknown }>) =>
  jobs.map((job, index) => ({ id: `job-${index}`, name: job.name, data: job.data }))
);
const queue = {
  add: mockAdd,
  addBulk: mockAddBulk,
  close: async () => {},
};

function createQueue(deps: EnrichmentQueueDeps = {}): InstanceType<typeof EnrichmentQueue> {
  return new EnrichmentQueue({ queue: queue as never, ...deps });
}

const allow = (): EnrichmentAdmissionDecision => ({
  allowed: true,
  reason: 'ok',
  hasExistingProfile: false,
});

const deny = (reason: string): EnrichmentAdmissionDecision => ({
  allowed: false,
  reason,
  hasExistingProfile: false,
});

describe('EnrichmentQueue', () => {
  it('enqueues ensure_profile_hyde with network context', async () => {
    const queue = createQueue({ checkAdmission: async () => allow() });
    const data = { userId: 'u1', networkId: 'n1', reason: 'network_membership' };
    const job = await queue.addEnsureProfileHydeJob(data);
    expect(job.name).toBe('ensure_profile_hyde');
    expect(job.data).toEqual(data);
    expect(mockAdd).toHaveBeenCalledWith('ensure_profile_hyde', data, expect.any(Object));
  });

  it('skips enrich.user when the admission check denies enrichment', async () => {
    const invokeEnrichUser = mock(async (_userId: string) => {});
    const onComplete = mock((_userId: string) => {});
    const queue = createQueue({
      invokeEnrichUser,
      checkAdmission: async () => deny('user_not_found'),
    });
    queue.onEnrichmentComplete = onComplete;

    await queue.processJob('enrich.user', { userId: 'u1', networkId: 'n1', reason: 'experiment_signup' });

    expect(invokeEnrichUser).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('runs enrich.user when the admission check allows enrichment', async () => {
    const invokeEnrichUser = mock(async (_userId: string) => {});
    const onComplete = mock((_userId: string) => {});
    const queue = createQueue({
      invokeEnrichUser,
      checkAdmission: async () => allow(),
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
      checkAdmission: async () => deny('network_not_found'),
    });

    await queue.processJob('enrich.user', { userId: 'u1', networkId: 'deleted-network', reason: 'experiment_import' });

    expect(invokeEnrichUser).not.toHaveBeenCalled();
  });

  it('skips ensure_profile_hyde when the admission check denies', async () => {
    const invokeProfileWrite = mock(async (_userId: string) => {});
    const queue = createQueue({
      invokeProfileWrite,
      checkAdmission: async () => deny('user_not_found'),
    });

    await queue.processJob('ensure_profile_hyde', { userId: 'u1', networkId: 'n1', reason: 'network_membership' });

    expect(invokeProfileWrite).not.toHaveBeenCalled();
  });

  it('runs ensure_profile_hyde when helper allows existing profiles', async () => {
    const invokeProfileWrite = mock(async (_userId: string) => {});
    const queue = createQueue({
      invokeProfileWrite,
      checkAdmission: async () => ({ ...allow(), reason: 'existing_profile_no_public_enrichment_needed', hasExistingProfile: true }),
    });

    await queue.processJob('ensure_profile_hyde', { userId: 'u1', networkId: 'n1', reason: 'network_membership' });

    expect(invokeProfileWrite).toHaveBeenCalledWith('u1');
  });

  it('exposes queue name', () => {
    expect(EnrichmentQueue.QUEUE_NAME).toBe(QUEUE_NAME);
    expect(QUEUE_NAME).toBe('profile-hyde-queue');
  });
});
