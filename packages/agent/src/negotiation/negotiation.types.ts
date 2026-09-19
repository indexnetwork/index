export interface User {
  id: string;
  name: string | null;
}

export interface Intent {
  id: string;
  payload: string;
}

export type Action = 'propose' | 'counter' | 'accept' | 'decline';
export interface TurnInput {
  action: Action;
  message: string;
  expectedTurnCount: number;
  expectedContextVersion: string;
}

/** The shared negotiation as one principal sees it. */
export interface Negotiation {
  id: string;
  pairKey: string;
  networkId: string;
  sessionNumber: number;
  previousSessions: NegotiationHistory[];
  opportunityId: string;
  /** Authoritative opportunity decision, separate from the negotiation outcome. */
  opportunityStatus: 'negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired';
  intentId: string;
  awaitingUserId: string | null;
  outcome: string | null;
  settledAt: string | null;
  turnCount: number;
  protocol: { guidance: string; availableActions: Action[]; blockedReason: string | null; maxTurns: number; messageLimit: number };
  counterparty: { intentId: string; userId: string; name: string | null; statement: string; payload: string };
  turns: { turnIndex: number; seatUserId: string; action: Action; message: string }[];
}

/** Shared transcripts only; never an offer or authority in the current session. */
export type NegotiationHistory = Pick<Negotiation, 'id' | 'opportunityId' | 'sessionNumber' | 'outcome' | 'opportunityStatus' | 'turns'>;

export interface NegotiationClient {
  listNegotiations(): Promise<Negotiation[]>;
  readNegotiation(id: string): Promise<Negotiation>;
  submitTurn(id: string, turn: TurnInput): Promise<Negotiation>;
}

/** Host notifications for delegated A2A work only; none can wake the H2A agent. */
export type NegotiationEvent =
  | { kind: 'opportunity.matched'; opportunityId: string }
  | { kind: 'negotiation.updated'; opportunityId: string }
  /** Cancel local work without changing its saved brief or the principal's questions. */
  | { kind: 'negotiation.stopped'; opportunityId: string };
