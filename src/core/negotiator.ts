import type { DeadlineOptions } from "./deadline.ts";
import { OpenRouterClient, type OpenRouterMessage } from "./openrouter-client.ts";
import type {
  NegotiationDecision,
  NegotiationMessage,
  NegotiationState,
  NegotiationTerms,
} from "./types.ts";

export interface NegotiatorOptions {
  apiKey?: string;
  model?: string;
  referer?: string;
  title?: string;
  /** Caps output tokens per call. Defaults to 2048 — raise it if decisions
   * carry large structured terms and you hit truncation errors. */
  maxTokens?: number;
  /** Bounds how long one model call may take, in milliseconds. Defaults to
   * 120s; `0` disables it. Per-call `signal`s on `respond()`/`decide()`
   * stack on top of this. */
  timeoutMs?: number;
  /**
   * Supplies the current date, told to the model on every turn. Defaults to
   * `() => new Date()`, read per call so a long-running server doesn't
   * freeze on the date it booted. Inject a fixed clock to make prompts
   * deterministic in tests.
   *
   * The date is rendered in UTC, so it can differ by a day from a party's
   * wall clock. This is also the only timezone control there is, and it
   * works because it returns an *instant* rather than a date: shift the
   * instant to put the model on your party's day.
   *
   *     now: () => new Date(Date.now() - 8 * 60 * 60 * 1000) // UTC-8
   *
   * If your own code also tells a model today's date — a surrounding agent
   * loop with its own system message, say — pass it the same `now`. Two
   * clocks defaulting to `new Date()` agree almost always and disagree
   * across midnight, which is a bug that hides for months.
   */
  now?: () => Date;
}

export type ActionSpec<A extends string> = A | { action: A; description: string };

export interface DecideOptions<A extends string> extends DeadlineOptions {
  /**
   * Actions this turn may end in (e.g. from the caller's protocol/seat rules).
   * Pass `{ action, description }` for action names whose meaning isn't
   * self-evident, so the model knows what choosing them actually does.
   */
  allowedActions: ActionSpec<A>[];
  /**
   * Describes the structured terms a decision should carry alongside its
   * message — e.g. `"amount (number, USD), pickupDay (ISO date)"`. When set,
   * the model is asked to emit a `terms` object with those fields, and to
   * name the `offerId` it's accepting when it takes an accepting action.
   * Leave unset to keep decisions prose-only.
   */
  terms?: string;
}

function actionName<A extends string>(spec: ActionSpec<A>): A {
  return typeof spec === "string" ? spec : spec.action;
}

const DEFAULT_MODEL = "google/gemini-3.7-flash";

/** Renders the date for the prompt, with the weekday — resolving "next
 * Tuesday" needs to know what day today is, not just the date. UTC for both
 * halves so they can never disagree with each other. */
function formatToday(now: Date): string {
  const date = now.toISOString().slice(0, 10);
  const weekday = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return `${date} (${weekday})`;
}

function buildSystemPrompt(state: NegotiationState, today: string): string {
  const { party } = state;
  return `You are negotiating on behalf of "${party.name}".\nObjective: ${party.objective}\nToday's date is ${today}.\nRespond with the next message you'd send to the other party.`;
}

function describeAction<A extends string>(spec: ActionSpec<A>): string {
  return typeof spec === "string" ? spec : `${spec.action} (${spec.description})`;
}

function buildDecisionSystemPrompt<A extends string>(
  state: NegotiationState,
  allowedActions: ActionSpec<A>[],
  terms: string | undefined,
  today: string,
): string {
  const { party } = state;
  const base = `You are negotiating on behalf of "${party.name}".
Objective: ${party.objective}
Today's date is ${today}.
Decide how to respond to the other party, and choose exactly one action from: ${allowedActions.map(describeAction).join(", ")}.`;

  if (!terms) {
    return `${base}
Respond with ONLY a JSON object of the form {"action": "<one of the allowed actions>", "message": "<the message you'd send to the other party>"}.
The message is the only thing the other party will see — do not include your private reasoning in it.`;
  }

  return `${base}
Respond with ONLY a JSON object of the form {"action": "<one of the allowed actions>", "message": "<the message you'd send to the other party>", "terms": {...}, "acceptsOfferId": "<id>"}.
"terms" must describe the concrete offer your message puts on the table, with these fields: ${terms}. Include it whenever you are proposing, countering, or accepting; omit it only when your action puts no offer on the table.
Express every date or deadline in "terms" as an absolute calendar date (YYYY-MM-DD), never a relative one like "next Tuesday" or "the end of the month". The other party reads your terms at a different moment than you wrote them, and the terms have to stay readable after the negotiation is over.
"acceptsOfferId" is required when your action accepts the other party's offer: set it to the offer id shown in brackets on the message you are accepting, and set "terms" to that same offer's terms. Never accept terms different from the offer you name — counter instead.
The message is the only thing the other party will see — do not include your private reasoning in it.`;
}

/** Renders a history entry for the model, appending its offer id and terms
 * so an accepting turn has something concrete to name. */
function historyContent(message: NegotiationMessage): string {
  if (!message.offerId && !message.terms) return message.content;
  const parts = [message.content];
  if (message.terms) {
    parts.push(`[offer ${message.offerId ?? "unidentified"}: ${JSON.stringify(message.terms)}]`);
  } else {
    parts.push(`[offer ${message.offerId}]`);
  }
  return parts.join("\n");
}

function buildHistoryMessages(state: NegotiationState): OpenRouterMessage[] {
  return state.history.map((message) => ({
    role: message.role === "incoming" ? "user" : "assistant",
    content: historyContent(message),
  }));
}

export class Negotiator {
  private readonly client: OpenRouterClient;
  private readonly now: () => Date;

  constructor(options: NegotiatorOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.client = new OpenRouterClient({
      apiKey: options.apiKey,
      model: options.model ?? DEFAULT_MODEL,
      referer: options.referer,
      title: options.title,
      maxTokens: options.maxTokens,
      timeoutMs: options.timeoutMs,
    });
  }

  async respond(state: NegotiationState, options: DeadlineOptions = {}): Promise<string> {
    const messages: OpenRouterMessage[] = [
      { role: "system", content: buildSystemPrompt(state, formatToday(this.now())) },
      ...buildHistoryMessages(state),
    ];

    return this.client.complete(messages, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  async decide<A extends string>(
    state: NegotiationState,
    options: DecideOptions<A>,
  ): Promise<NegotiationDecision<A>> {
    const messages: OpenRouterMessage[] = [
      {
        role: "system",
        content: buildDecisionSystemPrompt(
          state,
          options.allowedActions,
          options.terms,
          formatToday(this.now()),
        ),
      },
      ...buildHistoryMessages(state),
    ];

    const raw = await this.client.complete(messages, {
      jsonResponse: true,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Negotiator.decide(): model did not return valid JSON: ${raw}`);
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).action !== "string" ||
      typeof (parsed as Record<string, unknown>).message !== "string"
    ) {
      throw new Error(`Negotiator.decide(): malformed decision: ${raw}`);
    }

    const { action, message } = parsed as { action: string; message: string };
    const allowedNames = options.allowedActions.map(actionName);
    if (!(allowedNames as string[]).includes(action)) {
      throw new Error(
        `Negotiator.decide(): model chose disallowed action "${action}" (allowed: ${allowedNames.join(", ")})`,
      );
    }

    const decision: NegotiationDecision<A> = { action: action as A, message };

    const { terms, acceptsOfferId } = parsed as {
      terms?: unknown;
      acceptsOfferId?: unknown;
    };
    if (terms !== undefined && terms !== null) {
      if (typeof terms !== "object" || Array.isArray(terms)) {
        throw new Error(`Negotiator.decide(): "terms" must be a JSON object, got: ${raw}`);
      }
      decision.terms = terms as NegotiationTerms;
      // The library owns offer identity — the model only ever references
      // ids it was shown, it never mints them.
      decision.offerId = crypto.randomUUID();
    }
    if (typeof acceptsOfferId === "string" && acceptsOfferId) {
      decision.acceptsOfferId = acceptsOfferId;
    }

    return decision;
  }
}
