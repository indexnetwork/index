export interface Profile {
  id: string;
  name: string | null;
  intro: string | null;
  location: string | null;
  timezone: string | null;
  /** Unconfirmed profile data is not treated as fact in principal reasoning. */
  profileConfirmed: boolean;
}

export type IntentStatus = "ACTIVE" | "PAUSED" | "FULFILLED" | "EXPIRED" | "ARCHIVED";

/** The same authoritative intent record is used for individual reads and listing. */
export interface Intent {
  id: string;
  statement: string;
  status: IntentStatus;
}

export type NegotiationAction = "propose" | "counter" | "accept" | "decline";

/** One A2A turn, with authorship relative to the principal receiving the context. */
export interface NegotiationTurn {
  speaker: "our_agent" | "counterparty_agent";
  action: NegotiationAction;
  message: string;
}

/** Standing instruction that remains in force until replaced, not consumed after a turn. */
export type Decision = "continue" | "accept" | "decline" | "stop";

/** A potential connection and its negotiation context, including persisted instructions and stalls. */
export interface Opportunity {
  id: string;
  counterpart: string;
  status: string;
  awaiting?: string;
  /** Complete negotiation history, oldest first. */
  turns: NegotiationTurn[];
  turnCount: number;
  maxTurns: number;
  /** Total A2A turns left for both agents, derived from the host's limit and count. */
  remainingTurns: number;
  /** Authoritative actions currently permitted for this principal's seat. */
  actions?: NegotiationAction[];
  intent?: { statement: string };
  why?: string;
  brief?: string;
  decision?: Decision;
  stall?: Stall;
  /** Whether the principal has spoken to this opportunity since its last decision. */
  answered?: boolean;
}

/** A negotiation's missing fact or authority, not a host-read or scheduling failure. */
export interface Stall {
  reason: string;
  suggestedAsk?: string;
}
