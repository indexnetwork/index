import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.OPENROUTER_API_KEY ??= 'test';

import { describe, test, expect } from 'bun:test';

import { createOpportunityTools } from '../opportunity.tools.js';
import type { ToolDeps, ResolvedToolContext } from '../../shared/agent/tool.helpers.js';
import type { DiscoveryRunRecord } from '../../shared/interfaces/discovery-run.interface.js';

/**
 * IND-608 — discovery-run ownership at the tool/handler seam (DB-free).
 *
 * get_discovery_run and cancel_discovery_run must always scope the store lookup
 * to the authenticated caller (`context.userId`). A run owned by another user is
 * invisible ("not found") and never cancellable, and every store access records
 * the caller userId so ownership cannot be bypassed by supplying a foreign run id.
 */

function parse(raw: string) {
  return JSON.parse(raw) as { success: boolean; data?: Record<string, unknown>; error?: string };
}

/** Store whose reads are scoped by userId, like the production adapter. */
function makeOwnedRunStore(ownerUserId: string) {
  const getCalls: Array<{ id: string; userId: string }> = [];
  const requestCancelCalls: Array<{ id: string; userId: string }> = [];
  const run = {
    id: 'run-1',
    userId: ownerUserId,
    agentId: null,
    status: 'queued' as const,
    input: {},
    context: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  } as unknown as DiscoveryRunRecord;

  return {
    getCalls,
    requestCancelCalls,
    async get(id: string, userId: string): Promise<DiscoveryRunRecord | null> {
      getCalls.push({ id, userId });
      // Ownership scoping: only the owner sees the run.
      return id === run.id && userId === ownerUserId ? run : null;
    },
    async requestCancel(id: string, userId: string): Promise<DiscoveryRunRecord | null> {
      requestCancelCalls.push({ id, userId });
      return id === run.id && userId === ownerUserId ? run : null;
    },
    async create() { throw new Error('unused'); },
    async listActive() { return []; },
    async markRunning() { return null; },
    async updateProgress() {},
    async markSucceeded() {},
    async markFailed() {},
    async markCancelled() {},
    async isCancelRequested() { return false; },
  };
}

function makeContext(userId: string): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: 'U', email: 'u@test' } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
}

function makeDeps(runStore: ReturnType<typeof makeOwnedRunStore>): ToolDeps {
  return {
    database: {} as never,
    systemDb: {} as never,
    userDb: {} as never,
    cache: {} as never,
    graphs: { opportunity: { invoke: async () => ({}) } as never } as never,
    discoveryRuns: runStore as never,
    discoveryRunQueue: { async enqueue() {}, async cancel() { return true; } } as never,
  } as unknown as ToolDeps;
}

function captureTool(name: string, deps: ToolDeps) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: Record<string, unknown> }) => Promise<string> } | undefined;
  const defineTool = (def: { name: string }) => {
    if (def.name === name) captured = def as never;
    return def;
  };
  createOpportunityTools(defineTool as never, deps);
  if (!captured) throw new Error(`${name} tool not registered`);
  return captured;
}

describe('get_discovery_run — ownership scoping (IND-608)', () => {
  test('the owner sees their run and the store is queried with the owner userId', async () => {
    const store = makeOwnedRunStore('owner');
    const tool = captureTool('get_discovery_run', makeDeps(store));

    const result = parse(await tool.handler({
      context: makeContext('owner'),
      query: { discoveryRunId: 'run-1' },
    }));

    expect(result.success).toBe(true);
    expect(result.data!.discoveryRunId).toBe('run-1');
    expect(store.getCalls).toEqual([{ id: 'run-1', userId: 'owner' }]);
  });

  test('a non-owner cannot see another user\u2019s run (scoped lookup returns not found)', async () => {
    const store = makeOwnedRunStore('owner');
    const tool = captureTool('get_discovery_run', makeDeps(store));

    const result = parse(await tool.handler({
      context: makeContext('intruder'),
      query: { discoveryRunId: 'run-1' },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/discovery run not found/i);
    // The lookup was still scoped to the caller, never widened to the owner.
    expect(store.getCalls).toEqual([{ id: 'run-1', userId: 'intruder' }]);
  });
});

describe('cancel_discovery_run — ownership scoping (IND-608)', () => {
  test('a non-owner cannot cancel another user\u2019s run and no cancellation is attempted', async () => {
    const store = makeOwnedRunStore('owner');
    const tool = captureTool('cancel_discovery_run', makeDeps(store));

    const result = parse(await tool.handler({
      context: makeContext('intruder'),
      query: { discoveryRunId: 'run-1' },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/discovery run not found/i);
    expect(store.getCalls).toEqual([{ id: 'run-1', userId: 'intruder' }]);
    // Ownership fails closed before any state-changing cancellation call.
    expect(store.requestCancelCalls).toEqual([]);
  });
});
