import { runLoop } from "./loop.ts";
import { MemoryMessageStore } from "./sessions.ts";
import { ModelClient, type ModelMessage } from "./model.ts";
import { defaultTools, type Tool } from "./tools.ts";
import type { AgentIdentity, Intent, MessageStore, RunResult, Step } from "./types.ts";

const DEFAULT_MAX_STEPS = 10;

function formatDate(now: Date): string {
  return now.toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export interface AgentOptions {
  /** Who this agent acts for. Constant across every intent scope. */
  identity: AgentIdentity;
  /** The standing instructions this agent runs under, supplied by whatever
   * is hosting it. Used verbatim as the system message of the agent loop. */
  systemPrompt: string;
  /** What the agent is working on. Usually set with `for()` rather than
   * here; an agent without one is the unscoped agent. */
  intent?: Intent;

  /**
   * Tools the loop may call. Defaults to `ask_user`. Index Network
   * operations belong here, injected by the host — this package
   * deliberately knows nothing about how Index is reached. Passing your
   * own array replaces the defaults entirely, so spread `defaultTools()`
   * if you want to keep them.
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
   * The current time, for resolving what "next Tuesday" means. Defaults
   * to the host's clock.
   *
   * Read as UTC. A host whose party lives elsewhere passes an instant
   * shifted into that timezone; a test passes a fixed one.
   */
  now?: () => Date;

  /**
   * Where this agent's conversation with its party is recorded.
   *
   * The agent holds no state of its own; this is the host's, and defaults
   * to an in-memory store. Swap it for something shared and an agent picks
   * a suspended conversation back up after a restart, or from another
   * process, without the host having to thread `messages` through every
   * `run()` call itself.
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
  /** Fires as each step completes. */
  onStep?: (step: Step) => void;
  signal?: AbortSignal;
}

/**
 * A personal agent a host runs on someone's behalf: one identity, a system
 * prompt the host supplies, the tools the host injects, and a loop that
 * runs until the work is done or the party it represents has to answer
 * something.
 */
export class Agent {
  readonly identity: AgentIdentity;
  readonly systemPrompt: string;
  readonly intent?: Intent;
  readonly tools: Tool<never>[];

  private readonly model: ModelClient;
  private readonly maxSteps: number;
  /** This agent's conversation with its party. */
  private readonly history: MessageStore;

  constructor(private readonly options: AgentOptions) {
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
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.history = options.history ?? new MemoryMessageStore();
  }

  // --- intent scoping ------------------------------------------------

  /**
   * The same agent, narrowed to one intent.
   *
   * This is a lens, not a new agent: the identity object is shared, so
   * anything the scoped agent says is said by the same party. All that
   * changes is context — the intent is stated to the model.
   */
  for(intent: Intent | string): Agent {
    return new Agent({
      ...this.options,
      identity: this.identity,
      // Shared, not copied — an intent scopes what the agent is working
      // on, not what it has already said.
      history: this.history,
      intent: typeof intent === "string" ? { statement: intent } : intent,
    });
  }

  /** The system message the loop actually runs under: the host's standing
   * instructions, plus who this agent is, plus the current intent. */
  instructions(): string {
    const parts = [
      this.systemPrompt,
      `You are ${this.identity.name}, acting on behalf of ${this.identity.id}.`,
      // Without this the agent has no clock, and "next Tuesday" can only
      // be repeated, never resolved.
      `Today is ${formatDate((this.options.now ?? (() => new Date()))())}. When you agree a date, record the actual date rather than a relative one like "next Tuesday", so the terms still mean the same thing when someone reads them later.`,
      "Only call a tool from the list you were actually given this turn — what's offered can change as your situation does, so a capability you used before, or one that would make sense here, may not be available right now. If what you need isn't in that list, say so or ask, rather than calling a name you expect to exist.",
    ];
    if (this.intent) {
      parts.push(
        `Current intent: ${this.intent.statement}\nEverything you do in this session serves that intent. If something falls outside it, say so rather than acting.`,
      );
    }
    return parts.join("\n\n");
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
    // A host can pass `messages` message-style, lean on a shared `history`
    // store, or both — whichever arrived travels into this run.
    const messages = options.messages ?? this.history.list();

    const result = await runLoop({
      model: this.model,
      systemPrompt: this.instructions(),
      tools: this.tools,
      messages,
      input,
      maxSteps: options.maxSteps ?? this.maxSteps,
      context: { agent: this, signal: options.signal },
      onStep: options.onStep,
      signal: options.signal,
    });

    this.history.save(result.messages);
    return result;
  }
}
