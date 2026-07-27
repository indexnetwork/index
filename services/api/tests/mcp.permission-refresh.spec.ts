import '../src/startup.env';
import { describe, it, expect } from 'bun:test';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';

import { createMcpServer, clearMcpToolMetadataCacheForTests } from '../../../packages/protocol/src/mcp/mcp.server';
import type { ScopedDepsFactory } from '../../../packages/protocol/src/mcp/mcp.server';
import type { McpAuthorizationDenialEvent, McpAuthorizationObserver } from '../../../packages/protocol/src/mcp/mcp.authorization-policy';
import type { ToolDeps } from '../../../packages/protocol/src/shared/agent/tool.helpers';
import type { McpAuthResolver } from '../../../packages/protocol/src/shared/interfaces/auth.interface';
import type { AgentDatabase } from '../../../packages/protocol/src/shared/interfaces/agent.interface';

// ═══════════════════════════════════════════════════════════════════════════════
// IND-581: fresh authorization on reconnect/refresh, cross-principal cache
// isolation, and secret-free denial telemetry.
//
// Every case drives REAL tools/list / tools/call requests through the MCP
// transport against the real resolver + module-level metadata cache. No DB,
// Redis, or network — the auth resolver, agent registry, chat-context database,
// and scoped-deps factory are all in-memory doubles. Each `createMcpServer`
// call is a fresh reconnect/session resolution (the /mcp transport is stateless
// and builds a new server per HTTP request in production).
// ═══════════════════════════════════════════════════════════════════════════════

/** Credentials that must NEVER appear in emitted denial telemetry. */
const SECRET_API_KEY = 'sk-agent-super-secret-key-value-581';
const SECRET_BEARER = 'session-super-secret-bearer-581';

/** Minimal AgentDatabase whose methods throw unless explicitly overridden. */
const baseAgentDb: AgentDatabase = {
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
  agentDatabase: baseAgentDb,
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

/** Onboarding-complete chat context reads (only reached for admitted calls). */
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

/** A context database whose every read throws — proves denial precedes DB work. */
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

/** One fresh reconnect: build a per-request server + transport and send one call. */
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
    await Promise.allSettled([transport.close(), params.server.close()]);
  }
}

/** A single agent permission row. */
type PermissionRow = {
  scope: 'global' | 'network';
  scopeId: string | null;
  actions: string[];
};

/** Mutable agent registry state — the source mutated across reconnects. */
type MutableAgentState = {
  status: 'active' | 'inactive';
  permissions: PermissionRow[];
};

/**
 * Builds an AgentDatabase that reads LIVE from `state` on every
 * getAgentWithRelations call, so each fresh server resolution reflects the
 * current granted/revoked/deactivated state (never a stale snapshot).
 */
function liveAgentDb(agentId: string, state: MutableAgentState): AgentDatabase {
  return {
    ...baseAgentDb,
    getAgentWithRelations: async () => ({
      id: agentId,
      ownerId: 'test-user-id',
      name: 'Agent',
      description: null,
      type: 'external',
      status: state.status,
      metadata: {},
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      transports: [],
      permissions: state.permissions.map((permission, index) => ({
        id: `permission-${index}`,
        agentId,
        userId: 'test-user-id',
        scope: permission.scope,
        scopeId: permission.scopeId,
        actions: permission.actions,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      })),
    }),
  };
}

interface CallOutcome {
  isError?: boolean;
  code?: string;
  text: string;
  listNames: string[];
  scopedCreateArgs: Array<{ userId: string; allowedNetworkIds: string[] }>;
  denials: McpAuthorizationDenialEvent[];
}

/** Fresh reconnect for one tools/list or tools/call under a specific identity. */
async function resolveOnce(params: {
  identity: Record<string, unknown>;
  method: 'tools/list' | 'tools/call';
  toolName?: string;
  arguments?: Record<string, unknown>;
  agentDatabase?: AgentDatabase;
  database?: ToolDeps['database'];
  headers?: Record<string, string>;
  scopedThrows?: boolean;
  observer?: McpAuthorizationObserver;
}): Promise<CallOutcome> {
  clearMcpToolMetadataCacheForTests();
  const scopedCreateArgs: Array<{ userId: string; allowedNetworkIds: string[] }> = [];
  const scopedFactory: ScopedDepsFactory = {
    create: (userId: string, allowedNetworkIds: string[]) => {
      scopedCreateArgs.push({ userId, allowedNetworkIds });
      if (params.scopedThrows) throw new Error('scoped database must not be created');
      return { userDb: {} as ToolDeps['userDb'], systemDb: {} as ToolDeps['systemDb'] };
    },
  };
  const server = createMcpServer(
    {
      ...mockDeps,
      database: params.database ?? resolvedContextDatabase,
      agentDatabase: params.agentDatabase ?? baseAgentDb,
    },
    {
      resolveIdentity: async () => params.identity,
      resolveUserId: async () => 'test-user-id',
    } as McpAuthResolver,
    scopedFactory,
    {},
    params.observer,
  );

  const response = await invokeMcpRequest({
    server,
    method: params.method,
    requestParams: params.method === 'tools/call'
      ? { name: params.toolName, arguments: params.arguments ?? {} }
      : {},
    headers: params.headers,
  });

  const text = response.result?.content?.[0]?.text ?? '';
  let code: string | undefined;
  try {
    code = (JSON.parse(text || '{}') as { code?: string }).code;
  } catch {
    code = undefined;
  }
  return {
    isError: response.result?.isError,
    code,
    text,
    listNames: response.result?.tools?.map((tool) => tool.name) ?? [],
    scopedCreateArgs,
    denials: [],
  };
}

/** Collecting observer double — records every denial event verbatim. */
function collectingObserver(): { events: McpAuthorizationDenialEvent[]; observer: McpAuthorizationObserver } {
  const events: McpAuthorizationDenialEvent[] = [];
  return {
    events,
    observer: { onCapabilityDenied: (event) => { events.push(event); } },
  };
}

/** The set of keys a denial event may carry — nothing token/secret/payload-shaped. */
const ALLOWED_DENIAL_KEYS = new Set([
  'phase',
  'toolName',
  'profile',
  'reason',
  'reach',
  'requiredPermissions',
  'userId',
  'agentId',
  'networkScopeId',
]);

const AGENT_ID = 'agent-1';
const AGENT_HEADERS = { 'x-api-key': SECRET_API_KEY };

describe('IND-581 MCP authorization refresh + isolation + telemetry', () => {
  it('freshly resolves granted → revoked → deactivated across reconnects, denying before adapter work', async () => {
    const state: MutableAgentState = {
      status: 'active',
      permissions: [{ scope: 'global', scopeId: null, actions: ['manage:intents'] }],
    };
    const agentDatabase = liveAgentDb(AGENT_ID, state);
    const identity = { userId: 'test-user-id', agentId: AGENT_ID };
    const validIntent = { description: 'A specific valid discovery intent' };

    // (1) GRANTED: create_intent is admitted and reaches the scoped handler seam,
    // and tools/list advertises it.
    const grantedCall = await resolveOnce({
      identity, agentDatabase, method: 'tools/call',
      toolName: 'create_intent', arguments: validIntent, headers: AGENT_HEADERS,
    });
    expect(grantedCall.code).not.toBe('MCP_CAPABILITY_DENIED');
    expect(grantedCall.scopedCreateArgs.length).toBe(1);

    const grantedList = await resolveOnce({
      identity, agentDatabase, method: 'tools/list', headers: AGENT_HEADERS,
    });
    expect(grantedList.listNames).toContain('create_intent');

    // (2) REVOKED: the SAME live source now has no matching grant. The next fresh
    // reconnect must deny create_intent — before any chat DB read or scoped-deps
    // construction — and drop it from tools/list.
    state.permissions = [];
    const revokedCounter = { reads: 0 };
    const revokedCall = await resolveOnce({
      identity, agentDatabase, method: 'tools/call',
      toolName: 'create_intent', arguments: validIntent, headers: AGENT_HEADERS,
      database: guardReads(revokedCounter), scopedThrows: true,
    });
    expect(revokedCall.isError).toBe(true);
    expect(revokedCall.code).toBe('MCP_CAPABILITY_DENIED');
    expect(revokedCounter.reads).toBe(0);
    expect(revokedCall.scopedCreateArgs).toEqual([]);

    const revokedList = await resolveOnce({
      identity, agentDatabase, method: 'tools/list', headers: AGENT_HEADERS,
    });
    expect(revokedList.listNames).not.toContain('create_intent');

    // (3) DEACTIVATED: the agent is now inactive. It becomes an invalid principal;
    // the next fresh reconnect denies create_intent before adapter work and its
    // tools/list collapses to empty.
    state.status = 'inactive';
    const deactivatedCounter = { reads: 0 };
    const deactivatedCall = await resolveOnce({
      identity, agentDatabase, method: 'tools/call',
      toolName: 'create_intent', arguments: validIntent, headers: AGENT_HEADERS,
      database: guardReads(deactivatedCounter), scopedThrows: true,
    });
    expect(deactivatedCall.isError).toBe(true);
    expect(deactivatedCall.code).toBe('MCP_CAPABILITY_DENIED');
    expect(deactivatedCounter.reads).toBe(0);
    expect(deactivatedCall.scopedCreateArgs).toEqual([]);

    const deactivatedList = await resolveOnce({
      identity, agentDatabase, method: 'tools/list', headers: AGENT_HEADERS,
    });
    expect(deactivatedList.listNames).toEqual([]);
  });

  it('does not leak metadata/capability results between two principals sharing the module cache', async () => {
    // Both principals resolve within the same process against the shared,
    // module-level static metadata cache (no clear between them here).
    clearMcpToolMetadataCacheForTests();

    const humanServer = createMcpServer(
      { ...mockDeps, database: resolvedContextDatabase },
      {
        resolveIdentity: async () => ({ userId: 'test-user-id', isSessionAuth: true }),
        resolveUserId: async () => 'test-user-id',
      } as McpAuthResolver,
      { create: () => ({ userDb: {} as ToolDeps['userDb'], systemDb: {} as ToolDeps['systemDb'] }) },
    );
    const humanResponse = await invokeMcpRequest({
      server: humanServer, method: 'tools/list', headers: { authorization: `Bearer ${SECRET_BEARER}` },
    });
    const humanNames = humanResponse.result?.tools?.map((tool) => tool.name) ?? [];

    const revokedAgentDb = liveAgentDb(AGENT_ID, { status: 'active', permissions: [] });
    const agentServer = createMcpServer(
      { ...mockDeps, database: resolvedContextDatabase, agentDatabase: revokedAgentDb },
      {
        resolveIdentity: async () => ({ userId: 'test-user-id', agentId: AGENT_ID }),
        resolveUserId: async () => 'test-user-id',
      } as McpAuthResolver,
      { create: () => ({ userDb: {} as ToolDeps['userDb'], systemDb: {} as ToolDeps['systemDb'] }) },
    );
    const agentResponse = await invokeMcpRequest({
      server: agentServer, method: 'tools/list', headers: AGENT_HEADERS,
    });
    const agentNames = agentResponse.result?.tools?.map((tool) => tool.name) ?? [];

    // The permissioned human sees write/admin tools the revoked agent must not.
    expect(humanNames).toContain('create_intent');
    expect(humanNames).toContain('update_agent');
    // The revoked agent's grant loss is not masked by the human's cached inventory.
    expect(agentNames).not.toContain('create_intent');
    expect(agentNames).not.toContain('update_agent');

    // Re-resolving the human after the agent must still yield the full human view
    // (the shared cache holds static metadata only, never a per-principal result).
    const humanAgain = await invokeMcpRequest({
      server: createMcpServer(
        { ...mockDeps, database: resolvedContextDatabase },
        {
          resolveIdentity: async () => ({ userId: 'test-user-id', isSessionAuth: true }),
          resolveUserId: async () => 'test-user-id',
        } as McpAuthResolver,
        { create: () => ({ userDb: {} as ToolDeps['userDb'], systemDb: {} as ToolDeps['systemDb'] }) },
      ),
      method: 'tools/list',
      headers: { authorization: `Bearer ${SECRET_BEARER}` },
    });
    expect(humanAgain.result?.tools?.map((tool) => tool.name) ?? []).toEqual(humanNames);
  });

  it('emits denial telemetry with only safe caller-profile/reason fields (no token/secret/payload)', async () => {
    const { events, observer } = collectingObserver();
    const revokedAgentDb = liveAgentDb(AGENT_ID, { status: 'active', permissions: [] });

    const counter = { reads: 0 };
    const outcome = await resolveOnce({
      identity: { userId: 'test-user-id', agentId: AGENT_ID },
      agentDatabase: revokedAgentDb,
      method: 'tools/call',
      toolName: 'create_intent',
      arguments: { description: 'A specific valid discovery intent', secretPayload: SECRET_API_KEY },
      headers: AGENT_HEADERS,
      database: guardReads(counter),
      scopedThrows: true,
      observer,
    });

    expect(outcome.code).toBe('MCP_CAPABILITY_DENIED');
    expect(counter.reads).toBe(0);

    // A denial event was emitted describing the caller profile and reason.
    expect(events.length).toBeGreaterThan(0);
    const denial = events.at(-1)!;
    expect(denial.phase).toBe('tools/call');
    expect(denial.toolName).toBe('create_intent');
    expect(denial.profile).toBe('registered_global_agent');
    expect(denial.reason).toBe('permission_missing');
    expect(denial.userId).toBe('test-user-id');
    expect(denial.agentId).toBe(AGENT_ID);

    // Every event carries ONLY safe keys — no token/secret/argument-payload shape.
    for (const event of events) {
      for (const key of Object.keys(event)) {
        expect(ALLOWED_DENIAL_KEYS.has(key), `unexpected denial field: ${key}`).toBe(true);
      }
    }

    // The credential and the sensitive argument value never appear in telemetry.
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(SECRET_API_KEY);
    expect(serialized).not.toContain('secretPayload');
  });

  it('emits an invalid-principal denial for a deactivated agent without leaking credentials', async () => {
    const { events, observer } = collectingObserver();
    const inactiveAgentDb = liveAgentDb(AGENT_ID, {
      status: 'inactive',
      permissions: [{ scope: 'global', scopeId: null, actions: ['manage:intents'] }],
    });

    const counter = { reads: 0 };
    const outcome = await resolveOnce({
      identity: { userId: 'test-user-id', agentId: AGENT_ID },
      agentDatabase: inactiveAgentDb,
      method: 'tools/call',
      toolName: 'create_intent',
      arguments: { description: 'A specific valid discovery intent' },
      headers: AGENT_HEADERS,
      database: guardReads(counter),
      scopedThrows: true,
      observer,
    });

    expect(outcome.code).toBe('MCP_CAPABILITY_DENIED');
    expect(counter.reads).toBe(0);
    const denial = events.at(-1)!;
    expect(denial.profile).toBe('invalid_agent');
    expect(denial.reason).toBe('invalid_agent');
    expect(JSON.stringify(events)).not.toContain(SECRET_API_KEY);
  });

  it('a throwing observer never changes the fail-closed decision', async () => {
    const throwingObserver: McpAuthorizationObserver = {
      onCapabilityDenied: () => { throw new Error('observer boom'); },
    };
    const revokedAgentDb = liveAgentDb(AGENT_ID, { status: 'active', permissions: [] });
    const counter = { reads: 0 };
    const outcome = await resolveOnce({
      identity: { userId: 'test-user-id', agentId: AGENT_ID },
      agentDatabase: revokedAgentDb,
      method: 'tools/call',
      toolName: 'create_intent',
      arguments: { description: 'A specific valid discovery intent' },
      headers: AGENT_HEADERS,
      database: guardReads(counter),
      scopedThrows: true,
      observer: throwingObserver,
    });
    // The denial still stands and no adapter work happened despite the throw.
    expect(outcome.code).toBe('MCP_CAPABILITY_DENIED');
    expect(counter.reads).toBe(0);
    expect(outcome.scopedCreateArgs).toEqual([]);
  });
});
