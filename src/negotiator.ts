import { OpenRouterClient, type OpenRouterMessage } from "./openrouter-client.ts";
import type { NegotiationState } from "./types.ts";

export interface NegotiatorOptions {
  apiKey?: string;
  model?: string;
  referer?: string;
  title?: string;
}

const DEFAULT_MODEL = "openai/gpt-4o-mini";

function buildSystemPrompt(state: NegotiationState): string {
  const { party } = state;
  return `You are negotiating on behalf of "${party.name}".\nObjective: ${party.objective}\nRespond with the next message you'd send to the other party.`;
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
}
