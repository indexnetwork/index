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
}

export type ActionSpec<A extends string> = A | { action: A; description: string };

export interface DecideOptions<A extends string> {
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

function buildSystemPrompt(state: NegotiationState): string {
  const { party } = state;
  return `You are negotiating on behalf of "${party.name}".\nObjective: ${party.objective}\nRespond with the next message you'd send to the other party.`;
}

function describeAction<A extends string>(spec: ActionSpec<A>): string {
  return typeof spec === "string" ? spec : `${spec.action} (${spec.description})`;
}

function buildDecisionSystemPrompt<A extends string>(
  state: NegotiationState,
  allowedActions: ActionSpec<A>[],
  terms: string | undefined,
): string {
  const { party } = state;
  const base = `You are negotiating on behalf of "${party.name}".
Objective: ${party.objective}
Decide how to respond to the other party, and choose exactly one action from: ${allowedActions.map(describeAction).join(", ")}.`;

  if (!terms) {
    return `${base}
Respond with ONLY a JSON object of the form {"action": "<one of the allowed actions>", "message": "<the message you'd send to the other party>"}.
The message is the only thing the other party will see — do not include your private reasoning in it.`;
  }

  return `${base}
Respond with ONLY a JSON object of the form {"action": "<one of the allowed actions>", "message": "<the message you'd send to the other party>", "terms": {...}, "acceptsOfferId": "<id>"}.
"terms" must describe the concrete offer your message puts on the table, with these fields: ${terms}. Include it whenever you are proposing, countering, or accepting; omit it only when your action puts no offer on the table.
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

  constructor(options: NegotiatorOptions = {}) {
    this.client = new OpenRouterClient({
      apiKey: options.apiKey,
      model: options.model ?? DEFAULT_MODEL,
      referer: options.referer,
      title: options.title,
    });
  }

  async respond(state: NegotiationState): Promise<string> {
    const messages: OpenRouterMessage[] = [
      { role: "system", content: buildSystemPrompt(state) },
      ...buildHistoryMessages(state),
    ];

    return this.client.complete(messages);
  }

  async decide<A extends string>(
    state: NegotiationState,
    options: DecideOptions<A>,
  ): Promise<NegotiationDecision<A>> {
    const messages: OpenRouterMessage[] = [
      {
        role: "system",
        content: buildDecisionSystemPrompt(state, options.allowedActions, options.terms),
      },
      ...buildHistoryMessages(state),
    ];

    const raw = await this.client.complete(messages, { jsonResponse: true });

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
