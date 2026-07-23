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

let currentRun: unknown = null;
const completionOrder: string[] = [];
mock.module('../../adapters/discovery-run.adapter', () => ({
  discoveryRunAdapter: {
    markRunning: async () => currentRun,
    isCancelRequested: async () => false,
    markCancelled: async () => undefined,
    updateProgress: async () => undefined,
    markSucceeded: async () => { completionOrder.push('succeeded'); },
    markFailed: async () => undefined,
  },
}));

const {
  createDiscoveryRunScopeGraphs,
  DiscoveryRunQueue,
  resolveDiscoveryRunRecoveryIntentId,
} = await import('../opportunity/discovery-run.queue');

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

  it('resolves exact intent provenance and fails closed for ad-hoc or introducer-only runs', () => {
    const base = { context: { scopeType: 'network', scopeId: 'network-1' }, input: {} } as never;
    expect(resolveDiscoveryRunRecoveryIntentId(base)).toBeNull();
    expect(resolveDiscoveryRunRecoveryIntentId({
      context: { scopeType: 'network', scopeId: 'network-1' }, input: { intentId: 'input-intent' },
    } as never)).toBe('input-intent');
    expect(resolveDiscoveryRunRecoveryIntentId({
      context: { scopeType: 'intent', scopeId: 'scope-intent' }, input: { intentId: 'input-intent' },
    } as never)).toBe('scope-intent');
    expect(resolveDiscoveryRunRecoveryIntentId({
      context: { scopeType: 'intent' }, input: { intentId: 'input-intent' },
    } as never)).toBeNull();
    expect(resolveDiscoveryRunRecoveryIntentId({
      context: { scopeType: 'intent', scopeId: 'scope-intent' },
      input: { intentId: 'input-intent', introTargetUserId: 'target' },
    } as never)).toBeNull();
  });

  it('calls recovery only after success is durably marked and carries authoritative scope intent', async () => {
    completionOrder.length = 0;
    currentRun = {
      id: 'run-1', userId: 'user-1', agentId: null,
      context: { scopeType: 'intent', scopeId: 'scope-intent' },
      input: { intentId: 'input-intent' },
    };
    const recoverAfterCompletion = mock(async () => { completionOrder.push('recovery'); });
    const queue = new DiscoveryRunQueue();
    queue.setRuntimeDeps({ recoverAfterCompletion });
    (queue as unknown as { executeRun: () => Promise<unknown> }).executeRun = async () => {
      completionOrder.push('execute');
      return { ok: true };
    };

    await queue.processJob('run_discovery', { runId: 'run-1' });
    expect(recoverAfterCompletion).toHaveBeenCalledWith({
      source: 'discovery_run', recipientUserId: 'user-1', intentId: 'scope-intent', runId: 'run-1',
    });
    expect(completionOrder).toEqual(['execute', 'succeeded', 'recovery']);
  });

  it('does not call recovery when execution fails before durable success', async () => {
    completionOrder.length = 0;
    currentRun = {
      id: 'run-failed', userId: 'user-1', agentId: null,
      context: { scopeType: 'intent', scopeId: 'scope-intent' }, input: { intentId: 'scope-intent' },
    };
    const recoverAfterCompletion = mock(async () => {});
    const queue = new DiscoveryRunQueue();
    queue.setRuntimeDeps({ recoverAfterCompletion });
    (queue as unknown as { executeRun: () => Promise<unknown> }).executeRun = async () => {
      throw new Error('discovery failed');
    };
    await expect(queue.processJob('run_discovery', { runId: 'run-failed' })).rejects.toThrow('discovery failed');
    expect(recoverAfterCompletion).not.toHaveBeenCalled();
    expect(completionOrder).not.toContain('succeeded');
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
