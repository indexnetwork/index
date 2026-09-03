/**
 * Negotiations service — typed API client for the `/negotiations` endpoints.
 */

export type NegotiationTurnAction = 'propose' | 'counter' | 'accept' | 'decline';
export type NegotiationOutcome = 'agreed' | 'declined' | 'closed';

export interface NegotiationTurn {
  turnIndex: number;
  seatUserId: string;
  action: NegotiationTurnAction;
  message: string;
  createdAt: string;
}

/** One negotiation as the authenticated seat sees it. */
export interface NegotiationSummary {
  id: string;
  opportunityId: string;
  /** The viewer's own signal behind this negotiation. */
  intentId: string;
  /** The seat whose turn it is; null once settled. */
  awaitingUserId: string | null;
  outcome: NegotiationOutcome | null;
  settledAt: string | null;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
  counterparty: {
    userId: string;
    name: string | null;
    avatar: string | null;
    statement: string;
  };
}

export interface NegotiationDetail extends NegotiationSummary {
  turns: NegotiationTurn[];
}

export const createNegotiationService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  /** List the authenticated user's negotiations. */
  getNegotiations: async (opts?: { intentId?: string; state?: 'open' | 'settled' }): Promise<NegotiationSummary[]> => {
    const params = new URLSearchParams();
    if (opts?.intentId) params.set('intentId', opts.intentId);
    if (opts?.state) params.set('state', opts.state);
    const qs = params.toString();
    const response = await api.get<{ negotiations: NegotiationSummary[] }>(`/negotiations${qs ? `?${qs}` : ''}`);
    return response.negotiations;
  },

  /** Read one negotiation with its turn log. */
  getNegotiation: async (opportunityId: string): Promise<NegotiationDetail> => {
    const response = await api.get<{ negotiation: NegotiationDetail }>(`/negotiations/${opportunityId}`);
    return response.negotiation;
  },
});
