import type { Index } from "@indexnetwork/client";

import type { Decide } from "./decide.ts";
import type { Model } from "./model.ts";

export interface User {
  id: string;
  name: string | null;
  intro?: string | null;
  location?: string | null;
  timezone?: string | null;
  /** Whether the principal confirmed the profile above. Unconfirmed is seed data, not fact. */
  profileConfirmed?: boolean;
  /** Whether the principal verified their email. */
  emailVerified?: boolean;
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
  kind: "user" | "message" | "reply" | "question" | "answer" | "brief" | "decision" | "stall" | "resolution" | "expire" | "progress";
  text: string;
  /** The agent DM row this entry was read from. */
  id?: string;
  /** On a stall, the negotiation's turn count when it stalled. */
  turnCount?: number;
  /** On a question or a resolution, the stall entries it is about. */
  stalls?: string[];
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
  /** Turns one round allows. */
  maxTurns?: number;
  /** Turns left in the round in progress. */
  remainingTurns?: number;
  /** In talks with nobody to move: a decline or a full round ended its last round. Only `resume_negotiation` moves it. */
  paused?: boolean;
  /** What this seat may do right now. Constrains `submit_turn`. */
  actions?: NegotiationAction[];
  intent?: { statement: string };
  /** The counterpart's public profile bio and where they are based. */
  bio?: string | null;
  location?: string | null;
  /** A third party who opened this pair, and their unverified case for it. */
  introducer?: { name: string | null; context: string };
  why?: string;
  brief?: string;
  decision?: Decision;
  /** The stall still standing on this negotiation: its negotiator is held until it is answered or resolved. */
  stall?: StandingStall;
  /** Whether the principal answered a question about this opportunity since its last decision. */
  answered?: boolean;
}

/**
 * A stall as an obligation: the missing fact stays owed until the question
 * that asks for it is answered and the opportunity re-decided, the wake
 * resolves it explicitly, the negotiation is declined or stopped, or a turn
 * or settlement moves the negotiation past it.
 */
export interface StandingStall extends Stall {
  /** The stall entry on the agent DM. */
  id: string;
  /** The negotiation's turn count when it stalled. */
  turnCount: number;
  /** The question that asks the principal for it, once one does. */
  questionId?: string;
  /** Whether the principal answered that question. The next decision discharges it. */
  answered?: boolean;
  /** Whether this stall repeats one the wake already resolved without asking, so it can only be asked now. */
  retried?: boolean;
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
  /** When set, screening asks it. Without it, everyone is reached. */
  decide?: Decide;
  now?: () => Date;
  signal?: AbortSignal;
}

/** Everything a wake sees: one intent, its conversation, and all of its opportunities. */
export interface WakeInput {
  user: User;
  intent: Intent;
  principalConversation: ConversationEntry[];
  opportunities: Opportunity[];
  model: Model;
  /** When set, discovery screens candidates with it. Without it, everyone is reached. */
  decide?: Decide;
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
  /** The reply to the principal's direct message, the moment it is written. A failure is raised from `wake` once the loop ends. */
  onReply?: (text: string) => void | Promise<void>;
  /** Messages the principal wrote since the last call, so a running wake reads them before its next step. */
  steer?: () => string[];
  /** Omitted for an event. Morning is the same wake, with one extra instruction. */
  reason?: "morning";
}

export type WakeAction =
  | { type: "brief"; opportunityId: string; brief: string }
  | { type: "decision"; opportunityId: string; decision: Decision }
  | { type: "ask"; scope: "intent" | "opportunity"; opportunityId?: string; question: string; options: string[]; stalls?: string[] }
  | { type: "resolve"; opportunityId: string; stallId: string; reason: string }
  | { type: "note"; text: string }
  | { type: "reply"; text: string }
  | { type: "progress"; text: string }
  | { type: "expire"; questionId: string };

export interface WakeResult {
  /** What the host should persist and run. Empty when staying silent was right. */
  actions: WakeAction[];
  /** Stalled opportunities this wake left neither asked about, resolved, nor re-decided after their answer. */
  unresolved: string[];
}

/** How the negotiator's recorded choice relates to the assessment's preferred action. */
export interface AssessmentSelection {
  selectedActionId: string | null;
  divergence: "none" | "clarification" | "constraint" | "unmapped" | "tie" | "uncertainty";
  reason: string | null;
}

/**
 * Private per-turn decision support. When present, the negotiator reads the
 * text as evidence, must account for the preferred action in its turn, and the
 * host receives the selection it recorded. Absent, nothing changes.
 */
export interface AssessmentGuidance {
  /** Private context block, passed to the model verbatim. Never shown to the counterpart. */
  text: string;
  /** The assessed menu of scientific action ids. */
  orderedActionIds: string[];
  /** The action the selection policy prefers; null means an exact top tie, which holds the turn. */
  preferredActionId: string | null;
  onSelection?: (selection: AssessmentSelection) => void;
}

/** Everything a negotiator sees. No conversation, no other opportunities. */
export interface NegotiateInput {
  user: User;
  intent: Intent;
  brief: string;
  opportunity: Opportunity;
  /** Profiles the principal linked from their networks, read by the host. */
  evidence?: string;
  /** The principal's other private intents. Weighed, never revealed. */
  privateContext?: string[];
  /** Private per-turn decision support; absent for every ordinary run. */
  assessment?: AssessmentGuidance;
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

/** One host negotiator run: a turn, a stall, or held by a stall still standing. */
export type NegotiateRun = NegotiateResult | { held: string };
