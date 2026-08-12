export interface NegotiationPollingPermissionRecord {
  userId: string;
  scope: 'global' | 'node' | 'network';
  actions: string[];
}

export interface NegotiationPollingAgentRecord {
  id: string;
  ownerId: string;
  type: 'personal' | 'external' | 'system';
  status: 'active' | 'inactive';
  handleNegotiations: boolean;
  permissions: NegotiationPollingPermissionRecord[];
}

/** Persistence boundary for negotiation polling admission. */
export interface NegotiationPollingAuthorizationStore {
  getAgentWithRelations(agentId: string): Promise<NegotiationPollingAgentRecord | null>;
}

/**
 * Authorizes the exact selected external executor for pickup/respond.
 * `runtimeKind` is deliberately ignored to preserve legacy external pollers.
 */
export class NegotiationPollingAuthorization {
  constructor(private readonly store: NegotiationPollingAuthorizationStore) {}

  async authorizePickup(agentId: string, ownerId: string): Promise<boolean> {
    return this.isAuthorized(agentId, ownerId);
  }

  async authorizeRespond(agentId: string, ownerId: string): Promise<boolean> {
    return this.isAuthorized(agentId, ownerId);
  }

  async isAuthorized(agentId: string, ownerId: string): Promise<boolean> {
    const agent = await this.store.getAgentWithRelations(agentId);
    if (
      !agent
      || agent.id !== agentId
      || agent.ownerId !== ownerId
      || agent.type !== 'external'
      || agent.status !== 'active'
      || !agent.handleNegotiations
    ) {
      return false;
    }

    return agent.permissions.some((permission) =>
      permission.userId === ownerId
      && permission.scope === 'global'
      && permission.actions.includes('manage:negotiations'));
  }
}
