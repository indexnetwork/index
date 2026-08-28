import type {
  A2AArtifact,
  A2ATask,
  A2ATaskState,
  AgentCard,
} from "@indexnetwork/negotiator/a2a";
import type { NegotiationDecision, NegotiationTerms } from "@indexnetwork/negotiator";
import type { AgreementBasis } from "@indexnetwork/negotiator/a2a";
import type { ModelMessage } from "./model.ts";

// --- identity and intent ---------------------------------------------

/**
 * Who this agent acts for. One identity per agent, and it stays the same
 * across every intent scope and every negotiation the agent opens — the
 * intent narrows what the agent is working on, never who it is.
 *
 * Self-asserted: it's published on a public, unauthenticated AgentCard, so
 * a counterparty learns who this claims to be and decides whether to
 * believe it. Pair with `credentials`/`authenticate` if that needs proving.
 */
export interface AgentIdentity {
  /** Display name. Shown on the AgentCard, and used as the party name the
   * negotiator speaks under. */
  name: string;
  /** Stable identifier for the party this agent acts for — a DID, a
   * profile URL, an account id. */
  id: string;
  description?: string;
  /** Public base URL this agent is reachable at. */
  url?: string;
  /** Version published on the AgentCard. Defaults to "0.1.0". */
  version?: string;
}

/** What the agent is currently working on. Scoping an agent to one narrows
 * its context; it doesn't create a different agent. */
export interface Intent {
  id?: string;
  statement: string;
}

/**
 * The AgentCard this package publishes: the A2A card plus the agent's
 * identity. The A2A spec has no field for who an agent acts *for* — only
 * `name` and `url` — so `id` is an extension. Counterparties that don't
 * know about it ignore it, and it survives serialization untouched.
 */
export type IdentifiedAgentCard = AgentCard & { id?: string };

// --- the agent loop --------------------------------------------------

/** One thing that happened during a run. A tool step carries `output` or
 * `error`, never both. */
export type Step =
  | { kind: "message"; content: string }
  | { kind: "tool"; name: string; input: unknown; output?: unknown; error?: string }
  | { kind: "ask"; question: string; options?: string[] };

/** Why a run stopped. */
export type RunEnd =
  /** The model answered with text instead of another tool call. */
  | "done"
  /** The agent needs the user to answer something before it can continue.
   * See `pending`; resume by passing the answer to the next `run()`. */
  | "needs-input"
  /** `maxSteps` was spent while the model was still working. */
  | "max-steps";

export interface PendingQuestion {
  question: string;
  /** Suggested answers, when the agent offered a choice rather than an
   * open question. */
  options?: string[];
}

export interface RunResult {
  /** The agent's final text. Empty if it never produced any. */
  output: string;
  steps: Step[];
  end: RunEnd;
  /** Set when `end` is "needs-input": what the agent needs to know. */
  pending?: PendingQuestion;
  /** The full transcript, including the system message. Pass it back as
   * `messages` to continue — that's how a suspended run resumes. */
  messages: ModelMessage[];
  /** Negotiations still open at the end of this run. Pass these back
   * alongside `messages` so a resumed run can keep taking turns in them;
   * without them the agent can still talk, but not continue an exchange
   * it already started. */
  negotiations: NegotiationSession[];
}

// --- negotiation -----------------------------------------------------

/** Which side of a negotiation a turn belongs to, from this agent's point
 * of view. */
export type Speaker = "self" | "peer";

/** Whether this agent dialed the counterparty or answered them. */
export type Direction = "outbound" | "inbound";

export interface AgentTurn<A extends string = string> {
  speaker: Speaker;
  decision: NegotiationDecision<A>;
}

/**
 * An A2A negotiation this agent has open. Everything needed to take
 * another turn later, in another process — the counterparty holds its own
 * copy of the task, but the negotiator rebuilds this side's view from the
 * history, so the history has to travel with us.
 */
export interface NegotiationSession {
  /** The A2A task id, and how the agent refers to this negotiation. */
  id: string;
  /** Whether this agent dialed the counterparty or answered them. It
   * decides what can be done with the session, not what can be known: an
   * inbound negotiation is one this agent cannot take a turn in, because
   * the counterparty is the one who calls. */
  direction: Direction;
  /** The counterparty's A2A endpoint. Absent on inbound negotiations —
   * they contacted us, and a `message/send` call carries no return
   * address. */
  url?: string;
  /** What this agent is trying to get out of this negotiation. */
  objective: string;
  /** The counterparty's AgentCard, if it was fetched. Null inbound, where
   * nothing was fetched. */
  peer: IdentifiedAgentCard | null;
  task: A2ATask;
}

/**
 * Where an agent's negotiations live.
 *
 * The same shape as the A2A `TaskStore` and for the same reason: the agent
 * itself holds no state, and a real deployment swaps the in-memory default
 * for something shared. Both directions go here, so what the agent knows
 * doesn't depend on who happened to dial.
 */
export interface NegotiationStore {
  get(id: string): NegotiationSession | undefined;
  save(session: NegotiationSession): void;
  /** Most recently updated last. */
  list(): NegotiationSession[];
}

/**
 * How an ended negotiation actually ended, once both sides' closing moves
 * are compared.
 *
 * Each side decides its own turn, so "it ended" is two separate
 * assertions, not one shared fact: this agent can accept in the same round
 * trip that the counterparty rejects, and without comparing them both
 * parties walk away believing different things.
 */
export type SettlementOutcome =
  /** Both sides closed on the same deal. `basis` says on what evidence. */
  | "agreed"
  /** Closed cleanly with a refusal. Nobody is confused; there is no deal. */
  | "declined"
  /** The two closing moves bound to different terms. There is no agreement,
   * whatever either side's own action says. */
  | "conflict"
  /** It ended, but nothing structured says *what* was agreed — prose-only
   * decisions. Verify out of band rather than acting on it. */
  | "unconfirmed"
  /** This agent closed and the counterparty replied without closing. The
   * exchange is still open; nothing is agreed yet. */
  | "unanswered";

/**
 * The two closing statements, side by side.
 *
 * Read this rather than `endedBy` before telling anyone a deal was struck:
 * `endedBy` is what *this* agent did, and one side's accept is not an
 * agreement.
 *
 * The verdict comes from `verifyAgreement()` over the shared Task, so both
 * parties compute it from the same input and reach the same answer by
 * construction. The prose fallback is this package's own, and says so
 * through `basis`.
 */
export interface Settlement<A extends string = string> {
  outcome: SettlementOutcome;
  /**
   * What evidence the verdict rests on, weakest to strongest: `prose` (a
   * text comparison this package made, when nothing structured was
   * available), `state` (the server-stamped task state alone), `terms`
   * (structured terms compared directly — content equality), `reference`
   * (the closing move named the offer it accepted — provenance).
   *
   * Not strictness levels: check it when something irreversible depends on
   * the deal, e.g. `outcome === "agreed" && basis === "reference"`.
   */
  basis: AgreementBasis;
  /** What was agreed, when the terms could be established. */
  terms?: NegotiationTerms;
  /** This agent's closing move. */
  mine: NegotiationDecision<A>;
  /** The counterparty's, from the same round trip. */
  theirs: NegotiationDecision<A> | null;
  /** Why the outcome is what it is, in words, for a model or a person to
   * act on. */
  reason: string;
  /** Amounts each closing statement named, when the prose fallback found
   * them irreconcilable. Only set when `basis` is `"prose"`. */
  disputed?: { mine: number[]; theirs: number[] };
}

/** Why a negotiation stopped. */
export type NegotiationEnd =
  /** A terminal action was taken — see `endedBy` for which, and by whom. */
  | "terminal"
  /** Still open: nobody has taken a terminal action yet. */
  | "open"
  /** `maxTurns` was spent with the exchange still open. */
  | "max-turns";

/** The result of one exchange: this agent's turn and the reply to it. */
export interface NegotiationTurn<A extends string = string> {
  /** The negotiation this turn belongs to. */
  id: string;
  sent: NegotiationDecision<A>;
  /** The counterparty's reply, or null if it sent nothing decodable. */
  received: NegotiationDecision<A> | null;
  state: A2ATaskState;
  /** Whether the Task ended, read off the Task itself. A2A puts the Task
   * on the server side — ids are server-generated and only the server
   * transitions state — so this is the record, not this agent's opinion of
   * it. Accepting into a counter leaves the exchange open. */
  done: boolean;
  /** Who took a terminal action, and which. Records what was done; it is
   * not a verdict, because both sides can close differently in the same
   * round trip. Read `settlement` for whether anything was agreed. */
  endedBy?: { speaker: Speaker; action: A };
  /** Set once either side has closed: how the two closing moves compare.
   * `done` says the exchange stopped; this says whether anything was
   * actually agreed. */
  settlement?: Settlement<A>;
  /** An Artifact from this agent's `evaluate` hook, if it produced one. */
  artifact?: A2AArtifact;
}

/**
 * What a negotiation run under the fan-out pump reports when it stops.
 * One event per negotiation per tool call; the turns in between never
 * reach the agent loop. `failed` is an event rather than a throw so one
 * refused connection does not sink the other negotiations in the batch.
 */
export type NegotiationEvent<A extends string = string> =
  | {
      kind: "settled";
      id: string;
      peer?: string;
      state: A2ATaskState;
      settlement?: Settlement<A>;
      turns: number;
    }
  | {
      kind: "asking";
      id: string;
      peer?: string;
      question: string;
      /** The counterparty's most recent move, so the party can be told
       * what is on the table when asked. */
      last: NegotiationDecision<A> | null;
      turns: number;
    }
  | { kind: "budget"; id: string; peer?: string; last: NegotiationDecision<A> | null; turns: number }
  | { kind: "failed"; id: string; peer?: string; error: string; turns: number }
  | { kind: "skipped"; id: string; peer?: string; reason: string };

export interface Negotiation<A extends string = string> {
  peer: IdentifiedAgentCard | null;
  /** The A2A Task as the counterparty last returned it. */
  task: A2ATask;
  /** The Task's state, as the counterparty's server stamped it — the
   * record of what happened. This agent taking a terminal action does not
   * move it: an accept the counterparty answered with a counter comes back
   * `input-required`, and the exchange is still open. `endedBy` says what
   * this agent did; `settlement` says whether anything was agreed. */
  state: A2ATaskState;
  end: NegotiationEnd;
  endedBy?: { speaker: Speaker; action: A };
  /** How the two sides' closing moves compare. `end: "terminal"` means the
   * exchange stopped; this says whether the two agree about it. */
  settlement?: Settlement<A>;
  /** Every turn in order, both sides, decoded from the task history. */
  transcript: AgentTurn<A>[];
  /** Artifacts produced by this agent's own `evaluate` hook. */
  artifacts: A2AArtifact[];
}
