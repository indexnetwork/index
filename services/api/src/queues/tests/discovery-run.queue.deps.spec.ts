/** Runtime dependency and graph wiring for asynchronous MCP discovery runs. */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, describe, expect, it, mock } from 'bun:test';
import type { StampNewbornOpportunitiesFn } from '@indexnetwork/protocol';

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({
      add: async () => ({ id: 'job-1' }),
      getJob: async () => null,
      close: async () => undefined,
    }),
    createWorker: () => ({ close: async () => undefined }),
    createQueueEvents: () => ({ on: () => undefined, close: async () => undefined }),
  },
}));

const { createDiscoveryRunScopeGraphs, DiscoveryRunQueue } = await import('../opportunity/discovery-run.queue');

afterAll(() => {
  mock.restore();
});

describe('DiscoveryRunQueue runtime deps', () => {
  it('retains the newborn stamper supplied by main composition', () => {
    const stampNewbornOpportunities: StampNewbornOpportunitiesFn = async ({ items }) => items;
    const queue = new DiscoveryRunQueue();
    queue.setRuntimeDeps({ stampNewbornOpportunities });

    const deps = (queue as unknown as {
      deps?: { stampNewbornOpportunities?: StampNewbornOpportunitiesFn };
    }).deps;
    expect(deps?.stampNewbornOpportunities).toBe(stampNewbornOpportunities);
  });

  it('builds real scope graphs for background discovery membership resolution', async () => {
    const joinedAt = new Date('2026-07-18T00:00:00.000Z');
    const database = {
      getNetworkMemberships: async () => [
        { networkId: 'network-1', networkTitle: 'One', indexPrompt: null, autoAssign: true, isPersonal: false, joinedAt },
        { networkId: 'network-2', networkTitle: 'Two', indexPrompt: null, autoAssign: true, isPersonal: false, joinedAt },
        { networkId: 'network-3', networkTitle: 'Three', indexPrompt: null, autoAssign: true, isPersonal: true, joinedAt },
      ],
      getOwnedIndexes: async () => [],
      getPublicIndexesNotJoined: async () => ({ networks: [] }),
      isNetworkMember: async () => false,
    } as never;
    const graphs = createDiscoveryRunScopeGraphs(database);

    const indexResult = await graphs.index.invoke({
      userId: 'user-1',
      operationMode: 'read',
      showAll: true,
    });
    const membershipResult = await graphs.networkMembership.invoke({
      userId: 'user-1',
      networkId: 'network-denied',
      operationMode: 'read',
    });

    expect(indexResult.readResult?.memberOf.map((membership: { networkId: string }) => membership.networkId)).toEqual([
      'network-1',
      'network-2',
      'network-3',
    ]);
    expect(membershipResult.error).toBe('Network not found or you are not a member.');
  });
});
