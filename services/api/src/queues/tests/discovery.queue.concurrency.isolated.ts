/**
 * DiscoveryQueue worker concurrency and the same-intent overlap guard.
 *
 * Unlike discovery.queue.isolated.ts this keeps the real QueueFactory (the
 * hermetic in-memory broker under the test baseline) so jobs travel
 * add → worker → processor → lock exactly as in production; only the DB,
 * embedder, and the discovery graph are stood in for.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, describe, expect, it, mock } from 'bun:test';

mock.module('../../adapters/database.adapter', () => ({
  ChatDatabaseAdapter: class ChatDatabaseAdapter {},
  chatDatabaseAdapter: {},
}));
mock.module('../../adapters/embedder.adapter', () => ({
  EmbedderAdapter: class EmbedderAdapter {},
  embedderAdapter: {},
}));
mock.module('../pool/negotiation-evidence.shadow', () => ({
  maybeRunNegotiationEvidenceShadow: async () => {},
}));
mock.module('../questioner/recovery.shared', () => ({
  maybeEnqueueIntentRecovery: async () => {},
}));

afterAll(() => {
  mock.restore();
});

import type { DiscoveryDatabase, DiscoveryGraphInvokeOptions } from '../opportunity/discovery.queue';

const { DiscoveryQueue } = await import('../opportunity/discovery.queue');
const { DISCOVERY_WORKER_CONCURRENCY } = await import('../opportunity/discovery.shared');

const database: DiscoveryDatabase = {
  getIntentForIndexing: async (id: string) => ({ id, payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
  getNetworkIdsForIntent: async () => ['idx1'],
  getAssignmentNetworkMembershipsForUser: async () => [{ networkId: 'idx1', isPersonal: false }],
  markIntentFirstDiscoverySucceeded: async () => {},
  recordIntentDiscoveryProgress: async () => {},
};

/**
 * A graph stand-in that parks every invocation on a gate so the test controls
 * when each scan "finishes", and records how many scans were in flight at once.
 */
function gatedGraph() {
  let active = 0;
  let peakActive = 0;
  const started: string[] = [];
  const releases: Array<() => void> = [];
  const invoke = async (opts: DiscoveryGraphInvokeOptions) => {
    active += 1;
    peakActive = Math.max(peakActive, active);
    started.push(opts.triggerIntentId ?? '?');
    await new Promise<void>((resolve) => releases.push(resolve));
    active -= 1;
  };
  const waitForStarted = async (count: number) => {
    for (let index = 0; index < 200 && started.length < count; index += 1) await Bun.sleep(5);
    return started.length;
  };
  return {
    invoke,
    started,
    releases,
    waitForStarted,
    peak: () => peakActive,
    releaseAll: () => { for (const release of releases.splice(0)) release(); },
  };
}

describe('DiscoveryQueue worker concurrency', () => {
  it('runs jobs for different intents side by side', async () => {
    expect(DISCOVERY_WORKER_CONCURRENCY).toBeGreaterThan(1);
    const graph = gatedGraph();
    const queue = new DiscoveryQueue({ database, invokeOpportunityGraph: graph.invoke });
    queue.startWorker();

    await queue.addJob({ intentId: 'intent-a', userId: 'u1' });
    await queue.addJob({ intentId: 'intent-b', userId: 'u1' });

    expect(await graph.waitForStarted(2)).toBe(2);
    // Both scans are parked on the gate at the same time: no serialization.
    expect(graph.peak()).toBe(2);
    graph.releaseAll();
    await Bun.sleep(10);
    await queue.close();
  });

  it('defers a second job for an intent whose scan is still running, then runs it', async () => {
    const graph = gatedGraph();
    const queue = new DiscoveryQueue({
      database,
      invokeOpportunityGraph: graph.invoke,
      sameIntentDeferDelayMs: 10,
    });
    queue.startWorker();

    const first = await queue.addJob({ intentId: 'intent-same', userId: 'u1' });
    expect(await graph.waitForStarted(1)).toBe(1);
    // Arrives while the first scan is in flight; worker concurrency would
    // otherwise start it immediately.
    const second = await queue.addJob({ intentId: 'intent-same', userId: 'u1' });
    expect(second.id).not.toBe(first.id);

    // The guard trips: the second job finishes without scanning and a delayed
    // re-check is queued in its place.
    await Bun.sleep(30);
    expect(graph.started).toEqual(['intent-same']);
    expect(graph.peak()).toBe(1);
    expect(await second.getState()).toBe('completed');
    const counts = await queue.queue.getJobCounts('delayed', 'waiting', 'active');
    expect(counts.delayed + counts.waiting + counts.active).toBeGreaterThanOrEqual(1);

    // Once the first scan releases the lock, the deferred job gets its turn —
    // and never overlapped with the first.
    graph.releaseAll();
    expect(await graph.waitForStarted(2)).toBe(2);
    expect(graph.started).toEqual(['intent-same', 'intent-same']);
    expect(graph.peak()).toBe(1);
    graph.releaseAll();
    await Bun.sleep(10);
    await queue.close();
  });
});
