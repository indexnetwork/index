import type { AgentWithRelations } from '../adapters/agent.database.adapter';
import { NEGOTIATION_EXECUTOR_FRESHNESS_MS, isNegotiationExecutorFresh } from '../lib/agent/negotiation-executor';
import { RuntimeConflictError, RuntimeNotFoundError } from '../lib/agent/runtime-errors';
import { HERMES_CANONICAL_ACTIONS } from '../lib/agent/hermes-capabilities';
import { hermesRuntimeTelemetry, type HermesRuntimeTelemetry } from '../lib/agent/hermes-runtime-telemetry';

export { NEGOTIATION_EXECUTOR_FRESHNESS_MS, isNegotiationExecutorFresh } from '../lib/agent/negotiation-executor';

export type NegotiationRuntimeView = {
  selectedRuntime: 'index' | 'hermes' | 'external';
  executor: null | {
    id: string;
    installationId: string | null;
    setupAttemptId: string | null;
    status: 'active' | 'inactive';
    lastNegotiationPickupAt: string | null;
  };
  /** Non-secret authoritative state for the installation named by the read. */
  installation: null | {
    executorId: string;
    installationId: string;
    setupAttemptId: string | null;
    status: 'active' | 'inactive';
  };
  health: 'active' | 'stale' | 'never-seen';
  indexCovering: boolean;
  freshnessThresholdMs: number;
};

export type PrepareHermesRuntimeResult = {
  binding: NegotiationRuntimeView;
  executorId: string;
  credential: { id: string; key: string; expiresAt: string };
  setupAttemptId: string;
};

export type DisconnectHermesInstallationResult = 'disconnected' | 'absent' | 'owner_mismatch';
export type CompareSelectIndexResult = 'selected' | 'already_index' | 'preserved';

export type RuntimeSelectionInput =
  | { runtime: 'index' }
  | {
      runtime: 'hermes';
      installationId: string;
      executorId: string;
      setupAttemptId: string;
    };

/** Adapter boundary required by the owner-facing runtime service. */
export interface AgentRuntimeStore {
  prepareHermesInstallation(input: {
    ownerId: string;
    installationId: string;
    setupAttemptId: string;
  }): Promise<{ agent: AgentWithRelations; credential: { id: string; key: string; expiresAt: string } }>;
  setNegotiationExecutorBinding(input: {
    ownerId: string;
    targetAgentId: string | null;
    exactTargetPermissions: boolean;
    expectedSetupAttemptId?: string;
  }): Promise<AgentWithRelations | null>;
  rollbackHermesSetup(input: {
    ownerId: string;
    expectedSetupAttemptId: string;
  }): Promise<boolean>;
  compareAndSelectIndex(input: {
    ownerId: string;
    expectedAgentId: string;
    expectedInstallationId: string;
    expectedSetupAttemptId: string;
  }): Promise<CompareSelectIndexResult>;
  getNegotiationExecutorBinding(ownerId: string): Promise<AgentWithRelations | null>;
  getHermesInstallation(ownerId: string, installationId: string): Promise<AgentWithRelations | null>;
  disconnectHermesInstallation(input: {
    ownerId: string;
    installationId: string;
  }): Promise<DisconnectHermesInstallationResult>;
  touchNegotiationPickup(agentId: string): Promise<void>;
}

/**
 * Owner-facing orchestration for preparing, selecting, observing, and removing
 * the external Hermes negotiation executor.
 */
export class AgentRuntimeService {
  constructor(
    private readonly store: AgentRuntimeStore = lazyAgentRuntimeStore,
    private readonly now: () => Date = () => new Date(),
    private readonly telemetry: HermesRuntimeTelemetry = hermesRuntimeTelemetry,
  ) {}

  /** Return the server-authoritative runtime selection and heartbeat health. */
  async getRuntime(ownerId: string, installationId: string): Promise<NegotiationRuntimeView> {
    const selected = await this.store.getNegotiationExecutorBinding(ownerId);
    const installation = await this.store.getHermesInstallation(ownerId, installationId);
    const view = this.toView(selected, installation);
    if (view.selectedRuntime === 'hermes' && view.health !== 'active') {
      const reason = view.health === 'stale' ? 'stale' : 'never_seen';
      this.telemetry.increment('runtime_stale', { reason });
      this.telemetry.increment('index_fallback', { reason });
    }
    return view;
  }

  /** Prepare or rotate one setup generation without granting polling authority. */
  async prepareHermes(
    ownerId: string,
    installationId: string,
    setupAttemptId: string,
  ): Promise<PrepareHermesRuntimeResult> {
    const prepared = await this.store.prepareHermesInstallation({
      ownerId,
      installationId,
      setupAttemptId,
    });
    const selected = await this.store.getNegotiationExecutorBinding(ownerId);
    this.telemetry.increment('credential_rotated');
    return {
      binding: this.toView(selected),
      executorId: prepared.agent.id,
      credential: prepared.credential,
      setupAttemptId,
    };
  }

  /** Select Index or activate the exact prepared Hermes setup generation. */
  async setRuntime(ownerId: string, input: RuntimeSelectionInput): Promise<NegotiationRuntimeView> {
    if (input.runtime === 'index') {
      await this.store.setNegotiationExecutorBinding({
        ownerId,
        targetAgentId: null,
        exactTargetPermissions: false,
      });
      return this.toView(null);
    }

    const installation = await this.store.getHermesInstallation(ownerId, input.installationId);
    if (!installation || installation.id !== input.executorId) {
      this.telemetry.increment('conflict', { reason: 'runtime_not_found' });
      throw new RuntimeNotFoundError();
    }
    if (installation.runtimeSetupAttemptId !== input.setupAttemptId) {
      this.telemetry.increment('conflict', { reason: 'runtime_conflict' });
      throw new RuntimeConflictError();
    }

    const selected = await this.store.setNegotiationExecutorBinding({
      ownerId,
      targetAgentId: input.executorId,
      exactTargetPermissions: true,
      expectedSetupAttemptId: input.setupAttemptId,
    });
    if (!selected) {
      this.telemetry.increment('conflict', { reason: 'runtime_conflict' });
      throw new RuntimeConflictError();
    }
    const globalPermission = selected.permissions.find((permission) =>
      permission.userId === ownerId && permission.scope === 'global');
    const actions = globalPermission?.actions ?? [];
    const negotiationOnly = actions.length === 1 && actions[0] === 'manage:negotiations';
    const fullStandalone = actions.length === HERMES_CANONICAL_ACTIONS.length
      && HERMES_CANONICAL_ACTIONS.every((action, index) => actions[index] === action);
    if (!negotiationOnly && !fullStandalone) {
      this.telemetry.increment('conflict', { reason: 'runtime_conflict' });
      throw new RuntimeConflictError();
    }
    return this.toView(selected);
  }

  /** Compare-and-clear a setup only if its generation is still current. */
  async rollbackHermes(ownerId: string, setupAttemptId: string): Promise<boolean> {
    const revoked = await this.store.rollbackHermesSetup({
      ownerId,
      expectedSetupAttemptId: setupAttemptId,
    });
    if (revoked) this.telemetry.increment('credential_revoked');
    return revoked;
  }

  /** Owner-locked compare-and-select-Index. It never revokes connector credentials. */
  async compareAndSelectIndex(
    ownerId: string,
    expected: { agentId: string; installationId: string; setupAttemptId: string },
  ): Promise<{ outcome: CompareSelectIndexResult; binding: NegotiationRuntimeView }> {
    const outcome = await this.store.compareAndSelectIndex({
      ownerId,
      expectedAgentId: expected.agentId,
      expectedInstallationId: expected.installationId,
      expectedSetupAttemptId: expected.setupAttemptId,
    });
    if (outcome === 'selected') this.telemetry.increment('index_fallback', { reason: 'stale' });
    return {
      outcome,
      binding: await this.getRuntime(ownerId, expected.installationId),
    };
  }

  /** Legacy owner removal. Connector-backed clients do not call this path. */
  async disconnectHermes(ownerId: string, installationId: string): Promise<NegotiationRuntimeView> {
    const outcome = await this.store.disconnectHermesInstallation({ ownerId, installationId });
    // Global absence is positive evidence that this owner has nothing to revoke,
    // so logout is idempotent. An installation owned by someone else remains a
    // non-enumerating 404 and is never treated as absence.
    if (outcome === 'owner_mismatch') {
      this.telemetry.increment('conflict', { reason: 'runtime_not_found' });
      throw new RuntimeNotFoundError();
    }
    if (outcome === 'disconnected') this.telemetry.increment('credential_revoked');
    return this.getRuntime(ownerId, installationId);
  }

  private toView(
    selected: AgentWithRelations | null,
    installation: AgentWithRelations | null = null,
  ): NegotiationRuntimeView {
    const lastPickup = selected?.lastNegotiationPickupAt ?? null;
    const health: NegotiationRuntimeView['health'] = lastPickup === null
      ? 'never-seen'
      : isNegotiationExecutorFresh(lastPickup, this.now().getTime())
        ? 'active'
        : 'stale';
    const selectedRuntime: NegotiationRuntimeView['selectedRuntime'] = !selected
      ? 'index'
      : selected.runtimeKind === 'hermes' && selected.installationId
        ? 'hermes'
        : 'external';

    return {
      selectedRuntime,
      executor: selected
        ? {
            id: selected.id,
            installationId: selected.installationId,
            setupAttemptId: selected.runtimeSetupAttemptId,
            status: selected.status,
            lastNegotiationPickupAt: lastPickup?.toISOString() ?? null,
          }
        : null,
      installation: installation?.installationId
        ? {
            executorId: installation.id,
            installationId: installation.installationId,
            setupAttemptId: installation.runtimeSetupAttemptId,
            status: installation.status,
          }
        : null,
      health,
      indexCovering: selectedRuntime === 'index' || health !== 'active',
      freshnessThresholdMs: NEGOTIATION_EXECUTOR_FRESHNESS_MS,
    };
  }
}

const lazyAgentRuntimeStore: AgentRuntimeStore = {
  async prepareHermesInstallation(input) {
    const { agentDatabaseAdapter } = await import('../adapters/agent.database.adapter');
    return agentDatabaseAdapter.prepareHermesInstallation(input);
  },
  async setNegotiationExecutorBinding(input) {
    const { agentDatabaseAdapter } = await import('../adapters/agent.database.adapter');
    return agentDatabaseAdapter.setNegotiationExecutorBinding(input);
  },
  async rollbackHermesSetup(input) {
    const { agentDatabaseAdapter } = await import('../adapters/agent.database.adapter');
    return agentDatabaseAdapter.rollbackHermesSetup(input);
  },
  async compareAndSelectIndex(input) {
    const { agentDatabaseAdapter } = await import('../adapters/agent.database.adapter');
    return agentDatabaseAdapter.compareAndSelectIndex(input);
  },
  async getNegotiationExecutorBinding(ownerId) {
    const { agentDatabaseAdapter } = await import('../adapters/agent.database.adapter');
    return agentDatabaseAdapter.getNegotiationExecutorBinding(ownerId);
  },
  async getHermesInstallation(ownerId, installationId) {
    const { agentDatabaseAdapter } = await import('../adapters/agent.database.adapter');
    return agentDatabaseAdapter.getHermesInstallation(ownerId, installationId);
  },
  async disconnectHermesInstallation(input) {
    const { agentDatabaseAdapter } = await import('../adapters/agent.database.adapter');
    return agentDatabaseAdapter.disconnectHermesInstallation(input);
  },
  async touchNegotiationPickup(agentId) {
    const { agentDatabaseAdapter } = await import('../adapters/agent.database.adapter');
    return agentDatabaseAdapter.touchNegotiationPickup(agentId);
  },
};

export const agentRuntimeService = new AgentRuntimeService();
