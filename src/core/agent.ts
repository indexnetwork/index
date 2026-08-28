import {
  Negotiator,
  type ActionSpec,
  type NegotiationDecision,
} from "@indexnetwork/negotiator";
import {
  A2ANegotiationClient,
  createA2AHandler,
  fetchAgentCard,
  defaultStrategy,
  isTerminalTaskState,
  messageToDecision,
  strategyWithTerms,
  verifyAgreement,
  type A2AArtifact,
  type A2ACredentials,
  type A2AIdentity,
  type A2AMessage,
  type A2ATask,
  type A2ATaskState,
  type AgreementBasis,
  type DeadlineOptions,
  type AgentCardSkill,
  type DecisionStrategy,
  type EvaluateHook,
  type TaskStore,
} from "@indexnetwork/negotiator/a2a";

import { runLoop } from "./loop.ts";
import { MemoryNegotiationStore } from "./sessions.ts";
import { ModelClient, type ModelMessage } from "./model.ts";
import { defaultTools, type Tool, type ToolContext } from "./tools.ts";
import type {
  AgentIdentity,
  AgentTurn,
  Direction,
  IdentifiedAgentCard,
  Intent,
  Negotiation,
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
 * What terms to ask for when the host hasn't said. Deliberately generic:
 * one agent serves arbitrary intents, so the fields aren't known until the
 * negotiation exists. Naming them (`terms` on `AgentOptions`) is better
 * where the domain is known.
 */
const DEFAULT_TERMS =
  "the material terms of this deal as flat key/value pairs, using the plainest field name for each (amount, currency, date, quantity, location) — only what has actually been discussed, and the same field names the other side used. Write dates as YYYY-MM-DD rather than relative ones, and always name the currency alongside an amount";

/** "Friday, 28 August 2026" — a weekday included, since half of what gets
 * negotiated is stated as one. */
function formatDate(now: Date): string {
  return now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Mirrors the A2A handler's own mapping, so both halves agree on which
 * terminal action means a deal rather than a refusal. */
function defaultTerminalState(action: string): "completed" | "rejected" | "canceled" {
  if (action === "accept") return "completed";
  if (action === "withdraw") return "canceled";
  return "rejected";
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
  /** Sent as `HTTP-Referer`, per OpenRouter's app attribution. */
  referer?: string;
  /** Sent as `X-Title`, per OpenRouter's app attribution. */
  title?: string;
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
   * Tuesday". Defaults to the host's clock; pass one to fix it for tests,
   * or to run an agent in its party's timezone rather than the server's.
   */
  now?: () => Date;

  /** The negotiation engine. Defaults to a `Negotiator` built from `model`
   * and `apiKey`. */
  negotiator?: Negotiator;
  /** Defaults to `DEFAULT_ACTIONS` (propose/counter/accept/reject). */
  allowedActions?: ActionSpec<A>[];
  /** Turn cap for `negotiate()`. Defaults to 10. */
  maxTurns?: number;
  /** How long one negotiation turn may wait on the counterparty, in ms.
   * Defaults to the negotiator's 180s; `0` disables it and leaves a
   * `signal` as the only stop. */
  turnTimeout?: number;
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
  /** Replaces the per-turn `negotiator.decide()` call. */
  strategy?: DecisionStrategy<A>;
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
}

export interface RunOptions {
  maxSteps?: number;
  /** The conversation so far — pass `messages` from a previous result to
   * continue it, including resuming a run that stopped on a question. */
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
  /** How each turn is decided. Defaults to asking for structured terms, so
   * an agreement can be verified rather than read. */
  private readonly strategy: DecisionStrategy<A>;
  /** What this agent has negotiated, in either direction. */
  private readonly sessions: NegotiationStore;

  constructor(private readonly options: AgentOptions<A>) {
    this.identity = options.identity;
    this.systemPrompt = options.systemPrompt;
    this.intent = options.intent;
    this.tools = options.tools ?? defaultTools();

    this.model = new ModelClient({
      apiKey: options.apiKey,
      model: options.model,
      referer: options.referer,
      title: options.title,
      timeout: options.timeout,
      attempts: options.attempts,
      onRetry: options.onRetry,
    });
    this.negotiator =
      options.negotiator ?? new Negotiator({ apiKey: options.apiKey, model: options.model });

    this.allowedActions =
      options.allowedActions ?? ([...DEFAULT_ACTIONS] as unknown as ActionSpec<A>[]);
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    this.isTerminal = options.isTerminal ?? ((action: A) => DEFAULT_TERMINAL.has(action));
    this.sessions = options.sessions ?? new MemoryNegotiationStore();

    // An explicit strategy wins. Otherwise terms are on unless the host
    // turned them off with `terms: ""` — a decision that carries no terms
    // can only ever settle as `unconfirmed`.
    const terms = options.terms ?? DEFAULT_TERMS;
    this.strategy =
      options.strategy ??
      (terms ? strategyWithTerms<A>(terms) : (defaultStrategy as unknown as DecisionStrategy<A>));
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
      // on, not what it remembers negotiating.
      sessions: this.sessions,
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

    const lines = sessions.slice(-RECORDED_NEGOTIATIONS).map((session) => {
      const who = session.direction === "outbound" ? "you contacted them" : "they contacted you";
      const peer = session.peer?.name ? ` with ${session.peer.name}` : "";
      const agreement = verifyAgreement(session.task);
      const terms = agreement.terms ? `: ${JSON.stringify(agreement.terms)}` : "";
      const detail =
        agreement.status === "open"
          ? `still open, ${session.task.history.length} turns so far`
          : `${agreement.status}${terms}`;

      return `- ${session.id}${peer} — ${who}; ${detail}`;
    });

    return [
      "Negotiations you are party to. This is the record of what happened, which is not the same as what you remember saying — trust it over the conversation above:",
      ...lines,
      "Only negotiations you opened can be continued with negotiate_turn; in the others the counterparty calls you.",
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

    return runLoop({
      model: this.model,
      systemPrompt: this.instructions([...negotiations.values()]),
      tools: this.tools,
      messages: options.messages ?? [],
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
      if (tool.suspends || tool.name.startsWith("negotiate_")) continue;
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
    const inner = createA2AHandler<A>({
      negotiator: this.negotiator,
      party: { name: this.identity.name, objective: this.objectiveFor() },
      allowedActions: this.allowedActions,
      agentCard: this.card(),
      taskStore: this.options.taskStore,
      isTerminal: this.isTerminal,
      terminalState: this.options.terminalState,
      strategy: this.strategy,
      evaluate: this.options.evaluate,
      authenticate: this.options.authenticate,
    });

    const { onTurn, onSettled } = this.options;

    // Report both turns of the round trip, in order. The counterparty's has
    // to be decoded from the request before the handler runs, and this
    // agent's from the Task the handler returns; the clones leave both
    // bodies intact, and anything that won't parse is left for the handler
    // to reject exactly as it otherwise would.
    return async (request: Request): Promise<Response> => {
      if (request.method !== "POST") return inner(request);

      const body = await peek<{ params?: { message?: A2AMessage } }>(request);
      const incoming = body?.params?.message ? messageToDecision(body.params.message) : null;
      if (incoming) {
        onTurn?.({ speaker: "peer", decision: incoming as NegotiationDecision<A> }, "inbound");
      }

      const response = await inner(request);

      const answered = await peek<{ result?: A2ATask }>(response);
      const task = answered?.result;

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
          peer: null,
          task,
        });
      }

      const reply = task?.history.at(-1);
      const decision = reply ? messageToDecision(reply) : null;
      if (decision && task) {
        onTurn?.({ speaker: "self", decision: decision as NegotiationDecision<A> }, "inbound");

        // Read off the same Task the initiator reads, so a conflict is
        // visible from both ends rather than only the side that dialed.
        // Inbound: they spoke first and this agent replied.
        const settlement = this.settle(
          task,
          decision as NegotiationDecision<A>,
          incoming as NegotiationDecision<A> | null,
          false,
        );
        if (settlement) onSettled?.(settlement, "inbound");
      }

      return response;
    };
  }

  // --- outbound, one turn at a time ----------------------------------

  /**
   * Opens a negotiation and takes the first turn. The session is recorded
   * on `context.negotiations` so `continueNegotiation()` can pick it up,
   * and travels out on `RunResult.negotiations` so a later run — in
   * another process — can too.
   */
  async openNegotiation(
    url: string,
    options: OpenNegotiationOptions = {},
    context?: Pick<ToolContext, "negotiations" | "signal">,
  ): Promise<NegotiationTurn<A>> {
    const signal = context?.signal;
    const peer = options.discover === false ? null : await this.inspect(url, { signal });
    const objective = this.objectiveFor(options.objective);

    const session: NegotiationSession = {
      id: "",
      direction: "outbound",
      url,
      objective,
      peer,
      task: undefined as unknown as A2ATask,
    };

    const turn = await this.takeTurn(session, undefined, signal);
    context?.negotiations.set(session.id, session);
    return turn;
  }

  /**
   * Takes one more turn in a negotiation already opened. `guidance` folds
   * in anything learned since the last turn — an answer from the party this
   * agent acts for, a limit, a change of position — for this turn only.
   */
  async continueNegotiation(
    session: NegotiationSession | string,
    options: { guidance?: string } = {},
    context?: Pick<ToolContext, "negotiations" | "signal">,
  ): Promise<NegotiationTurn<A>> {
    const resolved =
      typeof session === "string"
        ? (context?.negotiations.get(session) ?? this.sessions.get(session))
        : session;

    if (!resolved) {
      throw new Error(
        `No open negotiation "${String(session)}". Open one with negotiate_open first.`,
      );
    }

    if (resolved.direction === "inbound") {
      throw new Error(
        `Negotiation "${resolved.id}" was opened by the counterparty. You answer their turns as they arrive; you cannot take one on your own initiative.`,
      );
    }

    // A settled exchange is finished. Taking another turn in it doesn't
    // reopen the question — it destroys the answer: the counterparty
    // replies, the Task falls back out of its terminal state, and the
    // agreement that was on the record is no longer there. If the terms
    // need to change, that is a new negotiation.
    const state = resolved.task?.status.state;
    if (state && isTerminalTaskState(state)) {
      throw new Error(
        `Negotiation "${resolved.id}" already ended (${state}). Taking another turn would erase what was settled — open a new negotiation if the terms need to change.`,
      );
    }

    const turn = await this.takeTurn(resolved, options.guidance, context?.signal);
    context?.negotiations.set(resolved.id, resolved);
    return turn;
  }

  /** Decides and sends one turn, updating the session in place. */
  private async takeTurn(
    session: NegotiationSession,
    guidance?: string,
    signal?: AbortSignal,
  ): Promise<NegotiationTurn<A>> {
    let sent: NegotiationDecision<A> | undefined;

    const client = new A2ANegotiationClient<A>({
      negotiator: this.negotiator,
      party: {
        name: this.identity.name,
        objective: guidance ? `${session.objective}\n\nFor this turn: ${guidance}` : session.objective,
      },
      allowedActions: this.allowedActions,
      strategy: this.strategy,
      evaluate: this.options.evaluate,
      credentials: this.options.credentials,
      timeoutMs: this.options.turnTimeout,
      onDecision: (decision) => {
        sent = decision;
        this.options.onTurn?.({ speaker: "self", decision }, "outbound");
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
    const result = session.task
      ? await client.continue(session.url, session.task, { signal })
      : await client.initiate(session.url, { signal });

    session.task = result.task;
    session.id = result.task.id;

    const reply = result.task.history.at(-1);
    const received = reply ? (messageToDecision(reply) as NegotiationDecision<A> | null) : null;
    if (received) this.options.onTurn?.({ speaker: "peer", decision: received }, "outbound");

    // Who did what. Both halves can be true at once — this agent can accept
    // in the same round trip the counterparty rejects — so this records the
    // actions and leaves the verdict to `settlement` and the Task state.
    let endedBy: { speaker: Speaker; action: A } | undefined;
    if (this.isTerminal(result.decision.action)) {
      endedBy = { speaker: "self", action: result.decision.action };
    } else if (received && this.isTerminal(received.action)) {
      endedBy = { speaker: "peer", action: received.action };
    }

    // Outbound: this agent spoke first and they replied.
    this.sessions.save(session);

    const settlement = this.settle(result.task, result.decision, received, true);
    if (settlement) this.options.onSettled?.(settlement, "outbound");

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
   * want a negotiation without an agent loop around it — the loop uses the
   * turn-level methods instead, so that it can stop in between.
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
      transcript.push({ speaker: "self", decision: result.sent });
      if (result.received) transcript.push({ speaker: "peer", decision: result.received });
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
    if (!session) throw new Error("negotiate(): the negotiation was never opened.");

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
