import type { Model } from "./model.ts";

export interface User {
  id: string;
  name: string | null;
  intro?: string | null;
  location?: string | null;
  timezone?: string | null;
  /** Whether the principal confirmed the profile above. Unconfirmed is seed data, not fact. */
  profileConfirmed?: boolean;
}

export interface Intent {
  id: string;
  statement: string;
}

export type NegotiationAction = "propose" | "counter" | "accept" | "decline";

/** A one-shot instruction the next negotiator run must carry out. */
export type Decision = "continue" | "accept" | "decline" | "stop";

/**
 * One entry of the principal conversation. Briefs and decisions are entries
 * too: they are how a wake's work persists, and the principal can read them.
 */
export interface ConversationEntry {
  kind: "user" | "message" | "question" | "answer" | "brief" | "decision" | "stall";
  text: string;
  scope?: "intent" | "opportunity";
  counterpart?: string;
  opportunity?: string;
  questionId?: string;
  options?: string[];
}

/** One opportunity as the host assembled it: Index's record plus the latest brief and decision. */
export interface Opportunity {
  id: string;
  counterpart: string;
  status: string;
  awaiting?: string;
  turns?: string;
  /** What this seat may do right now. Constrains `submit_turn`. */
  actions?: NegotiationAction[];
  intent?: { statement: string };
  why?: string;
  terms?: string;
  brief?: string;
  decision?: Decision;
  /** Why the last negotiator run stopped without a turn. */
  stall?: Stall;
}

/** Everything a wake sees: one signal, its conversation, and all of its opportunities. */
export interface WakeInput {
  user: User;
  intent: Intent;
  principalConversation: ConversationEntry[];
  opportunities: Opportunity[];
  model: Model;
  /**
   * One opportunity to work alone. No other opportunity is decided and the
   * principal is not addressed, however much either is owed.
   */
  focus?: string;
  now?: () => Date;
  signal?: AbortSignal;
  /**
   * One opportunity's brief and decision, the moment they are decided. The
   * wake waits for it, so the host can persist and act on that opportunity
   * while the others are still being decided.
   */
  onDecision?: (actions: WakeAction[]) => void | Promise<void>;
}

export type WakeAction =
  | { type: "brief"; opportunityId: string; brief: string }
  | { type: "decision"; opportunityId: string; decision: Decision }
  | { type: "ask"; scope: "intent" | "opportunity"; opportunityId?: string; question: string; options: string[] }
  | { type: "note"; text: string }
  | { type: "expire"; questionId: string };

export interface WakeResult {
  /** What the host should persist and run. Empty when staying silent was right. */
  actions: WakeAction[];
}

/** Everything a negotiator sees. No conversation, no other opportunities. */
export interface NegotiateInput {
  user: User;
  intent: Intent;
  brief: string;
  opportunity: Opportunity;
  model: Model;
  now?: () => Date;
  signal?: AbortSignal;
}

export interface Turn {
  action: NegotiationAction;
  message: string;
}

/** A negotiator's internal end state: it could not act on the brief alone. */
export interface Stall {
  reason: string;
  suggestedAsk?: string;
}

export type NegotiateResult = { turn: Turn } | { stall: Stall };
