/**
 * Unit tests for EnrichmentRunQueue. Mocks DB/Redis/protocol deps so the queue
 * lifecycle can be verified without BullMQ, Postgres, or model credentials.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.OPENROUTER_API_KEY ??= 'test-openrouter-key';

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const mockAdd = mock(async () => ({ id: 'profile-run-1', name: 'run_profile_tool', data: {} }));
const mockGetJob = mock(async () => null as { getState: () => Promise<string>; remove: () => Promise<void> } | null);
const mockCreateWorker = mock(() => ({ close: async () => {} }));
const mockQueueClose = mock(async () => {});

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd, getJob: mockGetJob, close: mockQueueClose }),
    createWorker: mockCreateWorker,
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));

const markRunning = mock(async () => null as unknown);
const updateProgress = mock(async () => {});
const markSucceeded = mock(async () => {});
const markFailed = mock(async () => {});
const markCancelled = mock(async () => {});
const isCancelRequested = mock(async () => false);

mock.module('../../adapters/enrichment-run.adapter', () => ({
  enrichmentRunAdapter: {
    markRunning,
    updateProgress,
    markSucceeded,
    markFailed,
    markCancelled,
    isCancelRequested,
  },
}));

const captureAppException = mock(() => {});
mock.module('../../lib/sentry', () => ({ captureAppException }));

mock.module('../../adapters/database.adapter', () => ({
  chatDatabaseAdapter: {},
  createUserDatabase: () => ({}),
  createSystemDatabase: () => ({}),
}));
mock.module('../../adapters/embedder.adapter', () => ({ embedderAdapter: {} }));
mock.module('../../adapters/cache.adapter', () => ({ cacheAdapter: {} }));
mock.module('../../adapters/scraper.adapter', () => ({ scraperAdapter: {} }));
mock.module('../../adapters/enricher.adapter', () => ({ enricherAdapter: {} }));

let registeredHandlers = new Map<string, (input: { context: unknown; query: unknown }) => Promise<string>>();
const mockResolveChatContext = mock(async () => ({
  userId: 'user-1',
  userName: 'Test User',
  userEmail: 'test@example.com',
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  userProfile: null,
  userNetworks: [],
  indexScope: ['net-1'],
  isOnboarding: false,
  hasName: true,
}));

mock.module('@indexnetwork/protocol', () => ({
  PremiseGraphFactory: class { createGraph() { return { invoke: async () => ({}) }; } },
  EnrichmentGraphFactory: class { createGraph() { return { invoke: async () => ({}) }; } },
  createEnrichmentTools: (defineTool: (def: { name: string; handler: (input: { context: unknown; query: unknown }) => Promise<string> }) => unknown) => {
    for (const [name, handler] of registeredHandlers) {
      defineTool({ name, handler });
    }
  },
  deriveAllowedNetworkIds: ({ memberships }: { memberships: Array<{ networkId: string }> }) => memberships.map((m) => m.networkId),
  getToolTimeoutPolicy: () => ({ maxOutputBytes: 1_000_000 }),
  requestContext: { run: async (_ctx: unknown, fn: () => Promise<unknown>) => fn() },
  resolveChatContext: mockResolveChatContext,
  // enrichment-run.queue -> questioner.queue imports QuestionerAgent at module load.
  // Never instantiated here (env-gated enqueue stays off), so a stub class satisfies
  // the named import that the partial protocol mock would otherwise drop.
  QuestionerAgent: class {},
}));

const { EnrichmentRunQueue, QUEUE_NAME } = await import('../enrichment-run.queue');

type EnrichmentRunJobData = { runId: string };

type ProfileRunFixture = {
  id: string;
  userId: string;
  agentId: string | null;
  operation: 'preview_user_profile' | 'update_user_profile';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  input: Record<string, unknown>;
  context: {
    userId: string;
    userName: string;
    userEmail: string;
    scopeType?: 'network';
    scopeId?: string;
    sessionId?: string;
    clientSurface?: 'telegram' | 'web';
  };
  createdAt: Date;
};

function runFixture(overrides: Partial<ProfileRunFixture> = {}): ProfileRunFixture {
  return {
    id: 'profile-run-1',
    userId: 'user-1',
    agentId: 'agent-1',
    operation: 'preview_user_profile',
    status: 'running',
    input: { bioOrDescription: 'Builder' },
    context: {
      userId: 'user-1',
      userName: 'Test User',
      userEmail: 'test@example.com',
      scopeType: 'network',
      scopeId: 'net-1',
      clientSurface: 'telegram',
    },
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  mockAdd.mockClear();
  mockGetJob.mockClear();
  mockCreateWorker.mockClear();
  mockQueueClose.mockClear();
  markRunning.mockReset();
  updateProgress.mockClear();
  markSucceeded.mockClear();
  markFailed.mockClear();
  markCancelled.mockClear();
  isCancelRequested.mockReset();
  captureAppException.mockClear();
  mockResolveChatContext.mockClear();
  registeredHandlers = new Map([
    ['preview_user_profile', mock(async () => JSON.stringify({ success: true, data: { draft: 'ok' } }))],
    ['update_user_profile', mock(async () => JSON.stringify({ success: true, data: { updated: true } }))],
  ]);
  markRunning.mockResolvedValue(runFixture());
  isCancelRequested.mockResolvedValue(false);
});

afterAll(() => {
  mock.restore();
});

describe('EnrichmentRunQueue', () => {
  it('exposes QUEUE_NAME on class', () => {
    expect(EnrichmentRunQueue.QUEUE_NAME).toBe(QUEUE_NAME);
    expect(QUEUE_NAME).toBe('enrichment-tool-run');
  });

  it('enqueues profile runs with stable job id and single attempt', async () => {
    const queue = new EnrichmentRunQueue();
    const job = await queue.enqueue('profile-run-1');

    expect(job.jobId).toBe('profile-run-1');
    expect(mockAdd).toHaveBeenCalledWith(
      'run_profile_tool',
      { runId: 'profile-run-1' },
      expect.objectContaining({
        attempts: 1,
        jobId: 'profile-run-1',
        priority: 10,
        removeOnComplete: { age: 24 * 60 * 60 },
        removeOnFail: { age: 24 * 60 * 60 },
      }),
    );
  });

  it('cancels waiting BullMQ jobs by removing them', async () => {
    const remove = mock(async () => {});
    mockGetJob.mockResolvedValue({ getState: async () => 'waiting', remove });

    const queue = new EnrichmentRunQueue();
    await expect(queue.cancel('profile-run-1')).resolves.toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('does not remove active jobs during cancel', async () => {
    const remove = mock(async () => {});
    mockGetJob.mockResolvedValue({ getState: async () => 'active', remove });

    const queue = new EnrichmentRunQueue();
    await expect(queue.cancel('profile-run-1')).resolves.toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('unknown job name logs and does not touch run state', async () => {
    const queue = new EnrichmentRunQueue();
    await queue.processJob('unknown_job', { runId: 'profile-run-1' });
    expect(markRunning).not.toHaveBeenCalled();
  });

  it('run_profile_tool succeeds and stores parsed tool result', async () => {
    const queue = new EnrichmentRunQueue();
    await queue.processJob('run_profile_tool', { runId: 'profile-run-1' });

    expect(markRunning).toHaveBeenCalledWith('profile-run-1');
    expect(updateProgress).toHaveBeenCalledWith('profile-run-1', {
      stage: 'running',
      operation: 'preview_user_profile',
    });
    expect(markSucceeded).toHaveBeenCalledWith('profile-run-1', {
      success: true,
      data: { draft: 'ok' },
    });
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('passes update_user_profile operation to the registered handler', async () => {
    const updateHandler = mock(async () => JSON.stringify({ success: true, data: { updated: true } }));
    registeredHandlers.set('update_user_profile', updateHandler);
    markRunning.mockResolvedValue(runFixture({
      operation: 'update_user_profile',
      input: { action: 'set location', details: 'Berlin' },
    }));

    const queue = new EnrichmentRunQueue();
    await queue.processJob('run_profile_tool', { runId: 'profile-run-1' });

    expect(updateHandler).toHaveBeenCalledWith(expect.objectContaining({
      query: { action: 'set location', details: 'Berlin' },
    }));
    expect(markSucceeded).toHaveBeenCalledWith('profile-run-1', {
      success: true,
      data: { updated: true },
    });
  });

  it('marks cancellation before start without executing handlers', async () => {
    const previewHandler = registeredHandlers.get('preview_user_profile') as ReturnType<typeof mock>;
    isCancelRequested.mockResolvedValueOnce(true);

    const queue = new EnrichmentRunQueue();
    await queue.processJob('run_profile_tool', { runId: 'profile-run-1' });

    expect(markCancelled).toHaveBeenCalledWith('profile-run-1', 'cancelled before start');
    expect(previewHandler).not.toHaveBeenCalled();
    expect(markSucceeded).not.toHaveBeenCalled();
  });

  it('marks failed, reports, and rethrows unexpected execution errors', async () => {
    const failure = new Error('profile boom');
    registeredHandlers.set('preview_user_profile', mock(async () => { throw failure; }));

    const queue = new EnrichmentRunQueue();
    await expect(queue.processJob('run_profile_tool', { runId: 'profile-run-1' })).rejects.toThrow('profile boom');

    expect(markFailed).toHaveBeenCalledWith('profile-run-1', 'profile boom');
    expect(captureAppException).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        operation: 'enrichment-run.queue',
        userId: 'user-1',
      }),
    );
  });

  it('worker processor delegates to processJob', async () => {
    let capturedProcessor: ((job: { id: string; name: string; data: EnrichmentRunJobData }) => Promise<void>) | null = null;
    mockCreateWorker.mockImplementation((_name: string, processor: (job: unknown) => Promise<void>) => {
      capturedProcessor = processor as (job: { id: string; name: string; data: EnrichmentRunJobData }) => Promise<void>;
      return { close: async () => {} };
    });

    const queue = new EnrichmentRunQueue();
    queue.startWorker();
    expect(capturedProcessor).not.toBeNull();

    await capturedProcessor!({
      id: 'job-1',
      name: 'run_profile_tool',
      data: { runId: 'profile-run-1' },
    });
    expect(markSucceeded).toHaveBeenCalled();
  });
});
