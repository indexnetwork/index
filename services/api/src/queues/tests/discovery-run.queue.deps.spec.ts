/** Runtime dependency propagation for asynchronous MCP discovery runs. */
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

import { DiscoveryRunQueue } from '../opportunity/discovery-run.queue';

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
});
