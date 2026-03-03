/** Negotiation participant */
export interface NegotiationParticipant {
  userId: string;
  role: 'initiator' | 'responder';
  name?: string;
}

/** Negotiation trigger context */
export interface NegotiationTrigger {
  source: 'search' | 'subscription';
  intentId?: string;
  query?: string;
  indexId?: string;
}

/** Negotiation turn message */
export interface NegotiationMessage {
  context: string;
  upside?: string;
  invitation?: string;
}

/** Negotiation turn */
export interface NegotiationTurn {
  turn: number;
  participantUserId: string;
  participantName?: string;
  message: NegotiationMessage;
  decision: string;
  reasoning: string;
  extendReason?: string;
  timestamp: string;
}

/** Negotiation resolution */
export interface NegotiationResolution {
  reasoning: string;
  outcome: 'opportunity' | 'disengaged' | 'deferred';
  opportunityId?: string;
}

/** Negotiation list item */
export interface NegotiationListItem {
  id: string;
  status: 'initiated' | 'in_progress' | 'resolved' | 'expired';
  outcome: 'opportunity' | 'disengaged' | 'deferred' | null;
  participants: NegotiationParticipant[];
  trigger: NegotiationTrigger;
  currentTurn: number;
  maxTurns: number;
  opportunityId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Negotiation detail with turns */
export interface NegotiationDetail extends NegotiationListItem {
  turns: NegotiationTurn[];
  resolution: NegotiationResolution | null;
}

/** Negotiation statistics */
export interface NegotiationStats {
  total: number;
  inProgress: number;
  resolved: number;
  accepted: number;
  declined: number;
  deferred: number;
}

export const createNegotiationsService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  /** List negotiations for the current user */
  listNegotiations: async (options?: {
    limit?: number;
    offset?: number;
    status?: string | string[];
  }): Promise<NegotiationListItem[]> => {
    const response = await api.post<{ negotiations: NegotiationListItem[] }>('/negotiations/list', options ?? {});
    return response.negotiations ?? [];
  },

  /** Get a specific negotiation by ID */
  getNegotiation: async (negotiationId: string): Promise<NegotiationDetail> => {
    const response = await api.post<{ negotiation: NegotiationDetail }>('/negotiations/get', { negotiationId });
    if (!response.negotiation) {
      throw new Error('Negotiation not found');
    }
    return response.negotiation;
  },

  /** Get negotiation statistics for the current user */
  getStats: async (): Promise<NegotiationStats> => {
    const response = await api.get<{ stats: NegotiationStats }>('/negotiations/stats');
    return response.stats;
  },
});
