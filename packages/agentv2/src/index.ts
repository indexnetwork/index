// A personal agent in three functions. `briefIfMissing` gives a new opportunity
// the standing state a negotiator needs; `wake` is the think pass over one
// signal; `negotiate` acts on one opportunity from its brief alone and can
// never wake its principal's agent. All are stateless: the caller passes what
// it read in and persists what comes back. Searching and opening opportunities
// are the exception — the model triggers those mid-loop, so `wake` calls Index
// itself.
export { briefIfMissing } from "./brief.ts";
export { wake } from "./wake.ts";
export { negotiate } from "./negotiate.ts";

// One run each, against whatever implements Index: read what the run needs,
// call it, publish what it produced.
export { runNegotiate, runWake } from "./host.ts";
export type { Runtime } from "./host.ts";

export { ModelClient } from "./model.ts";
export type { Model, ModelClientOptions, ModelMessage, ToolDefinition } from "./model.ts";

export type {
  BriefInput,
  ConversationEntry,
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
