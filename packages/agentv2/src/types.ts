import type { Index } from "@indexnetwork/client";

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

export interface NegotiationTurn {
  turnIndex: number;
  actor: "you" | "counterpart";
  action: NegotiationAction;
  message: string;
  createdAt: string;
}

/** A one-shot instruction the next negotiator run must carry out. */
export type Decision = "continue" | "accept" | "decline" | "stop";

/**
 * One entry of the principal conversation. Briefs and decisions are entries
 * too: they are how a wake's work persists, and the principal can read them.
 */
export interface ConversationEntry {
  kind: "user" | "message" | "question" | "answer" | "brief" | "decision" | "stall" | "expire" | "progress";
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
  turnCount?: number;
  turns?: NegotiationTurn[];
  maxTurns?: number;
  remainingTurns?: number;
  /** What this seat may do right now. Constrains `submit_turn`. */
  actions?: NegotiationAction[];
  intent?: { statement: string };
  why?: string;
  brief?: string;
  decision?: Decision;
  /** Why the last negotiator run stopped without a turn. */
  stall?: Stall;
  /** Whether the principal has spoken to this opportunity since its last decision. */
  answered?: boolean;
}

/**
 * Everything a first brief sees: one opportunity and the conversation behind
 * it. No siblings, and no way to reach the principal — this run only writes
 * the standing state a negotiator needs to exist.
 */
export interface BriefInput {
  user: User;
  intent: Intent;
  principalConversation: ConversationEntry[];
  opportunity: Opportunity;
  model: Model;
  now?: () => Date;
  signal?: AbortSignal;
}

/** Everything a wake sees: one signal, its conversation, and all of its opportunities. */
export interface WakeInput {
  user: User;
  intent: Intent;
  principalConversation: ConversationEntry[];
  opportunities: Opportunity[];
  model: Model;
  /** Index for this owner, for the two operations the model triggers mid-loop. */
  client: Index;
  now?: () => Date;
  signal?: AbortSignal;
  /**
   * One opportunity's brief and decision, the moment they are decided. The
   * wake waits for it, so the host can persist and act on that opportunity
   * while the wake goes on thinking. A failure here is raised from `wake`
   * once the loop ends; the model is never told the host could not persist.
   */
  onBrief?: (actions: WakeAction[]) => void | Promise<void>;
  /**
   * The opportunities this wake just opened, as Index created them. They have
   * no brief yet and it is this seat's turn on every one, so nothing else will
   * ever move them: the host starts each one, which briefs it and takes the
   * first turn.
   */
  onOpened?: (opportunityIds: string[]) => void;
  /** Persist one user-facing boundary for each discovery tool call. */
  onProgress?: (text: string) => void | Promise<void>;
}

export type WakeAction =
  | { type: "brief"; opportunityId: string; brief: string }
  | { type: "decision"; opportunityId: string; decision: Decision }
  | { type: "ask"; scope: "intent" | "opportunity"; opportunityId?: string; question: string; options: string[] }
  | { type: "note"; text: string }
  | { type: "reply"; text: string }
  | { type: "progress"; text: string }
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
