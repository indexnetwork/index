import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.OPENROUTER_API_KEY ??= 'test';

import { describe, test, expect, mock, afterAll } from 'bun:test';
import type { DiscoverResult } from '../opportunity.discover.js';

// The MCP-run branch returns before invoking discovery, but mock it so importing
// createOpportunityTools never reaches a real LLM path.
mock.module('../opportunity.discover.js', () => ({
  runDiscoverFromQuery: async () => ({ found: false, count: 0, message: 'no results' } satisfies DiscoverResult),
  continueDiscovery: async () => ({ found: false, count: 0, message: 'no results' } satisfies DiscoverResult),
}));

afterAll(() => mock.restore());

const { createOpportunityTools } = await import('../opportunity.tools.js');
import type { ToolDeps, ResolvedToolContext } from '../../shared/agent/tool.helpers.js';
import type {
  CreateDiscoveryRunInput,
  DiscoveryRunRecord,
} from '../../shared/interfaces/discovery-run.interface.js';

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

  test('same query in different scopes does NOT coalesce', async () => {
    const runStore = makeRunStore();
    const queue = { enqueueCalls: 0 };
    const tool = captureDiscoverTool(makeDeps(runStore, queue));

    await tool.handler({ context: makeContext({ indexScope: ['idx-1'] }), query: { searchQuery: 'AI engineers' } });
    const second = parseToolResult(
      await tool.handler({ context: makeContext({ indexScope: ['idx-1', 'idx-2'] }), query: { searchQuery: 'AI engineers' } }),
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
});
