import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.OPENROUTER_API_KEY ??= 'test';

import { describe, test, expect, beforeEach, afterEach, afterAll } from 'bun:test';

import { createOpportunityTools } from '../opportunity.tools.js';

// Capture every call to runDiscoverFromQuery via injected ToolDeps seams.
type DiscoverCall = { trigger?: string; userId: string; enableQuestions?: boolean };
let discoverCalls: DiscoverCall[] = [];
import type { ToolDeps, ResolvedToolContext } from '../../shared/agent/tool.helpers.js';

const USER_ID = 'mcp-user-1';

function makeContext(overrides: Partial<ResolvedToolContext>): ResolvedToolContext {
  return {
    userId: USER_ID,
    user: { id: USER_ID, name: 'M', email: 'm@test' } as any,
    userProfile: null,
    userNetworks: [],
    isMcp: false,
    sessionId: undefined,
    ...overrides,
  } as unknown as ResolvedToolContext;
}

function makeDeps(): ToolDeps {
  return {
    systemDb: {} as any,
    database: {} as any,
    cache: {} as any,
    graphs: {
      opportunity: { invoke: async () => ({}) },
      index: { invoke: async () => ({ readResult: { memberOf: [{ networkId: 'n1' }] } }) },
    },
    opportunityDiscovery: {
      runDiscoverFromQuery: async (args: unknown) => {
        const input = args as Record<string, unknown>;
        discoverCalls.push({
          trigger: input.trigger as string | undefined,
          userId: input.userId as string,
          enableQuestions: input.enableQuestions as boolean | undefined,
        });
        return { found: false, count: 0, message: 'no results' };
      },
      continueDiscovery: async () => ({ found: false, count: 0, message: 'no results' }),
    },
  } as unknown as ToolDeps;
}

function captureDiscoverTool(deps: ToolDeps) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: any }) => Promise<string> } | undefined;
  const defineTool = (def: any) => {
    if (def.name === 'discover_opportunities') captured = def;
    return def;
  };
  createOpportunityTools(defineTool as any, deps);
  return captured!;
}

describe('discover_opportunities — orchestrator trigger routing', () => {
  beforeEach(() => {
    discoverCalls = [];
  });

  test('MCP context (isMcp=true, sessionId undefined) → trigger: orchestrator', async () => {
    const tool = captureDiscoverTool(makeDeps());
    await tool.handler({ context: makeContext({ isMcp: true }), query: {} });

    expect(discoverCalls).toHaveLength(1);
    expect(discoverCalls[0].trigger).toBe('orchestrator');
  });

  test('Web chat context (sessionId set) → trigger: orchestrator', async () => {
    const tool = captureDiscoverTool(makeDeps());
    await tool.handler({ context: makeContext({ sessionId: 'session-abc' }), query: {} });

    expect(discoverCalls).toHaveLength(1);
    expect(discoverCalls[0].trigger).toBe('orchestrator');
  });

  test('Ambient context (isMcp=false, no sessionId) → trigger unset', async () => {
    const tool = captureDiscoverTool(makeDeps());
    await tool.handler({ context: makeContext({}), query: {} });

    expect(discoverCalls).toHaveLength(1);
    expect(discoverCalls[0].trigger).toBeUndefined();
  });
});

describe('discover_opportunities — enableQuestions gating', () => {
  const prevMaster = process.env.QUESTIONER_ENABLED;
  const prevDiscovery = process.env.QUESTIONER_DISCOVERY_ENABLED;

  const restoreFlags = () => {
    if (prevMaster === undefined) delete process.env.QUESTIONER_ENABLED;
    else process.env.QUESTIONER_ENABLED = prevMaster;
    if (prevDiscovery === undefined) delete process.env.QUESTIONER_DISCOVERY_ENABLED;
    else process.env.QUESTIONER_DISCOVERY_ENABLED = prevDiscovery;
  };

  const enableBoth = () => {
    process.env.QUESTIONER_ENABLED = 'true';
    process.env.QUESTIONER_DISCOVERY_ENABLED = 'true';
  };

  beforeEach(() => {
    discoverCalls = [];
  });

  // Restore the env between tests so a failing/skipped test in this block
  // cannot leak state into siblings or the rest of the file.
  afterEach(restoreFlags);

  // Belt-and-suspenders: also restore after the whole describe in case
  // a future test forgets afterEach for any reason.
  afterAll(restoreFlags);

  test('MCP context with both flags on → enableQuestions=true', async () => {
    enableBoth();
    const tool = captureDiscoverTool(makeDeps());
    await tool.handler({ context: makeContext({ isMcp: true }), query: {} });

    expect(discoverCalls[0].enableQuestions).toBe(true);
  });

  test('MCP context with flags off → enableQuestions=false', async () => {
    delete process.env.QUESTIONER_ENABLED;
    delete process.env.QUESTIONER_DISCOVERY_ENABLED;
    const tool = captureDiscoverTool(makeDeps());
    await tool.handler({ context: makeContext({ isMcp: true }), query: {} });

    expect(discoverCalls[0].enableQuestions).toBe(false);
  });

  test('Discovery flag on without master flag → enableQuestions=false (hierarchy)', async () => {
    delete process.env.QUESTIONER_ENABLED;
    process.env.QUESTIONER_DISCOVERY_ENABLED = 'true';
    const tool = captureDiscoverTool(makeDeps());
    await tool.handler({ context: makeContext({ isMcp: true }), query: {} });

    expect(discoverCalls[0].enableQuestions).toBe(false);
  });

  test('Master flag on without discovery flag → enableQuestions=false', async () => {
    process.env.QUESTIONER_ENABLED = 'true';
    delete process.env.QUESTIONER_DISCOVERY_ENABLED;
    const tool = captureDiscoverTool(makeDeps());
    await tool.handler({ context: makeContext({ isMcp: true }), query: {} });

    expect(discoverCalls[0].enableQuestions).toBe(false);
  });

  test('Chat context with both flags on → enableQuestions=true', async () => {
    enableBoth();
    const tool = captureDiscoverTool(makeDeps());
    await tool.handler({ context: makeContext({ sessionId: 'session-abc' }), query: {} });

    expect(discoverCalls[0].enableQuestions).toBe(true);
  });

  test('Ambient context (no MCP, no session) with both flags on → enableQuestions=false', async () => {
    enableBoth();
    const tool = captureDiscoverTool(makeDeps());
    await tool.handler({ context: makeContext({}), query: {} });

    expect(discoverCalls[0].enableQuestions).toBe(false);
  });
});
