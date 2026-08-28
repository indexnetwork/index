// Public API: one negotiator, one side of a conversation. The other party
// is a separate personal agent this package does not run or own — callers
// (e.g. Index Network) drive the conversation and call `respond()` per turn.
export { Negotiator } from "./core/negotiator.ts";
export { OpenRouterClient } from "./core/openrouter-client.ts";
export type { ActionSpec, DecideOptions, NegotiatorOptions } from "./core/negotiator.ts";
export type { DeadlineOptions } from "./core/deadline.ts";
export type { OpenRouterClientOptions, OpenRouterMessage } from "./core/openrouter-client.ts";
export type {
  MessageRole,
  NegotiationDecision,
  NegotiationMessage,
  NegotiationParty,
  NegotiationState,
  NegotiationTerms,
} from "./core/types.ts";
