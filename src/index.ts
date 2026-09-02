// Public API: a personal agent run by a host on someone's behalf. One
// identity, scopeable to an intent, with a loop that can stop to ask the
// party it represents a question — and negotiate with other agents over
// A2A via @indexnetwork/a2a.
export { Agent } from "./core/agent.ts";
export type { AgentOptions, RunOptions } from "./core/agent.ts";

export { askUserTool, defaultTools, negotiationTools } from "./core/tools.ts";
export type { Tool, ToolContext } from "./core/tools.ts";

export { MemoryMessageStore, MemoryNegotiationStore } from "./core/sessions.ts";
export type { ModelMessage } from "./core/model.ts";

export type {
  AgentIdentity,
  AgentTurn,
  Direction,
  Intent,
  MessageStore,
  Negotiation,
  NegotiationEvent,
  NegotiationSession,
  NegotiationStore,
  NegotiationTurn,
  PendingQuestion,
  RunResult,
  Settlement,
  SettlementOutcome,
  Step,
} from "./core/types.ts";

// The pieces of @indexnetwork/a2a a host reaches for alongside this
// package: the decision engine and its types on the negotiation hooks, and
// the A2A auth and storage a handler needs. Anything else is imported from
// @indexnetwork/a2a directly.
export { Negotiator } from "@indexnetwork/a2a/negotiator";
export type { ActionSpec, NegotiationDecision } from "@indexnetwork/a2a/negotiator";
export { TaskStore, bearerCredentials, bearerTokenAuth } from "@indexnetwork/a2a";
export type { A2ACredentials, A2ATask, AgentCard } from "@indexnetwork/a2a";
