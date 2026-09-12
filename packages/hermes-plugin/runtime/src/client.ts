import type { Negotiation, NegotiationTurn, NegotiationUser } from '@indexnetwork/agent';

export interface NegotiationSummary {
  opportunityId: string;
  intentId: string;
  settledAt: string | null;
}

export interface Principal {
  owner: NegotiationUser;
  principalContext: string;
}

interface ApiUser {
  id: string;
  name: string | null;
  intro?: string | null;
  location?: string | null;
  onboarding?: { profileConfirmedAt?: string | null } | null;
}

interface ApiIntent {
  id: string;
  payload: string;
  status?: string | null;
  archivedAt?: string | null;
}

/**
 * The Index protocol over REST, as the owner's selected external negotiator.
 *
 * Turns carry `executorId` so the API fences them: a turn is refused unless
 * this agent is still the selected negotiator at the moment it is applied.
 */
export class IndexClient {
  constructor(
    private readonly origin: string,
    private readonly token: string,
    private readonly executorId: string,
  ) {}

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
      // Reported through the checks below, which include the raw body.
    }
    if (!response.ok || payload.success === false || typeof payload.error === 'string') {
      const reason = typeof payload.error === 'string' ? payload.error : text.slice(0, 500);
      throw new Error(`Index ${method} ${path} failed (${response.status}): ${reason}`);
    }
    return payload as T;
  }

  /** @param id - The match. @returns The negotiation as this owner's seat sees it. */
  async readNegotiation(id: string): Promise<Negotiation> {
    const { negotiation } = await this.request<{ negotiation: Negotiation }>(
      'GET', `/negotiations/${encodeURIComponent(id)}`,
    );
    return negotiation;
  }

  /**
   * @param id - The match. @param turn - The decision and the turn count it was made against.
   * @returns The negotiation after the turn.
   * @throws When the protocol refuses the turn or this agent is no longer selected.
   */
  async submitTurn(id: string, turn: NegotiationTurn): Promise<Negotiation> {
    const { negotiation } = await this.request<{ negotiation: Negotiation }>(
      'POST',
      `/negotiations/${encodeURIComponent(id)}/turns?executorId=${encodeURIComponent(this.executorId)}`,
      turn,
    );
    return negotiation;
  }

  /** @returns Every negotiation this owner has a seat in. */
  async listNegotiations(): Promise<NegotiationSummary[]> {
    const { negotiations } = await this.request<{ negotiations: NegotiationSummary[] }>('GET', '/negotiations');
    return negotiations;
  }

  /** @returns The protocol's canonical negotiation guidance, from the API being negotiated against. */
  async guidance(): Promise<string> {
    const { content } = await this.request<{ content: string }>('GET', '/docs?topic=negotiations');
    return content;
  }

  /** @returns The authenticated owner and the confirmed context the negotiator may state as fact. */
  async principal(): Promise<Principal> {
    const { user } = await this.request<{ user: ApiUser }>('GET', '/auth/me');
    const confirmedProfile = user.onboarding?.profileConfirmedAt
      ? { name: user.name, intro: user.intro, location: user.location }
      : null;
    return {
      owner: { id: user.id, name: user.name },
      principalContext: confirmedProfile
        ? JSON.stringify({ confirmedProfile })
        : 'No confirmed profile is available. Ask for missing personal facts.',
    };
  }

  /**
   * @param id - The signal.
   * @returns The signal's statement.
   * @throws When the signal is paused, archived, or not this owner's (the API 404s).
   */
  async intent(id: string): Promise<{ id: string; payload: string }> {
    const { intent } = await this.request<{ intent: ApiIntent }>('GET', `/intents/${encodeURIComponent(id)}`);
    if (intent.archivedAt || (intent.status ?? 'ACTIVE') !== 'ACTIVE') {
      throw new Error('This signal is inactive or belongs to another owner.');
    }
    return { id: intent.id, payload: intent.payload };
  }
}
