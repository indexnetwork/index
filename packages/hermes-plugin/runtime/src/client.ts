import type { AgentHost, ConversationMessage, Counterparty, CounterpartyPick, Intent, IntentStatus, Negotiation, NegotiationAction, NegotiationDetail, PrincipalMessage, Profile } from '@indexnetwork/agent';

interface ApiUser {
  id: string;
  name: string | null;
  intro: string | null;
  location: string | null;
  timezone: string | null;
  onboarding?: { profileConfirmedAt?: string | null } | null;
}

interface ApiIntent {
  id: string;
  payload: string;
  status?: string | null;
  archivedAt?: string | null;
}

/** Session-authenticated REST implementation of the agent package's authoritative host. */
export class IndexClient implements AgentHost {
  /**
   * @param origin - Index API origin without `/api`.
   * @param token - This device's Index session token.
   * @param executorId - Selected external agent ID used to fence writes.
   */
  constructor(
    private readonly origin: string,
    private readonly token: string,
    private readonly executorId: string,
  ) {}

  /** @returns The authenticated principal and the profile confirmation boundary. */
  async getProfile(): Promise<Profile> {
    const { user } = await this.request<{ user: ApiUser }>('GET', '/auth/me');
    return {
      id: user.id,
      name: user.name,
      intro: user.intro,
      location: user.location,
      timezone: user.timezone,
      profileConfirmed: Boolean(user.onboarding?.profileConfirmedAt),
    };
  }

  /** @param intentId - Owned intent ID. @returns Its current statement and lifecycle. */
  async getIntent(intentId: string): Promise<Intent> {
    const { intent } = await this.request<{ intent: ApiIntent }>(
      'GET', `/intents/${encodeURIComponent(intentId)}`,
    );
    return this.toIntent(intent);
  }

  /** @returns The principal's current intents. */
  async listIntents(): Promise<Intent[]> {
    const { intents } = await this.request<{ intents: ApiIntent[] }>('POST', '/intents/list', { limit: 100 });
    return intents.map((intent) => this.toIntent(intent));
  }

  /**
   * @param intentId - Intent to discover from.
   * @param query - Agent-authored counterparty query.
   * @param limit - Maximum results.
   * @returns Ranked counterparties.
   */
  async findCounterparties(intentId: string, query: string, limit: number): Promise<Counterparty[]> {
    const { counterparties } = await this.request<{ counterparties: Counterparty[] }>(
      'POST', `/intents/${encodeURIComponent(intentId)}/discover`, { query, limit },
    );
    return counterparties;
  }

  /**
   * @param intentId - Principal intent.
   * @param counterparties - Counterparty intents and shared network IDs.
   * @returns Authoritative opportunity IDs.
   */
  async createOpportunities(
    intentId: string,
    counterparties: CounterpartyPick[],
  ): Promise<{ opportunityId: string }[]> {
    const { opportunities } = await this.request<{ opportunities: { opportunityId: string }[] }>(
      'POST', `/intents/${encodeURIComponent(intentId)}/opportunities`, { counterparties },
    );
    return opportunities;
  }

  /** @param intentId - Intent-scoped principal conversation. @returns Raw persisted API messages. */
  async getConversation(intentId: string): Promise<{ conversationId: string; messages: ConversationMessage[] }> {
    return this.request<{ conversationId: string; messages: ConversationMessage[] }>(
      'GET', `/conversations/agent/messages?intentId=${encodeURIComponent(intentId)}`,
    );
  }

  /**
   * @param intentId - Intent-scoped principal conversation.
   * @param entries - Structured agent messages.
   * @returns After the executor-fenced write succeeds.
   */
  async appendMessages(intentId: string, entries: PrincipalMessage[]): Promise<void> {
    await this.request(
      'POST',
      `/conversations/agent/h2a?executorId=${encodeURIComponent(this.executorId)}`,
      { intentId, entries },
    );
  }

  /** @returns Complete open negotiation summaries for this principal. */
  async listNegotiations(): Promise<Negotiation[]> {
    const { negotiations } = await this.request<{ negotiations: Negotiation[] }>('GET', '/negotiations?state=open');
    return negotiations;
  }

  /** @param opportunityId - Opportunity whose negotiation is read. @returns Current detail and protocol. */
  async getNegotiation(opportunityId: string): Promise<NegotiationDetail> {
    const { negotiation } = await this.request<{ negotiation: NegotiationDetail }>(
      'GET', `/opportunities/${encodeURIComponent(opportunityId)}/negotiation`,
    );
    return negotiation;
  }

  /**
   * @param opportunityId - Opportunity whose negotiation advances.
   * @param turn - Agent decision made against the observed turn count.
   * @returns The authoritative post-write negotiation.
   */
  async submitTurn(
    opportunityId: string,
    turn: { action: NegotiationAction; message: string; expectedTurnCount: number },
  ): Promise<NegotiationDetail> {
    const { negotiation } = await this.request<{ negotiation: NegotiationDetail }>(
      'POST',
      `/opportunities/${encodeURIComponent(opportunityId)}/negotiation/turns?executorId=${encodeURIComponent(this.executorId)}`,
      turn,
    );
    return negotiation;
  }

  private toIntent(intent: ApiIntent): Intent {
    return {
      id: intent.id,
      statement: intent.payload,
      status: (intent.archivedAt ? 'ARCHIVED' : intent.status ?? 'ACTIVE') as IntentStatus,
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.origin}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The error below includes the raw response body.
    }
    if (!response.ok || payload.success === false || typeof payload.error === 'string') {
      const reason = typeof payload.error === 'string' ? payload.error : text.slice(0, 500);
      throw new Error(`Index ${method} ${path} failed (${response.status}): ${reason}`);
    }
    return payload as T;
  }
}
