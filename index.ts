// Public API: one negotiator, one side of a conversation. The other party
// is a separate personal agent this package does not run or own — callers
// (e.g. Index Network) drive the conversation and call `respond()` per turn.
export { Negotiator, type NegotiatorOptions } from "./src/negotiator.ts";
export { OpenRouterClient, type OpenRouterClientOptions, type OpenRouterMessage } from "./src/openrouter-client.ts";
export type {
  MessageRole,
  NegotiationMessage,
  NegotiationParty,
  NegotiationState,
} from "./src/types.ts";
