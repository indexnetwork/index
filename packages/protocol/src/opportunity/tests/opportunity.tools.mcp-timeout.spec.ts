import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.OPENROUTER_API_KEY ??= 'test';

import { describe, test, expect, beforeEach } from 'bun:test';

import { createOpportunityTools } from '../opportunity.tools.js';
import type { DiscoverResult, FormattedDiscoveryCandidate } from '../opportunity.discover.js';

// ─── Discovery test doubles injected via ToolDeps ───────────────────────────

type DiscoverInvocation = {
  negotiateTimeoutMs?: number;
};
let discoverCalls: DiscoverInvocation[] = [];
let discoverResult: DiscoverResult = { found: false, count: 0, message: 'no results' };
import type { ToolDeps, ResolvedToolContext } from '../../shared/agent/tool.helpers.js';
import type { Opportunity } from '../../shared/interfaces/database.interface.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseToolResult(raw: string) {
  return JSON.parse(raw) as {
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
  };
}

function makeCard(id: string): FormattedDiscoveryCandidate {
  return {
    opportunityId: id,
    userId: `cand-${id}`,
    name: `Cand ${id}`,
    avatar: null,
    matchReason: `mock-${id}`,
    score: 0.85,
    status: 'negotiating',
    homeCardPresentation: {
      headline: `Headline ${id}`,
      personalizedSummary: `Summary ${id}`,
      suggestedAction: `Open ${id}`,
      primaryActionLabel: 'Send',
      secondaryActionLabel: 'Dismiss',
      mutualIntentsLabel: 'mutual',
    } as never,
  };
}

function makeOpp(id: string, status: Opportunity['status']): Opportunity {
  return {
    id,
    detection: { source: 'auto' } as never,
    actors: [
      { userId: 'viewer', role: 'patient', networkId: 'idx-1', intentId: null },
      { userId: `cand-${id}`, role: 'agent', networkId: 'idx-1', intentId: null },
    ] as never,
    interpretation: { reasoning: `mock-${id}`, confidence: 0.85 } as never,
    context: {} as never,
    confidence: '0.85',
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  };
}

function makeContext(overrides: Partial<ResolvedToolContext>): ResolvedToolContext {
  return {
    userId: 'viewer',
    user: { id: 'viewer', name: 'V', email: 'v@test' } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: false,
    sessionId: undefined,
    ...overrides,
  } as unknown as ResolvedToolContext;
}

function makeDeps(refreshed: Record<string, Opportunity['status']>): ToolDeps {
  return {
    database: {
      getOpportunitiesByIds: async (ids: string[]) =>
        ids.map((id) => makeOpp(id, refreshed[id] ?? 'negotiating')),
      // Other methods are not hit because runDiscoverFromQuery is mocked above.
    } as never,
    systemDb: {} as never,
    userDb: {} as never,
    cache: {} as never,
    graphs: {
      opportunity: { invoke: async () => ({}) } as never,
      index: { invoke: async () => ({ readResult: { memberOf: [{ networkId: 'idx-1' }] } }) } as never,
    } as never,
    opportunityDiscovery: {
      runDiscoverFromQuery: async (args: unknown) => {
        const input = args as Record<string, unknown>;
        discoverCalls.push({
          negotiateTimeoutMs: input.negotiateTimeoutMs as number | undefined,
        });
        return discoverResult;
      },
      continueDiscovery: async () => ({ found: false, count: 0, message: 'no results' } satisfies DiscoverResult),
    },
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('discover_opportunities — MCP timeout shape (IND-286)', () => {
  beforeEach(() => {
    discoverCalls = [];
  });

  test('MCP context passes negotiateTimeoutMs: 20_000 to runDiscoverFromQuery', async () => {
    discoverResult = {
      found: true,
      count: 0,
      opportunities: [],
    };
    const tool = captureDiscoverTool(makeDeps({}));
    await tool.handler({ context: makeContext({ isMcp: true }), query: {} });

    expect(discoverCalls).toHaveLength(1);
    expect(discoverCalls[0].negotiateTimeoutMs).toBe(20_000);
  });

  test('non-MCP context does NOT pass negotiateTimeoutMs', async () => {
    discoverResult = { found: false, count: 0, message: 'no results' };
    const tool = captureDiscoverTool(makeDeps({}));
    await tool.handler({ context: makeContext({ sessionId: 'sess-1' }), query: {} });

    expect(discoverCalls).toHaveLength(1);
    expect(discoverCalls[0].negotiateTimeoutMs).toBeUndefined();
  });

  test('renders only draft opps as cards and reports negotiating as a count', async () => {
    discoverResult = {
      found: true,
      count: 3,
      opportunities: [
        makeCard('opp-draft'),
        makeCard('opp-still-negotiating'),
        makeCard('opp-rejected'),
      ],
    };
    const deps = makeDeps({
      'opp-draft': 'draft',
      'opp-still-negotiating': 'negotiating',
      'opp-rejected': 'rejected',
    });
    const tool = captureDiscoverTool(deps);

    const raw = await tool.handler({ context: makeContext({ isMcp: true }), query: {} });
    const parsed = parseToolResult(raw);
    expect(parsed.success).toBe(true);

    expect(parsed.data!.count).toBe(1); // only opp-draft
    const message = parsed.data!.message as string;
    expect(message).toContain('still being evaluated'); // negotiating trailer
    expect(message).not.toContain('opp-rejected');
  });

  test('returns "still being evaluated" message when only negotiating opps come back', async () => {
    discoverResult = {
      found: true,
      count: 2,
      opportunities: [makeCard('opp-a'), makeCard('opp-b')],
    };
    const deps = makeDeps({ 'opp-a': 'negotiating', 'opp-b': 'negotiating' });
    const tool = captureDiscoverTool(deps);

    const raw = await tool.handler({ context: makeContext({ isMcp: true }), query: {} });
    const parsed = parseToolResult(raw);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.count).toBe(0);
    const message = parsed.data!.message as string;
    expect(message).toContain('still being evaluated');
    expect(message).toContain('list_opportunities');
    expect(message).toContain('2'); // count of pending
  });

  test('preserves existing-connections mention when no draft cards survive', async () => {
    discoverResult = {
      found: true,
      count: 1,
      opportunities: [makeCard('opp-still-neg')],
      existingConnections: [{
        userId: 'cand-existing',
        name: 'Existing Cand',
        status: 'pending',
        opportunityId: 'opp-existing',
      }],
      existingConnectionsForMention: [{
        userId: 'cand-existing',
        name: 'Existing Cand',
        status: 'pending',
        opportunityId: 'opp-existing',
      }],
    };
    const deps = makeDeps({ 'opp-still-neg': 'negotiating' });
    const tool = captureDiscoverTool(deps);

    const raw = await tool.handler({ context: makeContext({ isMcp: true }), query: {} });
    const parsed = parseToolResult(raw);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.count).toBe(0);
    const message = parsed.data!.message as string;
    expect(message).toContain('still being evaluated'); // base trailer preserved
    expect(message).toContain('1 pending');
    expect(message).toContain('Existing Cand'); // existing-connections mention preserved
    expect(message).toContain('pending'); // status from existing connection
    expect(message).not.toContain('Found 0 potential'); // misleading lead-in dropped
  });

  test('drops rejected and stalled opps entirely', async () => {
    discoverResult = {
      found: true,
      count: 2,
      opportunities: [makeCard('opp-rej'), makeCard('opp-stall')],
    };
    const deps = makeDeps({ 'opp-rej': 'rejected', 'opp-stall': 'stalled' });
    const tool = captureDiscoverTool(deps);

    const raw = await tool.handler({ context: makeContext({ isMcp: true }), query: {} });
    const parsed = parseToolResult(raw);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.count).toBe(0);
    const message = parsed.data!.message as string;
    expect(message).not.toContain('opp-rej');
    expect(message).not.toContain('opp-stall');
  });

  test('non-MCP context skips status refresh — chat behavior unchanged', async () => {
    discoverResult = {
      found: true,
      count: 1,
      opportunities: [makeCard('opp-chat')],
    };
    let getOppsByIdsCalled = false;
    const deps = {
      ...makeDeps({}),
      database: {
        getOpportunitiesByIds: async () => { getOppsByIdsCalled = true; return []; },
      } as never,
    } as ToolDeps;
    const tool = captureDiscoverTool(deps);

    const raw = await tool.handler({ context: makeContext({ sessionId: 'sess-1' }), query: {} });
    const parsed = parseToolResult(raw);
    expect(parsed.success).toBe(true);
    expect(getOppsByIdsCalled).toBe(false);
    expect(parsed.data!.count).toBe(1); // card rendered with discover-time status
  });
});
