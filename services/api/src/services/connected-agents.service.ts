import type { HermesCapability } from '../lib/agent/hermes-capabilities';
import { HERMES_INSTALLATION_NAME, type HermesActivationState } from '../lib/agent/hermes-credential';
import { NEGOTIATION_EXECUTOR_FRESHNESS_MS, isNegotiationExecutorFresh } from '../lib/agent/negotiation-executor';

export { HERMES_INSTALLATION_NAME, type HermesActivationState };

export type ConnectedAgentHealth = 'active' | 'stale' | 'never_seen' | 'expired' | 'revoked';

export type HermesConnectionRecord = {
  installationId: string;
  agentId: string;
  actions: readonly HermesCapability[];
  activationState: HermesActivationState;
  selected: boolean;
  lastHeartbeatAt: Date | null;
  expiresAt: Date;
};

export type ConnectedHermesAgentView = {
  installationId: string;
  installationName: typeof HERMES_INSTALLATION_NAME;
  agentId: string;
  actions: readonly HermesCapability[];
  activationState: HermesActivationState;
  selected: boolean;
  lastHeartbeatAt: string | null;
  expiresAt: string;
  health: ConnectedAgentHealth;
  indexCovering: boolean;
};

type OwnerMutationOutcome = 'paused' | 'revoked' | 'absent' | 'owner_mismatch';

export interface ConnectedAgentsStore {
  listHermesConnections(ownerId: string): Promise<HermesConnectionRecord[]>;
  pauseHermesConnection(input: {
    ownerId: string;
    installationId: string;
  }): Promise<Extract<OwnerMutationOutcome, 'paused' | 'absent' | 'owner_mismatch'>>;
  revokeHermesConnection(input: {
    ownerId: string;
    installationId: string;
  }): Promise<Extract<OwnerMutationOutcome, 'revoked' | 'absent' | 'owner_mismatch'>>;
}

export class ConnectedAgentNotFoundError extends Error {
  constructor() {
    super('connected_agent_not_found');
    this.name = 'ConnectedAgentNotFoundError';
  }
}

/** Session-owner orchestration for non-secret standalone Hermes controls. */
export class ConnectedAgentsService {
  constructor(
    private readonly store: ConnectedAgentsStore = lazyConnectedAgentsStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(ownerId: string): Promise<{ connections: ConnectedHermesAgentView[] }> {
    const records = await this.store.listHermesConnections(ownerId);
    return { connections: records.map((record) => this.toView(record)) };
  }

  async pause(ownerId: string, installationId: string): Promise<ConnectedHermesAgentView> {
    const outcome = await this.store.pauseHermesConnection({ ownerId, installationId });
    if (outcome !== 'paused') throw new ConnectedAgentNotFoundError();
    const records = await this.store.listHermesConnections(ownerId);
    const refreshed = records.find((record) => record.installationId === installationId);
    if (!refreshed) throw new ConnectedAgentNotFoundError();
    return this.toView(refreshed);
  }

  async revoke(ownerId: string, installationId: string): Promise<{ revoked: true }> {
    const outcome = await this.store.revokeHermesConnection({ ownerId, installationId });
    if (outcome !== 'revoked') throw new ConnectedAgentNotFoundError();
    return { revoked: true };
  }

  private toView(record: HermesConnectionRecord): ConnectedHermesAgentView {
    const now = this.now();
    const health: ConnectedAgentHealth = record.activationState === 'revoked'
      ? 'revoked'
      : record.expiresAt <= now
        ? 'expired'
        : record.lastHeartbeatAt === null
          ? 'never_seen'
          : isNegotiationExecutorFresh(record.lastHeartbeatAt, now.getTime())
            ? 'active'
            : 'stale';
    const selected = record.selected
      && record.activationState === 'active'
      && record.expiresAt > now;
    return {
      installationId: record.installationId,
      installationName: HERMES_INSTALLATION_NAME,
      agentId: record.agentId,
      actions: [...record.actions],
      activationState: record.activationState,
      selected,
      lastHeartbeatAt: record.lastHeartbeatAt?.toISOString() ?? null,
      expiresAt: record.expiresAt.toISOString(),
      health,
      indexCovering: !selected || health !== 'active',
    };
  }
}

const lazyConnectedAgentsStore: ConnectedAgentsStore = {
  async listHermesConnections(ownerId) {
    const { connectedAgentsDatabaseAdapter } = await import('../adapters/connected-agents.database.adapter');
    return connectedAgentsDatabaseAdapter.listHermesConnections(ownerId);
  },
  async pauseHermesConnection(input) {
    const { connectedAgentsDatabaseAdapter } = await import('../adapters/connected-agents.database.adapter');
    return connectedAgentsDatabaseAdapter.pauseHermesConnection(input);
  },
  async revokeHermesConnection(input) {
    const { connectedAgentsDatabaseAdapter } = await import('../adapters/connected-agents.database.adapter');
    return connectedAgentsDatabaseAdapter.revokeHermesConnection(input);
  },
};

export const connectedAgentsService = new ConnectedAgentsService();
export { NEGOTIATION_EXECUTOR_FRESHNESS_MS };
