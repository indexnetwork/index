// Public API: a personal agent run by a host on someone's behalf. One
// identity, scopeable to an intent, with a loop that can stop to ask the
// party it represents a question.
export { Agent } from "./core/agent.ts";
export type { AgentOptions, RunOptions } from "./core/agent.ts";

export { NegotiationAgent } from "./negotiation/negotiation.agent.ts";
export type { Action as NegotiationAction, TurnInput as NegotiationTurn, User as NegotiationUser, Intent as NegotiationIntent, Negotiation, NegotiationClient, NegotiationHost, NegotiationEvent } from "./negotiation/negotiation.agent.ts";
export type { PrincipalMessage, PrincipalQuestion, MatchReference, QuestionScope } from "./negotiation/principal.inbox.ts";

export { askUserTool, defaultTools } from "./core/tools.ts";
export type { Tool, ToolContext } from "./core/tools.ts";

export { Inbox, TICK_MS } from "./core/inbox.ts";
export type { InboxEvent, InboxOptions } from "./core/inbox.ts";

export { MemoryMessageStore } from "./core/sessions.ts";
export { ModelClient } from "./core/model.ts";
export type { Model, ModelClientOptions, ModelMessage, ModelRequestOptions, ToolDefinition } from "./core/model.ts";

export type {
  AgentIdentity,
  Intent,
  MessageStore,
  PendingQuestion,
  RunEnd,
  RunResult,
  Step,
} from "./core/types.ts";
