import { describe, expect, it } from 'bun:test';

import type { AgentWithRelations } from '../src/adapters/agent.database.adapter';
import { authenticateApiKey } from '../src/guards/auth.guard';
import { AgentRuntimeTransactionHarness } from './support/agent-runtime-transaction.harness';
import { NegotiationPollingAuthorization } from '../src/lib/agent/negotiation-polling-authorization';
import { AgentRuntimeService, NEGOTIATION_EXECUTOR_FRESHNESS_MS, type AgentRuntimeStore } from '../src/services/agent-runtime.service';

const OWNER_ID = 'owner-1';
const OTHER_OWNER_ID = 'owner-2';
const INSTALLATION_ID = 'installation-1';
const OTHER_INSTALLATION_ID = 'installation-2';
const AGENT_ID = 'agent-1';

function agent(overrides: Partial<AgentWithRelations> = {}): AgentWithRelations {
  return {
    id: AGENT_ID,
    ownerId: OWNER_ID,
    name: 'Hermes Negotiator',
    description: 'Negotiation-only Hermes runtime',
    type: 'external',
    status: 'active',
    metadata: {},
    runtimeKind: 'hermes',
    installationId: INSTALLATION_ID,
    runtimeSetupAttemptId: 'setup-1',
    lastSeenAt: null,
    lastNegotiationPickupAt: null,
    notifyOnOpportunity: false,
    dailySummaryEnabled: false,
    handleNegotiations: false,
    lastDailySummaryAt: null,
    createdAt: new Date('2026-08-07T00:00:00.000Z'),
    updatedAt: new Date('2026-08-07T00:00:00.000Z'),
    transports: [],
    permissions: [],
    ...overrides,
  };
}

class RuntimeMemoryStore implements AgentRuntimeStore {
  readonly createdAgents: AgentWithRelations[] = [];
  private readonly agents = new Map<string, AgentWithRelations>();
  private credentials = new Map<string, { id: string; key: string; setupAttemptId: string }>();
  private selectedId: string | null = null;
  private sequence = 0;
  private lock = Promise.resolve();

  private serialize<T>(work: () => Promise<T> | T): Promise<T> {
    const result = this.lock.then(work, work);
    this.lock = result.then(() => undefined, () => undefined);
    return result;
  }

  seed(value: AgentWithRelations): void {
    this.agents.set(value.id, structuredClone(value));
    if (value.handleNegotiations) this.selectedId = value.id;
  }

  currentCredential(agentId: string) {
    return this.credentials.get(agentId) ?? null;
  }

  enabledNegotiators(ownerId: string): string[] {
    return [...this.agents.values()]
      .filter((item) => item.ownerId === ownerId && item.handleNegotiations)
      .map((item) => item.id);
  }

  globalActions(agentId: string): string[] {
    return this.agents.get(agentId)?.permissions.find((permission) => permission.scope === 'global')?.actions ?? [];
  }

  async prepareHermesInstallation(input: { ownerId: string; installationId: string; setupAttemptId: string }) {
    return this.serialize(async () => {
      let existing = [...this.agents.values()].find((item) =>
        item.ownerId === input.ownerId
        && item.runtimeKind === 'hermes'
        && item.installationId === input.installationId);
      if (!existing) {
        existing = agent({
          id: AGENT_ID,
          ownerId: input.ownerId,
          installationId: input.installationId,
          runtimeSetupAttemptId: input.setupAttemptId,
        });
        this.agents.set(existing.id, existing);
        this.createdAgents.push(structuredClone(existing));
      }
      existing.runtimeSetupAttemptId = input.setupAttemptId;
      existing.handleNegotiations = false;
      existing.permissions = [];
      const credential = {
        id: `credential-${++this.sequence}`,
        key: `secret-${this.sequence}`,
        setupAttemptId: input.setupAttemptId,
      };
      this.credentials.set(existing.id, credential);
      return {
        agent: structuredClone(existing),
        credential: { id: credential.id, key: credential.key, expiresAt: '2026-09-06T00:00:00.000Z' },
      };
    });
  }

  async setNegotiationExecutorBinding(input: {
    ownerId: string;
    targetAgentId: string | null;
    exactTargetPermissions: boolean;
    expectedSetupAttemptId?: string;
  }) {
    return this.serialize(async () => {
      const target = input.targetAgentId ? this.agents.get(input.targetAgentId) : null;
      if (input.targetAgentId && (!target || target.ownerId !== input.ownerId || target.type !== 'external')) {
        throw new Error('Negotiation executor not found');
      }
      if (target && input.exactTargetPermissions) {
        if (target.runtimeKind !== 'hermes' || target.runtimeSetupAttemptId !== input.expectedSetupAttemptId) {
          throw new Error('Hermes setup generation does not match');
        }
      }
      for (const item of this.agents.values()) {
        if (item.ownerId !== input.ownerId || item.type !== 'external') continue;
        item.handleNegotiations = item.id === target?.id;
        for (const permission of item.permissions) {
          permission.actions = permission.actions.filter((action) => action !== 'manage:negotiations');
        }
      }
      if (!target) {
        this.selectedId = null;
        return null;
      }
      target.status = 'active';
      if (input.exactTargetPermissions) {
        target.permissions = [{
          id: `permission-${target.id}`,
          agentId: target.id,
          userId: input.ownerId,
          scope: 'global',
          scopeId: null,
          actions: ['manage:negotiations'],
          createdAt: new Date(),
        }];
      } else {
        const permission = target.permissions.find((item) => item.scope === 'global' && item.userId === input.ownerId);
        if (permission && !permission.actions.includes('manage:negotiations')) permission.actions.push('manage:negotiations');
      }
      this.selectedId = target.id;
      return structuredClone(target);
    });
  }

  async rollbackHermesSetup(input: { ownerId: string; expectedSetupAttemptId: string }): Promise<boolean> {
    return this.serialize(async () => {
      const current = [...this.agents.values()].find((item) =>
        item.ownerId === input.ownerId
        && item.runtimeKind === 'hermes'
        && item.runtimeSetupAttemptId === input.expectedSetupAttemptId);
      if (!current) return false;
      current.handleNegotiations = false;
      current.status = 'inactive';
      current.permissions = [];
      current.runtimeSetupAttemptId = null;
      this.credentials.delete(current.id);
      if (this.selectedId === current.id) this.selectedId = null;
      return true;
    });
  }

  async getNegotiationExecutorBinding(ownerId: string) {
    const current = this.selectedId ? this.agents.get(this.selectedId) : null;
    return current?.ownerId === ownerId ? structuredClone(current) : null;
  }

  async getHermesInstallation(ownerId: string, installationId: string) {
    const current = [...this.agents.values()].find((item) =>
      item.ownerId === ownerId && item.runtimeKind === 'hermes' && item.installationId === installationId);
    return current ? structuredClone(current) : null;
  }

  async disconnectHermesInstallation(input: { ownerId: string; installationId: string }) {
    return this.serialize(async () => {
      const matches = [...this.agents.values()].filter((item) =>
        item.runtimeKind === 'hermes' && item.installationId === input.installationId);
      const current = matches.find((item) => item.ownerId === input.ownerId);
      if (!current) return matches.length > 0 ? 'owner_mismatch' as const : 'absent' as const;
      for (const item of this.agents.values()) {
        if (item.ownerId === input.ownerId && item.type === 'external') {
          item.handleNegotiations = false;
          for (const permission of item.permissions) {
            permission.actions = permission.actions.filter((action) => action !== 'manage:negotiations');
          }
        }
      }
      current.status = 'inactive';
      current.runtimeSetupAttemptId = null;
      this.credentials.delete(current.id);
      this.selectedId = null;
      return 'disconnected' as const;
    });
  }

  async touchNegotiationPickup(agentId: string): Promise<void> {
    const current = this.agents.get(agentId);
    if (current) current.lastNegotiationPickupAt = new Date();
  }
}

describe('AgentRuntimeService', () => {
  it('prepares idempotently with no authority, then selects Hermes and Index', async () => {
    const store = new RuntimeMemoryStore();
    const service = new AgentRuntimeService(store, () => new Date('2026-08-07T00:00:00.000Z'));

    expect((await service.prepareHermes(OWNER_ID, INSTALLATION_ID, 'setup-1')).executorId).toBe(AGENT_ID);
    await service.prepareHermes(OWNER_ID, INSTALLATION_ID, 'setup-2');
    expect(store.createdAgents).toHaveLength(1);
    expect(store.globalActions(AGENT_ID)).toEqual([]);

    expect((await service.setRuntime(OWNER_ID, {
      runtime: 'hermes', installationId: INSTALLATION_ID, executorId: AGENT_ID, setupAttemptId: 'setup-2',
    })).selectedRuntime).toBe('hermes');
    expect(store.enabledNegotiators(OWNER_ID)).toEqual([AGENT_ID]);
    expect(store.globalActions(AGENT_ID)).toEqual(['manage:negotiations']);

    expect((await service.setRuntime(OWNER_ID, { runtime: 'index' })).selectedRuntime).toBe('index');
    expect(store.enabledNegotiators(OWNER_ID)).toEqual([]);
  });

  it('exposes non-secret authoritative installation generation state for lost-response recovery', async () => {
    const store = new RuntimeMemoryStore();
    const service = new AgentRuntimeService(store);
    const prepared = await service.prepareHermes(OWNER_ID, INSTALLATION_ID, 'setup-proof');

    expect((await service.getRuntime(OWNER_ID, INSTALLATION_ID)).installation).toEqual({
      executorId: prepared.executorId,
      installationId: INSTALLATION_ID,
      setupAttemptId: 'setup-proof',
      status: 'active',
    });
    expect(await service.rollbackHermes(OWNER_ID, 'setup-proof')).toBe(true);
    expect((await service.getRuntime(OWNER_ID, INSTALLATION_ID)).installation).toEqual({
      executorId: prepared.executorId,
      installationId: INSTALLATION_ID,
      setupAttemptId: null,
      status: 'inactive',
    });
  });

  it('serializes concurrent prepares to one executor and one current generation credential', async () => {
    const store = new RuntimeMemoryStore();
    const service = new AgentRuntimeService(store);

    await Promise.all([
      service.prepareHermes(OWNER_ID, INSTALLATION_ID, 'setup-a'),
      service.prepareHermes(OWNER_ID, INSTALLATION_ID, 'setup-b'),
    ]);

    expect(store.createdAgents).toHaveLength(1);
    const current = await store.getHermesInstallation(OWNER_ID, INSTALLATION_ID);
    const credential = store.currentCredential(AGENT_ID);
    expect(credential?.setupAttemptId).toBe(current?.runtimeSetupAttemptId);
  });

  it('generation-fences stale activation and rollback', async () => {
    const store = new RuntimeMemoryStore();
    const service = new AgentRuntimeService(store);
    await service.prepareHermes(OWNER_ID, INSTALLATION_ID, 'new-generation');

    await expect(service.setRuntime(OWNER_ID, {
      runtime: 'hermes', installationId: INSTALLATION_ID, executorId: AGENT_ID, setupAttemptId: 'old-generation',
    })).rejects.toThrow('generation');
    expect(await service.rollbackHermes(OWNER_ID, 'old-generation')).toBe(false);
    expect(store.currentCredential(AGENT_ID)?.setupAttemptId).toBe('new-generation');
  });

  it('two concurrent activations leave exactly one selected executor', async () => {
    const store = new RuntimeMemoryStore();
    store.seed(agent({ id: 'agent-a', installationId: INSTALLATION_ID, runtimeSetupAttemptId: 'setup-a' }));
    store.seed(agent({ id: 'agent-b', installationId: OTHER_INSTALLATION_ID, runtimeSetupAttemptId: 'setup-b' }));
    const service = new AgentRuntimeService(store);

    await Promise.all([
      service.setRuntime(OWNER_ID, { runtime: 'hermes', installationId: INSTALLATION_ID, executorId: 'agent-a', setupAttemptId: 'setup-a' }),
      service.setRuntime(OWNER_ID, { runtime: 'hermes', installationId: OTHER_INSTALLATION_ID, executorId: 'agent-b', setupAttemptId: 'setup-b' }),
    ]);

    expect(store.enabledNegotiators(OWNER_ID)).toHaveLength(1);
  });

  it('rejects wrong-owner and wrong-installation activation', async () => {
    const store = new RuntimeMemoryStore();
    const service = new AgentRuntimeService(store);
    await service.prepareHermes(OWNER_ID, INSTALLATION_ID, 'setup-1');

    await expect(service.setRuntime(OTHER_OWNER_ID, {
      runtime: 'hermes', installationId: INSTALLATION_ID, executorId: AGENT_ID, setupAttemptId: 'setup-1',
    })).rejects.toThrow();
    await expect(service.setRuntime(OWNER_ID, {
      runtime: 'hermes', installationId: OTHER_INSTALLATION_ID, executorId: AGENT_ID, setupAttemptId: 'setup-1',
    })).rejects.toThrow('installation');
  });

  it('derives health from lastNegotiationPickupAt and server time, never lastSeenAt', async () => {
    const store = new RuntimeMemoryStore();
    store.seed(agent({
      handleNegotiations: true,
      lastSeenAt: new Date('2026-08-07T00:00:00.000Z'),
      lastNegotiationPickupAt: null,
      permissions: [{ id: 'permission-1', agentId: AGENT_ID, userId: OWNER_ID, scope: 'global', scopeId: null, actions: ['manage:negotiations'], createdAt: new Date() }],
    }));
    const service = new AgentRuntimeService(store, () => new Date('2026-08-07T00:10:00.000Z'));

    expect((await service.getRuntime(OWNER_ID, INSTALLATION_ID)).health).toBe('never-seen');
    store.seed(agent({ handleNegotiations: true, lastNegotiationPickupAt: new Date('2026-08-07T00:08:31.000Z') }));
    expect((await service.getRuntime(OWNER_ID, INSTALLATION_ID)).health).toBe('active');
    store.seed(agent({ handleNegotiations: true, lastNegotiationPickupAt: new Date('2026-08-07T00:08:29.999Z') }));
    expect((await service.getRuntime(OWNER_ID, INSTALLATION_ID)).health).toBe('stale');
    expect(NEGOTIATION_EXECUTOR_FRESHNESS_MS).toBe(90_000);
  });

  it('disconnects only the owned installation, selects Index, revokes its credential, and marks it inactive', async () => {
    const store = new RuntimeMemoryStore();
    const service = new AgentRuntimeService(store);
    await service.prepareHermes(OWNER_ID, INSTALLATION_ID, 'setup-1');
    await service.setRuntime(OWNER_ID, { runtime: 'hermes', installationId: INSTALLATION_ID, executorId: AGENT_ID, setupAttemptId: 'setup-1' });

    await expect(service.disconnectHermes(OTHER_OWNER_ID, INSTALLATION_ID)).rejects.toThrow('installation');
    const result = await service.disconnectHermes(OWNER_ID, INSTALLATION_ID);
    expect(result.selectedRuntime).toBe('index');
    expect(result.executor).toBeNull();
    expect(store.currentCredential(AGENT_ID)).toBeNull();
  });

  it('treats a proven globally absent installation as idempotent owner logout success', async () => {
    const store = new RuntimeMemoryStore();
    const service = new AgentRuntimeService(store);

    await expect(service.disconnectHermes(OWNER_ID, INSTALLATION_ID)).resolves.toEqual({
      selectedRuntime: 'index',
      executor: null,
      installation: null,
      health: 'never-seen',
      indexCovering: true,
      freshnessThresholdMs: NEGOTIATION_EXECUTOR_FRESHNESS_MS,
    });
  });

  it('keeps selected installation A authoritative while preparing installation B', async () => {
    const persistence = new AgentRuntimeTransactionHarness();
    persistence.seedUser({ id: OWNER_ID, email: 'owner@example.com', name: 'Owner' });
    const service = new AgentRuntimeService(persistence);
    const selectedA = await service.prepareHermes(OWNER_ID, INSTALLATION_ID, 'setup-a');
    await service.setRuntime(OWNER_ID, {
      runtime: 'hermes', installationId: INSTALLATION_ID, executorId: selectedA.executorId, setupAttemptId: 'setup-a',
    });

    const preparedB = await service.prepareHermes(OWNER_ID, OTHER_INSTALLATION_ID, 'setup-b');

    expect(preparedB.executorId).not.toBe(selectedA.executorId);
    expect(preparedB.binding).toMatchObject({
      selectedRuntime: 'hermes',
      executor: { id: selectedA.executorId, installationId: INSTALLATION_ID },
    });
  });

  it('represents an admitted selected legacy external executor without calling it Hermes', async () => {
    const persistence = new AgentRuntimeTransactionHarness();
    const legacyId = persistence.seedLegacyExecutor({ id: AGENT_ID, ownerId: OWNER_ID });
    const service = new AgentRuntimeService(persistence);

    expect(await service.getRuntime(OWNER_ID, INSTALLATION_ID)).toMatchObject({
      selectedRuntime: 'external',
      executor: { id: legacyId, installationId: null },
    });
  });

  it.each([
    ['inactive selection', false],
    ['selection with its last credential revoked', true],
  ])('fails safe to Index and clears stale authority for %s', async (_label, revokeCredential) => {
    const persistence = new AgentRuntimeTransactionHarness();
    const legacyId = persistence.seedLegacyExecutor({
      id: AGENT_ID,
      ownerId: OWNER_ID,
      status: revokeCredential ? 'active' : 'inactive',
    });
    if (revokeCredential) persistence.revokeCredentialsForAgent(legacyId);
    const service = new AgentRuntimeService(persistence);

    expect(await service.getRuntime(OWNER_ID, INSTALLATION_ID)).toEqual({
      selectedRuntime: 'index',
      executor: null,
      installation: null,
      health: 'never-seen',
      indexCovering: true,
      freshnessThresholdMs: NEGOTIATION_EXECUTOR_FRESHNESS_MS,
    });
    expect(persistence.snapshot().agents.find((item) => item.id === legacyId)?.handleNegotiations).toBe(false);
    expect(persistence.snapshot().permissions.some((permission) =>
      permission.agentId === legacyId && permission.actions.includes('manage:negotiations'))).toBe(false);
  });
});

describe('Agent runtime transactional persistence adapter contract', () => {
  for (const mutation of ['pickup claim', 'respond transition', 'consultation pause'] as const) {
    for (const race of ['deselect', 'disconnect', 'rotate'] as const) {
      it(`${mutation} revalidates after a deterministic ${race} barrier and cannot mutate`, async () => {
        const persistence = new AgentRuntimeTransactionHarness();
        persistence.seedUser({ id: OWNER_ID, email: 'owner@example.com', name: 'Owner' });
        const runtime = new AgentRuntimeService(persistence);
        const prepared = await runtime.prepareHermes(OWNER_ID, INSTALLATION_ID, 'setup-current');
        await runtime.setRuntime(OWNER_ID, {
          runtime: 'hermes',
          installationId: INSTALLATION_ID,
          executorId: prepared.executorId,
          setupAttemptId: 'setup-current',
        });
        const principal = {
          credentialId: prepared.credential.id,
          agentId: prepared.executorId,
          audience: 'hermes-negotiator',
          setupAttemptId: 'setup-current',
        };

        const result = await persistence.attemptNegotiationMutation(OWNER_ID, principal, async () => {
          if (race === 'deselect') {
            await runtime.setRuntime(OWNER_ID, { runtime: 'index' });
          } else if (race === 'disconnect') {
            await runtime.disconnectHermes(OWNER_ID, INSTALLATION_ID);
          } else {
            await runtime.prepareHermes(OWNER_ID, INSTALLATION_ID, 'setup-rotated');
          }
        });

        expect(result).toBe(false);
        expect(persistence.negotiationMutationCount()).toBe(0);
      });
    }
  }

  it('serializes concurrent prepare operations into one persisted generation and credential', async () => {
    const persistence = new AgentRuntimeTransactionHarness();
    persistence.seedUser({ id: OWNER_ID, email: 'owner@example.com', name: 'Owner' });
    const service = new AgentRuntimeService(persistence);

    const prepared = await Promise.all([
      service.prepareHermes(OWNER_ID, INSTALLATION_ID, 'setup-a'),
      service.prepareHermes(OWNER_ID, INSTALLATION_ID, 'setup-b'),
    ]);

    const snapshot = persistence.snapshot();
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.credentials).toHaveLength(1);
    expect(snapshot.permissions).toHaveLength(0);
    expect(snapshot.credentials[0]).toMatchObject({
      audience: 'hermes-negotiator',
      kind: 'agent-runtime',
    });
    expect(snapshot.credentials[0]?.expiresAt).toBeInstanceOf(Date);
    expect(snapshot.credentials[0]?.metadataExpiresAt).toBe(snapshot.credentials[0]?.expiresAt?.toISOString());
    expect(snapshot.agents[0]?.runtimeSetupAttemptId).toBe(snapshot.credentials[0]?.setupAttemptId);
    const current = prepared.find((result) => result.setupAttemptId === snapshot.agents[0]?.runtimeSetupAttemptId);
    expect(current).toBeDefined();
    await expect(authenticateApiKey(
      new Request('http://localhost/api/agents/me', { headers: { 'x-api-key': current!.credential.key } }),
      current!.credential.key,
      persistence,
    )).resolves.toMatchObject({ id: OWNER_ID });
  });

  it('rejects an expired prepared Hermes credential', async () => {
    const persistence = new AgentRuntimeTransactionHarness();
    persistence.seedUser({ id: OWNER_ID, email: 'owner@example.com', name: 'Owner' });
    const runtime = new AgentRuntimeService(persistence);
    const prepared = await runtime.prepareHermes(OWNER_ID, INSTALLATION_ID, 'setup-expiry');
    persistence.expireCredential(prepared.credential.id);

    await expect(authenticateApiKey(
      new Request('http://localhost/api/agents/me', { headers: { 'x-api-key': prepared.credential.key } }),
      prepared.credential.key,
      persistence,
    )).rejects.toThrow('Invalid API key');
  });

  it('serializes concurrent activation and persists one selected executor with exact authority', async () => {
    const persistence = new AgentRuntimeTransactionHarness();
    persistence.seedUser({ id: OWNER_ID, email: 'owner@example.com', name: 'Owner' });
    const service = new AgentRuntimeService(persistence);
    const [first, second] = await Promise.all([
      service.prepareHermes(OWNER_ID, INSTALLATION_ID, 'setup-a'),
      service.prepareHermes(OWNER_ID, OTHER_INSTALLATION_ID, 'setup-b'),
    ]);

    await Promise.all([
      service.setRuntime(OWNER_ID, {
        runtime: 'hermes', installationId: INSTALLATION_ID, executorId: first.executorId, setupAttemptId: 'setup-a',
      }),
      service.setRuntime(OWNER_ID, {
        runtime: 'hermes', installationId: OTHER_INSTALLATION_ID, executorId: second.executorId, setupAttemptId: 'setup-b',
      }),
    ]);

    const snapshot = persistence.snapshot();
    const selected = snapshot.agents.filter((item) => item.handleNegotiations);
    expect(selected).toHaveLength(1);
    expect(snapshot.permissions).toEqual([{
      agentId: selected[0]!.id,
      userId: OWNER_ID,
      scope: 'global',
      actions: ['manage:negotiations'],
    }]);
    expect(snapshot.credentials).toHaveLength(2);
  });

  it('stale activation and rollback preserve the newer selected generation and credential', async () => {
    const persistence = new AgentRuntimeTransactionHarness();
    persistence.seedUser({ id: OWNER_ID, email: 'owner@example.com', name: 'Owner' });
    const service = new AgentRuntimeService(persistence);
    const old = await service.prepareHermes(OWNER_ID, INSTALLATION_ID, 'setup-old');
    const [current, stalePrepareRollback] = await Promise.all([
      service.prepareHermes(OWNER_ID, INSTALLATION_ID, 'setup-current'),
      service.rollbackHermes(OWNER_ID, 'setup-old'),
    ]);
    expect(stalePrepareRollback).toBe(false);
    await service.setRuntime(OWNER_ID, {
      runtime: 'hermes', installationId: INSTALLATION_ID, executorId: current.executorId, setupAttemptId: 'setup-current',
    });

    const [staleActivation, staleSelectedRollback] = await Promise.allSettled([
      service.setRuntime(OWNER_ID, {
        runtime: 'hermes', installationId: INSTALLATION_ID, executorId: old.executorId, setupAttemptId: 'setup-old',
      }),
      service.rollbackHermes(OWNER_ID, 'setup-old'),
    ]);
    expect(staleActivation.status).toBe('rejected');
    expect(staleSelectedRollback).toEqual({ status: 'fulfilled', value: false });

    const snapshot = persistence.snapshot();
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.agents[0]).toMatchObject({
      runtimeSetupAttemptId: 'setup-current',
      handleNegotiations: true,
    });
    expect(snapshot.credentials).toHaveLength(1);
    expect(snapshot.credentials[0]).toMatchObject({
      agentId: current.executorId,
      setupAttemptId: 'setup-current',
    });
    await expect(authenticateApiKey(
      new Request('http://localhost/api/agents/me', { headers: { 'x-api-key': old.credential.key } }),
      old.credential.key,
      persistence,
    )).rejects.toThrow('Invalid API key');
    await expect(authenticateApiKey(
      new Request('http://localhost/api/agents/me', { headers: { 'x-api-key': current.credential.key } }),
      current.credential.key,
      persistence,
    )).resolves.toMatchObject({ id: OWNER_ID });
  });
});

describe('runtime binding persistence and polling authorization contracts', () => {
  it('migration deterministically repairs duplicate selections before the unique index', async () => {
    const migration = await Bun.file(new URL('../drizzle/0119_add_hermes_runtime_binding.sql', import.meta.url)).text();
    const repair = migration.indexOf('row_number() OVER');
    const selectedIndex = migration.indexOf('uniq_agents_selected_negotiation_executor');
    expect(repair).toBeGreaterThanOrEqual(0);
    expect(selectedIndex).toBeGreaterThan(repair);
    expect(migration).toContain('ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC');
    expect(migration).not.toContain('UPDATE "agents" SET "installation_id"');
  });

  it('authorizes a selected active legacy executor and rejects every persisted admission mismatch', async () => {
    const persistence = new AgentRuntimeTransactionHarness();
    persistence.seedUser({ id: OWNER_ID, email: 'owner@example.com', name: 'Owner' });
    persistence.seedLegacyExecutor({ id: AGENT_ID, ownerId: OWNER_ID });
    const authorization = new NegotiationPollingAuthorization(persistence);

    expect(await authorization.isAuthorized(AGENT_ID, OWNER_ID)).toBe(true);
    expect(persistence.snapshot().agents[0]?.runtimeKind).toBeNull();

    for (const overrides of [
      { handleNegotiations: false },
      { status: 'inactive' as const },
      { type: 'personal' as const },
      { actions: [] },
    ]) {
      const denied = new AgentRuntimeTransactionHarness();
      denied.seedUser({ id: OWNER_ID, email: 'owner@example.com', name: 'Owner' });
      denied.seedLegacyExecutor({ id: AGENT_ID, ownerId: OWNER_ID, ...overrides });
      expect(await new NegotiationPollingAuthorization(denied).isAuthorized(AGENT_ID, OWNER_ID)).toBe(false);
    }
  });
});
