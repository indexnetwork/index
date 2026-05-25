import '../src/startup.env';

import { beforeEach, describe, expect, it } from 'bun:test';

import {
  SYSTEM_AGENT_IDS,
  type AgentPermissionRow,
  type AgentRegistryStore,
  type AgentRow,
  type AgentScope,
  type AgentTransportRow,
  type AgentWithRelations,
} from '../src/adapters/agent.database.adapter';
import type { AgentTokenStore } from '../src/adapters/agent-token.adapter';
import { AgentController } from '../src/controllers/agent.controller';
import { PERSONAL_AGENT_DEFAULT_ACTIONS, AgentService, type AgentServiceStore } from '../src/services/agent.service';
import { agentService } from '../src/services/agent.service';

const OWNER_ID = 'owner-1';
const OTHER_USER_ID = 'user-2';

function createAgentRow(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    ownerId: OWNER_ID,
    name: 'Test Agent',
    description: 'Handles agent tasks',
    type: 'personal',
    status: 'active',
    metadata: {},
    notifyOnOpportunity: true,
    dailySummaryEnabled: true,
    handleNegotiations: false,
    lastDailySummaryAt: null,
    lastSeenAt: null,
    createdAt: new Date('2026-04-08T00:00:00.000Z'),
    updatedAt: new Date('2026-04-08T00:00:00.000Z'),
    ...overrides,
  };
}

function createTransportRow(overrides: Partial<AgentTransportRow> = {}): AgentTransportRow {
  return {
    id: 'transport-1',
    agentId: 'agent-1',
    channel: 'mcp',
    config: {},
    priority: 0,
    active: true,
    failureCount: 0,
    createdAt: new Date('2026-04-08T00:00:00.000Z'),
    updatedAt: new Date('2026-04-08T00:00:00.000Z'),
    ...overrides,
  };
}

function createPermissionRow(overrides: Partial<AgentPermissionRow> = {}): AgentPermissionRow {
  return {
    id: 'permission-1',
    agentId: 'agent-1',
    userId: OWNER_ID,
    scope: 'global',
    scopeId: null,
    actions: ['manage:intents'],
    createdAt: new Date('2026-04-08T00:00:00.000Z'),
    ...overrides,
  };
}

function createAgentWithRelations(overrides: Partial<AgentWithRelations> = {}): AgentWithRelations {
  const baseAgent = createAgentRow(overrides);
  return {
    ...baseAgent,
    transports: overrides.transports ?? [],
    permissions: overrides.permissions ?? [],
  };
}

function createStore(overrides: Partial<AgentServiceStore> = {}): AgentServiceStore {
  return {
    createAgent: async (input) => createAgentRow({ ...input }),
    getAgent: async () => createAgentRow(),
    getAgentWithRelations: async () => createAgentWithRelations(),
    updateAgent: async (_agentId, updates) => createAgentRow(updates),
    deleteAgent: async () => undefined,
    listAgentsForUser: async () => [createAgentWithRelations()],
    createTransport: async (input) => createTransportRow({
      agentId: input.agentId,
      channel: input.channel,
      config: input.config ?? {},
      priority: input.priority ?? 0,
    }),
    deleteTransport: async () => undefined,
    recordTransportFailure: async () => undefined,
    recordTransportSuccess: async () => undefined,
    grantPermission: async (input) => createPermissionRow({
      agentId: input.agentId,
      userId: input.userId,
      scope: input.scope ?? 'global',
      scopeId: input.scopeId ?? null,
      actions: input.actions,
    }),
    upsertGlobalPermission: async (input) => createPermissionRow({
      agentId: input.agentId,
      userId: input.userId,
      scope: 'global',
      scopeId: null,
      actions: input.actions,
    }),
    revokePermission: async () => undefined,
    revokeGlobalPermission: async () => undefined,
    hasPermission: async () => false,
    findAuthorizedAgents: async () => [createAgentWithRelations()],
    getSystemAgentIds: () => SYSTEM_AGENT_IDS,
    touchLastSeen: async () => undefined,
    ...overrides,
  };
}

function createTokenStore(overrides: Partial<AgentTokenStore> = {}): AgentTokenStore {
  return {
    create: async (_userId, _params) => ({
      id: 'token-1',
      key: 'secret-key',
      name: 'Agent API Key',
      createdAt: '2026-04-08T00:00:00.000Z',
    }),
    list: async () => [],
    revoke: async () => undefined,
    ...overrides,
  };
}

describe('AgentService', () => {
  let calls: {
    createAgent: Array<Parameters<AgentRegistryStore['createAgent']>[0]>;
    createTransport: Array<Parameters<AgentRegistryStore['createTransport']>[0]>;
    grantPermission: Array<Parameters<AgentRegistryStore['grantPermission']>[0]>;
    findAuthorizedAgents: Array<{ userId: string; action: string; scope?: AgentScope }>;
    hasPermission: Array<{ agentId: string; userId: string; action: string; scope?: AgentScope }>;
    deleteTransport: string[];
    createToken: Array<{ name: string; agentId: string }>;
    revokeToken: string[];
  };

  beforeEach(() => {
    calls = {
      createAgent: [],
      createTransport: [],
      grantPermission: [],
      findAuthorizedAgents: [],
      hasPermission: [],
      deleteTransport: [],
      createToken: [],
      revokeToken: [],
    };
  });

  it('creates a trimmed personal agent with empty relations', async () => {
    const service = new AgentService(
      createStore({
        createAgent: async (input) => {
          calls.createAgent.push(input);
          return createAgentRow({ ...input, description: input.description ?? null });
        },
      }),
    );

    const result = await service.create(OWNER_ID, '  Test Agent  ', '  Helpful assistant  ');

    expect(calls.createAgent).toEqual([
      {
        ownerId: OWNER_ID,
        name: 'Test Agent',
        description: 'Helpful assistant',
        type: 'personal',
      },
    ]);
    expect(result.transports).toEqual([]);
    expect(result.permissions).toHaveLength(1);
    expect(result.permissions[0]!.actions).toEqual([...PERSONAL_AGENT_DEFAULT_ACTIONS]);
  });

  it('rejects empty agent names on create', async () => {
    const service = new AgentService(createStore());

    await expect(service.create(OWNER_ID, '   ')).rejects.toThrow('Agent name is required');
  });

  it('creates a personal agent without manage:negotiations by default', async () => {
    let grantedActions: string[] = [];
    const store = createStore({
      createAgent: async (input) => createAgentRow({ ...input }),
      grantPermission: async (input) => {
        grantedActions = [...input.actions];
        return createPermissionRow({ actions: input.actions });
      },
    });
    const service = new AgentService(store, createTokenStore());

    await service.create(OWNER_ID, 'Fresh agent');

    expect(grantedActions).not.toContain('manage:negotiations');
    expect(grantedActions).toEqual(
      expect.arrayContaining([
        'manage:profile',
        'manage:intents',
        'manage:networks',
        'manage:contacts',
        'manage:opportunities',
      ]),
    );
  });

  it('allows an authorized user to fetch an agent', async () => {
    const service = new AgentService(
      createStore({
        getAgentWithRelations: async () =>
          createAgentWithRelations({ permissions: [createPermissionRow({ userId: OTHER_USER_ID })] }),
      }),
    );

    const result = await service.getById('agent-1', OTHER_USER_ID);

    expect(result.id).toBe('agent-1');
  });

  it('rejects unauthorized agent reads', async () => {
    const service = new AgentService(createStore());

    await expect(service.getById('agent-1', OTHER_USER_ID)).rejects.toThrow('Agent not found');
  });

  it('sanitizeAgent exposes the three notification toggle fields', async () => {
    const store = createStore({
      getAgentWithRelations: async () =>
        createAgentWithRelations({
          notifyOnOpportunity: false,
          dailySummaryEnabled: false,
          handleNegotiations: true,
        }),
    });
    const service = new AgentService(store, createTokenStore());

    const result = await service.getById('agent-1', OWNER_ID);

    expect(result.notifyOnOpportunity).toBe(false);
    expect(result.dailySummaryEnabled).toBe(false);
    expect(result.handleNegotiations).toBe(true);
  });

  it('rejects modifying a system agent', async () => {
    const service = new AgentService(
      createStore({
        getAgentWithRelations: async () => createAgentWithRelations({ type: 'system' }),
      }),
    );

    await expect(service.update('agent-1', OWNER_ID, { status: 'inactive' })).rejects.toThrow(
      'System agents cannot be modified',
    );
  });

  it('verifies the transport belongs to the agent before removing it', async () => {
    const service = new AgentService(
      createStore({
        getAgentWithRelations: async () => createAgentWithRelations({ transports: [] }),
      }),
    );

    await expect(service.removeTransport('agent-1', 'transport-1', OWNER_ID)).rejects.toThrow(
      'Transport not found',
    );
  });

  it('validates granted actions and scope ids', async () => {
    const service = new AgentService(
      createStore({
        grantPermission: async (input) => {
          calls.grantPermission.push(input);
          return createPermissionRow({
            agentId: input.agentId,
            userId: input.userId,
            scope: input.scope ?? 'global',
            scopeId: input.scopeId ?? null,
            actions: input.actions,
          });
        },
      }),
    );

    await expect(service.grantPermission('agent-1', OWNER_ID, ['bad:action'])).rejects.toThrow(
      'Invalid action: bad:action',
    );
    await expect(
      service.grantPermission('agent-1', OWNER_ID, ['manage:intents'], 'network'),
    ).rejects.toThrow('scopeId is required for network permissions');

    const permission = await service.grantPermission(
      'agent-1',
      OWNER_ID,
      ['manage:intents', 'manage:intents', 'manage:negotiations'],
      'network',
      'network-1',
    );

    expect(permission.actions).toEqual(['manage:intents', 'manage:negotiations']);
    expect(calls.grantPermission).toEqual([
      {
        agentId: 'agent-1',
        userId: OWNER_ID,
        scope: 'network',
        scopeId: 'network-1',
        actions: ['manage:intents', 'manage:negotiations'],
      },
    ]);
  });

  it('rejects permission grants from non-owners', async () => {
    const service = new AgentService(
      createStore({
        grantPermission: async (input) => {
          calls.grantPermission.push(input);
          return createPermissionRow({
            agentId: input.agentId,
            userId: input.userId,
            scope: input.scope ?? 'global',
            scopeId: input.scopeId ?? null,
            actions: input.actions,
          });
        },
      }),
    );

    await expect(service.grantPermission('agent-1', OTHER_USER_ID, ['manage:intents'])).rejects.toThrow(
      'Not authorized',
    );

    expect(calls.grantPermission).toEqual([]);
  });

  it('limits non-owner reads to their own permission rows', async () => {
    const service = new AgentService(
      createStore({
        getAgentWithRelations: async () =>
          createAgentWithRelations({
            permissions: [
              createPermissionRow({ id: 'permission-owner', userId: OWNER_ID }),
              createPermissionRow({ id: 'permission-other', userId: OTHER_USER_ID }),
            ],
          }),
      }),
    );

    const result = await service.getById('agent-1', OTHER_USER_ID);

    expect(result.permissions).toEqual([
      expect.objectContaining({ id: 'permission-other', userId: OTHER_USER_ID }),
    ]);
  });

  it('preserves the full permission roster for personal-agent owners', async () => {
    const service = new AgentService(
      createStore({
        getAgentWithRelations: async () =>
          createAgentWithRelations({
            permissions: [
              createPermissionRow({ id: 'permission-owner', userId: OWNER_ID }),
              createPermissionRow({ id: 'permission-other', userId: OTHER_USER_ID }),
            ],
          }),
      }),
    );

    const result = await service.getById('agent-1', OWNER_ID);

    expect(result.permissions).toHaveLength(2);
  });

  it('filters system-agent permissions to the viewer even for the owner', async () => {
    const service = new AgentService(
      createStore({
        getAgentWithRelations: async () =>
          createAgentWithRelations({
            type: 'system',
            permissions: [
              createPermissionRow({ id: 'permission-owner', userId: OWNER_ID }),
              createPermissionRow({ id: 'permission-other', userId: OTHER_USER_ID }),
            ],
          }),
      }),
    );

    const result = await service.getById('agent-1', OWNER_ID);

    expect(result.permissions).toEqual([
      expect.objectContaining({ id: 'permission-owner', userId: OWNER_ID }),
    ]);
  });

  it('limits listed agent permissions to the current non-owner user', async () => {
    const service = new AgentService(
      createStore({
        listAgentsForUser: async () => [
          createAgentWithRelations({
            permissions: [
              createPermissionRow({ id: 'permission-owner', userId: OWNER_ID }),
              createPermissionRow({ id: 'permission-other', userId: OTHER_USER_ID }),
            ],
          }),
        ],
      }),
    );

    const result = await service.listForUser(OTHER_USER_ID);

    expect(result[0]?.permissions).toEqual([
      expect.objectContaining({ id: 'permission-other', userId: OTHER_USER_ID }),
    ]);
  });

  it('grants default system permissions only when missing', async () => {
    const service = new AgentService(
      createStore({
        getAgent: async (agentId) => createAgentRow({ id: agentId, type: 'system' }),
        hasPermission: async (agentId, userId, action, scope) => {
          calls.hasPermission.push({ agentId, userId, action, scope });
          return agentId === SYSTEM_AGENT_IDS.negotiator;
        },
        grantPermission: async (input) => {
          calls.grantPermission.push(input);
          return createPermissionRow({
            agentId: input.agentId,
            userId: input.userId,
            actions: input.actions,
          });
        },
      }),
    );

    await service.grantDefaultSystemPermissions(OWNER_ID);

    expect(calls.hasPermission).toContainEqual({
      agentId: SYSTEM_AGENT_IDS.chatOrchestrator,
      userId: OWNER_ID,
      action: 'manage:profile',
      scope: { type: 'global' },
    });
    expect(calls.hasPermission).toContainEqual({
      agentId: SYSTEM_AGENT_IDS.negotiator,
      userId: OWNER_ID,
      action: 'manage:negotiations',
      scope: { type: 'global' },
    });
    const orchestratorGrant = calls.grantPermission.find(
      (g) => g.agentId === SYSTEM_AGENT_IDS.chatOrchestrator,
    );
    expect(orchestratorGrant).toBeDefined();
    expect(orchestratorGrant!.actions).toEqual([
      'manage:profile',
      'manage:intents',
      'manage:networks',
      'manage:contacts',
      'manage:opportunities',
    ]);
  });

  it('tops up missing global system actions instead of skipping partial grants', async () => {
    const service = new AgentService(
      createStore({
        getAgent: async (agentId) => createAgentRow({ id: agentId, type: 'system' }),
        hasPermission: async (agentId, _userId, action) => {
          if (agentId === SYSTEM_AGENT_IDS.chatOrchestrator) {
            return action === 'manage:profile';
          }

          return agentId === SYSTEM_AGENT_IDS.negotiator && action === 'manage:negotiations';
        },
        grantPermission: async (input) => {
          calls.grantPermission.push(input);
          return createPermissionRow({
            agentId: input.agentId,
            userId: input.userId,
            actions: input.actions,
          });
        },
      }),
    );

    await service.grantDefaultSystemPermissions(OWNER_ID);

    const orchestratorGrant = calls.grantPermission.find(
      (g) => g.agentId === SYSTEM_AGENT_IDS.chatOrchestrator,
    );
    expect(orchestratorGrant).toBeDefined();
    expect(orchestratorGrant!.actions).toEqual([
      'manage:intents',
      'manage:networks',
      'manage:contacts',
      'manage:opportunities',
    ]);
  });

  it('skips default system permissions when system agents are absent', async () => {
    const service = new AgentService(
      createStore({
        getAgent: async () => null,
        grantPermission: async (input) => {
          calls.grantPermission.push(input);
          return createPermissionRow();
        },
      }),
    );

    await service.grantDefaultSystemPermissions(OWNER_ID);

    expect(calls.grantPermission).toEqual([]);
  });

  it('delegates permission and authorized-agent lookups', async () => {
    const service = new AgentService(
      createStore({
        hasPermission: async (agentId, userId, action, scope) => {
          calls.hasPermission.push({ agentId, userId, action, scope });
          return true;
        },
        findAuthorizedAgents: async (userId, action, scope) => {
          calls.findAuthorizedAgents.push({ userId, action, scope });
          return [createAgentWithRelations()];
        },
      }),
    );

    const scope = { type: 'network' as const, id: 'network-1' };
    const hasPermission = await service.hasPermission('agent-1', OWNER_ID, 'manage:intents', scope);
    const agents = await service.findAuthorizedAgents(OWNER_ID, 'manage:intents', scope);

    expect(hasPermission).toBe(true);
    expect(agents).toHaveLength(1);
    expect(calls.hasPermission).toEqual([
      {
        agentId: 'agent-1',
        userId: OWNER_ID,
        action: 'manage:intents',
        scope,
      },
    ]);
    expect(calls.findAuthorizedAgents).toEqual([
      {
        userId: OWNER_ID,
        action: 'manage:intents',
        scope,
      },
    ]);
  });

  it('creates agent-linked tokens for owned personal agents', async () => {
    const service = new AgentService(
      createStore(),
      createTokenStore({
        create: async (_userId, params) => {
          calls.createToken.push(params);
          return {
            id: 'token-1',
            key: 'secret-key',
            name: params.name,
            createdAt: '2026-04-08T00:00:00.000Z',
          };
        },
      }),
    );

    const token = await service.createToken('agent-1', OWNER_ID, 'Custom Key');

    expect(token.key).toBe('secret-key');
    expect(calls.createToken).toEqual([{ name: 'Custom Key', agentId: 'agent-1' }]);
  });

  it('AgentController.createToken accepts requests without a JSON body', async () => {
    const controller = new AgentController();
    const originalCreateToken = agentService.createToken;
    const serviceCalls: Array<{ agentId: string; userId: string; name: string | undefined }> = [];

    agentService.createToken = async (agentId, userId, name) => {
      serviceCalls.push({ agentId, userId, name });
      return {
        id: 'token-1',
        key: 'secret-key',
        name: name ?? 'Agent API Key',
        createdAt: '2026-04-08T00:00:00.000Z',
      };
    };

    try {
      const response = await controller.createToken(
        new Request('http://localhost/agents/agent-1/tokens', { method: 'POST' }),
        { id: OWNER_ID } as never,
        { id: 'agent-1' },
      );

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        token: {
          id: 'token-1',
          key: 'secret-key',
          name: 'Agent API Key',
          createdAt: '2026-04-08T00:00:00.000Z',
        },
      });
      expect(serviceCalls).toEqual([{ agentId: 'agent-1', userId: OWNER_ID, name: undefined }]);
    } finally {
      agentService.createToken = originalCreateToken;
    }
  });

  it('rejects token creation for system agents', async () => {
    const service = new AgentService(
      createStore({ getAgent: async () => createAgentRow({ type: 'system' }) }),
      createTokenStore(),
    );

    await expect(service.createToken('agent-1', OWNER_ID)).rejects.toThrow(
      'System agents cannot be modified',
    );
  });

  it('revokeToken only revokes tokens bound to the agent', async () => {
    const service = new AgentService(
      createStore(),
      createTokenStore({
        list: async () => [{
          id: 'token-1',
          name: 'Agent API Key',
          start: 'abcd1234',
          createdAt: '2026-04-08T00:00:00.000Z',
          lastUsedAt: null,
          metadata: { agentId: 'agent-1' },
        }],
        revoke: async (_userId, tokenId) => {
          calls.revokeToken.push(tokenId);
        },
      }),
    );

    await service.revokeToken('agent-1', 'token-1', OWNER_ID);
    expect(calls.revokeToken).toEqual(['token-1']);
  });

  it('rejects revoking tokens bound to a different agent', async () => {
    const service = new AgentService(
      createStore(),
      createTokenStore({
        list: async () => [{
          id: 'token-1',
          name: 'Agent API Key',
          start: 'abcd1234',
          createdAt: '2026-04-08T00:00:00.000Z',
          lastUsedAt: null,
          metadata: { agentId: 'other-agent' },
        }],
      }),
    );

    await expect(service.revokeToken('agent-1', 'token-1', OWNER_ID)).rejects.toThrow(
      'Token not found',
    );
  });

  it('deletes an agent and revokes all of its linked tokens', async () => {
    const service = new AgentService(
      createStore(),
      createTokenStore({
        list: async () => [
          {
            id: 'token-1',
            name: 'Agent API Key',
            start: 'abcd1234',
            createdAt: '2026-04-08T00:00:00.000Z',
            lastUsedAt: null,
            metadata: { agentId: 'agent-1' },
          },
          {
            id: 'token-2',
            name: 'Other API Key',
            start: 'zzzz9999',
            createdAt: '2026-04-08T00:00:00.000Z',
            lastUsedAt: null,
            metadata: { agentId: 'other-agent' },
          },
        ],
        revoke: async (_userId, tokenId) => {
          calls.revokeToken.push(tokenId);
        },
      }),
    );

    await service.delete('agent-1', OWNER_ID);

    expect(calls.revokeToken).toEqual(['token-1']);
  });

  it('updates notifyOnOpportunity and dailySummaryEnabled on a personal agent', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const store = createStore({
      getAgentWithRelations: async () =>
        createAgentWithRelations({
          notifyOnOpportunity: true,
          dailySummaryEnabled: true,
          handleNegotiations: false,
        }),
      updateAgent: async (_agentId, patch) => {
        updates.push(patch);
        return createAgentRow({ ...patch });
      },
    });
    const service = new AgentService(store, createTokenStore());

    await service.update('agent-1', OWNER_ID, {
      notifyOnOpportunity: false,
      dailySummaryEnabled: false,
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      notifyOnOpportunity: false,
      dailySummaryEnabled: false,
    });
  });

  describe('handle_negotiations toggle', () => {
    it('upserts owner permission with manage:negotiations added when flipped on', async () => {
      const upserts: Array<{ agentId: string; userId: string; actions: string[] }> = [];
      const columnWrites: Array<Record<string, unknown>> = [];

      const store = createStore({
        getAgentWithRelations: async () =>
          createAgentWithRelations({
            handleNegotiations: false,
            permissions: [
              createPermissionRow({
                id: 'perm-owner',
                actions: ['manage:intents', 'manage:opportunities'],
              }),
            ],
          }),
        updateAgent: async (_agentId, patch) => {
          columnWrites.push(patch);
          return createAgentRow({ ...patch });
        },
        upsertGlobalPermission: async (input) => {
          upserts.push({ ...input, actions: [...input.actions] });
          return createPermissionRow({ actions: input.actions });
        },
      });
      const service = new AgentService(store, createTokenStore());

      await service.update('agent-1', OWNER_ID, { handleNegotiations: true });

      expect(columnWrites).toEqual([expect.objectContaining({ handleNegotiations: true })]);
      expect(upserts).toHaveLength(1);
      expect(upserts[0]!.actions).toEqual([
        'manage:intents',
        'manage:opportunities',
        'manage:negotiations',
      ]);
    });

    it('upserts owner permission with manage:negotiations removed when flipped off', async () => {
      const upserts: Array<{ agentId: string; userId: string; actions: string[] }> = [];

      const store = createStore({
        getAgentWithRelations: async () =>
          createAgentWithRelations({
            handleNegotiations: true,
            permissions: [
              createPermissionRow({
                id: 'perm-owner',
                actions: ['manage:intents', 'manage:negotiations'],
              }),
            ],
          }),
        upsertGlobalPermission: async (input) => {
          upserts.push({ ...input, actions: [...input.actions] });
          return createPermissionRow({ actions: input.actions });
        },
        updateAgent: async (_agentId, patch) => createAgentRow({ ...patch }),
      });
      const service = new AgentService(store, createTokenStore());

      await service.update('agent-1', OWNER_ID, { handleNegotiations: false });

      expect(upserts).toHaveLength(1);
      expect(upserts[0]!.actions).toEqual(['manage:intents']);
    });

    it('deletes the owner permission row when flipping off leaves no actions', async () => {
      const revocations: Array<{ agentId: string; userId: string }> = [];

      const store = createStore({
        getAgentWithRelations: async () =>
          createAgentWithRelations({
            handleNegotiations: true,
            permissions: [
              createPermissionRow({
                id: 'perm-owner',
                actions: ['manage:negotiations'],
              }),
            ],
          }),
        revokeGlobalPermission: async (agentId, userId) => {
          revocations.push({ agentId, userId });
        },
        updateAgent: async (_agentId, patch) => createAgentRow({ ...patch }),
      });
      const service = new AgentService(store, createTokenStore());

      await service.update('agent-1', OWNER_ID, { handleNegotiations: false });

      expect(revocations).toEqual([{ agentId: 'agent-1', userId: OWNER_ID }]);
    });
  });
});
