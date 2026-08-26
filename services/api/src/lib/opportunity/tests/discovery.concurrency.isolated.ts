/**
 * IntentDiscovery same-intent overlap guard and concurrent scans.
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
mock.module('../../negotiation/negotiation-evidence.shadow', () => ({
  maybeRunNegotiationEvidenceShadow: async () => {},
}));

afterAll(() => {
  mock.restore();
});

import type { FromIntentDatabase, FromIntentGraphInvokeOptions } from '../discovery';

const { IntentDiscovery } = await import('../discovery');

const database: FromIntentDatabase = {
  getIntentForIndexing: async (id: string) => ({ id, payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
  getNetworkIdsForIntent: async () => ['idx1'],
  getAssignmentNetworkMembershipsForUser: async () => [{ networkId: 'idx1', isPersonal: false }],
  markIntentFirstDiscoverySucceeded: async () => {},
  recordIntentDiscoveryProgress: async () => {},
};

function gatedGraph() {
  let active = 0;
  let peakActive = 0;
  const started: string[] = [];
  const releases: Array<() => void> = [];
  const invoke = async (opts: FromIntentGraphInvokeOptions) => {
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

describe('IntentDiscovery concurrency', () => {
  it('runs jobs for different intents side by side', async () => {
    const graph = gatedGraph();
    const discovery = new IntentDiscovery({ database, invokeOpportunityGraph: graph.invoke });

    void discovery.addJob({ intentId: 'intent-a', userId: 'u1' });
    void discovery.addJob({ intentId: 'intent-b', userId: 'u1' });

    expect(await graph.waitForStarted(2)).toBe(2);
    expect(graph.peak()).toBe(2);
    graph.releaseAll();
    await Bun.sleep(10);
  });

  it('defers a second run for an intent whose scan is still running, then runs it', async () => {
    const graph = gatedGraph();
    const discovery = new IntentDiscovery({
      database,
      invokeOpportunityGraph: graph.invoke,
      sameIntentDeferDelayMs: 10,
    });

    void discovery.addJob({ intentId: 'intent-same', userId: 'u1' });
    expect(await graph.waitForStarted(1)).toBe(1);
    void discovery.addJob({ intentId: 'intent-same', userId: 'u1' });

    await Bun.sleep(30);
    expect(graph.started).toEqual(['intent-same']);
    expect(graph.peak()).toBe(1);

    graph.releaseAll();
    expect(await graph.waitForStarted(2)).toBe(2);
    expect(graph.started).toEqual(['intent-same', 'intent-same']);
    expect(graph.peak()).toBe(1);
    graph.releaseAll();
    await Bun.sleep(10);
  });
});
