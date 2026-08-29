// Public API: a personal agent run by a host on someone's behalf. One
// identity, scopeable to an intent, with a loop that can stop to ask the
// party it represents a question — and negotiate with other agents over
// A2A, one turn at a time, via @indexnetwork/negotiator.
export { Agent, ASK_ACTION, DEFAULT_ACTIONS } from "./core/agent.ts";
export type {
  AgentOptions,
  DefaultAction,
  NegotiateOptions,
  OpenNegotiationOptions,
  RunOptions,
} from "./core/agent.ts";

export {
  askUserTool,
  defaultTools,
  negotiationTools,
  toolDefinition,
} from "./core/tools.ts";
export type { NegotiationToolOptions, Tool, ToolContext } from "./core/tools.ts";

export { MemoryMessageStore, MemoryNegotiationStore } from "./core/sessions.ts";
export { digest } from "./core/digest.ts";
export { ModelClient, DEFAULT_MODEL } from "./core/model.ts";
export type {
  ModelClientOptions,
  ModelMessage,
  ToolCall,
  ToolDefinition,
} from "./core/model.ts";

export type {
  AgentIdentity,
  AgentTurn,
  Direction,
  IdentifiedAgentCard,
  Intent,
  MessageStore,
  Negotiation,
  NegotiationEnd,
  NegotiationEvent,
  NegotiationSession,
  NegotiationStore,
  NegotiationTurn,
  PendingQuestion,
  RunEnd,
  RunResult,
  Settlement,
  SettlementOutcome,
  Speaker,
  Step,
} from "./core/types.ts";

// Re-exported for convenience: the negotiation half of this package is
// @indexnetwork/negotiator, and its types turn up on `Negotiation` and the
// hooks. Importing them from the negotiator directly is equivalent.
export { Negotiator } from "@indexnetwork/negotiator";
export type {
  ActionSpec,
  NegotiationDecision,
  NegotiationParty,
  NegotiationTerms,
  NegotiatorOptions,
} from "@indexnetwork/negotiator";
export {
  TaskStore,
  bearerCredentials,
  bearerTokenAuth,
  strategyWithTerms,
  verifyAgreement,
} from "@indexnetwork/negotiator/a2a";
export type {
  A2AArtifact,
  A2ACredentials,
  A2AIdentity,
  A2ATask,
  A2ATaskState,
  AgentCard,
  AgentCardSkill,
  AgreementBasis,
  AgreementResult,
  AgreementStatus,
} from "@indexnetwork/negotiator/a2a";
