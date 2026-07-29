import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.OPENROUTER_API_KEY ??= 'test';

import { afterEach, describe, test, expect } from 'bun:test';

import { createOpportunityTools } from '../opportunity.tools.js';
import type { ToolDeps, ResolvedToolContext } from '../../shared/agent/tool.helpers.js';
import type { CreateDiscoveryRunInput, DiscoveryRunRecord } from '../../shared/interfaces/discovery-run.interface.js';

const originalIntroducerDiscoveryEnabled = process.env.INTRODUCER_DISCOVERY_ENABLED;
afterEach(() => {
  if (originalIntroducerDiscoveryEnabled === undefined) {
    delete process.env.INTRODUCER_DISCOVERY_ENABLED;
  } else {
    process.env.INTRODUCER_DISCOVERY_ENABLED = originalIntroducerDiscoveryEnabled;
  }
});

function parseToolResult(raw: string) {
  return JSON.parse(raw) as {
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
  };
}

// Minimal in-memory discovery-run store that records create/listActive activity.
function makeRunStore() {
  const runs: DiscoveryRunRecord[] = [];
  let seq = 0;
  const store = {
    createCalls: 0,
    listActiveCalls: 0,
    async create(input: CreateDiscoveryRunInput): Promise<DiscoveryRunRecord> {
      store.createCalls += 1;
      seq += 1;
      const rec = {
        id: `run-${seq}`,
        userId: input.userId,
        agentId: input.agentId ?? null,
        status: 'queued' as const,
        input: input.input,
        context: input.context,
        createdAt: new Date(Date.now() + seq), // monotonic for ordering
      } as DiscoveryRunRecord;
      runs.push(rec);
      return rec;
    },
    async listActive(userId: string): Promise<DiscoveryRunRecord[]> {
      store.listActiveCalls += 1;
      return runs
        .filter((r) => r.userId === userId && (r.status === 'queued' || r.status === 'running'))
        .sort((a, b) => +b.createdAt - +a.createdAt);
    },
    // Unused by these tests:
    async get() { return null; },
    async markRunning() { return null; },
    async updateProgress() {},
    async markSucceeded() {},
    async markFailed() {},
    async requestCancel() { return null; },
    async markCancelled() {},
    async isCancelRequested() { return false; },
  };
  return store;
}

function makeContext(overrides: Partial<ResolvedToolContext>): ResolvedToolContext {
  return {
    userId: 'viewer',
    user: { id: 'viewer', name: 'V', email: 'v@test' } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
    sessionId: undefined,
    ...overrides,
  } as unknown as ResolvedToolContext;
}

function makeDeps(runStore: ReturnType<typeof makeRunStore>, queue: { enqueueCalls: number }): ToolDeps {
  return {
    database: {} as never,
    systemDb: {} as never,
    userDb: {} as never,
    cache: {} as never,
    graphs: {
      opportunity: { invoke: async () => ({}) } as never,
      index: { invoke: async () => ({ readResult: { memberOf: [{ networkId: 'idx-1' }] } }) } as never,
    } as never,
    discoveryRuns: runStore as never,
    discoveryRunQueue: {
      async enqueue(_id: string) { queue.enqueueCalls += 1; },
      async cancel() { return true; },
    } as never,
  } as unknown as ToolDeps;
}

function captureDiscoverTool(deps: ToolDeps) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: Record<string, unknown> }) => Promise<string> } | undefined;
  const defineTool = (def: { name: string }) => {
    if (def.name === 'discover_opportunities') captured = def as never;
    return def;
  };
  createOpportunityTools(defineTool as never, deps);
  if (!captured) throw new Error('discover_opportunities tool not registered');
  return captured;
}

describe('discover_opportunities — MCP run coalescing', () => {
  test('disabled introducer discovery returns its stable result without coalescing, creating, or enqueueing a run', async () => {
    process.env.INTRODUCER_DISCOVERY_ENABLED = 'false';
    const runStore = makeRunStore();
    const queue = { enqueueCalls: 0 };
    const tool = captureDiscoverTool(makeDeps(runStore, queue));

    const result = parseToolResult(
      await tool.handler({
        context: makeContext({}),
        query: { introTargetUserId: 'target-user' },
      }),
    );

    expect(result).toEqual({
      success: true,
      data: {
        found: false,
        count: 0,
        message: 'Introducer discovery is currently disabled.',
      },
    });
    expect(runStore.listActiveCalls).toBe(0);
    expect(runStore.createCalls).toBe(0);
    expect(queue.enqueueCalls).toBe(0);
  });

  test('enabled introducer discovery still creates and enqueues an MCP run', async () => {
    process.env.INTRODUCER_DISCOVERY_ENABLED = 'true';
    const runStore = makeRunStore();
    const queue = { enqueueCalls: 0 };
    const tool = captureDiscoverTool(makeDeps(runStore, queue));

    const result = parseToolResult(
      await tool.handler({
        context: makeContext({}),
        query: { introTargetUserId: 'target-user' },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe('queued');
    expect(runStore.listActiveCalls).toBe(1);
    expect(runStore.createCalls).toBe(1);
    expect(queue.enqueueCalls).toBe(1);
  });

  test('repeat call with the same query returns the in-flight run instead of a new one', async () => {
    const runStore = makeRunStore();
    const queue = { enqueueCalls: 0 };
    const tool = captureDiscoverTool(makeDeps(runStore, queue));

    const first = parseToolResult(
      await tool.handler({ context: makeContext({}), query: { searchQuery: 'AI engineers' } }),
    );
    expect(first.success).toBe(true);
    expect(first.data!.status).toBe('queued');
    const runId = first.data!.discoveryRunId as string;
    expect(runId).toBeTruthy();
    expect(runStore.createCalls).toBe(1);
    expect(queue.enqueueCalls).toBe(1);

    const second = parseToolResult(
      await tool.handler({ context: makeContext({}), query: { searchQuery: 'AI engineers' } }),
    );
    expect(second.success).toBe(true);
    expect(second.data!.discoveryRunId).toBe(runId); // same run
    expect(second.data!.coalesced).toBe(true);
    expect(runStore.createCalls).toBe(1); // no new run created
    expect(queue.enqueueCalls).toBe(1); // no new enqueue
  });

  test('case/whitespace-insensitive match still coalesces', async () => {
    const runStore = makeRunStore();
    const queue = { enqueueCalls: 0 };
    const tool = captureDiscoverTool(makeDeps(runStore, queue));

    await tool.handler({ context: makeContext({}), query: { searchQuery: 'AI Engineers' } });
    const second = parseToolResult(
      await tool.handler({ context: makeContext({}), query: { searchQuery: '  ai engineers ' } }),
    );
    expect(second.data!.coalesced).toBe(true);
    expect(runStore.createCalls).toBe(1);
  });

  test('intro requests differing only by hint do NOT coalesce', async () => {
    const runStore = makeRunStore();
    const queue = { enqueueCalls: 0 };
    const tool = captureDiscoverTool(makeDeps(runStore, queue));
    const base = {
      partyUserIds: ['u1', 'u2'],
      entities: [
        { userId: 'u1', networkId: 'idx-1' },
        { userId: 'u2', networkId: 'idx-1' },
      ],
    };

    await tool.handler({ context: makeContext({}), query: { ...base, hint: 'both in healthcare AI' } });
    const second = parseToolResult(
      await tool.handler({ context: makeContext({}), query: { ...base, hint: 'complementary startup skills' } }),
    );
    expect(second.data!.coalesced).toBeUndefined();
    expect(runStore.createCalls).toBe(2);
  });

  test('intro requests with same parties but different entity networkId do NOT coalesce', async () => {
    const runStore = makeRunStore();
    const queue = { enqueueCalls: 0 };
    const tool = captureDiscoverTool(makeDeps(runStore, queue));

    await tool.handler({
      context: makeContext({}),
      query: { partyUserIds: ['u1', 'u2'], entities: [{ userId: 'u1', networkId: 'idx-1' }, { userId: 'u2', networkId: 'idx-1' }] },
    });
    const second = parseToolResult(
      await tool.handler({
        context: makeContext({}),
        query: { partyUserIds: ['u1', 'u2'], entities: [{ userId: 'u1', networkId: 'idx-2' }, { userId: 'u2', networkId: 'idx-2' }] },
      }),
    );
    expect(second.data!.coalesced).toBeUndefined();
    expect(runStore.createCalls).toBe(2);
  });

  test('continueFrom is case-sensitive — distinct tokens do NOT coalesce', async () => {
    const runStore = makeRunStore();
    const queue = { enqueueCalls: 0 };
    const tool = captureDiscoverTool(makeDeps(runStore, queue));

    await tool.handler({ context: makeContext({}), query: { continueFrom: 'AbC123' } });
    const second = parseToolResult(
      await tool.handler({ context: makeContext({}), query: { continueFrom: 'abc123' } }),
    );
    expect(second.data!.coalesced).toBeUndefined();
    expect(runStore.createCalls).toBe(2);
  });

  test('same query in different focused scopes does NOT coalesce', async () => {
    const runStore = makeRunStore();
    const queue = { enqueueCalls: 0 };
    const tool = captureDiscoverTool(makeDeps(runStore, queue));

    await tool.handler({
      context: makeContext({ scopeType: 'network', scopeId: 'idx-1' }),
      query: { searchQuery: 'AI engineers' },
    });
    const second = parseToolResult(
      await tool.handler({
        context: makeContext({ scopeType: 'network', scopeId: 'idx-2' }),
        query: { searchQuery: 'AI engineers' },
      }),
    );
    expect(second.data!.coalesced).toBeUndefined();
    expect(runStore.createCalls).toBe(2);
  });

  test('a different query starts a fresh run', async () => {
    const runStore = makeRunStore();
    const queue = { enqueueCalls: 0 };
    const tool = captureDiscoverTool(makeDeps(runStore, queue));

    const first = parseToolResult(
      await tool.handler({ context: makeContext({}), query: { searchQuery: 'AI engineers' } }),
    );
    const second = parseToolResult(
      await tool.handler({ context: makeContext({}), query: { searchQuery: 'fintech advisors' } }),
    );
    expect(second.data!.coalesced).toBeUndefined();
    expect(second.data!.discoveryRunId).not.toBe(first.data!.discoveryRunId);
    expect(runStore.createCalls).toBe(2);
    expect(queue.enqueueCalls).toBe(2);
  });

  // ── IND-592: coalescing is partitioned by the calling principal ────────────
  //
  // A single user can drive both a session-human principal (no agentId) and one
  // or more agent principals over MCP. An identical normalized request + scope
  // must NOT coalesce across principals, or one principal would be handed
  // another principal's in-flight run id (and, via get_discovery_run, its
  // status/results).

  test('the same request from an agent does NOT coalesce onto the human owner\u2019s run', async () => {
    const runStore = makeRunStore();
    const queue = { enqueueCalls: 0 };
    const tool = captureDiscoverTool(makeDeps(runStore, queue));

    // Human owner (no agentId) starts a run.
    const human = parseToolResult(
      await tool.handler({ context: makeContext({}), query: { searchQuery: 'AI engineers' } }),
    );
    // An agent under the SAME user fires the identical request.
    const agent = parseToolResult(
      await tool.handler({
        context: makeContext({ agentId: 'agent-1' }),
        query: { searchQuery: 'AI engineers' },
      }),
    );

    expect(agent.data!.coalesced).toBeUndefined();
    expect(agent.data!.discoveryRunId).not.toBe(human.data!.discoveryRunId);
    expect(runStore.createCalls).toBe(2);
    expect(queue.enqueueCalls).toBe(2);
  });

  test('two distinct agents under one user do NOT coalesce onto each other\u2019s run', async () => {
    const runStore = makeRunStore();
    const queue = { enqueueCalls: 0 };
    const tool = captureDiscoverTool(makeDeps(runStore, queue));

    const a1 = parseToolResult(
      await tool.handler({ context: makeContext({ agentId: 'agent-1' }), query: { searchQuery: 'AI engineers' } }),
    );
    const a2 = parseToolResult(
      await tool.handler({ context: makeContext({ agentId: 'agent-2' }), query: { searchQuery: 'AI engineers' } }),
    );

    expect(a2.data!.coalesced).toBeUndefined();
    expect(a2.data!.discoveryRunId).not.toBe(a1.data!.discoveryRunId);
    expect(runStore.createCalls).toBe(2);

    // The SAME agent repeating its request still coalesces onto its own run.
    const a1Again = parseToolResult(
      await tool.handler({ context: makeContext({ agentId: 'agent-1' }), query: { searchQuery: 'AI engineers' } }),
    );
    expect(a1Again.data!.coalesced).toBe(true);
    expect(a1Again.data!.discoveryRunId).toBe(a1.data!.discoveryRunId);
    expect(runStore.createCalls).toBe(2);
  });
});
