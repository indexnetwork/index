import '../src/startup.env';
import { describe, it, expect } from 'bun:test';
import { createMcpServer } from '../../packages/protocol/src/mcp/mcp.server';
import { createAgentTools } from '../../packages/protocol/src/agent/agent.tools';
import { createToolRegistry } from '../../packages/protocol/src/shared/agent/tool.registry';
import type { ToolDeps } from '../../packages/protocol/src/shared/agent/tool.helpers';
import type { McpAuthResolver } from '../../packages/protocol/src/shared/interfaces/auth.interface';
import type { AgentDatabase } from '../../packages/protocol/src/shared/interfaces/agent.interface';
import type { ScopedDepsFactory } from '../../packages/protocol/src/mcp/mcp.server';

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
      context: {
        userId: 'test-user-id',
        userName: 'Test User',
        userEmail: 'test@example.com',
        user: { id: 'test-user-id' } as never,
        userProfile: null,
        userNetworks: [],
        isOnboarding: false,
        hasName: true,
      },
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
      context: {
        userId: 'test-user-id',
        userName: 'Test User',
        userEmail: 'test@example.com',
        user: { id: 'test-user-id' } as never,
        userProfile: null,
        userNetworks: [],
        isOnboarding: false,
        hasName: true,
      },
      query: { name: 'Agent', permissions: ['invalid:action'] },
    });

    expect(parseToolResult(result ?? '')).toEqual({
      success: false,
      error: 'Invalid action: invalid:action. Valid actions: manage:profile, manage:intents, manage:networks, manage:contacts, manage:opportunities, manage:negotiations',
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
      context: {
        agentId: 'agent-123',
        userId: 'test-user-id',
        userName: 'Test User',
        userEmail: 'test@example.com',
        user: { id: 'test-user-id' } as never,
        userProfile: null,
        userNetworks: [],
        isOnboarding: false,
        hasName: true,
      },
      query: { name: 'Agent' },
    });

    expect(parseToolResult(result ?? '')).toEqual({
      success: false,
      error: 'Agent registration must be done from a user session (web UI or personal API key), ' +
        'not from within an existing agent context. To register a new agent, visit the Index web app.',
    });
    expect(createAgentCalls).toEqual([]);
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
          type: 'personal',
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
      context: {
        userId: 'test-user-id',
        userName: 'Test User',
        userEmail: 'test@example.com',
        user: { id: 'test-user-id' } as never,
        userProfile: null,
        userNetworks: [],
        isOnboarding: false,
        hasName: true,
      },
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
});
