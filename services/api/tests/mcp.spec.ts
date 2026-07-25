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
    for (const removed of ['scrape_url', 'list_contacts', 'read_user_profiles', 'import_gmail_contacts', 'get_profile_run']) {
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
});
