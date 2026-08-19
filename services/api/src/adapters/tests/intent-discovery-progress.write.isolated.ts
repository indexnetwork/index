/**
 * The owner-visible discovery-progress row is the radar warmup card's only
 * durable source. Two properties of the upsert are load-bearing rather than
 * cosmetic:
 *
 *  - a boundary that knows a tally writes it into both the insert values and
 *    the conflict `set`, so a re-run of the same intent updates the stored
 *    counts instead of leaving the first run's numbers on screen forever;
 *  - a boundary that does NOT know a tally (queued/running, or the injected
 *    graph path that returns no summary) omits the column entirely, so it can
 *    never overwrite a real count with a zero the worker never measured.
 *
 * Hermetic: the drizzle client is replaced with a recorder, so this asserts the
 * exact statement shape without a database.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

interface CapturedWrite {
  values: Record<string, unknown>;
  set: Record<string, unknown>;
}

const captured: CapturedWrite[] = [];

const recorderDb = {
  insert: () => ({
    values: (values: Record<string, unknown>) => ({
      onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
        captured.push({ values, set });
        return Promise.resolve();
      },
    }),
  }),
};

mock.module('../../lib/drizzle/drizzle', () => ({ default: recorderDb, db: recorderDb }));

afterAll(() => {
  mock.restore();
});

const { ChatDatabaseAdapter } = await import('../chat.database.adapter');

const adapter = new ChatDatabaseAdapter();
const base = { intentId: 'intent-1', userId: 'user-1', attempt: 1 } as const;

const only = (): CapturedWrite => {
  expect(captured).toHaveLength(1);
  return captured[0]!;
};

describe('recordIntentDiscoveryProgress', () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it('writes the run tallies on both sides of the upsert', async () => {
    await adapter.recordIntentDiscoveryProgress({
      ...base,
      status: 'succeeded',
      assignedCommunityCount: 4,
      processedCommunityCount: 4,
      possibleOverlapCount: 11,
      conversationsStartedCount: 2,
    });

    const write = only();
    const tallies = {
      assignedCommunityCount: 4,
      processedCommunityCount: 4,
      possibleOverlapCount: 11,
      conversationsStartedCount: 2,
    };
    expect(write.values).toMatchObject({ ...base, status: 'succeeded', ...tallies });
    expect(write.set).toMatchObject({ status: 'succeeded', attempt: 1, ...tallies });
    // A success closes the run; the card reads completedAt to timestamp its
    // last log line.
    expect(write.values.completedAt).toBeInstanceOf(Date);
    expect(write.set.completedAt).toBeInstanceOf(Date);
  });

  it('records an honest zero-result run rather than treating it as unknown', async () => {
    await adapter.recordIntentDiscoveryProgress({
      ...base,
      status: 'succeeded',
      assignedCommunityCount: 4,
      processedCommunityCount: 4,
      possibleOverlapCount: 0,
      conversationsStartedCount: 0,
    });

    const write = only();
    expect(write.values).toMatchObject({ possibleOverlapCount: 0, conversationsStartedCount: 0 });
    expect(write.set).toMatchObject({ possibleOverlapCount: 0, conversationsStartedCount: 0 });
  });

  it('omits every unknown tally instead of zeroing it', async () => {
    await adapter.recordIntentDiscoveryProgress({ ...base, status: 'running', assignedCommunityCount: 4 });

    const write = only();
    for (const side of [write.values, write.set]) {
      expect(side).toHaveProperty('assignedCommunityCount', 4);
      expect(side).not.toHaveProperty('processedCommunityCount');
      expect(side).not.toHaveProperty('possibleOverlapCount');
      expect(side).not.toHaveProperty('conversationsStartedCount');
    }
    expect(write.values.startedAt).toBeInstanceOf(Date);
  });

  it('leaves the blocked boundary free of tallies and starts no run', async () => {
    await adapter.recordIntentDiscoveryProgress({
      ...base, status: 'blocked', attempt: 0, assignedCommunityCount: 0,
    });

    const write = only();
    expect(write.set).toMatchObject({ status: 'blocked', attempt: 0, assignedCommunityCount: 0 });
    expect(write.set).not.toHaveProperty('possibleOverlapCount');
    expect(write.set).not.toHaveProperty('startedAt');
    expect(write.set.completedAt).toBeInstanceOf(Date);
  });

  it('clears the previous run stamps when the intent is re-queued', async () => {
    await adapter.recordIntentDiscoveryProgress({ ...base, status: 'queued', attempt: 0 });

    const write = only();
    expect(write.set).toMatchObject({ startedAt: null, completedAt: null });
    expect(write.set.queuedAt).toBeInstanceOf(Date);
    // Re-queuing knows nothing yet, so the last run's counts must survive
    // until the new run reports its own.
    expect(write.set).not.toHaveProperty('possibleOverlapCount');
  });
});
