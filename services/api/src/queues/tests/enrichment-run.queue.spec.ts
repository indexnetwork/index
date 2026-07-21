/**
 * Unit tests for EnrichmentRunQueue using constructor-injected queue, persistence,
 * execution, and reporting dependencies. No process-wide module mocks are used.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { EnrichmentRunQueue, QUEUE_NAME } from '../enrichment-run.queue';

const mockAdd = mock(async () => ({ id: 'profile-run-1', name: 'run_profile_tool', data: {} }));
const mockGetJob = mock(async () => null as { getState: () => Promise<string>; remove: () => Promise<void> } | null);
const mockCreateWorker = mock(() => ({ close: async () => {} }));
const mockQueueClose = mock(async () => {});

const markRunning = mock(async () => null as unknown);
const updateProgress = mock(async () => {});
const markSucceeded = mock(async () => {});
const markFailed = mock(async () => {});
const markCancelled = mock(async () => {});
const isCancelRequested = mock(async () => false);
const captureAppException = mock(() => {});

let registeredHandlers = new Map<
  string,
  (input: { context: unknown; query: unknown }) => Promise<string>
>();

type EnrichmentRunJobData = { runId: string };

type EnrichmentRunFixture = {
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

function runFixture(overrides: Partial<EnrichmentRunFixture> = {}): EnrichmentRunFixture {
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

function makeQueue(): EnrichmentRunQueue {
  return new EnrichmentRunQueue({
    queue: {
      add: mockAdd,
      getJob: mockGetJob,
      close: mockQueueClose,
    } as never,
    runs: {
      markRunning,
      updateProgress,
      markSucceeded,
      markFailed,
      markCancelled,
      isCancelRequested,
    } as never,
    executeRun: async (run) => {
      const handler = registeredHandlers.get(run.operation);
      if (!handler) throw new Error(`${run.operation} handler not available`);
      const raw = await handler({ context: { userId: run.userId }, query: run.input });
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },
    createWorker: mockCreateWorker as never,
    captureException: captureAppException,
  });
}

beforeEach(() => {
  mockAdd.mockClear();
  mockGetJob.mockReset();
  mockCreateWorker.mockReset();
  mockCreateWorker.mockImplementation(() => ({ close: async () => {} }));
  mockQueueClose.mockClear();
  markRunning.mockReset();
  updateProgress.mockClear();
  markSucceeded.mockClear();
  markFailed.mockClear();
  markCancelled.mockClear();
  isCancelRequested.mockReset();
  captureAppException.mockClear();
  registeredHandlers = new Map([
    ['preview_user_profile', mock(async () => JSON.stringify({ success: true, data: { draft: 'ok' } }))],
    ['update_user_profile', mock(async () => JSON.stringify({ success: true, data: { updated: true } }))],
  ]);
  markRunning.mockResolvedValue(runFixture());
  isCancelRequested.mockResolvedValue(false);
  mockGetJob.mockResolvedValue(null);
});

describe('EnrichmentRunQueue', () => {
  it('exposes QUEUE_NAME on class', () => {
    expect(EnrichmentRunQueue.QUEUE_NAME).toBe(QUEUE_NAME);
    expect(QUEUE_NAME).toBe('enrichment-tool-run');
  });

  it('enqueues profile runs with stable job id and single attempt', async () => {
    const job = await makeQueue().enqueue('profile-run-1');

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

    await expect(makeQueue().cancel('profile-run-1')).resolves.toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('does not remove active jobs during cancel', async () => {
    const remove = mock(async () => {});
    mockGetJob.mockResolvedValue({ getState: async () => 'active', remove });

    await expect(makeQueue().cancel('profile-run-1')).resolves.toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('unknown job name logs and does not touch run state', async () => {
    await makeQueue().processJob('unknown_job', { runId: 'profile-run-1' });
    expect(markRunning).not.toHaveBeenCalled();
  });

  it('run_profile_tool succeeds and stores parsed tool result', async () => {
    await makeQueue().processJob('run_profile_tool', { runId: 'profile-run-1' });

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

    await makeQueue().processJob('run_profile_tool', { runId: 'profile-run-1' });

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

    await makeQueue().processJob('run_profile_tool', { runId: 'profile-run-1' });

    expect(markCancelled).toHaveBeenCalledWith('profile-run-1', 'cancelled before start');
    expect(previewHandler).not.toHaveBeenCalled();
    expect(markSucceeded).not.toHaveBeenCalled();
  });

  it('marks failed, reports, and rethrows unexpected execution errors', async () => {
    const failure = new Error('profile boom');
    registeredHandlers.set('preview_user_profile', mock(async () => { throw failure; }));

    await expect(
      makeQueue().processJob('run_profile_tool', { runId: 'profile-run-1' }),
    ).rejects.toThrow('profile boom');

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
    let capturedProcessor: ((job: {
      id: string;
      name: string;
      data: EnrichmentRunJobData;
    }) => Promise<void>) | null = null;
    mockCreateWorker.mockImplementation((_name: string, processor: (job: unknown) => Promise<void>) => {
      capturedProcessor = processor as typeof capturedProcessor;
      return { close: async () => {} };
    });

    const queue = makeQueue();
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
