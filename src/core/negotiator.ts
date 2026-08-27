import { OpenRouterClient, type OpenRouterMessage } from "./openrouter-client.ts";
import type { NegotiationDecision, NegotiationState } from "./types.ts";

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
}

function actionName<A extends string>(spec: ActionSpec<A>): A {
  return typeof spec === "string" ? spec : spec.action;
}

const DEFAULT_MODEL = "openai/gpt-4o-mini";

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
): string {
  const { party } = state;
  return `You are negotiating on behalf of "${party.name}".
Objective: ${party.objective}
Decide how to respond to the other party, and choose exactly one action from: ${allowedActions.map(describeAction).join(", ")}.
Respond with ONLY a JSON object of the form {"action": "<one of the allowed actions>", "message": "<the message you'd send to the other party>"}.
The message is the only thing the other party will see — do not include your private reasoning in it.`;
}

function buildHistoryMessages(state: NegotiationState): OpenRouterMessage[] {
  return state.history.map((message) => ({
    role: message.role === "incoming" ? "user" : "assistant",
    content: message.content,
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
      { role: "system", content: buildDecisionSystemPrompt(state, options.allowedActions) },
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

    return { action: action as A, message };
  }
}
