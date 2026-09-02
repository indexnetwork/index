import {
  Negotiator,
  type ActionSpec,
  type NegotiationDecision,
} from "@indexnetwork/a2a/negotiator";
import {
  A2ANegotiationClient,
  createA2AHandler,
  fetchAgentCard,
  defaultStrategy,
  isTerminalTaskState,
  messageToDecision,
  strategyWithTerms,
  TaskStore,
  verifyAgreement,
  type A2AArtifact,
  type A2ACredentials,
  type A2AIdentity,
  type A2AMessage,
  type A2ATask,
  type AgreementBasis,
  type AgreementResult,
  type DeadlineOptions,
  type AgentCardSkill,
  type DecisionStrategy,
  type EvaluateHook,
} from "@indexnetwork/a2a";

import { runLoop } from "./loop.ts";
import { MemoryMessageStore, MemoryNegotiationStore } from "./sessions.ts";
import { ModelClient, type ModelMessage } from "./model.ts";
import { defaultTools, type Tool, type ToolContext } from "./tools.ts";
import type {
  AgentIdentity,
  AgentTurn,
  Direction,
  IdentifiedAgentCard,
  Intent,
  MessageStore,
  Negotiation,
  NegotiationEvent,
  NegotiationSession,
  NegotiationStore,
  NegotiationTurn,
  Settlement,
  SettlementOutcome,
  RunResult,
  Speaker,
  Step,
} from "./types.ts";

/** The negotiation vocabulary an `Agent` uses when you don't give it one. */
export const DEFAULT_ACTIONS = ["propose", "counter", "accept", "reject"] as const;

export type DefaultAction = (typeof DEFAULT_ACTIONS)[number];

const DEFAULT_MAX_STEPS = 10;
const DEFAULT_MAX_TURNS = 10;
const DEFAULT_VERSION = "0.1.0";

/** How many negotiations the system message lists. Enough to answer "what
 * did we agree", bounded so a busy agent's prompt doesn't grow without
 * limit. */
const RECORDED_NEGOTIATIONS = 10;

/** What a negotiation method sees of the run it is part of: the map of
 * sessions the loop's caller gets back, and the run's abort signal. Absent
 * on a direct API call, when the store is all there is. */
type RunContext = Pick<ToolContext, "negotiations" | "signal">;

/** The negotiating skill, described with the vocabulary this agent
 * actually understands. A counterparty reading the card learns which
 * actions it can expect back, which is the part of the card that changes
 * how the other side behaves. */
function negotiateSkill(actions: string[]): AgentCardSkill {
  return {
    id: "negotiate",
    name: "Negotiate",
    description:
      "Negotiates on its party's behalf over A2A message/send. " +
      `Understands: ${actions.join(", ")}.`,
  };
}

/** Mirrors the negotiator's own default terminal set, so an `Agent` and the
 * handler underneath it always agree on which actions end a task. */
const DEFAULT_TERMINAL: ReadonlySet<string> = new Set(["accept", "reject", "decline", "withdraw"]);

/**
 * The one action a negotiation under the pump may take that a one-vs-one
 * turn may not: stop and ask the party. It is intercepted before the wire,
 * so the counterparty never sees it.
 *
 * That interception is `takeTurn`'s doing, not something inherent to this
 * value: it happens only when this package's own pump offers `ask` among
 * `allowedActions`. A host that adds `ASK_ACTION` to its own
 * `allowedActions` — outside the pump, e.g. on a one-vs-one `negotiate()`
 * — gets no such interception, and `ask` goes out over the wire to the
 * counterparty like any other action.
 */
export const ASK_ACTION = {
  action: "ask",
  description:
    "use only when your next move depends on something the party you act for has not told you — a limit, a date, a preference. State what you need to know. Nothing is sent to the counterparty",
} as const;

/** Thrown by the pump's strategy wrapper when the negotiator decides to
 * `ask`, so the turn stops before `sendTurn` reaches the network. */
class Escalation extends Error {
  constructor(readonly decision: NegotiationDecision<string>) {
    super(decision.message);
  }
}

/**
 * What terms to ask for when the host hasn't said. Deliberately generic:
 * one agent serves arbitrary intents, so the fields aren't known until the
 * negotiation exists. Naming them (`terms` on `AgentOptions`) is better
 * where the domain is known.
 */
const DEFAULT_TERMS =
  "the material terms of this deal as flat key/value pairs, using the plainest field name for each (amount, currency, date, quantity, location) — only what has actually been discussed, using the same field names the other side used, and always naming the currency alongside an amount";

/**
 * "Friday, 28 August 2026" — the weekday included, since half of what gets
 * negotiated is stated as one ("weekday evenings", "next Tuesday").
 *
 * UTC, because the negotiator states the date in UTC too and an agent whose
 * loop and whose negotiation turns disagree about what day it is would be
 * worse than either being slightly off. A host that wants its party's local
 * day passes a `now` shifted into that timezone.
 */
function formatDate(now: Date): string {
  return now.toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Amounts named in a closing statement. Text is all the protocol carries,
 * so this is a backstop for the common case — a price — not a guarantee
 * that the rest of the terms match. */
function amountsIn(text: string): number[] {
  const found = text.matchAll(
    /(?:[$€£]\s?(\d[\d,]*(?:\.\d+)?))|(?:\b(\d[\d,]*(?:\.\d+)?)\s?(?:euros?|dollars?|pounds?|usd|eur|gbp)\b)/gi,
  );
  const amounts = [...found]
    .map((match) => Number((match[1] ?? match[2] ?? "").replace(/,/g, "")))
    .filter((amount) => Number.isFinite(amount));
  return [...new Set(amounts)];
}

/**
 * Whether a negotiation could still bind the party: unfinished, or closed
 * as a deal. Only a no-deal ending frees the counterparty up again —
 * `declined` and `conflict` leave the party holding nothing, and going
 * back with a new offer is exactly what a new negotiation is for.
 * `unconfirmed` is an ending nobody can read, which is a reason to verify
 * it, not to negotiate over the top of it.
 */
function stillBinding(session: NegotiationSession): boolean {
  if (!session.task || !isTerminalTaskState(session.task.status.state)) return true;
  const status = verifyAgreement(session.task).status;
  return status !== "declined" && status !== "conflict";
}

/**
 * Why a second negotiation with the same counterparty is refused, and
 * what to do with the one that already exists. Shared so the thrown
 * error and the skipped event say the same thing.
 */
function secondNegotiationRefusal(rival: NegotiationSession): string {
  const who = rival.peer?.name ?? rival.url ?? "them";

  if (rival.task && isTerminalTaskState(rival.task.status.state)) {
    const agreement = verifyAgreement(rival.task);
    const terms = agreement.terms ? ` on ${JSON.stringify(agreement.terms)}` : "";
    return (
      `You have already closed with ${who}${terms} ("${rival.id}"). ` +
      "Opening another negotiation would not change those terms, it would add a second deal alongside them — " +
      "report what you agreed instead, and tell your party if you think it should have gone differently."
    );
  }

  // An inbound rival can't be continued or resumed the way an outbound one
  // can — `continueNegotiation`/`resumeNegotiation` both refuse a session
  // this agent didn't dial, because the counterparty holds the initiative.
  if (rival.direction === "inbound") {
    const next = rival.pending
      ? `it is waiting on your party: ${JSON.stringify(rival.pending.question)} — answer it with answerInbound`
      : "they hold the initiative on it — wait for their next message";
    return (
      `${who} is already negotiating this with you ("${rival.id}"), under the same intent. ${next}. ` +
      "Opening your own negotiation over the top of it would settle independently and commit your party twice."
    );
  }

  const next = rival.pending
    ? `It is waiting on your party: ${JSON.stringify(rival.pending.question)} — answer it with negotiate_resume`
    : "Continue it with negotiate_turn";
  return (
    `You are already negotiating with ${who} ("${rival.id}"). ${next}, ` +
    "rather than opening a second one: both would settle independently, and your party would be committed twice."
  );
}

/** How many turns this side has sent. Client-side moves go over the wire
 * with role "user", so the Task history carries the count. */
function sentTurns(session: NegotiationSession): number {
  return session.task?.history.filter((message) => message.role === "user").length ?? 0;
}

/** A decision off a wire message, or null when there is no message or it
 * doesn't decode. */
function decode<A extends string>(message: A2AMessage | undefined): NegotiationDecision<A> | null {
  return message ? (messageToDecision(message) as NegotiationDecision<A> | null) : null;
}

/** The counterparty's most recent move, decoded, or null before they have
 * said anything. */
function lastPeerDecision<A extends string>(session: NegotiationSession): NegotiationDecision<A> | null {
  return decode<A>(session.task?.history.findLast((message) => message.role === "agent"));
}

/** The objective with the party's standing guidance folded in. Guidance
 * given to a parked negotiation holds for the rest of it, so every later
 * turn — outbound, or a reply to an inbound call — is decided under it. */
function brief(objective: string, guidance?: string[]): string {
  return guidance?.length
    ? `${objective}\n\nGuidance from the party you act for:\n${guidance.join("\n")}`
    : objective;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export interface AgentOptions<A extends string = DefaultAction> {
  /** Who this agent acts for. Constant across every intent scope and every
   * negotiation. */
  identity: AgentIdentity;
  /**
   * The standing instructions this agent runs under, supplied by whatever
   * is hosting it. Used two ways:
   *
   * - verbatim as the system message of the agent loop, and
   * - as the negotiating `objective` handed to `Negotiator`, which wraps
   *   it in its own negotiation framing (see `negotiate()`).
   */
  systemPrompt: string;
  /** What the agent is working on. Usually set with `for()` rather than
   * here; an agent without one is the unscoped agent. */
  intent?: Intent;

  /**
   * Tools the loop may call. Defaults to `ask_user` plus the negotiation
   * pair. Index Network operations belong here, injected by the host —
   * this package deliberately knows nothing about how Index is reached.
   * Passing your own array replaces the defaults entirely, so spread
   * `defaultTools()` if you want to keep them.
   */
  tools?: Tool<never>[];

  /** OpenRouter model for the agent loop. Defaults to
   * `google/gemini-3.7-flash`. */
  model?: string;
  /** OpenRouter API key. Falls back to `OPENROUTER_API_KEY`. */
  apiKey?: string;
  /** Step cap for `run()`. Defaults to 10. */
  maxSteps?: number;
  /** How long one model request may take, in ms. Defaults to 120s. A hung
   * connection otherwise stalls the agent until someone interrupts it. */
  timeout?: number;
  /** Model attempts per step, including the first. Defaults to 3; only
   * transient failures are retried. */
  attempts?: number;
  /** Fires before a model call is retried. A retry looks like slowness
   * from the outside, so a host with a UI generally wants to say so. */
  onRetry?: (attempt: number, reason: string) => void;
  /**
   * The current time, for resolving what a counterparty means by "next
   * Tuesday". Defaults to the host's clock, and is shared with the
   * negotiator so the loop and the negotiation turns can't disagree about
   * what day it is.
   *
   * Read as UTC. A host whose party lives elsewhere passes an instant
   * shifted into that timezone; a test passes a fixed one.
   */
  now?: () => Date;

  /** The negotiation engine. Defaults to a `Negotiator` built from `model`
   * and `apiKey`. */
  negotiator?: Negotiator;
  /** Defaults to `DEFAULT_ACTIONS` (propose/counter/accept/reject). */
  allowedActions?: ActionSpec<A>[];
  /** Turn cap per negotiation. Defaults to 10. */
  maxTurns?: number;
  /**
   * Describes the structured terms decisions should carry — e.g.
   * `"amount (number, USD), pickupDay (day of week)"`.
   *
   * Terms are what make an agreement checkable: an accepting move names the
   * offer it binds to, and `settlement` can verify it instead of reading
   * English. Defaults to a domain-agnostic description, because this agent
   * is scoped to an intent at run time and the host generally can't
   * enumerate the fields in advance. Name them when you can — it makes the
   * two sides more likely to use the same keys. Set to `""` for prose-only
   * decisions, which settle as `unconfirmed`.
   */
  terms?: string;

  /** Skills published on the AgentCard. Defaults to the negotiating skill,
   * described with this agent's action vocabulary. Setting this replaces
   * the derived skills entirely. */
  skills?: AgentCardSkill[];
  /**
   * Also publish this agent's tools as skills.
   *
   * Off by default, and deliberately: the AgentCard is public and
   * unauthenticated, and the tools are whatever the host injected — for
   * Index Network that is a list of the operations this party can perform,
   * which is not obviously anyone else's business. Turn it on when being
   * discoverable is the point.
   */
  publishTools?: boolean;
  /** Merged last into the derived AgentCard — the place to declare
   * `securitySchemes`/`security`, which can't be inferred from
   * `authenticate`. */
  card?: Partial<IdentifiedAgentCard>;

  /** Fires once per negotiation turn, both sides, in conversation order. */
  onTurn?: (turn: AgentTurn<A>, direction: Direction) => void;
  /**
   * Fires when a round trip closes an exchange, on whichever side this
   * agent played. Both parties compare the same two closing moves, so both
   * reach the same verdict — which is the point: without it, each side
   * knows only its own action and can report a deal the other never made.
   */
  onSettled?: (settlement: Settlement<A>, direction: Direction) => void;
  /** Which actions end a negotiation. Defaults to the negotiator's own set
   * (accept/reject/decline/withdraw). */
  isTerminal?: (action: A) => boolean;
  /** Maps a terminal action to the Task's final state. */
  terminalState?: (action: A) => "completed" | "rejected" | "canceled";
  /** Attaches structured findings to a negotiation turn. */
  evaluate?: EvaluateHook<A>;

  /** Gates inbound `message/send` calls. */
  authenticate?: (
    request: Request,
  ) => A2AIdentity | null | undefined | Promise<A2AIdentity | null | undefined>;
  /** Auth headers attached to this agent's own outbound calls. */
  credentials?: A2ACredentials;
  /** Where inbound Tasks are stored. Defaults to the negotiator's
   * in-memory store, which is per-process. */
  taskStore?: TaskStore;
  /**
   * Where this agent's negotiations are recorded — both the ones it opened
   * and the ones it answered.
   *
   * The agent holds no state of its own; this is the host's, like
   * `taskStore`, and defaults to an in-memory store. Swap it for something
   * shared and an agent knows what it negotiated after a restart, or from
   * another process.
   */
  sessions?: NegotiationStore;
  /**
   * Where this agent's H2A conversation is recorded.
   *
   * The agent holds no state of its own; this is the host's, like
   * `sessions`, and defaults to an in-memory store. Swap it for something
   * shared and an agent picks a suspended conversation back up after a
   * restart, or from another process, without the host having to thread
   * `messages` through every `run()` call itself.
   */
  history?: MessageStore;
}

export interface RunOptions {
  maxSteps?: number;
  /** The conversation so far — pass `messages` from a previous result to
   * continue it, including resuming a run that stopped on a question.
   * Omit it to fall back to the agent's `history` store instead; passing
   * it always wins, so a host mixing both approaches doesn't get a stale
   * transcript silently overriding a fresher one. */
  messages?: ModelMessage[];
  /** Negotiations still open — pass `negotiations` from a previous result
   * so the agent can keep taking turns in exchanges it already started. */
  negotiations?: NegotiationSession[];
  /** Fires as each step completes. */
  onStep?: (step: Step) => void;
  signal?: AbortSignal;
}

export interface OpenNegotiationOptions {
  /** What to achieve in this negotiation specifically. Composed with the
   * agent's standing instructions and intent. */
  objective?: string;
  /** Set false to skip fetching the counterparty's AgentCard. */
  discover?: boolean;
}

export interface NegotiateOptions extends OpenNegotiationOptions {
  maxTurns?: number;
  /** Stops the exchange, including the turn in flight. */
  signal?: AbortSignal;
}

/**
 * A personal agent, run by a host on someone's behalf.
 *
 * It works the way Claude Code, Hermes or OpenClaw do — a system prompt, a
 * set of tools, and a loop that runs until the work is done — with two
 * differences. It doesn't own its instructions: a host constructs it with
 * a `systemPrompt` and injects the operations it can perform. And it can
 * stop to ask the party it acts for a question, handing that question back
 * to the host rather than blocking on it.
 *
 * There is one agent per party, with one identity. `for()` scopes it to an
 * intent, which narrows what it's working on without changing who it is:
 * the identity carries into every scope and into every negotiation it
 * opens.
 */
export class Agent<A extends string = DefaultAction> {
  readonly identity: AgentIdentity;
  readonly systemPrompt: string;
  readonly intent?: Intent;
  readonly tools: Tool<never>[];

  private readonly model: ModelClient;
  private readonly negotiator: Negotiator;
  private readonly allowedActions: ActionSpec<A>[];
  private readonly maxSteps: number;
  private readonly maxTurns: number;
  private readonly isTerminal: (action: A) => boolean;
  /** How each turn is decided. Asks for structured terms unless the host
   * turned them off, so an agreement can be verified rather than read. */
  private readonly strategy: DecisionStrategy<A>;
  /** What this agent has negotiated, in either direction. */
  private readonly sessions: NegotiationStore;
  /** This agent's H2A conversation. */
  private readonly history: MessageStore;

  constructor(private readonly options: AgentOptions<A>) {
    this.identity = options.identity;
    this.systemPrompt = options.systemPrompt;
    this.intent = options.intent;
    this.tools = options.tools ?? defaultTools();

    this.model = new ModelClient({
      apiKey: options.apiKey,
      model: options.model,
      timeout: options.timeout,
      attempts: options.attempts,
      onRetry: options.onRetry,
    });
    // The same clock the loop reasons with. Two clocks in one agent can
    // disagree across midnight, and then the agent's own turns contradict
    // what it told its party.
    this.negotiator =
      options.negotiator ??
      new Negotiator({ apiKey: options.apiKey, model: options.model, now: options.now });

    this.allowedActions =
      options.allowedActions ?? ([...DEFAULT_ACTIONS] as unknown as ActionSpec<A>[]);
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    this.isTerminal = options.isTerminal ?? ((action: A) => DEFAULT_TERMINAL.has(action));
    this.sessions = options.sessions ?? new MemoryNegotiationStore();
    this.history = options.history ?? new MemoryMessageStore();

    // Terms are on unless the host turned them off with `terms: ""` — a
    // decision that carries no terms can only ever settle as `unconfirmed`.
    const terms = options.terms ?? DEFAULT_TERMS;
    this.strategy = terms
      ? strategyWithTerms<A>(terms)
      : (defaultStrategy as unknown as DecisionStrategy<A>);
  }

  // --- intent scoping ------------------------------------------------

  /**
   * The same agent, narrowed to one intent.
   *
   * This is a lens, not a new agent: the identity object is shared, so
   * anything the scoped agent says or signs is said by the same party. All
   * that changes is context — the intent is stated to the model, and every
   * negotiation opened in this scope is understood to serve it.
   */
  for(intent: Intent | string): Agent<A> {
    return new Agent<A>({
      ...this.options,
      identity: this.identity,
      // Shared, not copied — an intent scopes what the agent is working
      // on, not what it remembers negotiating or has already said.
      sessions: this.sessions,
      history: this.history,
      intent: typeof intent === "string" ? { statement: intent } : intent,
    });
  }

  /** The system message the loop actually runs under: the host's standing
   * instructions, plus who this agent is, plus the current intent. */
  instructions(sessions: NegotiationSession[] = this.sessions.list()): string {
    const parts = [
      this.systemPrompt,
      `You are ${this.identity.name}, acting on behalf of ${this.identity.id}.`,
      // Without this the agent has no clock, and a counterparty's "next
      // Tuesday" can only be repeated, never resolved. Terms then record a
      // date that stops meaning the same thing a week later.
      `Today is ${formatDate((this.options.now ?? (() => new Date()))())}. When you agree a date, record the actual date rather than a relative one like "next Tuesday", so the terms still mean the same thing when someone reads them later.`,
      "Only call a tool from the list you were actually given this turn — what's offered can change as your situation does, so a capability you used before, or one that would make sense here, may not be available right now. If what you need isn't in that list, say so or ask, rather than calling a name you expect to exist.",
    ];
    if (this.intent) {
      parts.push(
        `Current intent: ${this.intent.statement}\nEverything you do in this session serves that intent. If something falls outside it, say so rather than acting.`,
      );
    }

    // What this agent has actually negotiated, from the record rather than
    // from the conversation. A negotiation it answered never passed
    // through this loop, so without this the agent would deny a deal it
    // made — and even its own outbound deals would vanish the moment the
    // transcript was trimmed.
    const record = this.record(sessions);
    if (record) parts.push(record);

    return parts.join("\n\n");
  }

  /** The negotiations block of the system message. */
  private record(sessions: NegotiationSession[]): string {
    if (!sessions.length) return "";

    const shown = sessions.slice(-RECORDED_NEGOTIATIONS);
    const lines = shown.map((session) => {
      const who = session.direction === "outbound" ? "you contacted them" : "they contacted you";
      const peer = session.peer?.name ? ` with ${session.peer.name}` : "";
      const agreement: AgreementResult = session.task
        ? verifyAgreement(session.task)
        : { status: "open", basis: "state" };
      const terms = agreement.terms ? `: ${JSON.stringify(agreement.terms)}` : "";
      const detail = session.pending
        ? `waiting on your guidance: ${JSON.stringify(session.pending.question)}`
        : agreement.status === "open"
          ? `still open, ${session.task?.history.length ?? 0} turns so far`
          : `${agreement.status}${terms}`;

      return `- ${session.id}${peer} — ${who}; ${detail}`;
    });

    // Naming the parked ones here, rather than only in the digest a tool
    // returned, is the difference between an instruction the agent read
    // once and one it is holding: a run that ends with a question still
    // unanswered has abandoned a live negotiation, and the counterparty
    // is still waiting. Split by direction — resuming the two isn't the
    // same tool: an outbound one is pumped on, an inbound one just has its
    // answer recorded for when they continue it.
    const parked = shown.filter((session) => session.pending);
    const parkedOutbound = parked.filter((session) => session.direction === "outbound");
    const parkedInbound = parked.filter((session) => session.direction === "inbound");

    return [
      "Negotiations you are party to. This is the record of what happened, which is not the same as what you remember saying — trust it over the conversation above:",
      ...lines,
      "Only negotiations you opened can be continued — with negotiate_turn, or negotiate_resume for one waiting on your guidance; in the others the counterparty calls you.",
      "Never open a second negotiation with a counterparty you already have one open with: both would settle, and your party would be committed twice.",
      ...(parkedOutbound.length
        ? [
            `Waiting on your party right now: ${parkedOutbound.map((session) => session.id).join(", ")}. Ask with ask_user, then call negotiate_resume with every id the answer applies to — before you report back, not after.`,
          ]
        : []),
      ...(parkedInbound.length
        ? [
            `They are waiting on your party too, right now: ${parkedInbound.map((session) => session.id).join(", ")}. Ask with ask_user, then call answer_inbound with every id the answer applies to — this doesn't take a turn, it just has your answer ready for when they continue it.`,
          ]
        : []),
    ].join("\n");
  }

  // --- the agent loop ------------------------------------------------

  /**
   * Runs the agent: ask the model, run the tools it calls, feed the results
   * back, until it answers with text, needs the user, or spends `maxSteps`.
   *
   * `input` is normally an instruction. When the previous result ended
   * `needs-input`, pass the user's answer here along with that result's
   * `messages`, and the run picks up from the question.
   */
  async run(input: string, options: RunOptions = {}): Promise<RunResult> {
    // The store is the record; `options.negotiations` is what the host
    // carried back from a previous run. Either is enough on its own, so a
    // host can keep passing sessions around message-style or lean on a
    // shared store, and both hosts get an agent that knows the same things.
    for (const session of options.negotiations ?? []) {
      if (!this.sessions.get(session.id)) this.sessions.save(session);
    }
    const negotiations = new Map(
      this.sessions.list().map((session) => [session.id, session]),
    );

    // Same either-is-enough rule as negotiations: a host can pass `messages`
    // message-style, lean on a shared `history` store, or both — whichever
    // arrived travels into this run.
    const messages = options.messages ?? this.history.list();

    const result = await runLoop({
      model: this.model,
      systemPrompt: this.instructions([...negotiations.values()]),
      tools: this.tools,
      messages,
      input,
      maxSteps: options.maxSteps ?? this.maxSteps,
      context: {
        agent: this as unknown as Agent,
        negotiations,
        signal: options.signal,
      },
      onStep: options.onStep,
      signal: options.signal,
    });

    this.history.save(result.messages);
    return result;
  }

  // --- identity ------------------------------------------------------

  /**
   * The AgentCard this agent publishes. Derived from the identity, so it's
   * the same card in every intent scope — the intent is what the agent is
   * doing, not who it is.
   */
  card(): IdentifiedAgentCard {
    return {
      name: this.identity.name,
      id: this.identity.id,
      description: this.identity.description,
      url: this.identity.url ?? "",
      version: this.identity.version ?? DEFAULT_VERSION,
      capabilities: {},
      skills: this.options.skills ?? this.derivedSkills(),
      ...this.options.card,
    };
  }

  /**
   * What this agent advertises it can do: negotiating, in the action
   * vocabulary it actually uses, plus its tools when the host has opted
   * into publishing them.
   *
   * Suspending tools are left out — `ask_user` is how this agent reaches
   * the party it acts for, not something a counterparty can invoke.
   */
  private derivedSkills(): AgentCardSkill[] {
    const actions = this.allowedActions.map((action) =>
      typeof action === "string" ? action : action.action,
    );
    const skills = [negotiateSkill(actions)];

    if (!this.options.publishTools) return skills;

    for (const tool of this.tools) {
      if (tool.suspends || tool.name.startsWith("negotiate_") || tool.name === "answer_inbound") continue;
      skills.push({ id: tool.name, name: tool.name, description: tool.description });
    }
    return skills;
  }

  /** Fetches a counterparty's AgentCard without saying anything to them —
   * a trust check before negotiating. */
  async inspect(url: string, options: DeadlineOptions = {}): Promise<IdentifiedAgentCard> {
    return fetchAgentCard(url, this.options.credentials, options);
  }

  // --- inbound -------------------------------------------------------

  /**
   * This agent's A2A surface: serves its AgentCard at
   * `/.well-known/agent-card.json` and answers `message/send` calls.
   *
   * Inbound turns are decided by `Negotiator` directly, not by the agent
   * loop — a counterparty's turn needs one reply, not a work session.
   */
  handler(): (request: Request) => Promise<Response> {
    const { onTurn, onSettled } = this.options;
    // `inner` is rebuilt per request now, to fold each task's guidance
    // into `objective` — but `createA2AHandler` defaults to a fresh
    // in-memory `TaskStore` per call when none is given, so without
    // fixing one here, a host that never set `taskStore` would lose every
    // task the moment the next request built a new empty store.
    const taskStore = this.options.taskStore ?? new TaskStore();

    // Report both turns of the round trip, in order. The counterparty's has
    // to be decoded from the request before the handler runs, and this
    // agent's from the Task the handler returns; the clones leave both
    // bodies intact, and anything that won't parse is left for the handler
    // to reject exactly as it otherwise would. Both are only *emitted*
    // once the Task exists, though — its id is what tags each turn, and an
    // inbound negotiation has no other identity to give it (`peer: null`
    // below — nobody fetched an AgentCard for a caller we didn't dial).
    return async (request: Request): Promise<Response> => {
      // No early return for a non-POST request (the AgentCard GET): `inner`
      // is built per-request below, to fold this task's guidance in, and
      // `createA2AHandler` already routes GET to the card and anything
      // else to 404 — the rest of this block simply no-ops when `task`
      // never comes back.
      const body = await peek<{ id?: string; params?: { message?: A2AMessage } }>(request);
      const incoming = decode<A>(body?.params?.message);

      // A brand-new task (no `taskId`) under this same intent while this
      // agent already has an unfinished outbound negotiation about it is
      // the inbound half of the rival rule — refused before `inner` ever
      // creates a Task for it, the same way `openNegotiation` refuses the
      // outbound half. A continuation of an existing task is routed by its
      // `taskId` regardless, so this only ever catches an opening move.
      if (body?.params?.message && !body.params.message.taskId) {
        const rival = this.binding().find((session) => session.direction === "outbound");
        if (rival) {
          // `secondNegotiationRefusal` is written for this agent's own
          // model to read (an exception it catches, an event's `reason`
          // it sees in a digest) — it names this agent's own tools, which
          // mean nothing to whoever is calling in. This message is for
          // them instead.
          return Response.json(
            {
              jsonrpc: "2.0",
              id: body.id ?? null,
              error: {
                code: -32010,
                message:
                  "This agent already has an unfinished negotiation of its own about the same thing. Try again once that resolves.",
              },
            },
            { status: 409 },
          );
        }
      }

      // A reply already parked on `ask` folds the party's answer in as
      // standing guidance, the same way an outbound turn does — an
      // answered inbound question would otherwise never reach the
      // negotiator, because there is no per-request `objective` to carry
      // it except the one built fresh right here.
      const existing = body?.params?.message?.taskId
        ? this.sessions.get(body.params.message.taskId)
        : undefined;
      const objective = brief(this.objectiveFor(), existing?.guidance);

      // `ask` offered here lands as a legitimate `input-required` wire
      // reply — unlike the outbound pump's `Escalation`, there is nothing
      // to intercept before the wire: replying at all *is* this agent's
      // answer to their call, and "checking with my party" is exactly
      // that answer.
      const inner = createA2AHandler<A>({
        negotiator: this.negotiator,
        party: { name: this.identity.name, objective },
        allowedActions: [...this.allowedActions, ASK_ACTION as unknown as ActionSpec<A>],
        agentCard: this.card(),
        taskStore,
        isTerminal: this.isTerminal,
        terminalState: this.options.terminalState,
        strategy: this.strategy,
        evaluate: this.options.evaluate,
        authenticate: this.options.authenticate,
      });

      const response = await inner(request);

      const answered = await peek<{ result?: A2ATask }>(response);
      const task = answered?.result;
      const decision = decode<A>(task?.history.at(-1));

      // A negotiation this agent answered is one it was party to, so it
      // goes in the same record as the ones it opened. Without this the
      // agent can only know about negotiations it happened to dial, which
      // is an accident of transport rather than anything its party cares
      // about.
      if (task) {
        this.sessions.save({
          ...this.sessions.get(task.id),
          id: task.id,
          direction: "inbound",
          objective: this.objectiveFor(),
          ...(this.intent ? { intent: this.intent.statement } : {}),
          peer: null,
          task,
          // Set while this turn asked; cleared otherwise, so a stale
          // question from an earlier turn doesn't linger once a real
          // answer went out instead.
          pending:
            decision && (decision.action as string) === ASK_ACTION.action
              ? { question: decision.message }
              : undefined,
        });
      }

      if (incoming && task) {
        onTurn?.({ speaker: "peer", decision: incoming, id: task.id }, "inbound");
      }

      if (decision && task) {
        onTurn?.({ speaker: "self", decision, id: task.id }, "inbound");

        // Read off the same Task the initiator reads, so a conflict is
        // visible from both ends rather than only the side that dialed.
        // Inbound: they spoke first and this agent replied.
        const settlement = this.settle(task, decision, incoming, false);
        if (settlement) onSettled?.({ ...settlement, id: task.id }, "inbound");
      }

      return response;
    };
  }

  // --- the rival rule ------------------------------------------------

  /**
   * The negotiations under this intent that could still bind the party.
   *
   * One binding negotiation per counterparty, per intent: a second one is
   * refused while the first is unfinished or closed as a deal. An agent
   * that couldn't see how to move a negotiation waiting on its party once
   * re-opened all four of its counterparties instead, and agreed the same
   * purchase twice. Every Task-level invariant held throughout — the two
   * Tasks were independent and each was valid — and nothing had told it
   * not to.
   *
   * Read from the run's own view when there is one — `run()` seeds it from
   * the store, so it holds everything the store does and anything opened
   * since. Without a context this is a direct API call, and the store is
   * all there is.
   */
  private binding(context?: Pick<ToolContext, "negotiations">): NegotiationSession[] {
    const sessions = context ? [...context.negotiations.values()] : this.sessions.list();
    const intent = this.intent?.statement;
    return sessions.filter((session) => session.intent === intent && stillBinding(session));
  }

  /**
   * What refuses a new outbound negotiation with `url`: a binding one with
   * the same counterparty, or a binding *inbound* one under this intent.
   *
   * The second is coarser on purpose. An inbound negotiation carries no
   * return address, so there is no `url` to match against; a live run once
   * had one party's agent dial a counterparty while that same
   * counterparty's agent was mid-dial back, and each side settled its own
   * Task without ever seeing the other — two records for one deal. Two
   * Tasks for one deal is worse than occasionally refusing an unrelated
   * second counterparty until the first exchange resolves.
   */
  private rival(url: string, context?: Pick<ToolContext, "negotiations">): NegotiationSession | undefined {
    const binding = this.binding(context);
    return (
      binding.find((session) => session.direction === "outbound" && session.url === url) ??
      binding.find((session) => session.direction === "inbound")
    );
  }

  // --- outbound ------------------------------------------------------

  /** A session for a negotiation this agent is about to open, keyed under
   * a provisional id until the counterparty's Task exists — needed so a
   * negotiation that parks before its first turn can still be found and
   * resumed. `takeTurn` re-keys it the moment the Task comes back. */
  private newSession(url: string, objective?: string): NegotiationSession {
    return {
      id: `local:${crypto.randomUUID()}`,
      direction: "outbound",
      url,
      objective: this.objectiveFor(objective),
      ...(this.intent ? { intent: this.intent.statement } : {}),
      peer: null,
    };
  }

  /** Writes a session to the record and to the run's own view of it. */
  private remember(session: NegotiationSession, context?: Pick<ToolContext, "negotiations">): void {
    this.sessions.save(session);
    context?.negotiations.set(session.id, session);
  }

  /**
   * Opens a negotiation and takes the first turn. The session is recorded
   * on `context.negotiations` so `continueNegotiation()` can pick it up,
   * and travels out on `RunResult.negotiations` so a later run — in
   * another process — can too.
   */
  async openNegotiation(
    url: string,
    options: OpenNegotiationOptions = {},
    context?: RunContext,
  ): Promise<NegotiationTurn<A>> {
    const rival = this.rival(url, context);
    if (rival) throw new Error(secondNegotiationRefusal(rival));

    const signal = context?.signal;
    const session = this.newSession(url, options.objective);
    if (options.discover !== false) session.peer = await this.inspect(url, { signal });
    context?.negotiations.set(session.id, session);

    try {
      return await this.takeTurn(session, { signal }, context);
    } catch (cause) {
      context?.negotiations.delete(session.id);
      throw cause;
    }
  }

  /**
   * Takes one more turn in a negotiation already opened. `guidance` folds
   * in anything learned since the last turn — an answer from the party this
   * agent acts for, a limit, a change of position — for this turn only.
   */
  async continueNegotiation(
    id: string,
    options: { guidance?: string } = {},
    context?: RunContext,
  ): Promise<NegotiationTurn<A>> {
    const session = context?.negotiations.get(id) ?? this.sessions.get(id);
    if (!session) {
      throw new Error(`No open negotiation "${id}". Open one with negotiate_open first.`);
    }

    if (session.direction === "inbound") {
      throw new Error(
        `Negotiation "${session.id}" was opened by the counterparty. You answer their turns as they arrive; you cannot take one on your own initiative.`,
      );
    }

    // A settled exchange is finished. Taking another turn in it doesn't
    // reopen the question — it destroys the answer: the counterparty
    // replies, the Task falls back out of its terminal state, and the
    // agreement that was on the record is no longer there. If the terms
    // need to change, that is a new negotiation.
    const state = session.task?.status.state;
    if (state && isTerminalTaskState(state)) {
      throw new Error(
        `Negotiation "${session.id}" already ended (${state}). Taking another turn would erase what was settled — open a new negotiation if the terms need to change.`,
      );
    }

    // Parked on a question for the party. Taking a turn here anyway would
    // send without the answer it's waiting for; negotiate_resume is the
    // way back in, and keeps the answer for the rest of the negotiation.
    if (session.pending) {
      throw new Error(
        `Negotiation "${session.id}" is waiting on your party ("${session.pending.question}") — answer with negotiate_resume, which keeps the answer for the rest of the negotiation.`,
      );
    }

    return this.takeTurn(session, { guidance: options.guidance, signal: context?.signal }, context);
  }

  // --- outbound, run to an event ------------------------------------

  /**
   * Opens a negotiation and pumps it until something the agent loop needs
   * to hear: it settled, it needs the party, it ran out of turns, or it
   * failed. The turns in between never reach the loop. This is what the
   * `negotiate` tool runs, one per counterparty, concurrently.
   */
  async runNegotiation(
    url: string,
    options: OpenNegotiationOptions = {},
    context?: RunContext,
  ): Promise<NegotiationEvent<A>> {
    // Checked and registered before the first await, so two targets
    // naming the same counterparty in one batch can't both get past it.
    const rival = this.rival(url, context);
    if (rival) {
      return {
        kind: "skipped",
        id: rival.id,
        ...(rival.peer?.name ? { peer: rival.peer.name } : {}),
        url,
        reason: secondNegotiationRefusal(rival),
      };
    }

    const session = this.newSession(url, options.objective);
    context?.negotiations.set(session.id, session);

    if (options.discover !== false) {
      try {
        session.peer = await this.inspect(url, { signal: context?.signal });
      } catch (cause) {
        context?.negotiations.delete(session.id);
        return { kind: "failed", id: session.id, url, error: describe(cause), turns: 0 };
      }
    }

    return this.pump(session, context);
  }

  /**
   * Folds the party's answer into a parked negotiation and pumps it on.
   * Refusals are `skipped` events rather than throws, so a batch of
   * resumes reports every id.
   */
  async resumeNegotiation(
    id: string,
    guidance: string,
    context?: RunContext,
  ): Promise<NegotiationEvent<A>> {
    const session = context?.negotiations.get(id) ?? this.sessions.get(id);
    const skip = (reason: string): NegotiationEvent<A> => ({
      kind: "skipped",
      id,
      peer: session?.peer?.name,
      ...(session?.url ? { url: session.url } : {}),
      reason,
    });

    if (!session) return skip(`No negotiation "${id}".`);
    if (session.direction === "inbound") {
      return skip("They contacted you and hold the initiative — you cannot take a turn yourself. Use answerInbound to give your guidance for when they continue it.");
    }
    const state = session.task?.status.state;
    if (state && isTerminalTaskState(state)) {
      return skip(`already ended (${state}) — open a new negotiation if the terms need to change.`);
    }
    if (!session.pending) return skip("not waiting on you.");

    session.guidance = [...(session.guidance ?? []), guidance];
    delete session.pending;
    this.remember(session, context);
    return this.pump(session, context);
  }

  /**
   * Folds the party's answer into an inbound negotiation parked on `ask`.
   *
   * Unlike `resumeNegotiation`, this never takes a turn: the counterparty
   * holds the initiative on an inbound negotiation, so there is nothing to
   * pump here — the guidance just waits, folded into `objective` the next
   * time their message continues this task (see `handler()`).
   */
  answerInbound(id: string, guidance: string, context?: RunContext): NegotiationSession {
    const session = context?.negotiations.get(id) ?? this.sessions.get(id);
    if (!session) throw new Error(`No negotiation "${id}".`);
    if (session.direction !== "inbound") {
      throw new Error(
        `Negotiation "${id}" is one you opened yourself — answer it with negotiate_resume, not answerInbound.`,
      );
    }
    if (!session.pending) {
      throw new Error(`Negotiation "${id}" is not waiting on your party.`);
    }

    session.guidance = [...(session.guidance ?? []), guidance];
    delete session.pending;
    this.remember(session, context);
    return session;
  }

  /** Takes turns until an event. Turns are counted from the Task, so a
   * session resumed in another process picks up the right count. */
  private async pump(session: NegotiationSession, context?: RunContext): Promise<NegotiationEvent<A>> {
    const peer = session.peer?.name;
    const url = session.url;

    for (;;) {
      const turns = sentTurns(session);
      if (turns >= this.maxTurns) {
        return { kind: "budget", id: session.id, peer, url, last: lastPeerDecision(session), turns };
      }

      let turn: NegotiationTurn<A>;
      try {
        turn = await this.takeTurn(session, { signal: context?.signal, ask: true }, context);
      } catch (cause) {
        if (cause instanceof Escalation) {
          session.pending = { question: cause.decision.message };
          this.remember(session, context);
          return {
            kind: "asking",
            id: session.id,
            peer,
            url,
            question: cause.decision.message,
            last: lastPeerDecision(session),
            turns,
          };
        }
        // Failed before a Task ever existed — a provisional `local:`
        // session with nothing on the other side to resume. Left in
        // place it's a zombie: findable, but forever stuck on a URL that
        // just refused it.
        if (!session.task) {
          context?.negotiations.delete(session.id);
          this.sessions.delete?.(session.id);
        }
        return { kind: "failed", id: session.id, peer, url, error: describe(cause), turns };
      }

      if (turn.done || turn.settlement) {
        return {
          kind: "settled",
          id: session.id,
          peer,
          url,
          state: turn.state,
          ...(turn.settlement ? { settlement: turn.settlement } : {}),
          turns: sentTurns(session),
        };
      }
    }
  }

  /**
   * Decides and sends one turn, updating the session in place — and
   * re-keying it, in the store and in the run's view, once the
   * counterparty's Task gives it a real id.
   *
   * `ask` puts the ask action on the menu and intercepts it before the
   * wire: only the pump does that, because only the pump's caller has a
   * loop around it to answer the question.
   */
  private async takeTurn(
    session: NegotiationSession,
    options: { guidance?: string; signal?: AbortSignal; ask?: boolean },
    context?: RunContext,
  ): Promise<NegotiationTurn<A>> {
    let sent: NegotiationDecision<A> | undefined;

    // Standing guidance from the party holds for the rest of this
    // negotiation; per-turn guidance is for this turn only.
    const standing = brief(session.objective, session.guidance);

    // Under the pump, `ask` is on the menu — and taking it throws before
    // anything is sent, which is the whole point of offering it.
    const strategy: DecisionStrategy<A> = options.ask
      ? async (negotiator, state, actions, opts) => {
          const decision = await this.strategy(negotiator, state, actions, opts);
          if ((decision.action as string) === ASK_ACTION.action) throw new Escalation(decision);
          return decision;
        }
      : this.strategy;

    const client = new A2ANegotiationClient<A>({
      negotiator: this.negotiator,
      party: {
        name: this.identity.name,
        objective: options.guidance ? `${standing}\n\nFor this turn: ${options.guidance}` : standing,
      },
      allowedActions: options.ask
        ? [...this.allowedActions, ASK_ACTION as unknown as ActionSpec<A>]
        : this.allowedActions,
      strategy,
      evaluate: this.options.evaluate,
      credentials: this.options.credentials,
      // `onTurn` isn't fired here: a brand-new negotiation's session.id is
      // still the provisional key it was opened under, not the real Task
      // id below — tagging it now would leave this turn under a different
      // id than the peer's reply to it, in the same negotiation.
      onDecision: (decision) => {
        sent = decision;
      },
    });

    if (!session.url) {
      throw new Error(
        `Negotiation "${session.id}" was opened by the counterparty, so there is nowhere to call. They take the next turn by contacting this agent.`,
      );
    }

    // The signal covers the whole turn — this side's model call and the
    // wait on the counterparty — so an interrupted run stops the request in
    // flight instead of orphaning it.
    const { signal } = options;
    const before = session.id;
    const result = session.task
      ? await client.continue(session.url, session.task, { signal })
      : await client.initiate(session.url, { signal });

    session.task = result.task;
    session.id = result.task.id;

    // The Task's id is the real one now; drop the provisional key this
    // session was known under, so neither the store nor the run's view
    // carries both.
    if (before !== session.id) {
      this.sessions.delete?.(before);
      context?.negotiations.delete(before);
    }

    // Both turns of the round trip, now that `session.id` is the real Task
    // id and `session.peer` (if a card was fetched) names who this is.
    if (sent) {
      this.options.onTurn?.({ speaker: "self", decision: sent, id: session.id, peer: session.peer?.name }, "outbound");
    }

    const received = decode<A>(result.task.history.at(-1));
    if (received) {
      this.options.onTurn?.(
        { speaker: "peer", decision: received, id: session.id, peer: session.peer?.name },
        "outbound",
      );
    }

    // Who did what. Both halves can be true at once — this agent can accept
    // in the same round trip the counterparty rejects — so this records the
    // actions and leaves the verdict to `settlement` and the Task state.
    let endedBy: { speaker: Speaker; action: A } | undefined;
    if (this.isTerminal(result.decision.action)) {
      endedBy = { speaker: "self", action: result.decision.action };
    } else if (received && this.isTerminal(received.action)) {
      endedBy = { speaker: "peer", action: received.action };
    }

    this.remember(session, context);

    // Outbound: this agent spoke first and they replied.
    const settlement = this.settle(result.task, result.decision, received, true);
    if (settlement) {
      this.options.onSettled?.({ ...settlement, id: session.id, peer: session.peer?.name }, "outbound");
    }

    return {
      id: session.id,
      sent: sent ?? result.decision,
      received,
      state: result.task.status.state,
      // The Task is the counterparty's to own — A2A generates its id and
      // transitions its state on the server side — so whether this exchange
      // is over is read off the record, not asserted from this side's own
      // action. An accept the counterparty answered with a counter leaves
      // the Task open, whatever this agent meant by it.
      done: isTerminalTaskState(result.task.status.state),
      endedBy,
      ...(settlement ? { settlement } : {}),
      ...(result.artifact ? { artifact: result.artifact } : {}),
    };
  }

  /**
   * What the exchange actually settled on.
   *
   * The verdict comes from `verifyAgreement()` reading the shared Task, so
   * both parties compute it from the same input and reach the same answer —
   * no ordering rule for either side to get wrong. What this adds is the
   * one case the Task can't speak to (this agent closed and they replied
   * without closing) and a prose fallback for counterparties that send no
   * structured terms, labelled as the weak evidence it is.
   */
  private settle(
    task: A2ATask,
    mine: NegotiationDecision<A>,
    theirs: NegotiationDecision<A> | null,
    mineFirst: boolean,
  ): Settlement<A> | undefined {
    const closes = (decision: NegotiationDecision<A> | null): boolean =>
      Boolean(decision && this.isTerminal(decision.action));

    const agreement = verifyAgreement(task);

    const settlement = (
      outcome: SettlementOutcome,
      basis: AgreementBasis,
      reason: string,
    ): Settlement<A> => ({ outcome, basis, mine, theirs, reason });

    // Still open. Either nobody has closed — nothing to settle — or this
    // agent closed and the counterparty carried on talking.
    if (agreement.status === "open") {
      if (!closes(mine) && !closes(theirs)) return undefined;

      const closerIsMe = mineFirst;
      return settlement(
        "unanswered",
        "state",
        theirs
          ? closerIsMe
            ? `You closed with "${mine.action}", but they replied with "${theirs.action}" rather than closing too. Nothing is agreed until they do.`
            : `They closed with "${theirs.action}", but you replied with "${mine.action}" rather than closing too. Nothing is agreed until you do.`
          : `You closed with "${mine.action}", but they sent no readable reply. Nothing is agreed.`,
      );
    }

    // It ended, but the decisions carried no structured terms. The Task
    // can't say what was agreed, so fall back to reading the two closing
    // statements — and say that's what happened.
    if (agreement.status === "unconfirmed") {
      const ours = amountsIn(mine.message);
      const yours = amountsIn(theirs?.message ?? "");
      const overlap = ours.filter((amount) => yours.includes(amount));

      if (ours.length && yours.length && !overlap.length) {
        return {
          ...settlement(
            "conflict",
            "prose",
            `You closed on ${ours.join("/")} and they closed on ${yours.join("/")}. Both of you said yes, to different numbers — this is not an agreement. Reopen it and settle on one.`,
          ),
          disputed: { mine: ours, theirs: yours },
        };
      }

      return settlement(
        "unconfirmed",
        agreement.basis,
        agreement.reason ??
          "It ended, but neither side put structured terms on the table, so nothing here says what was agreed.",
      );
    }

    return {
      ...settlement(
        agreement.status,
        agreement.basis,
        agreement.reason ??
          (agreement.status === "agreed"
            ? "Both sides closed on the same terms."
            : `The exchange ended: ${agreement.status}.`),
      ),
      ...(agreement.terms ? { terms: agreement.terms } : {}),
    };
  }

  /**
   * Runs a negotiation to a conclusion in one call, by taking turns until
   * one side ends it or `maxTurns` is spent. A convenience for hosts that
   * want a negotiation without an agent loop around it — and so it never
   * offers `ask`: there is nobody on the other end of the loop to answer.
   */
  async negotiate(url: string, options: NegotiateOptions = {}): Promise<Negotiation<A>> {
    const maxTurns = options.maxTurns ?? this.maxTurns;
    const transcript: AgentTurn<A>[] = [];
    const artifacts: A2AArtifact[] = [];

    const negotiations = new Map<string, NegotiationSession>();
    const context = { negotiations, signal: options.signal };
    let turn = await this.openNegotiation(url, options, context);
    let turns = 1;

    const collect = (result: NegotiationTurn<A>) => {
      const peer = negotiations.get(result.id)?.peer?.name;
      transcript.push({ speaker: "self", decision: result.sent, id: result.id, peer });
      if (result.received) transcript.push({ speaker: "peer", decision: result.received, id: result.id, peer });
      if (result.artifact) artifacts.push(result.artifact);
    };
    collect(turn);

    // Stops on the record, and on a verdict: an agent that has taken a
    // terminal action shouldn't carry on bargaining just because the
    // counterparty's reply left the Task open.
    while (!turn.done && !turn.settlement && turns < maxTurns) {
      turn = await this.continueNegotiation(turn.id, {}, context);
      collect(turn);
      turns++;
    }

    const session = negotiations.get(turn.id);
    if (!session?.task) throw new Error("negotiate(): the negotiation was never opened.");

    return {
      peer: session.peer,
      task: session.task,
      state: turn.state,
      end: turn.done ? "terminal" : turns >= maxTurns ? "max-turns" : "open",
      endedBy: turn.endedBy,
      ...(turn.settlement ? { settlement: turn.settlement } : {}),
      transcript,
      artifacts,
    };
  }

  /** The standing instructions plus intent, narrowed to one negotiation.
   * `Negotiator` wraps whatever this returns in its own framing. */
  private objectiveFor(objective?: string): string {
    const parts = [this.systemPrompt];
    if (this.intent) parts.push(`Current intent: ${this.intent.statement}`);
    if (objective) parts.push(`In this negotiation: ${objective}`);
    return parts.join("\n\n");
  }
}

/** Reads a JSON body off a clone, or null if it isn't JSON. Never throws:
 * this runs only to report a turn. */
async function peek<T>(source: Request | Response): Promise<T | null> {
  try {
    return (await source.clone().json()) as T;
  } catch {
    return null;
  }
}
