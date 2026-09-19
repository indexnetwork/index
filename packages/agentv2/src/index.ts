// A personal agent in three functions. `briefIfMissing` gives a new opportunity
// the standing state a negotiator needs; `wake` is the think pass over one
// signal; `negotiate` acts on one opportunity from its brief alone and can
// never wake its principal's agent. All are stateless: the caller passes what
// it read in and persists what comes back. After persisting a successful plan,
// `runWake` automatically calls Index to score every eligible public intent/network
// pair without a pass/fail threshold, then walk all still-eligible scores in descending
// order until up to 10 new negotiations per intent per matching run are created.
// Existing/reused, terminal, and unavailable sessions do not consume that budget;
// terminal sessions require deliberate reopening. It schedules new negotiators
// outside model control, with no queries or embedding retrieval.
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
