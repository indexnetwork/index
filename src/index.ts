// Public API: one negotiator, one side of a conversation. The other party
// is a separate personal agent this package does not run or own — callers
// (e.g. Index Network) drive the conversation and call `respond()` per turn.
export { Negotiator } from "./negotiator.ts";
export { OpenRouterClient } from "./openrouter-client.ts";
export type { ActionSpec, DecideOptions, NegotiatorOptions } from "./negotiator.ts";
export type { OpenRouterClientOptions, OpenRouterMessage } from "./openrouter-client.ts";
export type {
  MessageRole,
  NegotiationDecision,
  NegotiationMessage,
  NegotiationParty,
  NegotiationState,
} from "./types.ts";
