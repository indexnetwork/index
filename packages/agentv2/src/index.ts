// A personal agent in two runtimes. `wake` decides; `negotiate` acts on one
// opportunity from its brief alone and can never wake its principal's agent.
// Both are stateless and know nothing of Index: the caller passes the snapshot
// in and persists what comes back.
export { wake } from "./wake.ts";
export { negotiate } from "./negotiate.ts";

export { ModelClient } from "./model.ts";
export type { Model, ModelClientOptions, ModelMessage, ToolDefinition } from "./model.ts";

export type {
  ConversationEntry,
  Counterparty,
  CounterpartyPick,
  Decision,
  Intent,
  NegotiateInput,
  NegotiateResult,
  NegotiationAction,
  Opportunity,
  Stall,
  Turn,
  User,
  WakeAction,
  WakeInput,
  WakeResult,
} from "./types.ts";
