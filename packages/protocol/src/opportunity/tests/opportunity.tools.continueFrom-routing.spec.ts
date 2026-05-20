import { config } from 'dotenv';
config({ path: '.env.development', override: true });
process.env.OPENROUTER_API_KEY ??= 'test';

import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';

// IND-305 reproducer: the bug report shows MCP `discover_opportunities` returning
//   { found: false, count: 0, message: "No more matching opportunities found in the remaining candidates." }
// That exact message is produced only by `continueDiscovery` (opportunity.discover.ts:1128) —
// `runDiscoverFromQuery` never emits it. So the failing call must have routed to the
// continuation path. The hypothesis: an MCP client passed a stale `continueFrom` (from a
// prior call's pagination token) alongside a fresh `searchQuery`, and the tool silently
// preferred `continueFrom`. These tests document and exercise that routing.

type ToolCallArgs = Record<string, unknown>;
let discoverCalls: ToolCallArgs[] = [];
let continueCalls: ToolCallArgs[] = [];

mock.module('../opportunity.discover.js', () => ({
  runDiscoverFromQuery: async (args: ToolCallArgs) => {
    discoverCalls.push(args);
    return { found: true, count: 0, opportunities: [], message: 'ok' };
  },
  continueDiscovery: async (args: ToolCallArgs) => {
    continueCalls.push(args);
    return {
      found: false,
      count: 0,
      message: 'No more matching opportunities found in the remaining candidates.',
    };
  },
}));

afterAll(() => mock.restore());

const { createOpportunityTools } = await import('../opportunity.tools.js');
import type { ToolDeps, ResolvedToolContext } from '../../shared/agent/tool.helpers.js';

const USER_ID = 'mcp-user-1';

function makeContext(overrides: Partial<ResolvedToolContext>): ResolvedToolContext {
  return {
    userId: USER_ID,
    user: { id: USER_ID, name: 'M', email: 'm@test' } as never,
    userProfile: null,
    userNetworks: [{ networkId: 'n1' } as never],
    isMcp: true,
    sessionId: undefined,
    ...overrides,
  } as unknown as ResolvedToolContext;
}

function makeDeps(): ToolDeps {
  return {
    systemDb: {} as never,
    database: {} as never,
    cache: {} as never,
    graphs: {
      opportunity: { invoke: async () => ({}) },
      index: { invoke: async () => ({ readResult: { memberOf: [{ networkId: 'n1' }] } }) },
      networkMembership: { invoke: async () => ({}) },
    },
  } as unknown as ToolDeps;
}

function captureDiscoverTool(deps: ToolDeps) {
  let captured:
    | { handler: (i: { context: ResolvedToolContext; query: Record<string, unknown> }) => Promise<string> }
    | undefined;
  const defineTool = (def: { name: string; handler: typeof captured extends infer T ? T extends { handler: infer H } ? H : never : never }) => {
    if (def.name === 'discover_opportunities') {
      captured = def as unknown as typeof captured;
    }
    return def;
  };
  createOpportunityTools(defineTool as never, deps);
  if (!captured) throw new Error('discover_opportunities not found');
  return captured;
}

describe('IND-305: discover_opportunities continueFrom routing', () => {
  beforeEach(() => {
    discoverCalls = [];
    continueCalls = [];
  });

  test('fresh searchQuery (no continueFrom) → runDiscoverFromQuery', async () => {
    const tool = captureDiscoverTool(makeDeps());
    await tool.handler({
      context: makeContext({ isMcp: true }),
      query: { searchQuery: 'people in San Francisco to meet, collaborate, or connect with' },
    });

    expect(discoverCalls).toHaveLength(1);
    expect(continueCalls).toHaveLength(0);
  });

  test('continueFrom set, no searchQuery → continueDiscovery (control)', async () => {
    const tool = captureDiscoverTool(makeDeps());
    await tool.handler({
      context: makeContext({ isMcp: true }),
      query: { continueFrom: 'some-discovery-id' },
    });

    expect(continueCalls).toHaveLength(1);
    expect(discoverCalls).toHaveLength(0);
  });

  // IND-305 regression guard. Before the fix, a caller (typically an MCP
  // client's LLM) passing a fresh `searchQuery` alongside a stale
  // `continueFrom` was silently routed to `continueDiscovery`, which resumed
  // an exhausted cache and returned "No more matching opportunities found in
  // the remaining candidates" — the user's intended fresh search never ran.
  // The handler now drops the stale token and runs fresh discovery.
  test('fresh searchQuery + stale continueFrom → runDiscoverFromQuery (IND-305 regression)', async () => {
    const tool = captureDiscoverTool(makeDeps());
    await tool.handler({
      context: makeContext({ isMcp: true }),
      query: {
        searchQuery: 'people in San Francisco to meet, collaborate, or connect with',
        continueFrom: 'stale-discovery-id-from-prior-call',
      },
    });

    expect(discoverCalls).toHaveLength(1);
    expect(continueCalls).toHaveLength(0);
  });
});
