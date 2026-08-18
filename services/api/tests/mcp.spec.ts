import '../src/startup.env';
import { describe, it, expect, mock } from 'bun:test';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';

import { createMcpServer, clearMcpToolMetadataCacheForTests, getCachedMcpToolMetadata } from '../../../packages/protocol/src/mcp/mcp.server';
import { CANONICAL_MCP_TOOL_ACCESS_RULES } from '../../../packages/protocol/src/mcp/mcp.authorization-policy';
import { createAgentTools } from '../../../packages/protocol/src/agents/agent.tools';
import { createToolRegistry } from '../../../packages/protocol/src/shared/agent/tool.registry';
import type { ToolDeps } from '../../../packages/protocol/src/shared/agent/tool.helpers';
import type { McpAuthResolver } from '../../../packages/protocol/src/shared/interfaces/auth.interface';
import type { AgentDatabase } from '../../../packages/protocol/src/agents/agent.repository.port';
import type { ScopedDepsFactory } from '../../../packages/protocol/src/mcp/mcp.server';
import { createHmac } from 'node:crypto';
import { createOpportunityOwnerApprovalAuthority } from '../src/lib/mcp/owner-approval';
import { createMemoryOwnerApprovalStore } from '../src/lib/mcp/owner-approval.store';

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
      'read_user_contexts',
      'update_opportunity',
      'list_contacts',
      'scrape_url',
      'register_agent',
      'list_agents',
    ];

    for (const toolName of expectedTools) {
      expect(registry.has(toolName)).toBe(true);
    }
    for (const removedTool of ['discover_opportunities', 'get_discovery_run', 'cancel_discovery_run']) {
      expect(registry.has(removedTool)).toBe(false);
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
    // surface. Contact tools, scrape_url, and the deprecated aliases are
    // omitted from the MCP registry (IND-596/597/598).
    const mcpRegistry = createToolRegistry({
      ...mockDeps,
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
    // IND-599: a registered agent's agent-admin surface is read_own_agent only
    // — never list_agents (human admin view) or any mutation.
    expect(names).toContain('read_own_agent');
    expect(names).not.toContain('list_agents');
    expect(names).toContain('read_docs');
    expect(names).not.toContain('update_agent');
    expect(names).not.toContain('discover_opportunities');
    expect(names).not.toContain('scrape_url');
    expect(names).not.toContain('list_contacts');
    expect(names).not.toContain('read_user_profiles');
    expect(getCachedMcpToolMetadata(deps)).toBe(staticMetadata);
    for (const removedTool of ['discover_opportunities', 'get_discovery_run', 'cancel_discovery_run']) {
      expect(staticMetadata.some((tool) => tool.name === removedTool)).toBe(false);
    }
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
    for (const removedTool of ['discover_opportunities', 'get_discovery_run', 'cancel_discovery_run']) {
      expect(humanNames).not.toContain(removedTool);
    }
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
    for (const removed of [
      'discover_opportunities',
      'get_discovery_run',
      'cancel_discovery_run',
      'scrape_url',
      'list_contacts',
      'read_user_profiles',
      'import_gmail_contacts',
      'get_profile_run',
      'report_agent_activity',
    ]) {
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

    expect(response.result).toBeUndefined();
    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toBe('Tool discover_opportunities not found');
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

    expect(response.result).toBeUndefined();
    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toBe('Tool discover_opportunities not found');
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

  it('generic conversation tools: session-human-only tools/list + tools/call parity, zero resource calls on denial, no cross-category leak', async () => {
    // IND-600: list_conversations / get_conversation expose H2A chat history ONLY
    // to a genuinely session-authenticated human. Registered agents (including a
    // manage:negotiations agent), delivery agents, and API-key/non-session
    // callers are denied at the capability layer BEFORE context DB, scoped DB,
    // or the chatSession resource runs — and the tools vanish from their
    // tools/list inventory in parity with tools/call. Every tools/call payload
    // is SCHEMA-VALID so the policy layer (not input validation) is the thing
    // under test. Forged H2A/H2H/A2A target session IDs change nothing: the
    // denial fires before any resource work.
    const H2A_SESSION_ID = '00000000-0000-4000-8000-0000000000a1';
    const H2H_SESSION_ID = '00000000-0000-4000-8000-0000000000b2';
    const A2A_SESSION_ID = '00000000-0000-4000-8000-0000000000c3';

    const resourceCalls = { list: 0, get: 0 };
    const chatSession = {
      listSessions: async (_userId: string, _limit?: number) => {
        resourceCalls.list += 1;
        return [{
          sessionId: H2A_SESSION_ID,
          title: 'H2A orchestrator chat',
          messageCount: 1,
          lastMessageAt: new Date('2026-01-02T00:00:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }];
      },
      getSession: async (_userId: string, sessionId: string, _messageLimit?: number) => {
        resourceCalls.get += 1;
        // Mirror the production adapter contract (chat-session.adapter.ts →
        // listChatSessionSummaries/getChatSessionDetail): ONLY H2A sessions
        // (orchestrator persona + system-agent participant) resolve; H2H DMs
        // and A2A negotiation conversations return null at the resource
        // boundary, so their transcripts can never cross it.
        if (sessionId !== H2A_SESSION_ID) return null;
        return {
          sessionId: H2A_SESSION_ID,
          title: 'H2A orchestrator chat',
          messageCount: 1,
          lastMessageAt: new Date('2026-01-02T00:00:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          messages: [{ role: 'user', content: 'h2a-only-transcript-body', createdAt: new Date('2026-01-01T00:00:00.000Z') }],
        };
      },
      getSessionMessages: async () => [],
    } as unknown as ToolDeps['chatSession'];

    // ── Part 1: every non-session principal is hidden in tools/list and denied
    // in tools/call before ANY resource work, for both generic tools and for
    // forged H2A/H2H/A2A targets.
    const nonSessionPrincipals = [
      {
        label: 'registered global agent',
        identity: { userId: 'test-user-id', agentId: 'agent-cv1' },
        agentDatabase: agentDbWith({ agentId: 'agent-cv1', scope: 'global', scopeId: null, actions: ['manage:intents'] }),
      },
      {
        label: 'bound network agent holding manage:negotiations',
        identity: { userId: 'test-user-id', agentId: 'agent-cv2', networkScopeId: NETWORK_1 },
        agentDatabase: agentDbWith({ agentId: 'agent-cv2', scope: 'network', scopeId: NETWORK_1, actions: ['manage:negotiations'] }),
      },
      {
        label: 'designated delivery agent',
        identity: { userId: 'test-user-id', agentId: 'agent-cv3', isDeliveryAgent: true },
        agentDatabase: agentDbWith({ agentId: 'agent-cv3', scope: 'global', scopeId: null, actions: ['manage:opportunities'] }),
      },
      {
        label: 'enrollment-capable API key (no agent, no session)',
        identity: { userId: 'test-user-id', enrollmentCapable: true },
        agentDatabase: undefined,
      },
      {
        label: 'plain unregistered API key (no agent, no session)',
        identity: { userId: 'test-user-id' },
        agentDatabase: undefined,
      },
    ];

    for (const principal of nonSessionPrincipals) {
      const names = await listToolNamesFor({
        identity: principal.identity,
        agentDatabase: principal.agentDatabase,
        extraDeps: { chatSession },
      });
      expect(names, `${principal.label}: list_conversations hidden from tools/list`).not.toContain('list_conversations');
      expect(names, `${principal.label}: get_conversation hidden from tools/list`).not.toContain('get_conversation');

      const counter = { reads: 0 };
      const listDenied = await callTool({
        identity: principal.identity,
        agentDatabase: principal.agentDatabase,
        extraDeps: { chatSession },
        database: guardReads(counter),
        scopedThrows: true,
        toolName: 'list_conversations',
        arguments: {},
      });
      expect(listDenied.isError, `${principal.label}: list_conversations denied`).toBe(true);
      expect(listDenied.code, `${principal.label}: capability denial`).toBe('MCP_CAPABILITY_DENIED');
      expect(counter.reads, `${principal.label}: no context DB reads`).toBe(0);
      expect(listDenied.scopedCreateArgs, `${principal.label}: no scoped DB`).toEqual([]);

      // Forged cross-category targets: H2A, H2H, and A2A session IDs are all
      // equally unreachable — denial fires before the resource, so no target
      // category can be probed through the generic tool.
      for (const [category, targetId] of [['H2A', H2A_SESSION_ID], ['H2H', H2H_SESSION_ID], ['A2A', A2A_SESSION_ID]] as const) {
        const getDenied = await callTool({
          identity: principal.identity,
          agentDatabase: principal.agentDatabase,
          extraDeps: { chatSession },
          database: guardReads(counter),
          scopedThrows: true,
          toolName: 'get_conversation',
          arguments: { sessionId: targetId },
        });
        expect(getDenied.isError, `${principal.label}: get_conversation ${category} target denied`).toBe(true);
        expect(getDenied.code, `${principal.label}: capability denial for ${category} target`).toBe('MCP_CAPABILITY_DENIED');
        expect(getDenied.text, `${principal.label}: no transcript leak for ${category} target`).not.toContain('h2a-only-transcript-body');
      }
    }
    expect(resourceCalls.list, 'chatSession.listSessions never ran for a non-session caller').toBe(0);
    expect(resourceCalls.get, 'chatSession.getSession never ran for a non-session caller').toBe(0);

    // ── Part 2: the session-authenticated human sees both tools and reaches
    // the resource — which exposes ONLY H2A. H2H/A2A session IDs resolve to
    // null at the resource boundary and surface as "not found", leaking no
    // transcript and no existence signal beyond the generic not-found error.
    const humanHeaders = { authorization: 'Bearer session-token' };
    const humanIdentity = { userId: 'test-user-id', isSessionAuth: true };

    const humanNames = await listToolNamesFor({
      identity: humanIdentity,
      extraDeps: { chatSession },
      headers: humanHeaders,
    });
    expect(humanNames).toContain('list_conversations');
    expect(humanNames).toContain('get_conversation');

    const humanList = await callTool({
      identity: humanIdentity,
      extraDeps: { chatSession },
      headers: humanHeaders,
      toolName: 'list_conversations',
      arguments: { limit: 10 },
    });
    expect(humanList.code).not.toBe('MCP_CAPABILITY_DENIED');
    expect(humanList.scopedCreateArgs.length).toBe(1);
    const listPayload = JSON.parse(humanList.text) as { success: boolean; data?: { conversations?: Array<{ sessionId: string }> } };
    expect(listPayload.success).toBe(true);
    expect(listPayload.data?.conversations?.map((c) => c.sessionId)).toEqual([H2A_SESSION_ID]);
    expect(resourceCalls.list).toBe(1);

    const humanGet = await callTool({
      identity: humanIdentity,
      extraDeps: { chatSession },
      headers: humanHeaders,
      toolName: 'get_conversation',
      arguments: { sessionId: H2A_SESSION_ID },
    });
    const getPayload = JSON.parse(humanGet.text) as { success: boolean; data?: { messages?: Array<{ content: string }> } };
    expect(getPayload.success).toBe(true);
    expect(getPayload.data?.messages?.[0]?.content).toBe('h2a-only-transcript-body');

    // Cross-category targets: the human's own H2H DM and A2A negotiation
    // transcripts are NOT reachable through the generic tool — the resource
    // returns null and the tool answers with the generic not-found error.
    for (const [category, targetId] of [['H2H', H2H_SESSION_ID], ['A2A', A2A_SESSION_ID]] as const) {
      const crossGet = await callTool({
        identity: humanIdentity,
        extraDeps: { chatSession },
        headers: humanHeaders,
        toolName: 'get_conversation',
        arguments: { sessionId: targetId },
      });
      const crossPayload = JSON.parse(crossGet.text) as { success: boolean; error?: string };
      expect(crossPayload.success, `${category} transcript must not resolve`).toBe(false);
      expect(crossPayload.error, `${category} target yields the generic not-found`).toMatch(/not found or you are not a participant/i);
      expect(crossGet.text, `${category} target leaks no H2A transcript`).not.toContain('h2a-only-transcript-body');
    }
    expect(resourceCalls.get).toBe(3);
  });

  it('does not list the retired question tools for any principal', async () => {
    // read_pending_questions / answer_pending_question retired with the card
    // question surface (conversational-questions plan, "Retirements").
    const names = await listToolNamesFor({
      identity: { userId: 'test-user-id', isSessionAuth: true },
    });
    expect(names).not.toContain('read_pending_questions');
    expect(names).not.toContain('answer_pending_question');
  });

  it('omits complete_onboarding from tools/list for every principal', async () => {
    clearMcpToolMetadataCacheForTests();
    const server = createMcpServer(
      {
        ...mockDeps,
        database: resolvedContextDatabase,
      },
      {
        resolveIdentity: async () => ({ userId: 'test-user-id', isSessionAuth: true }),
        resolveUserId: async () => 'test-user-id',
      },
      mockScopedDepsFactory,
    );
    const response = await invokeMcpRequest({
      server,
      method: 'tools/list',
      headers: { authorization: 'Bearer session-token' },
    });
    const names = response.result?.tools?.map((tool) => tool.name) ?? [];
    expect(names).not.toContain('complete_onboarding');
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

  // ══════════════════════════════════════════════════════════════════════════
  // IND-591..595: network / discovery / opportunity-state / delivery / A2A
  // capability boundaries at the transport seam.
  //
  // These prove the paired schema-valid tools/list and forged tools/call
  // authorization for the community, discovery, opportunity-state, delivery,
  // and A2A-negotiation surfaces. Positive admission is proven by reaching the
  // scoped-deps/handler seam (scopedCreateArgs); forged denial is proven by an
  // MCP_CAPABILITY_DENIED code with zero chat-DB reads and zero scoped-deps
  // construction. Resource-level behavior (bound-community roster/mutation
  // clamps, opportunity actor/lifecycle/scope, discovery-run
  // exact-principal ownership + coalescing partition, negotiation participation
  // + A2A transcript boundary + agent-vs-owner narration) is proven directly
  // against the handlers in the protocol package specs; these transport tests
  // add the missing capability-gate parity without duplicating them.
  // ══════════════════════════════════════════════════════════════════════════

  const NETWORK_1 = 'network-1';
  const NETWORK_2 = 'network-2';
  const UUID_A = '00000000-0000-4000-8000-000000000001';

  /** Resolves a caller's principal-aware tools/list inventory. */
  async function listToolNamesFor(params: {
    identity: Record<string, unknown>;
    agentDatabase?: AgentDatabase;
    headers?: Record<string, string>;
    extraDeps?: Partial<ToolDeps>;
  }): Promise<string[]> {
    clearMcpToolMetadataCacheForTests();
    const server = createMcpServer(
      {
        ...mockDeps,
        database: resolvedContextDatabase,
        agentDatabase: params.agentDatabase ?? mockAgentDb,
        ...params.extraDeps,
      },
      {
        resolveIdentity: async () => params.identity,
        resolveUserId: async () => 'test-user-id',
      } as McpAuthResolver,
      mockScopedDepsFactory,
    );
    const response = await invokeMcpRequest({
      server,
      method: 'tools/list',
      headers: params.headers ?? { 'x-api-key': 'agent-key' },
    });
    return response.result?.tools?.map((tool) => tool.name) ?? [];
  }

  // ── IND-591: community (network) authorization & bound-community clamp ───────

  it('hides community mutations from an agent without manage:networks but keeps reads (tools/list)', async () => {
    const names = await listToolNamesFor({
      identity: { userId: 'test-user-id', agentId: 'agent-n' },
      agentDatabase: agentDbWith({ agentId: 'agent-n', scope: 'global', scopeId: null, actions: ['manage:opportunities'] }),
    });
    // Reads are `authenticated` — available to any registered agent.
    expect(names).toContain('read_networks');
    expect(names).toContain('read_network_memberships');
    // Mutations require manage:networks.
    for (const tool of ['create_network', 'update_network', 'create_network_membership', 'delete_network_membership']) {
      expect(names, `${tool} must require manage:networks`).not.toContain(tool);
    }
    // delete_network is human-only: never visible to any agent.
    expect(names).not.toContain('delete_network');
  });

  it('denies community mutations for an agent without manage:networks before DB work', async () => {
    const writes = [
      { tool: 'create_network', args: { title: 'New community' } },
      { tool: 'update_network', args: { networkId: UUID_A, settings: {} } },
      { tool: 'create_network_membership', args: { networkId: UUID_A } },
      { tool: 'delete_network_membership', args: { userId: 'other-user', networkId: UUID_A } },
    ];
    for (const { tool, args } of writes) {
      const counter = { reads: 0 };
      const result = await callTool({
        identity: { userId: 'test-user-id', agentId: 'agent-n' },
        agentDatabase: agentDbWith({ agentId: 'agent-n', scope: 'global', scopeId: null, actions: ['manage:opportunities'] }),
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

  it('keeps community deletion human-only: a manage:networks agent is denied, the human is admitted', async () => {
    // Autonomous agents never receive community deletion — even one holding
    // manage:networks scoped to the community it targets.
    const counter = { reads: 0 };
    const agentDenied = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-n', networkScopeId: NETWORK_1 },
      agentDatabase: agentDbWith({ agentId: 'agent-n', scope: 'network', scopeId: NETWORK_1, actions: ['manage:networks'] }),
      database: guardReads(counter),
      scopedThrows: true,
      toolName: 'delete_network',
      arguments: { networkId: UUID_A },
    });
    expect(agentDenied.isError).toBe(true);
    expect(agentDenied.code).toBe('MCP_CAPABILITY_DENIED');
    expect(counter.reads).toBe(0);
    expect(agentDenied.scopedCreateArgs).toEqual([]);

    // The session human is admitted and reaches the scoped handler seam.
    const humanAllowed = await callTool({
      identity: { userId: 'test-user-id', isSessionAuth: true },
      headers: { authorization: 'Bearer session-token' },
      toolName: 'delete_network',
      arguments: { networkId: UUID_A },
    });
    expect(humanAllowed.code).not.toBe('MCP_CAPABILITY_DENIED');
    expect(humanAllowed.scopedCreateArgs.length).toBe(1);
  });

  it('requires manage:networks scoped to the exact bound community, then admits a matching grant', async () => {
    // A network-1-bound agent whose only manage:networks grant is scoped to
    // network-2 does not receive the capability for its bound community.
    const counter = { reads: 0 };
    const misScoped = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-n', networkScopeId: NETWORK_1 },
      agentDatabase: agentDbWith({ agentId: 'agent-n', scope: 'network', scopeId: NETWORK_2, actions: ['manage:networks'] }),
      database: guardReads(counter),
      scopedThrows: true,
      toolName: 'create_network_membership',
      arguments: { networkId: UUID_A },
    });
    expect(misScoped.isError).toBe(true);
    expect(misScoped.code).toBe('MCP_CAPABILITY_DENIED');
    expect(counter.reads).toBe(0);
    expect(misScoped.scopedCreateArgs).toEqual([]);

    // A matching network-1 grant is admitted and reaches the scoped handler seam.
    const admitted = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-n', networkScopeId: NETWORK_1 },
      agentDatabase: agentDbWith({ agentId: 'agent-n', scope: 'network', scopeId: NETWORK_1, actions: ['manage:networks'] }),
      toolName: 'create_network_membership',
      arguments: { networkId: NETWORK_1 },
    });
    expect(admitted.code).not.toBe('MCP_CAPABILITY_DENIED');
    expect(admitted.scopedCreateArgs.length).toBe(1);
  });

  it('admits an exact-bound manage:networks agent, then resource-clamps a foreign-community roster mutation before graph work', async () => {
    // Production-reachable resource clamp (distinct from the mis-scoped-grant
    // capability denial above): the agent is bound to network-1 AND holds an
    // applicable network-1 manage:networks grant, so capability policy ADMITS
    // and dispatch reaches the scoped handler seam. It then asks to add a member
    // to a DIFFERENT community (UUID_A). The tool's own bound-community clamp
    // rejects with a stable domain message BEFORE any network-membership graph
    // write, and the foreign community is never mutated.
    let membershipGraphCalls = 0;
    const graphs = {
      ...mockDeps.graphs,
      networkMembership: {
        invoke: async () => {
          membershipGraphCalls += 1;
          return { mutationResult: { success: true, message: 'added' } };
        },
      },
    } as unknown as ToolDeps['graphs'];
    const memberDb = {
      ...resolvedContextDatabase,
      getNetworkMemberships: async () => ([
        { networkId: NETWORK_1, networkTitle: 'N1', isPersonal: false, permissions: ['owner'] },
      ]),
    } as unknown as ToolDeps['database'];

    const result = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-cm', networkScopeId: NETWORK_1 },
      agentDatabase: agentDbWith({ agentId: 'agent-cm', scope: 'network', scopeId: NETWORK_1, actions: ['manage:networks'] }),
      database: memberDb,
      extraDeps: { graphs },
      toolName: 'create_network_membership',
      arguments: { networkId: UUID_A, userId: 'target-user' },
    });

    // Admission happened (not a capability denial) and the seam was reached.
    expect(result.code).not.toBe('MCP_CAPABILITY_DENIED');
    expect(result.scopedCreateArgs.length).toBe(1);
    // The bound-community clamp only admitted network-1 into the scoped deps.
    const allowed = result.scopedCreateArgs[0]!.allowedNetworkIds;
    expect(allowed).toContain(NETWORK_1);
    expect(allowed).not.toContain(UUID_A);
    // Stable resource/domain denial — not merely MCP_CAPABILITY_DENIED.
    const payload = JSON.parse(result.text) as { success: boolean; error?: string };
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/you can only add members to this community/i);
    // The foreign community was never touched: the membership graph never ran.
    expect(membershipGraphCalls).toBe(0);
  });

  it('clamps a network-bound agent reading community rosters to its bound community', async () => {
    // read_network_memberships is `authenticated`; even so, a network-bound
    // agent's scoped deps are constructed with only the bound community, so no
    // other community the user belongs to is reachable.
    const memberDb = {
      ...resolvedContextDatabase,
      getNetworkMemberships: async () => ([
        { networkId: NETWORK_1, networkTitle: 'N1', isPersonal: false, permissions: [] },
        { networkId: NETWORK_2, networkTitle: 'N2', isPersonal: false, permissions: [] },
      ]),
    } as unknown as ToolDeps['database'];
    const result = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-r', networkScopeId: NETWORK_1 },
      agentDatabase: agentDbWith({ agentId: 'agent-r', scope: 'network', scopeId: NETWORK_1, actions: ['manage:networks'] }),
      database: memberDb,
      toolName: 'read_network_memberships',
      arguments: {},
    });
    expect(result.scopedCreateArgs.length).toBe(1);
    const allowed = result.scopedCreateArgs[0]!.allowedNetworkIds;
    expect(allowed).toContain(NETWORK_1);
    expect(allowed).not.toContain(NETWORK_2);
  });

  // Direct discovery runs are not MCP capabilities. A capable opportunity agent
  // still receives the retained persisted-opportunity action surface only.
  it('omits retired discovery tools from a manage:opportunities agent tools/list', async () => {
    const names = await listToolNamesFor({
      identity: { userId: 'test-user-id', agentId: 'agent-o', networkScopeId: NETWORK_1 },
      agentDatabase: agentDbWith({ agentId: 'agent-o', scope: 'network', scopeId: NETWORK_1, actions: ['manage:opportunities'] }),
    });
    expect(names).toContain('update_opportunity');
    expect(names).toContain('list_opportunities');
    for (const removedTool of ['discover_opportunities', 'get_discovery_run', 'cancel_discovery_run']) {
      expect(names).not.toContain(removedTool);
    }
  });

  // ── IND-593: opportunity-state capability gate (actor/lifecycle/scope + ──────
  // retired uptake interlock covered in update-opportunity.spec.ts). ─────────

  /**
   * Faithful in-memory contract double for the injected owner-approval
   * authority (IND-593): challenges are registered on proof-less calls, proofs
   * are issued only against a pending challenge, and consumption is
   * atomically single-use. The real HMAC authority is unit-tested in
   * services/api/src/lib/mcp/tests/owner-approval.isolated.ts.
   */
  type OwnerApprovalVerdict =
    | { kind: 'admitted' }
    | { kind: 'denied'; reason: string; challenge?: { interactionId: string; expiresAt: string } };

  class FakeOwnerApprovalAuthority {
    pending = new Map<string, { binding: Record<string, unknown> }>();
    consumed = new Set<string>();
    consumeCalls: Array<{ proof: string | undefined; binding: Record<string, unknown> }> = [];
    attestCalls: Array<Record<string, unknown>> = [];
    private counter = 0;

    /** Owner-side issuance, valid only against a pending challenge. */
    issue(interactionId: string): string {
      if (!this.pending.has(interactionId)) throw new Error(`no pending challenge ${interactionId}`);
      return `proof:${interactionId}`;
    }

    async consumeAgentProof(proof: string | undefined, binding: Record<string, unknown>): Promise<OwnerApprovalVerdict> {
      this.consumeCalls.push({ proof, binding });
      if (proof === undefined) {
        const interactionId = `interaction-${++this.counter}`;
        this.pending.set(interactionId, { binding });
        return {
          kind: 'denied',
          reason: 'missing',
          challenge: { interactionId, expiresAt: new Date(Date.now() + 600_000).toISOString() },
        };
      }
      if (!proof.startsWith('proof:')) return { kind: 'denied', reason: 'forged' };
      const interactionId = proof.slice('proof:'.length);
      if (this.consumed.has(interactionId)) return { kind: 'denied', reason: 'replayed' };
      const challenge = this.pending.get(interactionId);
      if (!challenge) return { kind: 'denied', reason: 'forged' };
      for (const [field, reason] of [
        ['opportunityId', 'wrong_opportunity'],
        ['action', 'wrong_action'],
        ['ownerId', 'wrong_owner'],
        ['agentId', 'wrong_agent'],
      ] as const) {
        if (challenge.binding[field] !== binding[field]) return { kind: 'denied', reason };
      }
      this.pending.delete(interactionId);
      this.consumed.add(interactionId);
      return { kind: 'admitted' };
    }

    async attestOwnerInteraction(binding: Record<string, unknown>): Promise<OwnerApprovalVerdict> {
      this.attestCalls.push(binding);
      return { kind: 'admitted' };
    }
  }

  it('denies every update_opportunity transition (send/accept/reject) for an agent without manage:opportunities before DB work', async () => {
    for (const status of ['pending', 'accepted', 'rejected'] as const) {
      const counter = { reads: 0 };
      const result = await callTool({
        identity: { userId: 'test-user-id', agentId: 'agent-u' },
        agentDatabase: agentDbWith({ agentId: 'agent-u', scope: 'global', scopeId: null, actions: ['manage:networks'] }),
        database: guardReads(counter),
        scopedThrows: true,
        toolName: 'update_opportunity',
        arguments: { opportunityId: UUID_A, status },
      });
      expect(result.isError, `${status} must be denied`).toBe(true);
      expect(result.code, `${status} must be a capability denial`).toBe('MCP_CAPABILITY_DENIED');
      expect(counter.reads, `${status} must deny before chat DB`).toBe(0);
      expect(result.scopedCreateArgs, `${status} must deny before scoped DB`).toEqual([]);
    }
  });

  it('requires an explicit owner proof for every admitted MCP-agent transition (send/accept/reject) before the mutation graph', async () => {
    // Production-reachable proof of the IND-593 owner-approval gate over MCP.
    // An admitted manage:opportunities agent calling with SCHEMA-VALID args and
    // no owner proof passes the capability gate and the handler seam, but every
    // send/accept/reject is denied with a stable owner_approval_required
    // challenge BEFORE the opportunity mutation graph runs.
    const OPP = '00000000-0000-4000-8000-0000000000ab';
    const authority = new FakeOwnerApprovalAuthority();
    const memberDb = {
      ...resolvedContextDatabase,
      getNetworkMemberships: async () => ([{ networkId: NETWORK_1, networkTitle: 'N1', isPersonal: false, permissions: [] }]),
    } as unknown as ToolDeps['database'];
    const identity = { userId: 'test-user-id', agentId: 'agent-a', networkScopeId: NETWORK_1 };
    const agentDatabase = agentDbWith({ agentId: 'agent-a', scope: 'network', scopeId: NETWORK_1, actions: ['manage:opportunities'] });
    let graphCalls = 0;
    const graphs = {
      ...mockDeps.graphs,
      opportunity: {
        invoke: async () => {
          graphCalls += 1;
          return { mutationResult: { success: true, opportunityId: OPP, message: 'ok' } };
        },
      },
    } as unknown as ToolDeps['graphs'];

    for (const [status, action, current] of [
      ['pending', 'send', 'draft'],
      ['accepted', 'accept', 'pending'],
      ['rejected', 'reject', 'pending'],
    ] as const) {
      const scopedSystemDb = {
        getOpportunity: async () => ({ id: OPP, status: current, actors: [{ userId: 'test-user-id', role: 'party', networkId: NETWORK_1 }] }),
      } as unknown as ToolDeps['systemDb'];
      const result = await callTool({
        identity, agentDatabase, database: memberDb, scopedSystemDb,
        extraDeps: { graphs, opportunityOwnerApproval: authority as never },
        toolName: 'update_opportunity',
        arguments: { opportunityId: OPP, status },
      });
      expect(result.code, `${status} passes the capability gate`).not.toBe('MCP_CAPABILITY_DENIED');
      expect(result.scopedCreateArgs.length, `${status} reaches the handler seam`).toBe(1);
      const payload = JSON.parse(result.text) as {
        success: boolean;
        approval?: { code?: string; reason?: string; action?: string; opportunityId?: string; interactionId?: string; expiresAt?: string };
      };
      expect(payload.success).toBe(false);
      expect(payload.approval?.code).toBe('owner_approval_required');
      expect(payload.approval?.reason).toBe('missing');
      expect(payload.approval?.action).toBe(action);
      expect(payload.approval?.opportunityId).toBe(OPP);
      // The denial carries the fresh, server-derived interaction challenge the
      // owner must explicitly approve out of band.
      expect(payload.approval?.interactionId).toBeTruthy();
      expect(payload.approval?.expiresAt).toBeTruthy();
    }
    expect(graphCalls).toBe(0);
  });

  it('admits one exact fresh owner proof exactly once; replayed, forged, and wrong-binding proofs fail closed before persistence', async () => {
    const OPP = '00000000-0000-4000-8000-0000000000ac';
    const OPP_B = '00000000-0000-4000-8000-0000000000ad';
    const authority = new FakeOwnerApprovalAuthority();
    const opportunity = { id: OPP, status: 'pending', actors: [{ userId: 'test-user-id', role: 'party', networkId: NETWORK_1 }] };
    const scopedSystemDb = { getOpportunity: async () => opportunity } as unknown as ToolDeps['systemDb'];
    const memberDb = {
      ...resolvedContextDatabase,
      getNetworkMemberships: async () => ([{ networkId: NETWORK_1, networkTitle: 'N1', isPersonal: false, permissions: [] }]),
    } as unknown as ToolDeps['database'];
    const identity = { userId: 'test-user-id', agentId: 'agent-a', networkScopeId: NETWORK_1 };
    const agentDatabase = agentDbWith({ agentId: 'agent-a', scope: 'network', scopeId: NETWORK_1, actions: ['manage:opportunities'] });
    let graphCalls = 0;
    const graphs = {
      ...mockDeps.graphs,
      opportunity: {
        invoke: async () => {
          graphCalls += 1;
          return { mutationResult: { success: true, opportunityId: OPP, message: 'accepted' } };
        },
      },
    } as unknown as ToolDeps['graphs'];
    const extraDeps: Partial<ToolDeps> = { graphs, opportunityOwnerApproval: authority as never };
    const call = (args: Record<string, unknown>) => callTool({
      identity, agentDatabase, database: memberDb, scopedSystemDb, extraDeps,
      toolName: 'update_opportunity',
      arguments: args,
    });

    // (1) Challenge: the proof-less attempt is denied with a fresh interaction.
    const unapproved = await call({ opportunityId: OPP, status: 'accepted' });
    const challengeId = (JSON.parse(unapproved.text) as { approval?: { interactionId?: string } }).approval?.interactionId;
    expect(challengeId).toBeTruthy();
    expect(graphCalls).toBe(0);

    // (2) The owner approves that exact interaction; the proof admits exactly once.
    const proof = authority.issue(challengeId!);
    const approved = await call({ opportunityId: OPP, status: 'accepted', ownerApprovalProof: proof });
    expect((JSON.parse(approved.text) as { success: boolean }).success).toBe(true);
    expect(graphCalls).toBe(1);

    // (3) Replay: the same proof never admits twice.
    const replayed = await call({ opportunityId: OPP, status: 'accepted', ownerApprovalProof: proof });
    expect((JSON.parse(replayed.text) as { approval?: { reason?: string } }).approval?.reason).toBe('replayed');
    expect(graphCalls).toBe(1);

    // (4) A proof bound to another opportunity does not transfer.
    const other = await call({ opportunityId: OPP_B, status: 'accepted' });
    const otherProof = authority.issue((JSON.parse(other.text) as { approval?: { interactionId?: string } }).approval!.interactionId!);
    const wrongBinding = await call({ opportunityId: OPP, status: 'accepted', ownerApprovalProof: otherProof });
    expect((JSON.parse(wrongBinding.text) as { approval?: { reason?: string } }).approval?.reason).toBe('wrong_opportunity');
    expect(graphCalls).toBe(1);

    // (5) A forged token is never admitted.
    const forged = await call({ opportunityId: OPP, status: 'accepted', ownerApprovalProof: 'forged-token' });
    expect((JSON.parse(forged.text) as { approval?: { reason?: string } }).approval?.reason).toBe('forged');
    expect(graphCalls).toBe(1);
  });

  it('exposes ownerApprovalProof as an optional update_opportunity field on tools/list', async () => {
    const server = createMcpServer(
      {
        ...mockDeps,
        database: resolvedContextDatabase,
        agentDatabase: agentDbWith({ agentId: 'agent-a', scope: 'global', scopeId: null, actions: ['manage:opportunities'] }),
      },
      {
        resolveIdentity: async () => ({ userId: 'test-user-id', agentId: 'agent-a' }),
        resolveUserId: async () => 'test-user-id',
      } as McpAuthResolver,
      mockScopedDepsFactory,
    );
    const response = await invokeMcpRequest({
      server,
      method: 'tools/list',
      headers: { 'x-api-key': 'agent-key' },
    });
    const tool = response.result?.tools?.find((candidate) => candidate.name === 'update_opportunity') as
      | { inputSchema?: { properties?: Record<string, unknown>; required?: string[] } }
      | undefined;
    expect(tool?.inputSchema?.properties?.ownerApprovalProof).toBeTruthy();
    expect(tool?.inputSchema?.required ?? []).not.toContain('ownerApprovalProof');
    // tools/list ↔ tools/call parity: the listed schema names exactly the
    // fields the transport matrix exercises — required opportunityId + status
    // (covering send/pending, accept/accepted, reject/rejected) plus the
    // optional single-use owner proof.
    expect(tool?.inputSchema?.required ?? []).toEqual(expect.arrayContaining(['opportunityId', 'status']));
    const statusSchema = tool?.inputSchema?.properties?.status as { enum?: string[] } | undefined;
    expect(statusSchema?.enum).toEqual(expect.arrayContaining(['pending', 'accepted', 'rejected']));
  });

  it('routes a direct owner session through the same gate via host attestation, never trusting caller proof fields', async () => {
    const OPP = '00000000-0000-4000-8000-0000000000ae';
    const authority = new FakeOwnerApprovalAuthority();
    const scopedSystemDb = {
      getOpportunity: async () => ({ id: OPP, status: 'pending', actors: [{ userId: 'test-user-id', role: 'party' }] }),
    } as unknown as ToolDeps['systemDb'];
    let graphCalls = 0;
    const graphs = {
      ...mockDeps.graphs,
      opportunity: {
        invoke: async () => {
          graphCalls += 1;
          return { mutationResult: { success: true, opportunityId: OPP, message: 'accepted' } };
        },
      },
    } as unknown as ToolDeps['graphs'];

    const result = await callTool({
      identity: { userId: 'test-user-id', isSessionAuth: true },
      headers: { authorization: 'Bearer session-token' },
      scopedSystemDb,
      extraDeps: { graphs, opportunityOwnerApproval: authority as never },
      toolName: 'update_opportunity',
      arguments: { opportunityId: OPP, status: 'accepted', ownerApprovalProof: 'caller-controlled-junk' },
    });
    const payload = JSON.parse(result.text) as { success: boolean };
    expect(payload.success).toBe(true);
    expect(graphCalls).toBe(1);
    // The binding carries only the server-derived principal and trusted
    // interaction/surface provenance; the caller-controlled proof field never
    // reaches the agent-proof consumer.
    expect(authority.attestCalls).toEqual([{
      opportunityId: OPP,
      action: 'accept',
      ownerId: 'test-user-id',
      provenance: { surface: 'mcp', sessionAuthenticated: true },
    }]);
    expect(authority.consumeCalls).toEqual([]);
  });

  it('admits a genuine session-authenticated owner over MCP through the real host authority, ignoring caller proof fields', async () => {
    // Production-boundary preservation proof: the direct authenticated owner
    // traverses the REAL host authority's attestation policy (no fake) —
    // trusted server-derived mcp/session provenance admits, and the mutation
    // graph runs exactly once.
    const OPP = '00000000-0000-4000-8000-0000000000af';
    const authority = createOpportunityOwnerApprovalAuthority({
      store: createMemoryOwnerApprovalStore(),
      secret: 'mcp-spec-owner-approval-secret',
      ttlMs: 60_000,
    });
    const scopedSystemDb = {
      getOpportunity: async () => ({ id: OPP, status: 'pending', actors: [{ userId: 'test-user-id', role: 'party' }] }),
    } as unknown as ToolDeps['systemDb'];
    let graphCalls = 0;
    const graphs = {
      ...mockDeps.graphs,
      opportunity: {
        invoke: async () => {
          graphCalls += 1;
          return { mutationResult: { success: true, opportunityId: OPP, message: 'accepted' } };
        },
      },
    } as unknown as ToolDeps['graphs'];

    const result = await callTool({
      identity: { userId: 'test-user-id', isSessionAuth: true },
      headers: { authorization: 'Bearer session-token' },
      scopedSystemDb,
      extraDeps: { graphs, opportunityOwnerApproval: authority as never },
      toolName: 'update_opportunity',
      arguments: { opportunityId: OPP, status: 'accepted', ownerApprovalProof: 'caller-controlled-junk' },
    });
    const payload = JSON.parse(result.text) as { success: boolean };
    expect(payload.success).toBe(true);
    expect(graphCalls).toBe(1);
  });

  // ── IND-593 Batch C: complete schema-valid MCP tools/call matrix over the ───
  // REAL host authority (HMAC proofs, injected memory store, controllable
  // clock — no fake authority, no live Redis, no DB). ──────────────────────

  const OWNER_APPROVAL_TEST_SECRET = 'mcp-spec-owner-approval-secret';

  /** Signs an arbitrary payload with the fixture secret (generic-token cases). */
  function signOwnerApprovalPayload(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', OWNER_APPROVAL_TEST_SECRET).update(`oap1.${body}`).digest('base64url');
    return `oap1.${body}.${sig}`;
  }

  type OwnerApprovalPayload = {
    success: boolean;
    approval?: {
      code?: string;
      reason?: string;
      opportunityId?: string;
      action?: string;
      interactionId?: string;
      expiresAt?: string;
    };
  };

  /**
   * MCP transport fixture around the real owner-approval authority: a
   * manage:opportunities network agent issuing schema-valid update_opportunity
   * tools/call requests, with an explicit mutation-graph counter proving
   * nothing persists before the proof gate admits.
   */
  function ownerApprovalTransportFixture(options: { ttlMs?: number } = {}) {
    const clock = { now: 1_000_000 };
    const now = () => clock.now;
    const authority = createOpportunityOwnerApprovalAuthority({
      store: createMemoryOwnerApprovalStore({ now }),
      secret: OWNER_APPROVAL_TEST_SECRET,
      ttlMs: options.ttlMs ?? 600_000,
      now,
    });
    const graph = { calls: 0 };
    const graphs = {
      ...mockDeps.graphs,
      opportunity: {
        invoke: async () => {
          graph.calls += 1;
          return { mutationResult: { success: true, opportunityId: 'any', message: 'ok' } };
        },
      },
    } as unknown as ToolDeps['graphs'];
    const memberDb = {
      ...resolvedContextDatabase,
      getNetworkMemberships: async () => ([{ networkId: NETWORK_1, networkTitle: 'N1', isPersonal: false, permissions: [] }]),
    } as unknown as ToolDeps['database'];
    const identity = { userId: 'test-user-id', agentId: 'agent-a', networkScopeId: NETWORK_1 };
    const agentDatabase = agentDbWith({ agentId: 'agent-a', scope: 'network', scopeId: NETWORK_1, actions: ['manage:opportunities'] });

    const call = async (
      opportunity: { id: string; status: string },
      args: Record<string, unknown>,
    ) => {
      const outcome = await callTool({
        identity,
        agentDatabase,
        database: memberDb,
        scopedSystemDb: {
          getOpportunity: async () => ({
            ...opportunity,
            actors: [{ userId: 'test-user-id', role: 'party', networkId: NETWORK_1 }],
          }),
        } as unknown as ToolDeps['systemDb'],
        extraDeps: { graphs, opportunityOwnerApproval: authority as never },
        toolName: 'update_opportunity',
        arguments: args,
      });
      // Every matrix case is a schema-valid call by an admitted agent: it must
      // pass the capability gate and reach the handler seam — the denial under
      // test happens INSIDE the boundary, before persistence.
      expect(outcome.code).not.toBe('MCP_CAPABILITY_DENIED');
      expect(outcome.scopedCreateArgs.length).toBe(1);
      return { outcome, payload: JSON.parse(outcome.text) as OwnerApprovalPayload };
    };

    return { clock, authority, graph, call };
  }

  const OWNER_ACTION_MATRIX = [
    ['pending', 'send', 'draft'],
    ['accepted', 'accept', 'pending'],
    ['rejected', 'reject', 'pending'],
  ] as const;

  it('admits one exact fresh owner-issued proof exactly once per send/accept/reject tools/call; replays fail closed before persistence', async () => {
    for (const [status, action, current] of OWNER_ACTION_MATRIX) {
      const fx = ownerApprovalTransportFixture();
      const OPP = `00000000-0000-4000-8000-0000000000b${OWNER_ACTION_MATRIX.findIndex(([s]) => s === status)}`;
      const opportunity = { id: OPP, status: current };

      // (1) Proof-less call: denied with a fresh server-derived challenge.
      const missing = await fx.call(opportunity, { opportunityId: OPP, status });
      expect(missing.payload.success).toBe(false);
      expect(missing.payload.approval?.code).toBe('owner_approval_required');
      expect(missing.payload.approval?.reason).toBe('missing');
      expect(missing.payload.approval?.action).toBe(action);
      expect(missing.payload.approval?.opportunityId).toBe(OPP);
      expect(missing.payload.approval?.interactionId).toBeTruthy();
      expect(fx.graph.calls).toBe(0);

      // (2) The owner explicitly approves that exact interaction; the real
      // HMAC proof admits exactly once and persistence runs exactly once.
      const issued = await fx.authority.issueProofForInteraction({
        interactionId: missing.payload.approval!.interactionId!,
        ownerId: 'test-user-id',
        expectedOpportunityId: OPP,
      });
      expect(issued.kind).toBe('issued');
      if (issued.kind !== 'issued') continue;
      const admitted = await fx.call(opportunity, { opportunityId: OPP, status, ownerApprovalProof: issued.proof });
      expect(admitted.payload.success).toBe(true);
      expect(fx.graph.calls).toBe(1);

      // (3) Replay of the same proof never admits twice.
      const replayed = await fx.call(opportunity, { opportunityId: OPP, status, ownerApprovalProof: issued.proof });
      expect(replayed.payload.success).toBe(false);
      expect(replayed.payload.approval?.reason).toBe('replayed');
      expect(fx.graph.calls).toBe(1);
    }
  });

  it('denies stale, generic, forged, wrong-owner, wrong-agent, wrong-action, and wrong-opportunity proofs at the transport with zero mutation-graph calls', async () => {
    const OPP = '00000000-0000-4000-8000-0000000000c0';
    const OPP_B = '00000000-0000-4000-8000-0000000000c1';
    const fx = ownerApprovalTransportFixture({ ttlMs: 60_000 });
    const opportunity = { id: OPP, status: 'pending' };
    const serverBinding = { opportunityId: OPP, action: 'accept', ownerId: 'test-user-id', agentId: 'agent-a' } as const;

    const expectDenied = async (args: Record<string, unknown>, reason: string) => {
      const { payload } = await fx.call(opportunity, args);
      expect(payload.success).toBe(false);
      expect(payload.approval?.code).toBe('owner_approval_required');
      expect(payload.approval?.reason).toBe(reason);
    };

    /** Owner-issues a proof against a challenge minted for `binding`. */
    const mintProofFor = async (binding: { opportunityId: string; action: string; ownerId: string; agentId: string }) => {
      const challenge = await fx.authority.consumeAgentProof(undefined, binding as never);
      if (challenge.kind !== 'denied' || !challenge.challenge) throw new Error('expected challenge');
      const issued = await fx.authority.issueProofForInteraction({
        interactionId: challenge.challenge.interactionId,
        ownerId: binding.ownerId,
        expectedOpportunityId: binding.opportunityId,
      });
      if (issued.kind !== 'issued') throw new Error('expected issuance');
      return issued.proof;
    };

    // Stale: the owner approved, but the challenge TTL lapsed before the retry.
    const staleProof = await mintProofFor(serverBinding);
    fx.clock.now += 61_000;
    await expectDenied({ opportunityId: OPP, status: 'accepted', ownerApprovalProof: staleProof }, 'stale');

    // Generic: a well-signed token that lacks the exact binding fields.
    await expectDenied({
      opportunityId: OPP,
      status: 'accepted',
      ownerApprovalProof: signOwnerApprovalPayload({ v: 1, interactionId: 'whatever', exp: fx.clock.now + 60_000 }),
    }, 'generic');

    // Forged: never issued by the authority at all.
    await expectDenied({ opportunityId: OPP, status: 'accepted', ownerApprovalProof: 'not-a-real-proof' }, 'forged');

    // Wrong owner: proof minted under another owner principal does not transfer.
    await expectDenied({
      opportunityId: OPP,
      status: 'accepted',
      ownerApprovalProof: await mintProofFor({ ...serverBinding, ownerId: 'other-owner-999' }),
    }, 'wrong_owner');

    // Wrong agent: proof minted for another registered agent does not transfer.
    await expectDenied({
      opportunityId: OPP,
      status: 'accepted',
      ownerApprovalProof: await mintProofFor({ ...serverBinding, agentId: 'agent-b' }),
    }, 'wrong_agent');

    // Wrong action/status: a reject approval cannot authorize an accept.
    await expectDenied({
      opportunityId: OPP,
      status: 'accepted',
      ownerApprovalProof: await mintProofFor({ ...serverBinding, action: 'reject' }),
    }, 'wrong_action');

    // Wrong opportunity: an approval for a sibling opportunity does not transfer.
    await expectDenied({
      opportunityId: OPP,
      status: 'accepted',
      ownerApprovalProof: await mintProofFor({ ...serverBinding, opportunityId: OPP_B }),
    }, 'wrong_opportunity');

    // No denial in the matrix ever reached the opportunity mutation graph.
    expect(fx.graph.calls).toBe(0);
  });

  it('rejects negotiation approvals, uptake acknowledgements, self-acknowledgement, and advisory/challenge values as owner-proof substitutes over MCP', async () => {
    const OPP = '00000000-0000-4000-8000-0000000000c2';
    const fx = ownerApprovalTransportFixture();
    const opportunity = { id: OPP, status: 'pending' };

    // Agent self-acknowledgment of uptake questions is not owner authorization.
    const selfAck = await fx.call(opportunity, {
      opportunityId: OPP,
      status: 'accepted',
      acknowledgedUptakeQuestionIds: ['uptake-question-1'],
    });
    expect(selfAck.payload.success).toBe(false);
    expect(selfAck.payload.approval?.code).toBe('owner_approval_required');
    expect(selfAck.payload.approval?.reason).toBe('missing');

    // The server-derived challenge/advisory values themselves are not proofs.
    const interactionAsProof = await fx.call(opportunity, {
      opportunityId: OPP,
      status: 'accepted',
      ownerApprovalProof: selfAck.payload.approval!.interactionId!,
    });
    expect(interactionAsProof.payload.approval?.reason).toBe('forged');
    const expiryAsProof = await fx.call(opportunity, {
      opportunityId: OPP,
      status: 'accepted',
      ownerApprovalProof: selfAck.payload.approval!.expiresAt!,
    });
    expect(expiryAsProof.payload.approval?.reason).toBe('forged');

    // An A2A negotiation approval artifact is a distinct authorization path
    // and never substitutes for the owner proof.
    const negotiationApproval = await fx.call(opportunity, {
      opportunityId: OPP,
      status: 'accepted',
      ownerApprovalProof: 'negotiation-approval:task-1',
    });
    expect(negotiationApproval.payload.approval?.reason).toBe('forged');

    expect(fx.graph.calls).toBe(0);
  });

  it('accepts through the transport seam without the retired uptake advisory interposing', async () => {
    // The pre-accept uptake interlock is retired (conversational-questions
    // plan, "Retirements"). Even with the legacy flags set and a leftover
    // pending uptake row visible to findPendingQuestions, an owner-approved
    // acceptance runs the opportunity mutation graph directly: no advisory,
    // no acknowledgment round-trip. The IND-593 owner-proof gate itself is
    // covered by the surrounding tests.
    const OPP = '00000000-0000-4000-8000-0000000000aa';
    const opportunity = {
      id: OPP,
      status: 'pending',
      actors: [{ userId: 'test-user-id', role: 'party', networkId: NETWORK_1 }],
    };
    let opportunityMutations = 0;
    const scopedSystemDb = {
      getOpportunity: async () => opportunity,
    } as unknown as ToolDeps['systemDb'];
    const mutate = async () => {
      opportunityMutations += 1;
      return { mutationResult: { success: true, opportunityId: OPP, message: 'accepted' } };
    };
    const opportunityOperations = {
      sendOpportunity: mutate,
      updateOpportunityStatus: mutate,
    } as unknown as ToolDeps['opportunityOperations'];
    const proofAuthority = {
      consumeAgentProof: async (proof: string | undefined): Promise<OwnerApprovalVerdict> =>
        proof === 'owner-proof'
          ? { kind: 'admitted' }
          : {
              kind: 'denied',
              reason: 'missing',
              challenge: { interactionId: 'interaction-uptake', expiresAt: new Date(Date.now() + 600_000).toISOString() },
            },
      attestOwnerInteraction: async (): Promise<OwnerApprovalVerdict> => ({ kind: 'admitted' }),
    };
    const findPendingQuestions = mock(async () => [{ id: 'uptake-question-1' }]);
    const extraDeps: Partial<ToolDeps> = {
      opportunityOperations,
      findPendingQuestions: findPendingQuestions as unknown as ToolDeps['findPendingQuestions'],
      opportunityOwnerApproval: proofAuthority as never,
    };
    const memberDb = {
      ...resolvedContextDatabase,
      getNetworkMemberships: async () => ([{ networkId: NETWORK_1, networkTitle: 'N1', isPersonal: false, permissions: [] }]),
    } as unknown as ToolDeps['database'];
    const identity = { userId: 'test-user-id', agentId: 'agent-a', networkScopeId: NETWORK_1 };
    const agentDatabase = agentDbWith({ agentId: 'agent-a', scope: 'network', scopeId: NETWORK_1, actions: ['manage:opportunities'] });

    const prevEnabled = process.env.QUESTIONER_ENABLED;
    const prevUptake = process.env.QUESTIONER_UPTAKE_ENABLED;
    process.env.QUESTIONER_ENABLED = 'true';
    process.env.QUESTIONER_UPTAKE_ENABLED = 'true';
    try {
      const approved = await callTool({
        identity, agentDatabase, database: memberDb, extraDeps, scopedSystemDb,
        toolName: 'update_opportunity',
        arguments: { opportunityId: OPP, status: 'accepted', ownerApprovalProof: 'owner-proof' },
      });
      expect(approved.code).not.toBe('MCP_CAPABILITY_DENIED');
      const approvedPayload = JSON.parse(approved.text) as { success: boolean; advisory?: unknown };
      expect(approvedPayload.success).toBe(true);
      expect(approvedPayload.advisory).toBeUndefined();
      expect(findPendingQuestions).not.toHaveBeenCalled();
      expect(opportunityMutations).toBe(1);
    } finally {
      if (prevEnabled === undefined) delete process.env.QUESTIONER_ENABLED; else process.env.QUESTIONER_ENABLED = prevEnabled;
      if (prevUptake === undefined) delete process.env.QUESTIONER_UPTAKE_ENABLED; else process.env.QUESTIONER_UPTAKE_ENABLED = prevUptake;
    }
  });

  // ── IND-594: designated-delivery-only classification. The tools/call forgery
  // denial + delivery admit-to-seam is also covered by the IND-608 test
  // 'restricts confirm_opportunity_delivery to designated delivery agents,
  // before DB work' above; ledger idempotency/ownership by the protocol spec
  // opportunity.tools.confirm-delivery.spec.ts. These add the tools/list parity
  // and a direct ledger-seam ownership proof. ───────────────────────────────

  it('lists confirm_opportunity_delivery only for the designated delivery agent', async () => {
    const deliveryNames = await listToolNamesFor({
      identity: { userId: 'test-user-id', agentId: 'agent-d', isDeliveryAgent: true },
      agentDatabase: agentDbWith({ agentId: 'agent-d', scope: 'global', scopeId: null, actions: ['manage:opportunities'] }),
    });
    expect(deliveryNames).toContain('confirm_opportunity_delivery');

    // An ordinary agent holding manage:opportunities does not see it.
    const ordinaryNames = await listToolNamesFor({
      identity: { userId: 'test-user-id', agentId: 'agent-d' },
      agentDatabase: agentDbWith({ agentId: 'agent-d', scope: 'global', scopeId: null, actions: ['manage:opportunities'] }),
    });
    expect(ordinaryNames).not.toContain('confirm_opportunity_delivery');

    // Nor does the session human.
    const humanNames = await listToolNamesFor({
      identity: { userId: 'test-user-id', isSessionAuth: true },
      headers: { authorization: 'Bearer session-token' },
    });
    expect(humanNames).not.toContain('confirm_opportunity_delivery');
  });

  it('forged ordinary-agent confirm_opportunity_delivery never reaches the ledger; the delivery agent reaches it with its own principal', async () => {
    const ledgerCalls: Array<{ opportunityId: string; userId: string; agentId: string; trigger: string }> = [];
    const deliveryLedger = {
      confirmOpportunityDelivery: async (input: { opportunityId: string; userId: string; agentId: string; trigger: string }) => {
        ledgerCalls.push(input);
        return 'committed' as const;
      },
    } as unknown as ToolDeps['deliveryLedger'];

    // Ordinary agent (manage:opportunities, not the delivery principal): denied
    // before any work, so the ledger is never touched — no forged delivery row.
    const counter = { reads: 0 };
    const forged = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-d' },
      agentDatabase: agentDbWith({ agentId: 'agent-d', scope: 'global', scopeId: null, actions: ['manage:opportunities'] }),
      database: guardReads(counter),
      scopedThrows: true,
      extraDeps: { deliveryLedger },
      toolName: 'confirm_opportunity_delivery',
      arguments: { opportunityId: UUID_A, trigger: 'ambient' },
    });
    expect(forged.isError).toBe(true);
    expect(forged.code).toBe('MCP_CAPABILITY_DENIED');
    expect(counter.reads).toBe(0);
    expect(forged.scopedCreateArgs).toEqual([]);
    expect(ledgerCalls).toEqual([]);

    // Designated delivery agent: admitted and reaches the ledger, which records
    // the caller's exact user + agent principal (ownership provenance).
    const delivered = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-d', isDeliveryAgent: true },
      agentDatabase: agentDbWith({ agentId: 'agent-d', scope: 'global', scopeId: null, actions: ['manage:opportunities'] }),
      extraDeps: { deliveryLedger },
      toolName: 'confirm_opportunity_delivery',
      arguments: { opportunityId: UUID_A, trigger: 'ambient' },
    });
    expect(delivered.code).not.toBe('MCP_CAPABILITY_DENIED');
    const deliveredPayload = JSON.parse(delivered.text) as { success: boolean; data?: { status?: string } };
    expect(deliveredPayload.success).toBe(true);
    expect(deliveredPayload.data?.status).toBe('committed');
    expect(ledgerCalls).toEqual([{ opportunityId: UUID_A, userId: 'test-user-id', agentId: 'agent-d', trigger: 'ambient' }]);
  });

  // ── IND-595: A2A negotiation capability gate. The resource-level boundaries ──
  // are proven directly in negotiation.tools.spec.ts:
  //   • 'get_negotiation — participant-only A2A visibility (IND-608)' — a
  //     non-participant is denied without reading the transcript/artifacts, and
  //     a participating party is admitted (participation + A2A-transcript-only
  //     boundary; the reader only ever reads the negotiation task's own
  //     conversation, never H2A/H2H).
  //   • 'get_negotiation — network scope' / 'respond_to_negotiation — network
  //     scope' — bound-network enforcement.
  //   • 'readAuthorizedNegotiationDetail' + list_negotiations narrative specs —
  //     agent-vs-owner narration (ownerAction not_recorded / directConversation
  //     Evidence not_provided; actionActor 'agent').
  // These transport tests add the manage:negotiations capability gate parity at
  // both list AND call boundaries. ────────────────────────────────────────────

  it('denies A2A negotiation tools for an agent without manage:negotiations before DB work', async () => {
    const cases = [
      { tool: 'list_negotiations', args: {} },
      { tool: 'get_negotiation', args: { negotiationId: 'task-1' } },
      {
        tool: 'respond_to_negotiation',
        args: {
          negotiationId: 'task-1',
          action: 'counter',
          reasoning: 'a specific assessment',
          suggestedRoles: { ownUser: 'peer', otherUser: 'peer' },
          message: 'a specific counter message',
        },
      },
    ];
    for (const { tool, args } of cases) {
      const counter = { reads: 0 };
      const result = await callTool({
        identity: { userId: 'test-user-id', agentId: 'agent-g' },
        agentDatabase: agentDbWith({ agentId: 'agent-g', scope: 'global', scopeId: null, actions: ['manage:opportunities'] }),
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

  it('shows A2A negotiation tools to a bound manage:negotiations agent and admits list/get/respond to the handler seam', async () => {
    const identity = { userId: 'test-user-id', agentId: 'agent-g', networkScopeId: NETWORK_1 };
    const agentDatabase = agentDbWith({ agentId: 'agent-g', scope: 'network', scopeId: NETWORK_1, actions: ['manage:negotiations'] });

    const names = await listToolNamesFor({ identity, agentDatabase });
    expect(names).toContain('list_negotiations');
    expect(names).toContain('get_negotiation');
    expect(names).toContain('respond_to_negotiation');

    // Functional negotiation database: admission is proven by a STABLE DOMAIN
    // response from the real handler, not merely the absence of a denial code.
    const negotiationDatabase = {
      getTasksForUser: async () => [],
      getTask: async () => null,
      getIntentIdsForOpportunities: async () => ({}),
      getOpportunityLifecyclesForNegotiations: async () => ({}),
      getMessagesForConversation: async () => [],
      getNegotiationMessages: async () => [],
      getArtifactsForTask: async () => [],
    } as unknown as ToolDeps['negotiationDatabase'];

    // list_negotiations: admitted, handler returns an empty listing.
    const list = await callTool({
      identity, agentDatabase, extraDeps: { negotiationDatabase },
      toolName: 'list_negotiations', arguments: {},
    });
    expect(list.code).not.toBe('MCP_CAPABILITY_DENIED');
    expect(list.scopedCreateArgs.length).toBe(1);
    const listPayload = JSON.parse(list.text) as { success: boolean; data?: { count?: number } };
    expect(listPayload.success).toBe(true);
    expect(listPayload.data?.count).toBe(0);

    // get_negotiation: admitted; unknown id yields the stable domain response.
    const get = await callTool({
      identity, agentDatabase, extraDeps: { negotiationDatabase },
      toolName: 'get_negotiation', arguments: { negotiationId: 'task-unknown' },
    });
    expect(get.code).not.toBe('MCP_CAPABILITY_DENIED');
    const getPayload = JSON.parse(get.text) as { success: boolean; error?: string };
    expect(getPayload.success).toBe(false);
    expect(getPayload.error).toMatch(/negotiation not found/i);

    // respond_to_negotiation: admitted; schema-valid turn on an unknown id
    // reaches the handler and returns the stable domain response.
    const respond = await callTool({
      identity, agentDatabase, extraDeps: { negotiationDatabase },
      toolName: 'respond_to_negotiation',
      arguments: {
        negotiationId: 'task-unknown',
        action: 'counter',
        reasoning: 'a specific assessment',
        suggestedRoles: { ownUser: 'peer', otherUser: 'peer' },
        message: 'a specific counter message',
      },
    });
    expect(respond.code).not.toBe('MCP_CAPABILITY_DENIED');
    const respondPayload = JSON.parse(respond.text) as { success: boolean; error?: string };
    expect(respondPayload.success).toBe(false);
    expect(respondPayload.error).toMatch(/negotiation not found/i);
  });

  it('A2A transcripts: participant reads via negotiation tools; nonparticipant and cross-network callers are denied without transcript reads', async () => {
    // IND-600: A2A negotiation chats are reachable ONLY through the negotiation
    // tools, and even there only under exact participation plus bound-network
    // scope. The network-scope check fires BEFORE the participant check (and
    // before any transcript read), so a cross-scope caller cannot probe
    // existence; a nonparticipant never triggers a message read at all.
    const TRANSCRIPT_SECRET = 'a2a-transcript-secret-body';

    const makeTask = (overrides: {
      id?: string;
      sourceUserId?: string;
      candidateUserId?: string;
      networkId?: string;
    } = {}) => ({
      id: overrides.id ?? 'task-a2a-1',
      conversationId: `conv-${overrides.id ?? 'task-a2a-1'}`,
      state: 'working',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      metadata: {
        type: 'negotiation',
        protocolVersion: 'v1',
        sourceUserId: overrides.sourceUserId ?? 'test-user-id',
        candidateUserId: overrides.candidateUserId ?? 'other-user-id',
        networkId: overrides.networkId ?? NETWORK_1,
      },
    });

    const a2aMessages = [
      {
        senderId: 'agent:test-user-id',
        parts: [{ kind: 'data', data: { action: 'propose', message: TRANSCRIPT_SECRET, assessment: { reasoning: 'initial assessment', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } } } }],
        createdAt: new Date('2026-01-01T01:00:00.000Z'),
      },
      {
        senderId: 'agent:other-user-id',
        parts: [{ kind: 'data', data: { action: 'counter', message: 'counter proposal body', assessment: { reasoning: 'counter reasoning', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } } } }],
        createdAt: new Date('2026-01-01T02:00:00.000Z'),
      },
    ];

    /** Functional negotiation DB that counts transcript reads. */
    const negotiationDbWith = (db: {
      task: ReturnType<typeof makeTask> | null;
      tasks?: Array<ReturnType<typeof makeTask>>;
      messageReads: { count: number };
    }) => ({
      getTasksForUser: async () => db.tasks ?? (db.task ? [db.task] : []),
      getTask: async () => db.task,
      getIntentIdsForOpportunities: async () => ({}),
      getOpportunityLifecyclesForNegotiations: async () => ({}),
      getMessagesForConversation: async () => {
        db.messageReads.count += 1;
        return a2aMessages;
      },
      getArtifactsForTask: async () => [],
    } as unknown as ToolDeps['negotiationDatabase']);

    // ── Participant: the owning agent (global manage:negotiations, owner is the
    // source) reads the full transcript through get_negotiation.
    const participantReads = { count: 0 };
    const participant = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-a2a-p' },
      agentDatabase: agentDbWith({ agentId: 'agent-a2a-p', scope: 'global', scopeId: null, actions: ['manage:negotiations'] }),
      extraDeps: { negotiationDatabase: negotiationDbWith({ task: makeTask(), messageReads: participantReads }) },
      toolName: 'get_negotiation',
      arguments: { negotiationId: 'task-a2a-1' },
    });
    const participantPayload = JSON.parse(participant.text) as {
      success: boolean;
      data?: { role?: string; conversationType?: string; turns?: Array<{ message?: string | null }> };
    };
    expect(participantPayload.success).toBe(true);
    expect(participantPayload.data?.role).toBe('source');
    expect(participantPayload.data?.conversationType).toBe('agent_negotiation');
    expect(participantPayload.data?.turns?.length).toBe(2);
    expect(participant.text).toContain(TRANSCRIPT_SECRET);
    expect(participantReads.count).toBe(1);

    // ── Nonparticipant: a manage:negotiations agent whose owner is NEITHER
    // party is denied by the handler, and no transcript read ever happens.
    const nonparticipantReads = { count: 0 };
    const nonparticipant = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-a2a-n' },
      agentDatabase: agentDbWith({ agentId: 'agent-a2a-n', scope: 'global', scopeId: null, actions: ['manage:negotiations'] }),
      extraDeps: {
        negotiationDatabase: negotiationDbWith({
          task: makeTask({ sourceUserId: 'user-a', candidateUserId: 'user-b' }),
          messageReads: nonparticipantReads,
        }),
      },
      toolName: 'get_negotiation',
      arguments: { negotiationId: 'task-a2a-1' },
    });
    const nonparticipantPayload = JSON.parse(nonparticipant.text) as { success: boolean; error?: string };
    expect(nonparticipantPayload.success).toBe(false);
    expect(nonparticipantPayload.error).toMatch(/not a party to this negotiation/i);
    expect(nonparticipant.text).not.toContain(TRANSCRIPT_SECRET);
    expect(nonparticipantReads.count, 'no transcript read for a nonparticipant').toBe(0);

    // ── Cross-network: a NETWORK_1-bound manage:negotiations agent whose owner
    // IS the source is still scope-denied on a NETWORK_2 negotiation — the
    // scope check fires before participation and before any transcript read.
    const crossNetworkReads = { count: 0 };
    const crossNetwork = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-a2a-x', networkScopeId: NETWORK_1 },
      agentDatabase: agentDbWith({ agentId: 'agent-a2a-x', scope: 'network', scopeId: NETWORK_1, actions: ['manage:negotiations'] }),
      extraDeps: {
        negotiationDatabase: negotiationDbWith({
          task: makeTask({ networkId: NETWORK_2 }),
          messageReads: crossNetworkReads,
        }),
      },
      toolName: 'get_negotiation',
      arguments: { negotiationId: 'task-a2a-1' },
    });
    const crossNetworkPayload = JSON.parse(crossNetwork.text) as { success: boolean; error?: string };
    expect(crossNetworkPayload.success).toBe(false);
    expect(crossNetworkPayload.error).toMatch(/bound network scope/i);
    expect(crossNetwork.text).not.toContain(TRANSCRIPT_SECRET);
    expect(crossNetworkReads.count, 'no transcript read across network scope').toBe(0);

    // ── List parity: the same bound agent's list_negotiations drops the
    // NETWORK_2 task even though the DB returned it for the user.
    const listReads = { count: 0 };
    const boundList = await callTool({
      identity: { userId: 'test-user-id', agentId: 'agent-a2a-x', networkScopeId: NETWORK_1 },
      agentDatabase: agentDbWith({ agentId: 'agent-a2a-x', scope: 'network', scopeId: NETWORK_1, actions: ['manage:negotiations'] }),
      extraDeps: {
        negotiationDatabase: negotiationDbWith({
          task: null,
          tasks: [makeTask({ id: 'task-net-1', networkId: NETWORK_1 }), makeTask({ id: 'task-net-2', networkId: NETWORK_2 })],
          messageReads: listReads,
        }),
      },
      toolName: 'list_negotiations',
      arguments: {},
    });
    const boundListPayload = JSON.parse(boundList.text) as {
      success: boolean;
      data?: { count?: number; negotiations?: Array<{ id: string }> };
    };
    expect(boundListPayload.success).toBe(true);
    expect(boundListPayload.data?.count).toBe(1);
    expect(boundListPayload.data?.negotiations?.map((n) => n.id)).toEqual(['task-net-1']);
  });

  // ── IND-599: agent administration authorization policy ────────────────────
  //
  // Canonical read_own_agent is available ONLY to a registered active agent and
  // returns that agent's OWN sanitized record. Its input schema is empty — there
  // is no target selector, so a caller can never name another agent. Session
  // humans get list_agents plus owned-only register/update/delete/grant/revoke
  // and NEVER read_own_agent. Enrollment-capable unregistered keys get
  // register_agent only. Plain unregistered keys fail closed. Every denial is
  // enforced at the capability layer (MCP_CAPABILITY_DENIED) BEFORE any context
  // DB read, scoped-deps creation, or handler work — proven with a read-guarded
  // context database (guardReads) and a throwing scoped-deps factory
  // (scopedThrows). All tools/call payloads are SCHEMA-VALID (snake_case
  // agent_id / scope_id / permission_id, canonical `actions` array) so the SDK
  // schema passes and the policy layer is the thing under test.

  /** The canonical self-read tool, available only to registered agents. */
  const AGENT_SELF_TOOL = 'read_own_agent';
  /** Admin list + mutations reserved for session humans (never for agents). */
  const HUMAN_ADMIN_TOOLS = ['register_agent', 'list_agents', 'update_agent', 'delete_agent', 'grant_agent_permission', 'revoke_agent_permission'] as const;
  /** Every agent-admin tool in the matrix (self-read plus human admin surface). */
  const ALL_AGENT_ADMIN_TOOLS = [AGENT_SELF_TOOL, ...HUMAN_ADMIN_TOOLS] as const;
  const OWNED_AGENT_ID = 'agent-owned';
  const FOREIGN_AGENT_ID = 'agent-foreign';
  /** Private transport connection material that must NEVER appear in any tool output. */
  const SENSITIVE_TRANSPORT_SECRET = 'sk-transport-super-secret-token-599';

  /** Schema-valid tools/call arguments for every human admin tool. */
  const HUMAN_ADMIN_CALLS = [
    { tool: 'register_agent', args: { name: 'New Agent' } },
    { tool: 'list_agents', args: {} },
    { tool: 'update_agent', args: { agent_id: OWNED_AGENT_ID, name: 'Renamed' } },
    { tool: 'delete_agent', args: { agent_id: OWNED_AGENT_ID } },
    { tool: 'grant_agent_permission', args: { agent_id: OWNED_AGENT_ID, actions: ['manage:intents'], scope: 'global' } },
    { tool: 'revoke_agent_permission', args: { agent_id: OWNED_AGENT_ID, permission_id: 'permission-1' } },
  ] as const;

  /** A full agent record owned by the given user. */
  const agentRecord = (agentId: string, ownerId: string) => ({
    id: agentId,
    ownerId,
    name: ownerId === 'test-user-id' ? 'Owned Agent' : 'Foreign Agent',
    description: null,
    type: 'external' as const,
    status: 'active' as const,
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    // A live transport whose config carries private connection material — the
    // sanitizer must project the transport (safe shape) with config redacted.
    transports: [{
      id: 'transport-1',
      agentId,
      channel: 'mcp' as const,
      config: { endpoint: 'https://agent.example/mcp', authToken: SENSITIVE_TRANSPORT_SECRET },
      priority: 0,
      active: true,
      failureCount: 0,
    }],
    permissions: ownerId === 'test-user-id'
      ? [{
          id: 'permission-1',
          agentId,
          userId: ownerId,
          scope: 'global' as const,
          scopeId: null,
          actions: ['manage:intents'],
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }]
      : [],
  });

  /**
   * Agent registry that resolves the caller's OWN active record and records
   * exactly which agentId each lookup received, so a read_own_agent call can be
   * shown to read the caller's own id (context.agentId) and never a forged
   * target smuggled through the (empty) tool arguments.
   */
  const ownedAgentDb = (resolvedIds?: string[]): AgentDatabase => ({
    ...mockAgentDb,
    getAgent: async (id: string) => { resolvedIds?.push(id); return agentRecord(id, 'test-user-id'); },
    getAgentWithRelations: async (id: string) => { resolvedIds?.push(id); return agentRecord(id, 'test-user-id'); },
  });

  /** Agent registry whose records are owned by another user (foreign). */
  const foreignAgentDb = (): AgentDatabase => ({
    ...mockAgentDb,
    getAgent: async (id: string) => agentRecord(id, 'other-user-id'),
    getAgentWithRelations: async (id: string) => agentRecord(id, 'other-user-id'),
  });

  it('registered agent tools/list exposes only read_own_agent — no admin, no domain admin', async () => {
    const names = await listToolNamesFor({
      identity: { userId: 'test-user-id', agentId: OWNED_AGENT_ID },
      agentDatabase: ownedAgentDb(),
    });
    // read_own_agent is the ONLY agent-admin tool a registered agent may see.
    expect(names).toContain(AGENT_SELF_TOOL);
    for (const tool of HUMAN_ADMIN_TOOLS) {
      expect(names, `${tool} must be hidden from a registered agent`).not.toContain(tool);
    }
  });

  it('read_own_agent input schema is empty — there is no caller-selectable target', async () => {
    clearMcpToolMetadataCacheForTests();
    const server = createMcpServer(
      { ...mockDeps, database: resolvedContextDatabase, agentDatabase: ownedAgentDb() },
      {
        resolveIdentity: async () => ({ userId: 'test-user-id', agentId: OWNED_AGENT_ID }),
        resolveUserId: async () => 'test-user-id',
      } as McpAuthResolver,
      mockScopedDepsFactory,
    );
    const response = await invokeMcpRequest({ server, method: 'tools/list', headers: { 'x-api-key': 'agent-key' } });
    const tool = response.result?.tools?.find((t) => t.name === AGENT_SELF_TOOL) as
      | { name: string; inputSchema?: { properties?: Record<string, unknown> } }
      | undefined;
    expect(tool, 'read_own_agent must be advertised to a registered agent').toBeDefined();
    // No properties → no agent_id / target field the caller could set.
    expect(Object.keys(tool?.inputSchema?.properties ?? {})).toEqual([]);
  });

  it('read_own_agent returns the caller\u2019s own sanitized record, reading only context.agentId', async () => {
    const resolvedIds: string[] = [];
    const result = await callTool({
      identity: { userId: 'test-user-id', agentId: OWNED_AGENT_ID },
      agentDatabase: ownedAgentDb(resolvedIds),
      toolName: AGENT_SELF_TOOL,
      // A forged target in the arguments is stripped by the empty input schema.
      arguments: { agent_id: FOREIGN_AGENT_ID },
    });
    expect(result.code).not.toBe('MCP_CAPABILITY_DENIED');
    const payload = parseToolResult(result.text);
    expect(payload.success).toBe(true);
    const agent = payload.data?.agent as { id: string; ownerId: string } | undefined;
    // The record returned is the CALLER's own agent, never the forged target.
    expect(agent?.id).toBe(OWNED_AGENT_ID);
    expect(agent?.id).not.toBe(FOREIGN_AGENT_ID);
    expect(agent?.ownerId).toBe('test-user-id');
    // Every registry lookup used context.agentId only — the forged FOREIGN id
    // was never queried.
    expect(resolvedIds.length).toBeGreaterThan(0);
    expect(resolvedIds.every((id) => id === OWNED_AGENT_ID)).toBe(true);
  });

  it('read_own_agent redacts private transport config while preserving the safe response shape', async () => {
    const result = await callTool({
      identity: { userId: 'test-user-id', agentId: OWNED_AGENT_ID },
      agentDatabase: ownedAgentDb(),
      toolName: AGENT_SELF_TOOL,
      arguments: {},
    });
    const payload = parseToolResult(result.text);
    expect(payload.success).toBe(true);
    const agent = payload.data?.agent as {
      id: string;
      transports: Array<{ id: string; channel: string; config: Record<string, unknown>; priority: number; active: boolean; failureCount: number }>;
      permissions: unknown[];
    };
    // Safe response shape preserved: the transport row is still projected with
    // its channel/priority/health fields, and permissions remain visible.
    expect(agent.transports).toHaveLength(1);
    expect(agent.transports[0]).toMatchObject({
      id: 'transport-1',
      channel: 'mcp',
      priority: 0,
      active: true,
      failureCount: 0,
    });
    expect(agent.permissions).toHaveLength(1);
    // The private field itself is fully redacted…
    expect(agent.transports[0]!.config).toEqual({});
    // …and the sensitive VALUE does not leak anywhere in the raw payload.
    expect(result.text).not.toContain(SENSITIVE_TRANSPORT_SECRET);
  });

  it('registered agent is denied every human admin tool with MCP_CAPABILITY_DENIED before context DB', async () => {
    for (const { tool, args } of HUMAN_ADMIN_CALLS) {
      const counter = { reads: 0 };
      const result = await callTool({
        identity: { userId: 'test-user-id', agentId: OWNED_AGENT_ID },
        agentDatabase: ownedAgentDb(),
        database: guardReads(counter),
        scopedThrows: true,
        toolName: tool,
        arguments: args,
      });
      expect(result.isError, `${tool} must reach policy`).toBe(true);
      expect(result.code, `${tool} must be MCP_CAPABILITY_DENIED`).toBe('MCP_CAPABILITY_DENIED');
      expect(counter.reads, `${tool} must deny before context DB`).toBe(0);
    }
  });

  it('session human tools/list exposes the full human admin surface but never read_own_agent', async () => {
    const names = await listToolNamesFor({
      identity: { userId: 'test-user-id', isSessionAuth: true },
      headers: { authorization: 'Bearer session-token' },
    });
    for (const tool of HUMAN_ADMIN_TOOLS) {
      expect(names, `${tool} must be visible to a session human`).toContain(tool);
    }
    expect(names, 'read_own_agent is agent-only and must be hidden from humans').not.toContain(AGENT_SELF_TOOL);
  });

  it('session human is admitted to every human admin tool; the handler owns the owned-only check', async () => {
    // Policy admits all human admin tools; ownership is a handler concern. Proven
    // by reaching the handler with an owned fixture (no capability denial).
    for (const { tool, args } of HUMAN_ADMIN_CALLS) {
      const result = await callTool({
        identity: { userId: 'test-user-id', isSessionAuth: true },
        headers: { authorization: 'Bearer session-token' },
        agentDatabase: ownedAgentDb(),
        toolName: tool,
        arguments: args,
      });
      expect(result.code, `${tool} must not be MCP_CAPABILITY_DENIED`).not.toBe('MCP_CAPABILITY_DENIED');
    }
  });

  it('session human read_own_agent is denied at the capability layer before context DB', async () => {
    const counter = { reads: 0 };
    const result = await callTool({
      identity: { userId: 'test-user-id', isSessionAuth: true },
      headers: { authorization: 'Bearer session-token' },
      database: guardReads(counter),
      scopedThrows: true,
      toolName: AGENT_SELF_TOOL,
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.code).toBe('MCP_CAPABILITY_DENIED');
    expect(counter.reads, 'read_own_agent denial must precede any context DB read').toBe(0);
  });

  it('session human mutating a FOREIGN agent is admitted by policy but rejected by the handler (not a policy denial)', async () => {
    // Owned-vs-foreign is a handler distinction: the policy admits the call, and
    // the handler returns "Agent not found" for another user's agent.
    const result = await callTool({
      identity: { userId: 'test-user-id', isSessionAuth: true },
      headers: { authorization: 'Bearer session-token' },
      agentDatabase: foreignAgentDb(),
      toolName: 'update_agent',
      arguments: { agent_id: FOREIGN_AGENT_ID, name: 'Hijacked' },
    });
    expect(result.code).not.toBe('MCP_CAPABILITY_DENIED');
    const payload = parseToolResult(result.text);
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/not found/i);
  });

  /** Persistence/mutation call counters for the owned-vs-foreign handler matrix. */
  type MutationCounts = { updates: number; deletes: number; grants: number; revokes: number };
  const zeroMutations = (): MutationCounts => ({ updates: 0, deletes: 0, grants: 0, revokes: 0 });

  /**
   * Agent registry whose records belong to `ownerId` and whose every mutation
   * method increments a counter — proving foreign targets are rejected BEFORE
   * persistence while owned targets reach exactly one mutation.
   */
  const auditedAgentDb = (
    ownerId: string,
    counts: MutationCounts,
    listRequestedUserIds?: string[],
  ): AgentDatabase => ({
    ...mockAgentDb,
    getAgent: async (id: string) => agentRecord(id, ownerId),
    getAgentWithRelations: async (id: string) => agentRecord(id, ownerId),
    listAgentsForUser: async (userId: string) => {
      listRequestedUserIds?.push(userId);
      return [agentRecord(OWNED_AGENT_ID, userId)];
    },
    updateAgent: async (id: string) => { counts.updates += 1; return agentRecord(id, ownerId); },
    deleteAgent: async () => { counts.deletes += 1; },
    grantPermission: async () => {
      counts.grants += 1;
      return {
        id: 'permission-2',
        agentId: OWNED_AGENT_ID,
        userId: 'test-user-id',
        scope: 'global' as const,
        scopeId: null,
        actions: ['manage:intents'],
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      };
    },
    revokePermission: async () => { counts.revokes += 1; },
  });

  it('list_agents queries ONLY the caller\u2019s own userId and returns no foreign record (and no transport secrets)', async () => {
    const requestedUserIds: string[] = [];
    const counts = zeroMutations();
    const result = await callTool({
      identity: { userId: 'test-user-id', isSessionAuth: true },
      headers: { authorization: 'Bearer session-token' },
      agentDatabase: auditedAgentDb('test-user-id', counts, requestedUserIds),
      toolName: 'list_agents',
      arguments: {},
    });
    const payload = parseToolResult(result.text);
    expect(payload.success).toBe(true);
    // The registry lookup is keyed strictly by the authenticated caller.
    expect(requestedUserIds).toEqual(['test-user-id']);
    const agents = payload.data?.agents as Array<{ id: string; ownerId: string }>;
    expect(agents.length).toBeGreaterThan(0);
    expect(agents.every((agent) => agent.ownerId === 'test-user-id')).toBe(true);
    expect(agents.some((agent) => agent.id === FOREIGN_AGENT_ID)).toBe(false);
    // The list projection is sanitized too — no transport secret leaks.
    expect(result.text).not.toContain(SENSITIVE_TRANSPORT_SECRET);
  });

  it('each target-bearing mutation admits an OWNED target and persists exactly once', async () => {
    const ownedMutations = [
      { tool: 'update_agent', args: { agent_id: OWNED_AGENT_ID, name: 'Renamed' }, count: (c: MutationCounts) => c.updates },
      { tool: 'delete_agent', args: { agent_id: OWNED_AGENT_ID }, count: (c: MutationCounts) => c.deletes },
      { tool: 'grant_agent_permission', args: { agent_id: OWNED_AGENT_ID, actions: ['manage:intents'], scope: 'global' }, count: (c: MutationCounts) => c.grants },
      { tool: 'revoke_agent_permission', args: { agent_id: OWNED_AGENT_ID, permission_id: 'permission-1' }, count: (c: MutationCounts) => c.revokes },
    ] as const;

    for (const { tool, args, count } of ownedMutations) {
      const counts = zeroMutations();
      const result = await callTool({
        identity: { userId: 'test-user-id', isSessionAuth: true },
        headers: { authorization: 'Bearer session-token' },
        agentDatabase: auditedAgentDb('test-user-id', counts),
        toolName: tool,
        arguments: args,
      });
      const payload = parseToolResult(result.text);
      expect(payload.success, `${tool} must admit the owned target`).toBe(true);
      expect(count(counts), `${tool} must persist exactly once for the owned target`).toBe(1);
      const others = counts.updates + counts.deletes + counts.grants + counts.revokes - count(counts);
      expect(others, `${tool} must not trigger unrelated mutations`).toBe(0);
    }
  });

  it('each target-bearing mutation rejects a FOREIGN target with zero persistence', async () => {
    const foreignMutations = [
      { tool: 'update_agent', args: { agent_id: FOREIGN_AGENT_ID, name: 'Hijacked' } },
      { tool: 'delete_agent', args: { agent_id: FOREIGN_AGENT_ID } },
      { tool: 'grant_agent_permission', args: { agent_id: FOREIGN_AGENT_ID, actions: ['manage:intents'], scope: 'global' } },
      { tool: 'revoke_agent_permission', args: { agent_id: FOREIGN_AGENT_ID, permission_id: 'permission-1' } },
    ] as const;

    for (const { tool, args } of foreignMutations) {
      const counts = zeroMutations();
      const result = await callTool({
        identity: { userId: 'test-user-id', isSessionAuth: true },
        headers: { authorization: 'Bearer session-token' },
        agentDatabase: auditedAgentDb('other-user-id', counts),
        toolName: tool,
        arguments: args,
      });
      expect(result.code, `${tool} is admitted by policy (ownership is a handler concern)`).not.toBe('MCP_CAPABILITY_DENIED');
      const payload = parseToolResult(result.text);
      expect(payload.success, `${tool} must reject the foreign target`).toBe(false);
      expect(payload.error, `${tool} must not reveal the foreign record`).toMatch(/not found/i);
      expect(counts.updates + counts.deletes + counts.grants + counts.revokes, `${tool} must never persist for a foreign target`).toBe(0);
    }
  });

  it('enrollment-capable unregistered key sees only register_agent (no read_own_agent, no admin)', async () => {
    clearMcpToolMetadataCacheForTests();
    const server = createMcpServer(
      { ...mockDeps, database: resolvedContextDatabase },
      {
        resolveIdentity: async () => ({ userId: 'test-user-id', enrollmentCapable: true }),
        resolveUserId: async () => 'test-user-id',
      } as McpAuthResolver,
      mockScopedDepsFactory,
    );
    const response = await invokeMcpRequest({
      server,
      method: 'tools/list',
      headers: { 'x-api-key': 'enrollment-key' },
    });
    const names = response.result?.tools?.map((tool) => tool.name) ?? [];
    // Whole-registry proof: the enrollment credential is single-purpose. Across
    // the ENTIRE MCP registry — domain, informational, delivery, and admin —
    // exactly one tool is advertised.
    expect(names).toEqual(['register_agent']);
  });

  it('enrollment-capable key is denied representative domain tools of every access class before any resource', async () => {
    // Schema-valid calls across authenticated / permission / informational /
    // delivery_only / human_only access classes: each is denied at the
    // capability layer with zero context-DB reads and zero scoped-deps
    // creation — no adapter or resource work is reachable.
    const enrollmentDomainCalls = [
      { tool: 'read_intents', args: {} },
      { tool: 'create_intent', args: { description: 'A specific valid discovery intent' } },
      { tool: 'read_docs', args: {} },
      { tool: 'confirm_opportunity_delivery', args: { opportunityId: '00000000-0000-4000-8000-000000000001', trigger: 'ambient' } },
      // human_only representative registered on this surface (chat-history tools
      // are chat-session-only and never in this MCP registry).
      { tool: 'delete_network', args: { networkId: '00000000-0000-4000-8000-000000000001' } },
    ] as const;

    for (const { tool, args } of enrollmentDomainCalls) {
      const counter = { reads: 0 };
      const result = await callTool({
        identity: { userId: 'test-user-id', enrollmentCapable: true },
        database: guardReads(counter),
        scopedThrows: true,
        toolName: tool,
        arguments: args,
        headers: { 'x-api-key': 'enrollment-key' },
      });
      expect(result.isError, `${tool} must reach policy`).toBe(true);
      expect(result.code, `${tool} must be MCP_CAPABILITY_DENIED`).toBe('MCP_CAPABILITY_DENIED');
      expect(counter.reads, `${tool} must deny before context DB`).toBe(0);
      expect(result.scopedCreateArgs, `${tool} must never create scoped deps`).toEqual([]);
    }
  });

  it('enrollment-capable key is denied read_own_agent and every non-register admin tool before context DB', async () => {
    const deniedForEnrollment = [
      { tool: AGENT_SELF_TOOL, args: {} },
      { tool: 'list_agents', args: {} },
      { tool: 'update_agent', args: { agent_id: OWNED_AGENT_ID } },
      { tool: 'delete_agent', args: { agent_id: OWNED_AGENT_ID } },
      { tool: 'grant_agent_permission', args: { agent_id: OWNED_AGENT_ID, actions: ['manage:intents'], scope: 'global' } },
      { tool: 'revoke_agent_permission', args: { agent_id: OWNED_AGENT_ID, permission_id: 'permission-1' } },
    ] as const;

    for (const { tool, args } of deniedForEnrollment) {
      const counter = { reads: 0 };
      const result = await callTool({
        identity: { userId: 'test-user-id', enrollmentCapable: true },
        database: guardReads(counter),
        scopedThrows: true,
        toolName: tool,
        arguments: args,
        headers: { 'x-api-key': 'enrollment-key' },
      });
      expect(result.isError, `${tool} must reach policy`).toBe(true);
      expect(result.code, `${tool} must be MCP_CAPABILITY_DENIED`).toBe('MCP_CAPABILITY_DENIED');
      expect(counter.reads, `${tool} must deny before context DB`).toBe(0);
    }
  });

  it('plain unregistered key fails closed on every agent-admin tool with MCP_CAPABILITY_DENIED before context DB', async () => {
    const failClosedCalls = [
      { tool: AGENT_SELF_TOOL, args: {} },
      ...HUMAN_ADMIN_CALLS,
    ] as const;

    for (const { tool, args } of failClosedCalls) {
      const counter = { reads: 0 };
      const result = await callTool({
        identity: { userId: 'test-user-id' },
        database: guardReads(counter),
        scopedThrows: true,
        toolName: tool,
        arguments: args,
        headers: { 'x-api-key': 'ordinary-key' },
      });
      expect(result.isError, `${tool} must reach policy`).toBe(true);
      expect(result.code, `${tool} must be MCP_CAPABILITY_DENIED`).toBe('MCP_CAPABILITY_DENIED');
      expect(counter.reads, `${tool} must deny before context DB`).toBe(0);
    }
  });

  it('plain unregistered key sees zero agent-admin tools in tools/list', async () => {
    clearMcpToolMetadataCacheForTests();
    const server = createMcpServer(
      { ...mockDeps, database: resolvedContextDatabase },
      {
        resolveIdentity: async () => ({ userId: 'test-user-id' }),
        resolveUserId: async () => 'test-user-id',
      } as McpAuthResolver,
      mockScopedDepsFactory,
    );
    const response = await invokeMcpRequest({
      server,
      method: 'tools/list',
      headers: { 'x-api-key': 'ordinary-key' },
    });
    const names = response.result?.tools?.map((tool) => tool.name) ?? [];
    for (const tool of ALL_AGENT_ADMIN_TOOLS) {
      expect(names, `${tool} must be hidden`).not.toContain(tool);
    }
  });
});
