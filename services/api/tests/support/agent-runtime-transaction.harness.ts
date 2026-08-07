import type { AgentPermissionRow, AgentRow, AgentWithRelations } from '../../src/adapters/agent.database.adapter';
import type { ApiKeyAuthenticationCredential, ApiKeyAuthenticationStore, AuthenticatedUser } from '../../src/guards/auth.guard';
import { API_KEY_START_LENGTH, generateApiKey, hashApiKey } from '../../src/lib/apikey/credential';
import type { NegotiationPollingAuthorizationStore } from '../../src/lib/agent/negotiation-polling-authorization';
import type { AgentRuntimeStore } from '../../src/services/agent-runtime.service';

interface PersistedCredential extends ApiKeyAuthenticationCredential {
  id: string;
  keyHash: string;
  start: string;
}

interface HarnessState {
  users: Map<string, AuthenticatedUser>;
  agents: Map<string, AgentRow>;
  permissions: Map<string, AgentPermissionRow>;
  credentials: Map<string, PersistedCredential>;
}

/**
 * Normalized, copy-on-write persistence harness for the runtime adapter contract.
 * Every mutation runs under one serialized transaction and commits atomically;
 * tests inspect persisted agent, permission, and hashed API-key rows.
 */
export class AgentRuntimeTransactionHarness implements
  AgentRuntimeStore,
  ApiKeyAuthenticationStore,
  NegotiationPollingAuthorizationStore {
  private state: HarnessState = {
    users: new Map(),
    agents: new Map(),
    permissions: new Map(),
    credentials: new Map(),
  };
  private lock: Promise<void> = Promise.resolve();
  private sequence = 0;

  seedUser(user: AuthenticatedUser): void {
    this.state.users.set(user.id, structuredClone(user));
  }

  seedLegacyExecutor(overrides: Partial<Pick<
    AgentRow,
    'id' | 'ownerId' | 'type' | 'status' | 'runtimeKind' | 'handleNegotiations'
  >> & { actions?: string[] } = {}): string {
    const id = overrides.id ?? `agent-${++this.sequence}`;
    const ownerId = overrides.ownerId ?? 'owner-1';
    const row = this.makeAgent({
      id,
      ownerId,
      type: overrides.type ?? 'external',
      status: overrides.status ?? 'active',
      runtimeKind: overrides.runtimeKind ?? null,
      handleNegotiations: overrides.handleNegotiations ?? true,
      installationId: null,
      runtimeSetupAttemptId: null,
    });
    this.state.agents.set(id, row);
    const actions = overrides.actions ?? ['manage:negotiations'];
    if (actions.length > 0) {
      const permission = this.makePermission(id, ownerId, actions);
      this.state.permissions.set(permission.id, permission);
    }
    this.state.credentials.set(`credential-${++this.sequence}`, {
      id: `credential-${this.sequence}`,
      keyHash: `seeded-hash-${this.sequence}`,
      start: 'seeded',
      referenceId: ownerId,
      userId: ownerId,
      enabled: true,
      expiresAt: null,
      metadata: JSON.stringify({ agentId: id }),
    });
    return id;
  }

  revokeCredentialsForAgent(agentId: string): void {
    this.deleteCredentialsForAgent(this.state, agentId);
  }

  snapshot(): {
    agents: AgentRow[];
    permissions: Array<{ agentId: string; userId: string; scope: 'global'; actions: string[] }>;
    credentials: Array<{ id: string; agentId: string | null; setupAttemptId: string | null; keyHash: string }>;
  } {
    return {
      agents: [...this.state.agents.values()].map((row) => structuredClone(row)),
      permissions: [...this.state.permissions.values()].map((row) => ({
        agentId: row.agentId,
        userId: row.userId,
        scope: 'global',
        actions: [...row.actions],
      })),
      credentials: [...this.state.credentials.values()].map((row) => {
        const metadata = this.parseMetadata(row.metadata);
        return {
          id: row.id,
          agentId: typeof metadata?.agentId === 'string' ? metadata.agentId : null,
          setupAttemptId: typeof metadata?.setupAttemptId === 'string' ? metadata.setupAttemptId : null,
          keyHash: row.keyHash,
        };
      }),
    };
  }

  async prepareHermesInstallation(input: {
    ownerId: string;
    installationId: string;
    setupAttemptId: string;
  }): Promise<{ agent: AgentWithRelations; credential: { id: string; key: string } }> {
    return this.transaction(async (draft) => {
      let row = [...draft.agents.values()].find((candidate) =>
        candidate.ownerId === input.ownerId
        && candidate.type === 'external'
        && candidate.runtimeKind === 'hermes'
        && candidate.installationId === input.installationId) ?? null;
      if (!row) {
        row = this.makeAgent({
          id: `agent-${++this.sequence}`,
          ownerId: input.ownerId,
          runtimeKind: 'hermes',
          installationId: input.installationId,
          runtimeSetupAttemptId: input.setupAttemptId,
          handleNegotiations: false,
        });
        draft.agents.set(row.id, row);
      } else {
        row.status = 'active';
        row.runtimeSetupAttemptId = input.setupAttemptId;
        row.handleNegotiations = false;
        row.updatedAt = new Date();
      }

      this.deletePermissionsForAgent(draft, row.id);
      this.deleteCredentialsForAgent(draft, row.id);

      const key = generateApiKey();
      const credential: PersistedCredential = {
        id: `credential-${++this.sequence}`,
        keyHash: await hashApiKey(key),
        start: key.substring(0, API_KEY_START_LENGTH),
        referenceId: input.ownerId,
        userId: input.ownerId,
        enabled: true,
        expiresAt: null,
        metadata: JSON.stringify({ agentId: row.id, setupAttemptId: input.setupAttemptId }),
      };
      draft.credentials.set(credential.id, credential);
      return {
        agent: this.withRelations(draft, row),
        credential: { id: credential.id, key },
      };
    });
  }

  async setNegotiationExecutorBinding(input: {
    ownerId: string;
    targetAgentId: string | null;
    exactTargetPermissions: boolean;
    expectedSetupAttemptId?: string;
  }): Promise<AgentWithRelations | null> {
    return this.transaction((draft) => {
      const target = input.targetAgentId ? draft.agents.get(input.targetAgentId) ?? null : null;
      if (input.targetAgentId && (
        !target
        || target.ownerId !== input.ownerId
        || target.type !== 'external'
        || target.status !== 'active'
      )) {
        throw new Error('Negotiation executor not found');
      }
      if (target && input.exactTargetPermissions && (
        target.runtimeKind !== 'hermes'
        || !input.expectedSetupAttemptId
        || target.runtimeSetupAttemptId !== input.expectedSetupAttemptId
      )) {
        throw new Error('Hermes setup generation does not match');
      }

      for (const agent of draft.agents.values()) {
        if (agent.ownerId !== input.ownerId || agent.type !== 'external') continue;
        agent.handleNegotiations = false;
        for (const permission of [...draft.permissions.values()]) {
          if (permission.agentId !== agent.id) continue;
          permission.actions = permission.actions.filter((action) => action !== 'manage:negotiations');
          if (permission.actions.length === 0) draft.permissions.delete(permission.id);
        }
      }
      if (!target) return null;

      if (input.exactTargetPermissions) this.deletePermissionsForAgent(draft, target.id);
      const permission = this.makePermission(target.id, input.ownerId, ['manage:negotiations']);
      draft.permissions.set(permission.id, permission);
      target.handleNegotiations = true;
      target.status = 'active';
      target.updatedAt = new Date();
      return this.withRelations(draft, target);
    });
  }

  async rollbackHermesSetup(input: {
    ownerId: string;
    expectedSetupAttemptId: string;
  }): Promise<boolean> {
    return this.transaction((draft) => {
      const target = [...draft.agents.values()].find((candidate) =>
        candidate.ownerId === input.ownerId
        && candidate.type === 'external'
        && candidate.runtimeKind === 'hermes'
        && candidate.runtimeSetupAttemptId === input.expectedSetupAttemptId) ?? null;
      if (!target) return false;

      target.handleNegotiations = false;
      target.status = 'inactive';
      target.runtimeSetupAttemptId = null;
      target.updatedAt = new Date();
      this.deletePermissionsForAgent(draft, target.id);
      for (const [id, credential] of draft.credentials) {
        const metadata = this.parseMetadata(credential.metadata);
        if (
          metadata?.agentId === target.id
          && metadata.setupAttemptId === input.expectedSetupAttemptId
        ) {
          draft.credentials.delete(id);
        }
      }
      return true;
    });
  }

  async getNegotiationExecutorBinding(ownerId: string): Promise<AgentWithRelations | null> {
    return this.transaction((draft) => {
      const row = [...draft.agents.values()].find((candidate) =>
        candidate.ownerId === ownerId
        && candidate.type === 'external'
        && candidate.handleNegotiations) ?? null;
      if (!row) return null;

      const hasPermission = [...draft.permissions.values()].some((permission) =>
        permission.agentId === row.id
        && permission.userId === ownerId
        && permission.scope === 'global'
        && permission.actions.includes('manage:negotiations'));
      const hasCredential = [...draft.credentials.values()].some((credential) => {
        const metadata = this.parseMetadata(credential.metadata);
        return credential.enabled
          && (!credential.expiresAt || credential.expiresAt.getTime() > Date.now())
          && metadata?.agentId === row.id
          && (row.runtimeKind !== 'hermes' || metadata.setupAttemptId === row.runtimeSetupAttemptId);
      });
      if (row.status === 'active' && hasPermission && hasCredential) {
        return this.withRelations(draft, row);
      }

      row.handleNegotiations = false;
      for (const permission of [...draft.permissions.values()]) {
        if (permission.agentId !== row.id) continue;
        permission.actions = permission.actions.filter((action) => action !== 'manage:negotiations');
        if (permission.actions.length === 0) draft.permissions.delete(permission.id);
      }
      return null;
    });
  }

  async getHermesInstallation(ownerId: string, installationId: string): Promise<AgentWithRelations | null> {
    const row = [...this.state.agents.values()].find((candidate) =>
      candidate.ownerId === ownerId
      && candidate.type === 'external'
      && candidate.runtimeKind === 'hermes'
      && candidate.installationId === installationId) ?? null;
    return row ? this.withRelations(this.state, row) : null;
  }

  async disconnectHermesInstallation(input: { ownerId: string; installationId: string }): Promise<boolean> {
    return this.transaction((draft) => {
      const target = [...draft.agents.values()].find((candidate) =>
        candidate.ownerId === input.ownerId
        && candidate.type === 'external'
        && candidate.runtimeKind === 'hermes'
        && candidate.installationId === input.installationId) ?? null;
      if (!target) return false;

      for (const agent of draft.agents.values()) {
        if (agent.ownerId !== input.ownerId || agent.type !== 'external') continue;
        agent.handleNegotiations = false;
        for (const permission of [...draft.permissions.values()]) {
          if (permission.agentId !== agent.id) continue;
          permission.actions = permission.actions.filter((action) => action !== 'manage:negotiations');
          if (permission.actions.length === 0) draft.permissions.delete(permission.id);
        }
      }
      target.status = 'inactive';
      target.runtimeSetupAttemptId = null;
      target.updatedAt = new Date();
      this.deleteCredentialsForAgent(draft, target.id);
      return true;
    });
  }

  async touchNegotiationPickup(agentId: string): Promise<void> {
    await this.transaction((draft) => {
      const row = draft.agents.get(agentId);
      if (row) row.lastNegotiationPickupAt = new Date();
    });
  }

  async getAgentWithRelations(agentId: string): Promise<AgentWithRelations | null> {
    const row = this.state.agents.get(agentId);
    return row ? this.withRelations(this.state, row) : null;
  }

  async findCredentialByHash(hash: string): Promise<ApiKeyAuthenticationCredential | null> {
    const row = [...this.state.credentials.values()].find((credential) => credential.keyHash === hash);
    if (!row) return null;
    return {
      referenceId: row.referenceId,
      userId: row.userId,
      enabled: row.enabled,
      expiresAt: row.expiresAt,
      metadata: row.metadata,
    };
  }

  async findUserById(userId: string): Promise<AuthenticatedUser | null> {
    const user = this.state.users.get(userId);
    return user ? structuredClone(user) : null;
  }

  private async transaction<T>(work: (draft: HarnessState) => Promise<T> | T): Promise<T> {
    const previous = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const draft = structuredClone(this.state);
    try {
      const result = await work(draft);
      this.state = draft;
      return result;
    } finally {
      release();
    }
  }

  private makeAgent(overrides: Partial<AgentRow> & Pick<AgentRow, 'id' | 'ownerId'>): AgentRow {
    const now = new Date();
    return {
      id: overrides.id,
      ownerId: overrides.ownerId,
      name: 'Hermes Negotiator',
      description: 'Negotiation-only Hermes runtime',
      type: overrides.type ?? 'external',
      status: overrides.status ?? 'active',
      metadata: {},
      runtimeKind: overrides.runtimeKind === undefined ? 'hermes' : overrides.runtimeKind,
      installationId: overrides.installationId ?? null,
      runtimeSetupAttemptId: overrides.runtimeSetupAttemptId ?? null,
      lastSeenAt: null,
      lastNegotiationPickupAt: null,
      notifyOnOpportunity: false,
      dailySummaryEnabled: false,
      handleNegotiations: overrides.handleNegotiations ?? false,
      lastDailySummaryAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private makePermission(agentId: string, userId: string, actions: string[]): AgentPermissionRow {
    return {
      id: `permission-${++this.sequence}`,
      agentId,
      userId,
      scope: 'global',
      scopeId: null,
      actions: [...actions],
      createdAt: new Date(),
    };
  }

  private withRelations(state: HarnessState, row: AgentRow): AgentWithRelations {
    return {
      ...structuredClone(row),
      transports: [],
      permissions: [...state.permissions.values()]
        .filter((permission) => permission.agentId === row.id)
        .map((permission) => structuredClone(permission)),
    };
  }

  private deletePermissionsForAgent(state: HarnessState, agentId: string): void {
    for (const [id, permission] of state.permissions) {
      if (permission.agentId === agentId) state.permissions.delete(id);
    }
  }

  private deleteCredentialsForAgent(state: HarnessState, agentId: string): void {
    for (const [id, credential] of state.credentials) {
      if (this.parseMetadata(credential.metadata)?.agentId === agentId) state.credentials.delete(id);
    }
  }

  private parseMetadata(metadata: string | null): Record<string, unknown> | null {
    if (!metadata) return null;
    try {
      return JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
