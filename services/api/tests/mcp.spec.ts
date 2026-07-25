import '../src/startup.env';
import { describe, it, expect } from 'bun:test';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';

import { createMcpServer, clearMcpToolMetadataCacheForTests, getCachedMcpToolMetadata } from '../../../packages/protocol/src/mcp/mcp.server';
import { CANONICAL_MCP_TOOL_ACCESS_RULES } from '../../../packages/protocol/src/mcp/mcp.authorization-policy';
import { createAgentTools } from '../../../packages/protocol/src/agent/agent.tools';
import { createToolRegistry } from '../../../packages/protocol/src/shared/agent/tool.registry';
import type { ToolDeps } from '../../../packages/protocol/src/shared/agent/tool.helpers';
import type { McpAuthResolver } from '../../../packages/protocol/src/shared/interfaces/auth.interface';
import type { AgentDatabase } from '../../../packages/protocol/src/shared/interfaces/agent.interface';
import type { ScopedDepsFactory } from '../../../packages/protocol/src/mcp/mcp.server';

function parseToolResult(result: string) {
  return JSON.parse(result) as {
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK DEPENDENCIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Minimal mock ToolDeps — tools are registered but never invoked, so stubs suffice. */
const mockAgentDb: AgentDatabase = {
  createAgent: async () => { throw new Error('not implemented'); },
  getAgent: async () => null,
  getAgentWithRelations: async () => null,
  updateAgent: async () => null,
  deleteAgent: async () => undefined,
  listAgentsForUser: async () => [],
  createTransport: async () => { throw new Error('not implemented'); },
  deleteTransport: async () => undefined,
  recordTransportFailure: async () => undefined,
  recordTransportSuccess: async () => undefined,
  grantPermission: async () => { throw new Error('not implemented'); },
  revokePermission: async () => undefined,
  hasPermission: async () => false,
  findAuthorizedAgents: async () => [],
  getSystemAgentIds: () => ({
    chatOrchestrator: '00000000-0000-0000-0000-000000000001',
    negotiator: '00000000-0000-0000-0000-000000000002',
  }),
};

const mockDeps = {
  database: {} as ToolDeps['database'],
  userDb: {} as ToolDeps['userDb'],
  systemDb: {} as ToolDeps['systemDb'],
  scraper: {} as ToolDeps['scraper'],
  embedder: {} as ToolDeps['embedder'],
  cache: {} as ToolDeps['cache'],
  integration: {} as ToolDeps['integration'],
  contactService: {} as ToolDeps['contactService'],
  integrationImporter: {} as ToolDeps['integrationImporter'],
  enricher: {} as ToolDeps['enricher'],
  negotiationDatabase: {} as ToolDeps['negotiationDatabase'],
  agentDatabase: mockAgentDb,
  graphs: {
    profile: { invoke: async () => ({}) },
    intent: { invoke: async () => ({}) },
    index: { invoke: async () => ({}) },
    networkMembership: { invoke: async () => ({}) },
    intentIndex: { invoke: async () => ({}) },
    opportunity: { invoke: async () => ({}) } as ToolDeps['graphs']['opportunity'],
    premise: { invoke: async () => ({}) } as ToolDeps['graphs']['premise'],
  },
} satisfies ToolDeps;

const mockDepsWithoutAgentDb: ToolDeps = {
  ...mockDeps,
  agentDatabase: undefined,
};

/** Mock auth resolver — never called during tool registration. */
const mockAuthResolver: McpAuthResolver = {
  resolveIdentity: async () => ({ userId: 'test-user-id' }),
  resolveUserId: async () => 'test-user-id',
};

/** Mock scoped deps factory — never called during tool registration. */
const mockScopedDepsFactory: ScopedDepsFactory = {
  create: () => ({
    userDb: {} as ToolDeps['userDb'],
    systemDb: {} as ToolDeps['systemDb'],
  }),
};

/** Shared handler context for register_agent tests (user session, no agent). */
const baseToolContext = {
  userId: 'test-user-id',
  userName: 'Test User',
  userEmail: 'test@example.com',
  user: { id: 'test-user-id' } as never,
  userProfile: null,
  userNetworks: [],
  isOnboarding: false,
  hasName: true,
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number;
  result?: {
    tools?: Array<{ name: string }>;
    content?: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
};

async function invokeMcpRequest(params: {
  server: ReturnType<typeof createMcpServer>;
  method: 'tools/list' | 'tools/call';
  requestParams?: Record<string, unknown>;
  headers?: Record<string, string>;
}): Promise<JsonRpcResponse> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await params.server.connect(transport);

  try {
    const response = await transport.handleRequest(new Request('https://example.test/mcp', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...params.headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: params.method,
        params: params.requestParams ?? {},
      }),
    }));
    return await response.json() as JsonRpcResponse;
  } finally {
    await Promise.allSettled([
      transport.close(),
      params.server.close(),
    ]);
  }
}

const resolvedContextDatabase = {
  getUser: async () => ({
    id: 'test-user-id',
    name: 'Test User',
    email: 'test@example.com',
    onboarding: { completedAt: new Date('2026-01-01T00:00:00.000Z') },
  }),
  getProfile: async () => null,
  getNetworkMemberships: async () => [],
  getNetworkMembership: async () => null,
  getNetwork: async () => null,
  isIndexOwner: async () => false,
  isNetworkMember: async () => false,
  getUserContext: async () => null,
} as unknown as ToolDeps['database'];

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('MCP Server Factory', () => {
  it('creates an McpServer instance', () => {
    const server = createMcpServer(mockDeps, mockAuthResolver, mockScopedDepsFactory);
    // Check structural shape — instanceof fails across dual module installs
    expect(server).toHaveProperty('server');
    expect(typeof (server as { connect?: unknown }).connect).toBe('function');
  });

  it('registers the same tools as createToolRegistry', () => {
    const registry = createToolRegistry(mockDeps);
    // The MCP server should have registered every tool from the registry.
    // Keep this resilient as new tool domains are added over time.
    expect(registry.size).toBeGreaterThan(0);

    // Verify representative tools remain in the registry.
    const expectedTools = [
      'read_intents',
      'create_intent',
      'read_user_profiles',
      'discover_opportunities',
      'update_opportunity',
      'list_contacts',
      'scrape_url',
      'register_agent',
      'list_agents',
    ];

    for (const toolName of expectedTools) {
      expect(registry.has(toolName)).toBe(true);
    }
  });

  it('agent tool domain returns no tools without agentDatabase', () => {
    const tools = createAgentTools((() => null) as never, mockDepsWithoutAgentDb);
    expect(tools).toEqual([]);
  });

  it('register_agent rejects blank names before creating an agent', async () => {
    const createAgentCalls: Array<Parameters<AgentDatabase['createAgent']>[0]> = [];
    const registry = createToolRegistry({
      ...mockDeps,
      agentDatabase: {
        ...mockAgentDb,
        createAgent: async (input) => {
          createAgentCalls.push(input);
          throw new Error('should not create agent');
        },
      },
    });

    const result = await registry.get('register_agent')?.handler({
      context: baseToolContext,
      query: { name: '   ' },
    });

    expect(parseToolResult(result ?? '')).toEqual({ success: false, error: 'Agent name is required.' });
    expect(createAgentCalls).toEqual([]);
  });

  it('register_agent validates permissions before creating an agent', async () => {
    const createAgentCalls: Array<Parameters<AgentDatabase['createAgent']>[0]> = [];
    const registry = createToolRegistry({
      ...mockDeps,
      agentDatabase: {
        ...mockAgentDb,
        createAgent: async (input) => {
          createAgentCalls.push(input);
          throw new Error('should not create agent');
        },
      },
    });

    const result = await registry.get('register_agent')?.handler({
      context: baseToolContext,
      query: { name: 'Agent', permissions: ['invalid:action'] },
    });

    expect(parseToolResult(result ?? '')).toEqual({
      success: false,
      error: 'Invalid action: invalid:action. Valid actions: manage:identity, manage:premises, manage:intents, manage:networks, manage:opportunities, manage:negotiations',
    });
    expect(createAgentCalls).toEqual([]);
  });

  it('register_agent rejects creation when authenticated as an agent', async () => {
    const createAgentCalls: Array<Parameters<AgentDatabase['createAgent']>[0]> = [];
    const registry = createToolRegistry({
      ...mockDeps,
      agentDatabase: {
        ...mockAgentDb,
        createAgent: async (input) => {
          createAgentCalls.push(input);
          throw new Error('should not create agent');
        },
      },
    });

    const result = await registry.get('register_agent')?.handler({
      context: { ...baseToolContext, agentId: 'agent-123' },
      query: { name: 'Agent' },
    });

    expect(parseToolResult(result ?? '')).toEqual({
      success: false,
      error: 'Agent registration must be done from a user session (web UI or personal API key), ' +
        'not from within an existing agent context. To register a new agent, visit the Index web app.',
    });
    expect(createAgentCalls).toEqual([]);
  });

  it('caches static MCP tool metadata by registry-shaping dependencies', () => {
    clearMcpToolMetadataCacheForTests();

    const first = getCachedMcpToolMetadata(mockDeps);
    const second = getCachedMcpToolMetadata(mockDeps);
    // The MCP server builds its metadata from the restricted MCP registry
    // profile, so compare against that same profile (not the full REST set).
    const registry = createToolRegistry(mockDeps, { surface: 'mcp' });

    expect(second).toBe(first);
    expect(first.length).toBe(registry.size);
    expect(first.some((tool) => tool.name === 'list_agents')).toBe(true);
    expect(first.every((tool) => tool.schema && tool.jsonSchema && tool.inputSchema)).toBe(true);
    expect(first.every((tool) => (
      !('allowed' in tool) &&
      !('principal' in tool) &&
      !('permissions' in tool) &&
      !('visibleTools' in tool)
    ))).toBe(true);

    const withoutAgentTools = getCachedMcpToolMetadata(mockDepsWithoutAgentDb);
    expect(withoutAgentTools).not.toBe(first);
    expect(withoutAgentTools.some((tool) => tool.name === 'list_agents')).toBe(false);
  });

  it('classifies every MCP-surface registry tool in the canonical production matrix', () => {
    // The canonical matrix must classify exactly the tools exposed on the MCP
    // surface. Contact/Gmail tools, scrape_url, and the deprecated aliases are
    // omitted from the MCP registry (IND-596/597/598), so contactsEnabled must
    // not add them back even when true.
    const mcpRegistry = createToolRegistry({
      ...mockDeps,
      contactsEnabled: true,
      chatSession: {
        listSessions: async () => [],
        getSession: async () => null,
      },
    }, { surface: 'mcp' });

    expect([...CANONICAL_MCP_TOOL_ACCESS_RULES.keys()].sort()).toEqual(
      [...mcpRegistry.keys()].sort(),
    );
  });

  it('register_agent rolls back the created agent when later setup fails', async () => {
    const deletedAgentIds: string[] = [];
    const registry = createToolRegistry({
      ...mockDeps,
      agentDatabase: {
        ...mockAgentDb,
        createAgent: async () => ({
          id: 'agent-123',
          ownerId: 'test-user-id',
          name: 'Agent',
          description: null,
          type: 'external',
          status: 'active',
          metadata: {},
          createdAt: new Date('2026-04-08T00:00:00.000Z'),
          updatedAt: new Date('2026-04-08T00:00:00.000Z'),
        }),
        grantPermission: async () => {
          throw new Error('permission grant failed');
        },
        deleteAgent: async (agentId) => {
          deletedAgentIds.push(agentId);
        },
      },
    });

    const result = await registry.get('register_agent')?.handler({
      context: baseToolContext,
      query: {
        name: 'Agent',
        permissions: ['manage:intents'],
      },
    });

    expect(parseToolResult(result ?? '')).toEqual({
      success: false,
      error: 'Failed to register agent. Please try again.',
    });
    expect(deletedAgentIds).toEqual(['agent-123']);
  });

  it('filters tools/list for registered agents without mutating static metadata', async () => {
    clearMcpToolMetadataCacheForTests();
    const agentDb: AgentDatabase = {
      ...mockAgentDb,
      getAgentWithRelations: async () => ({
        id: 'agent-1',
        ownerId: 'test-user-id',
        name: 'Agent',
        description: null,
        type: 'external',
        status: 'active',
        metadata: {},
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        transports: [],
        permissions: [{
          id: 'permission-1',
          agentId: 'agent-1',
          userId: 'test-user-id',
          scope: 'global',
          scopeId: null,
          actions: ['manage:intents'],
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }],
      }),
    };
    const deps = {
      ...mockDeps,
      database: resolvedContextDatabase,
      agentDatabase: agentDb,
    };
    const staticMetadata = getCachedMcpToolMetadata(deps);
    const server = createMcpServer(
      deps,
      {
        resolveIdentity: async () => ({
          userId: 'test-user-id',
          agentId: 'agent-1',
        }),
        resolveUserId: async () => 'test-user-id',
      },
      mockScopedDepsFactory,
    );

    const response = await invokeMcpRequest({
      server,
      method: 'tools/list',
      headers: { 'x-api-key': 'agent-key' },
    });
    const names = response.result?.tools?.map((tool) => tool.name) ?? [];

    expect(response.error).toBeUndefined();
    expect(names).toContain('create_intent');
    expect(names).toContain('list_agents');
    expect(names).toContain('read_docs');
    expect(names).not.toContain('update_agent');
    expect(names).not.toContain('discover_opportunities');
    expect(names).not.toContain('scrape_url');
    expect(names).not.toContain('list_contacts');
    expect(names).not.toContain('read_user_profiles');
    expect(getCachedMcpToolMetadata(deps)).toBe(staticMetadata);
    expect(staticMetadata.some((tool) => tool.name === 'discover_opportunities')).toBe(true);
  });

  it('keeps caller-specific tools/list decisions isolated across servers', async () => {
    clearMcpToolMetadataCacheForTests();
    const deps = {
      ...mockDeps,
      database: resolvedContextDatabase,
    };

    const humanResponse = await invokeMcpRequest({
      server: createMcpServer(
        deps,
        {
          resolveIdentity: async () => ({
            userId: 'test-user-id',
            isSessionAuth: true,
          }),
          resolveUserId: async () => 'test-user-id',
        },
        mockScopedDepsFactory,
      ),
      method: 'tools/list',
      headers: { authorization: 'Bearer session-token' },
    });
    const unregisteredResponse = await invokeMcpRequest({
      server: createMcpServer(
        deps,
        {
          resolveIdentity: async () => ({ userId: 'test-user-id' }),
          resolveUserId: async () => 'test-user-id',
        },
        mockScopedDepsFactory,
      ),
      method: 'tools/list',
      headers: { 'x-api-key': 'ordinary-key' },
    });

    const humanNames = humanResponse.result?.tools?.map((tool) => tool.name) ?? [];
    const unregisteredNames = unregisteredResponse.result?.tools?.map((tool) => tool.name) ?? [];
    expect(humanNames).toContain('discover_opportunities');
    expect(humanNames).toContain('update_agent');
    expect(humanNames).not.toContain('confirm_opportunity_delivery');
    expect(humanNames).not.toContain('scrape_url');
    expect(humanNames).not.toContain('list_contacts');
    expect(humanNames).not.toContain('read_user_profiles');
    expect(unregisteredNames).toEqual([]);
  });

  it('rejects a forged tools/call to a removed MCP surface as an unregistered tool', async () => {
    clearMcpToolMetadataCacheForTests();
    const deps = { ...mockDeps, database: resolvedContextDatabase };
    const server = createMcpServer(
      deps,
      {
        resolveIdentity: async () => ({ userId: 'test-user-id', isSessionAuth: true }),
        resolveUserId: async () => 'test-user-id',
      },
      mockScopedDepsFactory,
    );

    // Even the broadest caller (session human) cannot reach the removed tools:
    // they are omitted from the MCP registry, so the SDK rejects tools/call with
    // a JSON-RPC InvalidParams (-32602) "Tool <name> not found" error BEFORE any
    // handler runs. This is distinct from a policy denial (which returns a
    // result with isError + MCP_CAPABILITY_DENIED) or a handler error — both of
    // which must fail this assertion.
    for (const removed of ['scrape_url', 'list_contacts', 'read_user_profiles', 'import_gmail_contacts', 'get_profile_run', 'report_agent_activity']) {
      const response = await invokeMcpRequest({
        server,
        method: 'tools/call',
        requestParams: { name: removed, arguments: {} },
        headers: { authorization: 'Bearer session-token' },
      });
      expect(response.result, `${removed} must not execute or return a policy denial`).toBeUndefined();
      expect(response.error?.code, `${removed} must be rejected as an unregistered tool`).toBe(-32602);
      expect(response.error?.message).toBe(`Tool ${removed} not found`);
    }
  });

  it('denies forged hidden tools/call before chat DB, scoped DB, registry, or graph work', async () => {
    let chatDatabaseReads = 0;
    let scopedDatabaseCreations = 0;
    const deps = {
      ...mockDeps,
      database: new Proxy(resolvedContextDatabase, {
        get(target, property, receiver) {
          if (typeof property === 'string' && property.startsWith('get')) {
            return async () => {
              chatDatabaseReads += 1;
              throw new Error('chat database must not be reached');
            };
          }
          return Reflect.get(target, property, receiver);
        },
      }),
    };
    const server = createMcpServer(
      deps,
      {
        resolveIdentity: async () => ({ userId: 'test-user-id' }),
        resolveUserId: async () => 'test-user-id',
      },
      {
        create: () => {
          scopedDatabaseCreations += 1;
          throw new Error('scoped database must not be created');
        },
      },
    );

    const response = await invokeMcpRequest({
      server,
      method: 'tools/call',
      requestParams: {
        name: 'discover_opportunities',
        arguments: {},
      },
      headers: { 'x-api-key': 'ordinary-key' },
    });
    const payload = JSON.parse(response.result?.content?.[0]?.text ?? '{}') as {
      code?: string;
    };

    expect(response.result?.isError).toBe(true);
    expect(payload.code).toBe('MCP_CAPABILITY_DENIED');
    expect(chatDatabaseReads).toBe(0);
    expect(scopedDatabaseCreations).toBe(0);
  });

  it('keeps registered-agent tools/list and forged tools/call in policy parity before context work', async () => {
    let chatDatabaseReads = 0;
    let scopedDatabaseCreations = 0;
    const agentDb: AgentDatabase = {
      ...mockAgentDb,
      getAgentWithRelations: async () => ({
        id: 'agent-1',
        ownerId: 'test-user-id',
        name: 'Agent',
        description: null,
        type: 'external',
        status: 'active',
        metadata: {},
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        transports: [],
        permissions: [{
          id: 'permission-1',
          agentId: 'agent-1',
          userId: 'test-user-id',
          scope: 'global',
          scopeId: null,
          actions: ['manage:intents'],
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }],
      }),
    };
    const guardedDatabase = new Proxy(resolvedContextDatabase, {
      get(target, property, receiver) {
        if (typeof property === 'string' && property.startsWith('get')) {
          return async () => {
            chatDatabaseReads += 1;
            throw new Error('chat database must not be reached');
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const server = createMcpServer(
      {
        ...mockDeps,
        database: guardedDatabase,
        agentDatabase: agentDb,
      },
      {
        resolveIdentity: async () => ({
          userId: 'test-user-id',
          agentId: 'agent-1',
        }),
        resolveUserId: async () => 'test-user-id',
      },
      {
        create: () => {
          scopedDatabaseCreations += 1;
          throw new Error('scoped database must not be created');
        },
      },
    );

    const response = await invokeMcpRequest({
      server,
      method: 'tools/call',
      requestParams: {
        name: 'discover_opportunities',
        arguments: {},
      },
      headers: { 'x-api-key': 'agent-key' },
    });
    const payload = JSON.parse(response.result?.content?.[0]?.text ?? '{}') as {
      code?: string;
    };

    expect(response.result?.isError).toBe(true);
    expect(payload.code).toBe('MCP_CAPABILITY_DENIED');
    expect(chatDatabaseReads).toBe(0);
    expect(scopedDatabaseCreations).toBe(0);
  });

  it('projects read_activity_summary per caller and narrows network agents at the adapter input', async () => {
    clearMcpToolMetadataCacheForTests();

    const fullSummary = {
      sinceHours: 24,
      liveSignalsWatched: 2,
      opportunitiesSurfaced: 4,
      opportunitiesBySignal: [{ intentId: 'intent-1', title: 'Climate founders', count: 4 }],
      pendingQuestionsByMode: { intent: 1, negotiation: 2, chat: 5 },
      answeredQuestionsByMode: { enrichment: 3 },
      negotiationsStarted: 5,
      negotiationsCompleted: 6,
    };
    const summaryInputs: Array<{ sinceHours: number; networkId?: string }> = [];
    const scopedFactory: ScopedDepsFactory = {
      create: () => ({
        userDb: {
          getAgentActivitySummary: async (input: { sinceHours: number; networkId?: string }) => {
            summaryInputs.push(input);
            return { ...fullSummary, sinceHours: input.sinceHours };
          },
        } as unknown as ToolDeps['userDb'],
        systemDb: {} as ToolDeps['systemDb'],
      }),
    };

    const networkAgentDb: AgentDatabase = {
      ...mockAgentDb,
      getAgentWithRelations: async () => ({
        id: 'agent-net',
        ownerId: 'test-user-id',
        name: 'Network Agent',
        description: null,
        type: 'external',
        status: 'active',
        metadata: {},
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        transports: [],
        permissions: [{
          id: 'permission-1',
          agentId: 'agent-net',
          userId: 'test-user-id',
          scope: 'network',
          scopeId: 'network-1',
          actions: ['manage:intents', 'manage:opportunities'],
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }],
      }),
    };
    const deps = {
      ...mockDeps,
      database: resolvedContextDatabase,
      agentDatabase: networkAgentDb,
    };

    const callSummary = async (
      identity: Record<string, unknown>,
      headers: Record<string, string>,
    ) => {
      const server = createMcpServer(
        deps,
        {
          resolveIdentity: async () => identity,
          resolveUserId: async () => 'test-user-id',
        } as McpAuthResolver,
        scopedFactory,
      );
      return invokeMcpRequest({
        server,
        method: 'tools/call',
        requestParams: { name: 'read_activity_summary', arguments: {} },
        headers,
      });
    };

    // Session human: every domain, no network narrowing.
    const humanResponse = await callSummary(
      { userId: 'test-user-id', isSessionAuth: true },
      { authorization: 'Bearer session-token' },
    );
    const humanPayload = JSON.parse(humanResponse.result?.content?.[0]?.text ?? '{}') as {
      success: boolean;
      data: Record<string, unknown>;
    };
    expect(humanResponse.result?.isError).toBeUndefined();
    expect(humanPayload.success).toBe(true);
    expect(humanPayload.data).toEqual({
      sinceHours: 24,
      liveSignalsWatched: 2,
      opportunitiesSurfaced: 4,
      opportunitiesBySignal: fullSummary.opportunitiesBySignal,
      pendingQuestionsByDomain: { intents: 1, negotiations: 2, chat: 5 },
      answeredQuestionsByDomain: { premises: 3 },
      negotiationsStarted: 5,
      negotiationsCompleted: 6,
    });
    expect(summaryInputs.at(-1)).toEqual({ sinceHours: 24 });

    // Network agent: per-domain projection, bound community passed to the adapter.
    const agentResponse = await callSummary(
      { userId: 'test-user-id', agentId: 'agent-net', networkScopeId: 'network-1' },
      { 'x-api-key': 'agent-key' },
    );
    const agentPayload = JSON.parse(agentResponse.result?.content?.[0]?.text ?? '{}') as {
      success: boolean;
      data: Record<string, unknown>;
    };
    expect(agentResponse.result?.isError).toBeUndefined();
    expect(agentPayload.success).toBe(true);
    // manage:intents + manage:opportunities release only intent-affected
    // question counts; negotiation-mode and chat-mode counts stay hidden.
    expect(agentPayload.data).toEqual({
      sinceHours: 24,
      liveSignalsWatched: 2,
      opportunitiesSurfaced: 4,
      opportunitiesBySignal: fullSummary.opportunitiesBySignal,
      pendingQuestionsByDomain: { intents: 1 },
    });
    expect('negotiationsStarted' in agentPayload.data).toBe(false);
    expect(summaryInputs.at(-1)).toEqual({ sinceHours: 24, networkId: 'network-1' });
  });

  it('denies read_activity_summary to agents without any activity-domain permission', async () => {
    clearMcpToolMetadataCacheForTests();
    const networksOnlyAgentDb: AgentDatabase = {
      ...mockAgentDb,
      getAgentWithRelations: async () => ({
        id: 'agent-1',
        ownerId: 'test-user-id',
        name: 'Agent',
        description: null,
        type: 'external',
        status: 'active',
        metadata: {},
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        transports: [],
        permissions: [{
          id: 'permission-1',
          agentId: 'agent-1',
          userId: 'test-user-id',
          scope: 'global',
          scopeId: null,
          actions: ['manage:networks'],
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }],
      }),
    };
    const deps = {
      ...mockDeps,
      database: resolvedContextDatabase,
      agentDatabase: networksOnlyAgentDb,
    };
    const server = createMcpServer(
      deps,
      {
        resolveIdentity: async () => ({
          userId: 'test-user-id',
          agentId: 'agent-1',
        }),
        resolveUserId: async () => 'test-user-id',
      },
      mockScopedDepsFactory,
    );

    const listResponse = await invokeMcpRequest({
      server,
      method: 'tools/list',
      headers: { 'x-api-key': 'agent-key' },
    });
    const names = listResponse.result?.tools?.map((tool) => tool.name) ?? [];
    expect(names).not.toContain('read_activity_summary');

    const callResponse = await invokeMcpRequest({
      server,
      method: 'tools/call',
      requestParams: { name: 'read_activity_summary', arguments: {} },
      headers: { 'x-api-key': 'agent-key' },
    });
    const payload = JSON.parse(callResponse.result?.content?.[0]?.text ?? '{}') as {
      code?: string;
    };
    expect(callResponse.result?.isError).toBe(true);
    expect(payload.code).toBe('MCP_CAPABILITY_DENIED');
  });

  // ── IND-608: independent tools/call authorization & scope matrix ────────────
  //
  // These exercise capability authorization at the transport boundary via real
  // tools/call requests with SCHEMA-VALID arguments (the MCP SDK validates the
  // registered input schema BEFORE the handler runs, so empty args on a tool
  // with required fields would surface as a schema error, not a policy result).
  // Positive admission is proven by reaching the scoped-deps/handler seam (the
  // scopedDepsFactory.create spy), never merely by the absence of a denial code.

  /** Builds an agent registry snapshot with a single permission row. */
  function agentDbWith(permission: {
    agentId: string;
    scope: 'global' | 'network';
    scopeId: string | null;
    actions: string[];
  }): AgentDatabase {
    return {
      ...mockAgentDb,
      getAgentWithRelations: async () => ({
        id: permission.agentId,
        ownerId: 'test-user-id',
        name: 'Agent',
        description: null,
        type: 'external',
        status: 'active',
        metadata: {},
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        transports: [],
        permissions: [{
          id: 'permission-1',
          agentId: permission.agentId,
          userId: 'test-user-id',
          scope: permission.scope,
          scopeId: permission.scopeId,
          actions: permission.actions,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }],
      }),
    };
  }

  /** A context database whose reads throw, proving denial happens before DB work. */
  function guardReads(counter: { reads: number }): ToolDeps['database'] {
    return new Proxy(resolvedContextDatabase, {
      get(target, property, receiver) {
        if (typeof property === 'string' && property.startsWith('get')) {
          return async () => {
            counter.reads += 1;
            throw new Error('chat database must not be reached');
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
  }

  interface CallToolOutcome {
    isError?: boolean;
    code?: string;
    text: string;
    /** Records each scopedDepsFactory.create(userId, allowedNetworkIds) call. */
    scopedCreateArgs: Array<{ userId: string; allowedNetworkIds: string[] }>;
  }

  async function callTool(params: {
    identity: Record<string, unknown>;
    toolName: string;
    arguments: Record<string, unknown>;
    agentDatabase?: AgentDatabase;
    database?: ToolDeps['database'];
    extraDeps?: Partial<ToolDeps>;
    headers?: Record<string, string>;
    /** When true, the scoped-deps factory throws if the handler seam is reached. */
    scopedThrows?: boolean;
    /** Functional scoped databases for handlers that must run past the seam
     *  (e.g. a resource-level clamp fired inside the tool handler). */
    scopedUserDb?: ToolDeps['userDb'];
    scopedSystemDb?: ToolDeps['systemDb'];
  }): Promise<CallToolOutcome> {
    clearMcpToolMetadataCacheForTests();
    const scopedCreateArgs: Array<{ userId: string; allowedNetworkIds: string[] }> = [];
    const scopedFactory: ScopedDepsFactory = {
      create: (userId: string, allowedNetworkIds: string[]) => {
        scopedCreateArgs.push({ userId, allowedNetworkIds });
        if (params.scopedThrows) throw new Error('scoped database must not be created');
        return {
          userDb: params.scopedUserDb ?? ({} as ToolDeps['userDb']),
          systemDb: params.scopedSystemDb ?? ({} as ToolDeps['systemDb']),
        };
      },
    };
    const server = createMcpServer(
      {
        ...mockDeps,
        database: params.database ?? resolvedContextDatabase,
        agentDatabase: params.agentDatabase ?? mockAgentDb,
        ...params.extraDeps,
      },
      {
        resolveIdentity: async () => params.identity,
        resolveUserId: async () => 'test-user-id',
      } as McpAuthResolver,
      scopedFactory,
    );
    const response = await invokeMcpRequest({
      server,
      method: 'tools/call',
      requestParams: { name: params.toolName, arguments: params.arguments },
      headers: params.headers ?? { 'x-api-key': 'agent-key' },
    });
    const text = response.result?.content?.[0]?.text ?? '';
    let code: string | undefined;
    try {
      code = (JSON.parse(text || '{}') as { code?: string }).code;
    } catch {
      code = undefined;
    }
    return { isError: response.result?.isError, code, text, scopedCreateArgs };
  }

  it('denies a forged cross-network create_intent before context, scoped DB, or graph work', async () => {
    // The agent is bound to network-1 but its only manage:intents grant is scoped
    // to network-2, so the grant does not apply. With schema-valid arguments the
    // SDK schema passes and the capability layer denies at the preliminary stage,
    // before any chat context read, scoped DB creation, or graph work.
    const counter = { reads: 0 };
    const result = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-x', networkScopeId: 'network-1' },
      agentDatabase: agentDbWith({ agentId: 'agent-x', scope: 'network', scopeId: 'network-2', actions: ['manage:intents'] }),
      database: guardReads(counter),
      scopedThrows: true,
      toolName: 'create_intent',
      arguments: { description: 'A specific valid discovery intent' },
    });
    expect(result.isError).toBe(true);
    expect(result.code).toBe('MCP_CAPABILITY_DENIED');
    expect(counter.reads).toBe(0);
    expect(result.scopedCreateArgs).toEqual([]);
  });

  it('admits a network agent whose grant matches its binding and reaches the scoped handler seam', async () => {
    // With a matching network-1 grant and schema-valid arguments, create_intent
    // is authorized and dispatch reaches the scoped-deps/handler seam.
    const result = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-x', networkScopeId: 'network-1' },
      agentDatabase: agentDbWith({ agentId: 'agent-x', scope: 'network', scopeId: 'network-1', actions: ['manage:intents'] }),
      toolName: 'create_intent',
      arguments: { description: 'A specific valid discovery intent' },
    });
    expect(result.code).not.toBe('MCP_CAPABILITY_DENIED');
    expect(result.scopedCreateArgs.length).toBe(1);
  });

  it('clamps a bound network-1 principal away from a network it is a member of (resource clamp)', async () => {
    // The user is a member of BOTH network-1 and network-2, but the agent is
    // bound to network-1. The scoped-deps factory must be constructed with only
    // the bound network in allowedNetworkIds, so no network-2 resource, graph, or
    // adapter work is reachable — the clamp is at scoped-deps construction, not a
    // per-row permission check.
    const memberDb = {
      ...resolvedContextDatabase,
      getNetworkMemberships: async () => ([
        { networkId: 'network-1', networkTitle: 'N1', isPersonal: false, permissions: [] },
        { networkId: 'network-2', networkTitle: 'N2', isPersonal: false, permissions: [] },
      ]),
    } as unknown as ToolDeps['database'];
    const result = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-c', networkScopeId: 'network-1' },
      agentDatabase: agentDbWith({ agentId: 'agent-c', scope: 'network', scopeId: 'network-1', actions: ['manage:intents'] }),
      database: memberDb,
      toolName: 'read_intents',
      arguments: {},
    });
    expect(result.scopedCreateArgs.length).toBe(1);
    const allowed = result.scopedCreateArgs[0]!.allowedNetworkIds;
    expect(allowed).toContain('network-1');
    expect(allowed).not.toContain('network-2');
  });

  it('restricts confirm_opportunity_delivery to designated delivery agents, before DB work', async () => {
    // Ordinary agent with manage:opportunities and schema-valid arguments is
    // denied by the delivery_only rule before context/scoped DB work.
    const counter = { reads: 0 };
    const denied = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-d' },
      agentDatabase: agentDbWith({ agentId: 'agent-d', scope: 'global', scopeId: null, actions: ['manage:opportunities'] }),
      database: guardReads(counter),
      scopedThrows: true,
      toolName: 'confirm_opportunity_delivery',
      arguments: { opportunityId: '00000000-0000-4000-8000-000000000001', trigger: 'ambient' },
    });
    expect(denied.isError).toBe(true);
    expect(denied.code).toBe('MCP_CAPABILITY_DENIED');
    expect(counter.reads).toBe(0);
    expect(denied.scopedCreateArgs).toEqual([]);

    // A designated delivery agent is admitted and reaches the scoped handler seam.
    const allowed = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-d', isDeliveryAgent: true },
      agentDatabase: agentDbWith({ agentId: 'agent-d', scope: 'global', scopeId: null, actions: ['manage:opportunities'] }),
      toolName: 'confirm_opportunity_delivery',
      arguments: { opportunityId: '00000000-0000-4000-8000-000000000001', trigger: 'ambient' },
    });
    expect(allowed.code).not.toBe('MCP_CAPABILITY_DENIED');
    expect(allowed.scopedCreateArgs.length).toBe(1);
  });

  it('lets a network agent reach meta-network premises with manage:premises (principal reach)', async () => {
    // Premises are meta-network: a network-bound agent holding manage:premises
    // retains principal reach for read_premises and reaches the scoped seam.
    const result = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-p', networkScopeId: 'network-1' },
      agentDatabase: agentDbWith({ agentId: 'agent-p', scope: 'network', scopeId: 'network-1', actions: ['manage:premises'] }),
      toolName: 'read_premises',
      arguments: {},
    });
    expect(result.code).not.toBe('MCP_CAPABILITY_DENIED');
    expect(result.scopedCreateArgs.length).toBe(1);
  });

  it('denies a network agent premises access when it lacks manage:premises, before DB work', async () => {
    const counter = { reads: 0 };
    const result = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-p', networkScopeId: 'network-1' },
      agentDatabase: agentDbWith({ agentId: 'agent-p', scope: 'network', scopeId: 'network-1', actions: ['manage:intents'] }),
      database: guardReads(counter),
      scopedThrows: true,
      toolName: 'read_premises',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.code).toBe('MCP_CAPABILITY_DENIED');
    expect(counter.reads).toBe(0);
    expect(result.scopedCreateArgs).toEqual([]);
  });

  it('keeps H2A chat history human-only: a permissioned agent is denied, the owning human is admitted', async () => {
    // list_conversations is human_only. It is only registered when chatSession is
    // present, so include it and prove the agent is capability-denied while the
    // owning session human reaches the handler seam.
    const chatSession = {
      listSessions: async () => [],
      getSession: async () => null,
    } as unknown as ToolDeps['chatSession'];

    const counter = { reads: 0 };
    const agentDenied = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-h' },
      agentDatabase: agentDbWith({ agentId: 'agent-h', scope: 'global', scopeId: null, actions: ['manage:intents'] }),
      extraDeps: { chatSession },
      database: guardReads(counter),
      scopedThrows: true,
      toolName: 'list_conversations',
      arguments: {},
    });
    expect(agentDenied.isError).toBe(true);
    expect(agentDenied.code).toBe('MCP_CAPABILITY_DENIED');
    expect(counter.reads).toBe(0);
    expect(agentDenied.scopedCreateArgs).toEqual([]);

    const humanAllowed = await callTool({
      identity: { userId: 'test-user-id', isSessionAuth: true },
      extraDeps: { chatSession },
      headers: { authorization: 'Bearer session-token' },
      toolName: 'list_conversations',
      arguments: {},
    });
    expect(humanAllowed.code).not.toBe('MCP_CAPABILITY_DENIED');
    expect(humanAllowed.scopedCreateArgs.length).toBe(1);
  });

  it('enforces exact question affected-domain inheritance on answer_pending_question at tools/call', async () => {
    // The canonical matrix admits answer_pending_question with a UNION of domain
    // actions, so a global manage:intents agent passes capability policy and
    // reaches the handler. The handler must then deny answering a NEGOTIATION
    // question (wrong affected domain) and write nothing.
    const negotiationQuestion = {
      id: 'neg-1',
      title: 'Negotiation question',
      prompt: 'Prompt',
      options: [],
      multiSelect: false,
      mode: 'negotiation',
      sourceType: 'negotiation',
      sourceId: 'task-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    let answerWrites = 0;
    const answerCalls: Array<{ userId: string; questionId: string }> = [];
    const questionDeps: Partial<ToolDeps> = {
      findPendingQuestions: (async (userId: string) => {
        void userId;
        return [negotiationQuestion];
      }) as unknown as ToolDeps['findPendingQuestions'],
      answerPendingQuestion: (async (userId: string, questionId: string) => {
        answerWrites += 1;
        answerCalls.push({ userId, questionId });
        return true;
      }) as unknown as ToolDeps['answerPendingQuestion'],
    };

    // Wrong-domain global agent: admitted by policy, denied by the handler gate,
    // nothing written.
    const denied = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-q' },
      agentDatabase: agentDbWith({ agentId: 'agent-q', scope: 'global', scopeId: null, actions: ['manage:intents'] }),
      extraDeps: questionDeps,
      toolName: 'answer_pending_question',
      arguments: { questionId: 'neg-1', freeText: 'the client\u2019s explicit answer' },
    });
    // Reached the handler (not a capability denial), but refused with no write.
    expect(denied.code).not.toBe('MCP_CAPABILITY_DENIED');
    const deniedPayload = JSON.parse(denied.text) as { success: boolean; error?: string };
    expect(deniedPayload.success).toBe(false);
    expect(deniedPayload.error).toMatch(/not authorized to answer this question/i);
    expect(answerWrites).toBe(0);

    // Matching-domain agent: admitted and the write is threaded with the
    // authenticated caller userId (provenance).
    const allowed = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-q' },
      agentDatabase: agentDbWith({ agentId: 'agent-q', scope: 'global', scopeId: null, actions: ['manage:negotiations'] }),
      extraDeps: questionDeps,
      toolName: 'answer_pending_question',
      arguments: { questionId: 'neg-1', freeText: 'the client\u2019s explicit answer' },
    });
    const allowedPayload = JSON.parse(allowed.text) as { success: boolean; data?: Record<string, unknown> };
    expect(allowedPayload.success).toBe(true);
    expect(answerWrites).toBe(1);
    expect(answerCalls).toEqual([{ userId: 'test-user-id', questionId: 'neg-1' }]);
  });

  it('projects read_pending_questions by exact affected domain at tools/call', async () => {
    // A global manage:intents agent sees intent questions but never negotiation
    // questions, even though the tool is union-admitted.
    const questions = [
      { id: 'intent-q', title: 'I', prompt: 'p', options: [], multiSelect: false, mode: 'intent', sourceType: 'intent', sourceId: 'i1', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'neg-q', title: 'N', prompt: 'p', options: [], multiSelect: false, mode: 'negotiation', sourceType: 'negotiation', sourceId: 't1', createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    const questionDeps: Partial<ToolDeps> = {
      findPendingQuestions: (async () => questions) as unknown as ToolDeps['findPendingQuestions'],
    };

    const result = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-q' },
      agentDatabase: agentDbWith({ agentId: 'agent-q', scope: 'global', scopeId: null, actions: ['manage:intents'] }),
      extraDeps: questionDeps,
      toolName: 'read_pending_questions',
      arguments: {},
    });
    const payload = JSON.parse(result.text) as { success: boolean; data?: { questions?: Array<{ id: string }> } };
    expect(payload.success).toBe(true);
    const ids = (payload.data?.questions ?? []).map((q) => q.id);
    expect(ids).toEqual(['intent-q']);
  });

  // ── IND-583: human-only onboarding privacy consent at the transport seam ────
  //
  // record_onboarding_privacy_consent and complete_onboarding are human_only. A
  // registered agent — even one holding BOTH manage:identity and manage:premises
  // (the exact pair the retired manage:profile grant projected to) — must neither
  // see them in tools/list nor reach them via tools/call, and the denial must
  // land before any chat DB, scoped DB, registry, or graph work. The session
  // human is admitted and reaches the scoped handler seam. tools/list and
  // tools/call therefore agree for both principals.
  const IDENTITY_PREMISES_ACTIONS = ['manage:identity', 'manage:premises'];
  const HUMAN_ONLY_ONBOARDING_TOOLS = ['record_onboarding_privacy_consent', 'complete_onboarding'] as const;

  it('hides onboarding privacy consent tools from an agent holding identity+premises grants (tools/list)', async () => {
    clearMcpToolMetadataCacheForTests();
    const deps = {
      ...mockDeps,
      database: resolvedContextDatabase,
      agentDatabase: agentDbWith({ agentId: 'agent-ip', scope: 'global', scopeId: null, actions: IDENTITY_PREMISES_ACTIONS }),
    };
    const server = createMcpServer(
      deps,
      {
        resolveIdentity: async () => ({ userId: 'test-user-id', agentId: 'agent-ip' }),
        resolveUserId: async () => 'test-user-id',
      },
      mockScopedDepsFactory,
    );
    const response = await invokeMcpRequest({ server, method: 'tools/list', headers: { 'x-api-key': 'agent-key' } });
    const names = response.result?.tools?.map((tool) => tool.name) ?? [];
    for (const tool of HUMAN_ONLY_ONBOARDING_TOOLS) {
      expect(names, `${tool} must be hidden from an identity+premises agent`).not.toContain(tool);
    }
  });

  it('denies an identity+premises agent calling onboarding consent tools before any DB or graph work', async () => {
    for (const tool of HUMAN_ONLY_ONBOARDING_TOOLS) {
      const counter = { reads: 0 };
      const result = await callTool({
        identity: { userId: 'test-user-id', agentId: 'agent-ip' },
        agentDatabase: agentDbWith({ agentId: 'agent-ip', scope: 'global', scopeId: null, actions: IDENTITY_PREMISES_ACTIONS }),
        database: guardReads(counter),
        scopedThrows: true,
        toolName: tool,
        arguments: {},
      });
      expect(result.isError, `${tool} must be denied`).toBe(true);
      expect(result.code, `${tool} must be a capability denial`).toBe('MCP_CAPABILITY_DENIED');
      expect(counter.reads, `${tool} must deny before chat DB`).toBe(0);
      expect(result.scopedCreateArgs, `${tool} must deny before scoped DB`).toEqual([]);
    }
  });

  it('admits the session human to onboarding privacy consent tools and reaches the scoped handler seam', async () => {
    // Schema-valid arguments; the session human passes policy and reaches the
    // scoped-deps/handler seam (scopedCreateArgs), which is the admission
    // boundary — the exact parity partner of the agent denial above.
    const consent = await callTool({
      identity: { userId: 'test-user-id', isSessionAuth: true },
      headers: { authorization: 'Bearer session-token' },
      toolName: 'record_onboarding_privacy_consent',
      arguments: { publicProfileLookupGranted: true },
    });
    expect(consent.code).not.toBe('MCP_CAPABILITY_DENIED');
    expect(consent.scopedCreateArgs.length).toBe(1);

    const complete = await callTool({
      identity: { userId: 'test-user-id', isSessionAuth: true },
      headers: { authorization: 'Bearer session-token' },
      toolName: 'complete_onboarding',
      arguments: {},
    });
    expect(complete.code).not.toBe('MCP_CAPABILITY_DENIED');
    expect(complete.scopedCreateArgs.length).toBe(1);
  });

  // ── IND-588: signals read/write split at the transport seam ─────────────────
  //
  // Signal READ tools (read_intents, search_intents, read_intent_indexes) are
  // `authenticated`; every MUTATION and community-assignment tool requires
  // manage:intents. An authenticated registered agent WITHOUT manage:intents may
  // reach the read seam but is capability-denied on every mutation before DB or
  // graph work, and those mutations are absent from its tools/list. (The
  // create_intent cross-network case is covered above; these prove the
  // read-allow-vs-write-deny split, the network read clamp, and one out-of-scope
  // non-create mutation denial.)
  const NON_INTENT_AGENT_ACTIONS = ['manage:opportunities'];

  it('lets an authenticated agent without manage:intents reach the read_intents seam', async () => {
    const result = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-sr' },
      agentDatabase: agentDbWith({ agentId: 'agent-sr', scope: 'global', scopeId: null, actions: NON_INTENT_AGENT_ACTIONS }),
      toolName: 'read_intents',
      arguments: {},
    });
    expect(result.code).not.toBe('MCP_CAPABILITY_DENIED');
    expect(result.scopedCreateArgs.length).toBe(1);
  });

  it('hides signal mutation and community-assignment tools from an agent without manage:intents (tools/list)', async () => {
    clearMcpToolMetadataCacheForTests();
    const deps = {
      ...mockDeps,
      database: resolvedContextDatabase,
      agentDatabase: agentDbWith({ agentId: 'agent-sr', scope: 'global', scopeId: null, actions: NON_INTENT_AGENT_ACTIONS }),
    };
    const server = createMcpServer(
      deps,
      {
        resolveIdentity: async () => ({ userId: 'test-user-id', agentId: 'agent-sr' }),
        resolveUserId: async () => 'test-user-id',
      },
      mockScopedDepsFactory,
    );
    const response = await invokeMcpRequest({ server, method: 'tools/list', headers: { 'x-api-key': 'agent-key' } });
    const names = response.result?.tools?.map((tool) => tool.name) ?? [];
    // Reads remain usable.
    expect(names).toContain('read_intents');
    expect(names).toContain('search_intents');
    expect(names).toContain('read_intent_indexes');
    // Mutations and community assignment are absent.
    for (const tool of ['create_intent', 'update_intent', 'delete_intent', 'create_intent_index', 'delete_intent_index']) {
      expect(names, `${tool} must be hidden without manage:intents`).not.toContain(tool);
    }
  });

  it('denies signal mutations and community assignment for an agent without manage:intents before DB work', async () => {
    const writes: Array<{ tool: string; args: Record<string, unknown> }> = [
      { tool: 'update_intent', args: { intentId: '00000000-0000-4000-8000-000000000010', description: 'a refined specific signal' } },
      { tool: 'delete_intent', args: { intentId: '00000000-0000-4000-8000-000000000010' } },
      { tool: 'create_intent_index', args: { intentId: '00000000-0000-4000-8000-000000000010', networkId: '00000000-0000-4000-8000-000000000020' } },
      { tool: 'delete_intent_index', args: { intentId: '00000000-0000-4000-8000-000000000010', networkId: '00000000-0000-4000-8000-000000000020' } },
    ];
    for (const { tool, args } of writes) {
      const counter = { reads: 0 };
      const result = await callTool({
        identity: { userId: 'test-user-id', agentId: 'agent-sr' },
        agentDatabase: agentDbWith({ agentId: 'agent-sr', scope: 'global', scopeId: null, actions: NON_INTENT_AGENT_ACTIONS }),
        database: guardReads(counter),
        scopedThrows: true,
        toolName: tool,
        arguments: args,
      });
      expect(result.isError, `${tool} must be denied`).toBe(true);
      expect(result.code, `${tool} must be a capability denial`).toBe('MCP_CAPABILITY_DENIED');
      expect(counter.reads, `${tool} must deny before chat DB`).toBe(0);
      expect(result.scopedCreateArgs, `${tool} must deny before scoped DB`).toEqual([]);
    }
  });

  it('clamps a network-scoped read-only agent to its bound network on read_intents', async () => {
    // Distinct from the manage:intents clamp case above: even an authenticated
    // read-only network agent is clamped at scoped-deps construction to its bound
    // network, never the other network the user also belongs to.
    const memberDb = {
      ...resolvedContextDatabase,
      getNetworkMemberships: async () => ([
        { networkId: 'network-1', networkTitle: 'N1', isPersonal: false, permissions: [] },
        { networkId: 'network-2', networkTitle: 'N2', isPersonal: false, permissions: [] },
      ]),
    } as unknown as ToolDeps['database'];
    const result = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-srn', networkScopeId: 'network-1' },
      agentDatabase: agentDbWith({ agentId: 'agent-srn', scope: 'network', scopeId: 'network-1', actions: NON_INTENT_AGENT_ACTIONS }),
      database: memberDb,
      toolName: 'read_intents',
      arguments: {},
    });
    expect(result.scopedCreateArgs.length).toBe(1);
    const allowed = result.scopedCreateArgs[0]!.allowedNetworkIds;
    expect(allowed).toContain('network-1');
    expect(allowed).not.toContain('network-2');
  });

  it('admits a bound network agent to create_intent_index then resource-clamps a schema-valid out-of-network assignment before the write', async () => {
    // Production-reachable resource-level denial (not a permission-row-loss case):
    // the agent is bound to network-1 AND holds an applicable network-1
    // manage:intents grant, so capability policy ADMITS and dispatch reaches the
    // scoped handler seam. It then asks to assign an intent to network-2 (an
    // explicit out-of-network community). The tool's own network/resource clamp
    // rejects with a stable domain message BEFORE any intent-index graph/write.
    let intentIndexGraphCalls = 0;
    const scopedSystemDb = {
      // Member of the bound network, so ensureScopedMembership passes.
      isNetworkMember: async () => true,
    } as unknown as ToolDeps['systemDb'];
    const graphs = {
      ...mockDeps.graphs,
      intentIndex: {
        invoke: async () => {
          intentIndexGraphCalls += 1;
          return {};
        },
      },
    } as unknown as ToolDeps['graphs'];
    // The user is a member of the bound network-1 (so allowedNetworkIds resolves
    // to network-1); the requested network-2 is out of the binding.
    const memberDb = {
      ...resolvedContextDatabase,
      getNetworkMemberships: async () => ([
        { networkId: 'network-1', networkTitle: 'N1', isPersonal: false, permissions: [] },
      ]),
    } as unknown as ToolDeps['database'];

    const result = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-ci', networkScopeId: 'network-1' },
      agentDatabase: agentDbWith({ agentId: 'agent-ci', scope: 'network', scopeId: 'network-1', actions: ['manage:intents'] }),
      database: memberDb,
      extraDeps: { graphs },
      scopedSystemDb,
      toolName: 'create_intent_index',
      arguments: {
        intentId: '00000000-0000-4000-8000-000000000010',
        networkId: '00000000-0000-4000-8000-000000000020',
      },
    });

    // Admission happened (not a capability denial) and the handler seam was reached.
    expect(result.code).not.toBe('MCP_CAPABILITY_DENIED');
    expect(result.scopedCreateArgs.length).toBe(1);
    // The bound-network clamp allowed only network-1 into the scoped deps.
    const allowed = result.scopedCreateArgs[0]!.allowedNetworkIds;
    expect(allowed).toContain('network-1');
    expect(allowed).not.toContain('00000000-0000-4000-8000-000000000020');
    // Stable resource/domain denial, not merely MCP_CAPABILITY_DENIED.
    const payload = JSON.parse(result.text) as { success: boolean; error?: string };
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/you can only link intents to this community/i);
    // Rejected before the intent-index graph/write.
    expect(intentIndexGraphCalls).toBe(0);
  });
});
