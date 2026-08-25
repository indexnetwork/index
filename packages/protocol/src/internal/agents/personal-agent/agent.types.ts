/**
 * PersonalAgent vocabulary: one persona, three scopes
 * (docs/plans/2026-08-23-personal-agent-and-negotiation-graphs.md).
 *
 * The graph routes on the SHAPE of its input, exactly as IntentGraph and
 * NegotiationGraph do — there is no scope flag and no operation mode:
 *
 * | Input                                          | Scope       |
 * |------------------------------------------------|-------------|
 * | `{ userId }`                                   | global      |
 * | `{ userId, intentId, event: 'user_message' }`  | IS-A (DM)   |
 * | `{ userId, intentId, event: 'matches_ready' }` | IS-A (kick) |
 * | `{ userId, intentId, event: 'all_paused' }`    | IS-A (reflect) |
 * | `{ userId, intentId, negotiationId }`          | negotiator  |
 *
 * Global is deferred: it is a graph-level input error until there is a
 * surface for it.
 *
 * The ports below are what a host must implement. The package knows nothing
 * of Drizzle, BullMQ or Redis: the signal DM, the dossier, the act ledger,
 * the reply transport and the owner's accept path are all host concerns.
 */
import type { NegotiationAuthoredTurn } from "../../negotiations/negotiation.turn.js";
import type { NegotiationGraphLike } from "../../negotiations/negotiation.graph.js";
import type { NegotiationGraphDatabase, NegotiationTaskRow } from "../../../platform/database/negotiation.js";
import type { IntentRecord } from "../../../platform/database/entities.js";
import type { NegotiationRoundReflectEnqueueFn } from "../../negotiations/negotiation.round-reflect.js";
import type { Question } from "../../../protocol/question.js";

// ─── Invoke contract ─────────────────────────────────────────────────────────

/** What woke the agent in intent scope. */
export type PersonalAgentIntentEventKind = "user_message" | "matches_ready" | "all_paused";

export type PersonalAgentInput =
  /** Global scope — deferred; the graph answers with an input error. */
  | { userId: string }
  /** The principal wrote in the signal's DM. */
  | {
    userId: string;
    intentId: string;
    event: "user_message";
    /** The DM session the message landed in. */
    sessionId: string;
    /** Persisted id of the principal's message; keys the reply stream. */
    messageId: string;
    text: string;
  }
  /** Discovery persisted a batch of matches for this signal. */
  | { userId: string; intentId: string; event: "matches_ready" }
  /** Every negotiation of `(intentId, round)` has paused. */
  | { userId: string; intentId: string; event: "all_paused"; round: number }
  /** One negotiator turn for the given seat and its own signal. */
  | { userId: string; intentId: string; negotiationId: string };

export type PersonalAgentScope = "global" | "intent" | "negotiation";

export interface PersonalAgentResult {
  scope: PersonalAgentScope;
  /** What the turn actually did, in execution order. Empty in negotiation scope. */
  acts: PersonalAgentExecutedAct[];
  /** Every text delivered into the DM by this turn, in delivery order. */
  messages: string[];
  /** Negotiation scope only: the one verb this seat plays. */
  turn?: NegotiationAuthoredTurn;
  error?: string;
}

// ─── Decided acts (model output, positions already resolved to ids) ──────────

/**
 * One model choice is one tool call. `message_user` is the natural terminal
 * response; any asks travel as canonical structured questions beside its prose.
 */
export type PersonalAgentDecidedAct =
  | { tool: "message_user"; text: string; questions?: Question[] }
  /** Open (or re-open) every undecided match of this signal with fresh briefs. */
  | { tool: "kickoff"; reasoning: string }
  /** Terminal writes IS-A owns: opportunity → `pending` / `rejected`. */
  | { tool: "promote"; negotiationId: string; reasoning: string }
  | { tool: "reject"; negotiationId: string; reasoning: string }
  | { tool: "note_dossier"; text: string }
  | { tool: "retire_dossier"; entryId: string }
  /** The principal's own verdict, on their explicit word only. */
  | { tool: "accept_opportunity"; opportunityId: string; reason?: string };

// ─── Executed acts (decision + durable effects) ──────────────────────────────

export type PersonalAgentExecutedAct =
  | {
    tool: "message_user";
    text: string;
    questions?: Question[];
    sessionId: string;
    messageId: string;
  }
  | {
    tool: "kickoff";
    round: number;
    /** How many negotiation tasks the round settled with; preserves the round-size semantics. */
    opened: number;
    /** How many matches this kickoff tried to open or resume. */
    attempted: number;
    /** How many of those attempts failed before or during negotiation opening. */
    failed: number;
    reasoning: string;
  }
  | {
    tool: "promote" | "reject";
    negotiationId: string;
    opportunityId: string;
    reasoning: string;
    outcome: "resolved" | "error";
  }
  | { tool: "note_dossier"; text: string; entryId: string }
  | { tool: "retire_dossier"; entryId: string; retired: boolean }
  | {
    tool: "accept_opportunity";
    opportunityId: string;
    outcome: string;
    counterparty?: string;
    reason?: string;
  };

/**
 * Feedback from the turn runner about a tool choice it refused before any
 * write. This helps the next choice recover without pretending that the call
 * executed or recording it in the act ledger.
 */
export type PersonalAgentNonDurableObservation =
  | {
    kind: "irreversible_tool_refused";
    tool: "kickoff";
    reason: string;
  }
  | {
    kind: "irreversible_tool_refused";
    tool: "promote" | "reject";
    negotiationId: string;
    reason: string;
  }
  | {
    kind: "irreversible_tool_refused";
    tool: "accept_opportunity";
    opportunityId: string;
    reason: string;
  };

// ─── Host ports ──────────────────────────────────────────────────────────────

/** One dossier fact: what IS-A may use at the negotiation table. */
export interface PersonalAgentDossierEntry {
  id: string;
  text: string;
  source: string;
  createdAt: Date;
}

export interface PersonalAgentDossierPort {
  readActiveEntries(userId: string, intentId: string): Promise<PersonalAgentDossierEntry[]>;
  addEntry(input: {
    userId: string;
    intentId: string;
    text: string;
    source: "user_message" | "answer" | "agent_note";
  }): Promise<string>;
  retireEntry(input: { userId: string; entryId: string }): Promise<boolean>;
}

/** The agent's own append-only conduct record. */
export interface PersonalAgentLedgerPort {
  append(input: {
    userId: string;
    intentId: string;
    event: Record<string, unknown>;
    act: Record<string, unknown>;
  }): Promise<string>;
  readRecent(userId: string, intentId: string, limit: number): Promise<Array<{ createdAt: Date; act: Record<string, unknown> }>>;
}

/**
 * The signal's DM — the agent's memory and its only channel to the
 * principal. `resolveSession` creates it if it does not exist yet (the agent
 * may need to speak before the principal ever opened the signal); `findSession`
 * never creates.
 */
export interface PersonalAgentConversationPort {
  findSession(userId: string, intentId: string): Promise<{ id: string } | null>;
  resolveSession(userId: string, intentId: string): Promise<
    { session: { id: string } } | { error: string; status: number }
  >;
  getMessages(sessionId: string): Promise<Array<{ role: string; content: string }>>;
  addMessage(input: {
    sessionId: string;
    role: "user" | "assistant" | "system";
    content: string;
    questions?: Question[];
  }): Promise<string>;
}

/** Token transport for completed conversational messages. */
export interface PersonalAgentReplyStreamPort {
  publish(messageId: string, chunk: { seq: number; content: string }): Promise<void>;
}

/** A bounded, user-facing description of an intent turn's visible progress. */
export interface PersonalAgentActivity {
  phase: "reviewing" | "working" | "preparing_response";
  label: string;
}

/** Live activity transport. `messageId` is the channel key, never event data. */
export interface PersonalAgentActivityPort {
  publish(messageId: string, activity: PersonalAgentActivity): Promise<void>;
}

/** One of this signal's matches, as the prompt numbers it. */
export interface PersonalAgentMatch {
  opportunityId: string;
  /** One line the model may read and repeat: counterparty + state. */
  label: string;
  status: string;
  /**
   * An introduction whose introducer has not approved it yet. Nothing may be
   * opened on it and the principal is not offered it — the introduction is
   * not theirs to act on until it is vouched for.
   */
  awaitingIntroducerApproval?: boolean;
}

/**
 * The opportunity surface IS-A touches. `accept` is the principal's own
 * verdict executing through the host's untouched owner path — IS-A never
 * accepts on its own initiative, and `promote`/`reject` do NOT come through
 * here: they are negotiation verdicts and go through NegotiationGraph.
 */
export interface PersonalAgentOpportunityPort {
  readMatches(userId: string, intentId: string): Promise<PersonalAgentMatch[]>;
  accept(
    userId: string,
    input: { intentId: string; opportunityId: string; reason?: string },
  ): Promise<{ status: string; counterparty?: string }>;
}

/** The name on the user's `type='personal'` agent row. */
export interface PersonalAgentIdentityPort {
  readAgentName(userId: string): Promise<string | null>;
}

// ─── Deps ────────────────────────────────────────────────────────────────────

export interface PersonalAgentDeps {
  /** Every negotiation effect — kickoff, resume, verdict — goes through here. */
  negotiations: NegotiationGraphLike;
  /** Reads negotiation state IS-A reasons over: round tasks, threads, briefs. */
  negotiationDatabase: NegotiationGraphDatabase;
  conversation: PersonalAgentConversationPort;
  dossier: PersonalAgentDossierPort;
  ledger: PersonalAgentLedgerPort;
  opportunities: PersonalAgentOpportunityPort;
  identity: PersonalAgentIdentityPort;
  replyStream?: PersonalAgentReplyStreamPort;
  activity?: PersonalAgentActivityPort;
  /**
   * The all-paused → reflect trigger. Kickoff runs one final check after
   * stamping the round size, to cover pauses that landed before the stamp.
   */
  reflectEnqueue?: NegotiationRoundReflectEnqueueFn;
  /**
   * Wakes this signal again with `matches_ready`. Kickoff calls it when a
   * discovery batch landed after the turn had already read its match list —
   * the authoritative recovery for a hand-off the inbox could not coalesce.
   */
  wakeForMatches?: (input: { userId: string; intentId: string }) => Promise<void>;
  /** Model seam. Production resolves the real judgment; tests script it. */
  judgment?: PersonalAgentJudgment;
}

// ─── Judgment seam ───────────────────────────────────────────────────────────

/**
 * Everything the agent asks a model for. One interface so a host, a test or
 * an eval can drive the whole cycle without a provider.
 */
export interface PersonalAgentJudgment {
  /** One intent-scope choice. Durable results and refused calls inform the next choice. */
  next(
    context: PersonalAgentTurnContext,
    executed: PersonalAgentExecutedAct[],
    nonDurable?: PersonalAgentNonDurableObservation[],
  ): Promise<PersonalAgentDecidedAct>;
  /** The plan for a round, written into the DM before any negotiation opens. */
  strategy(context: PersonalAgentTurnContext): Promise<string>;
  /** One negotiation's brief. Called once per match, in parallel. */
  brief(context: PersonalAgentTurnContext, input: PersonalAgentBriefInput): Promise<string>;
  /**
   * A brief for a seat that arrived at a table without one — the
   * counterparty, whose own agent writes it at its first turn rather than
   * inheriting the initiator's.
   */
  seatBrief(input: PersonalAgentSeatBriefInput): Promise<string>;
  /** One negotiator turn: own intent, task context, brief + thread → exactly one verb. */
  negotiationTurn(input: PersonalAgentNegotiationTurnInput): Promise<NegotiationAuthoredTurn>;
}

export interface PersonalAgentBriefInput {
  match: PersonalAgentMatch;
  strategy: string;
  /** This negotiation's turns so far — empty at first kickoff. */
  thread: PersonalAgentThreadEntry[];
}

export interface PersonalAgentSeatBriefInput {
  /** The resolved intent owned by this seat; never the counterparty's. */
  intent: IntentRecord;
  /** The negotiation this brief prepares the seat for. */
  negotiation: NegotiationTaskRow;
  /** What has been said at this table so far. */
  thread: PersonalAgentThreadEntry[];
}

export interface PersonalAgentThreadEntry {
  speaker: "own" | "counterparty";
  turn: import("../../negotiations/negotiation.turn.js").NegotiationTurn;
}

export interface PersonalAgentNegotiationTurnInput {
  /** The resolved intent owned by the current seat; never the counterparty's. */
  intent: IntentRecord;
  /** The current negotiation task context, containing no other seat's brief. */
  negotiation: NegotiationTaskRow;
  /** This side's compact, derived negotiating stance. */
  brief: string;
  thread: PersonalAgentThreadEntry[];
  /** True on the negotiation's very first turn — must answer `outreach`. */
  isOpening: boolean;
}

// ─── Turn context ────────────────────────────────────────────────────────────

/** One paused negotiation of the current round, as reflect reads it. */
export interface PersonalAgentPausedNegotiation {
  negotiationId: string;
  opportunityId: string;
  reason: string;
  /** Private to this side: the question or the recommendation behind the pause. */
  payload?: unknown;
  /** Whether the pause came from our own seat or the counterparty's. */
  pausedByUs: boolean;
  /** This negotiation's turns, oldest first. */
  thread: PersonalAgentThreadEntry[];
}

/**
 * Assembled fresh every turn, all from honest reads. Nothing here is cached
 * or carried between turns: the DM is the memory, the dossier is the
 * disclosure boundary, the paused set is the open state.
 */
export interface PersonalAgentTurnContext {
  userId: string;
  intentId: string;
  event: PersonalAgentIntentEventKind;
  /** Present only for `user_message`. */
  message?: { text: string; sessionId: string; messageId: string };
  /** Present only for `all_paused`. */
  round?: number;
  agentName?: string;
  signalText: string | null;
  /** Everything undecided on this signal — what the principal may act on. */
  matches: PersonalAgentMatch[];
  /**
   * The subset of `matches` a kickoff would actually open, computed once with
   * the context. The prompt renders it and `runKickoff` opens exactly it: a
   * second, separately-filtered read meant the agent was shown one set and
   * opened another.
   */
  kickoffTargets: PersonalAgentMatch[];
  /**
   * Every undecided match as this turn read it, ids only — including the ones
   * the display cap held back. The end-of-turn re-check compares against this
   * so a signal's own remainder is never mistaken for a new arrival.
   */
  knownMatchIds: string[];
  paused: PersonalAgentPausedNegotiation[];
  dossier: PersonalAgentDossierEntry[];
  recentDm: Array<{ role: string; content: string }>;
  recentActs: Array<{ createdAt: Date; act: Record<string, unknown> }>;
}
