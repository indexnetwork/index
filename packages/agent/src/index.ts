// Public API: a personal agent run by a host on someone's behalf. One
// identity, scopeable to an intent, with a loop that can stop to ask the
// party it represents a question.
export { Agent } from "./core/agent.ts";
export type { AgentOptions, RunOptions } from "./core/agent.ts";

export { NegotiationAgent } from "./negotiation/negotiation.agent.ts";
export type { NegotiationSpeaker } from './negotiation/negotiation.speaker.ts';
export type { Action as NegotiationAction, TurnInput as NegotiationTurn, User as NegotiationUser, Intent as NegotiationIntent, Negotiation, NegotiationHistory, NegotiationClient, NegotiationHost, NegotiationEvent } from "./negotiation/negotiation.agent.ts";
export type { PrincipalMessage, PrincipalQuestion, PrincipalAnswer, PrincipalToolCall, MatchReference, QuestionScope } from "./negotiation/principal.inbox.ts";

export { askUserTool, defaultTools } from "./core/tools.ts";
export type { Tool, ToolContext } from "./core/tools.ts";

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

export type { IntentActivation, PrincipalActivation, AgentDomainEvent } from './negotiation/agent.events.ts';
export { MemoryPrincipalRecords, pendingPrincipalQuestions, validPrincipalEffects, acceptedPrincipalMessages, latestPrincipalInput, isPrincipalBriefCurrent, briefExecutionVersion, validStandingBrief, openingDelegation, openingRequestKey } from './negotiation/principal.records.ts';
export type { PrincipalRecords, PrincipalRecordsView, PrincipalEffects, PrincipalStandingBrief, PrincipalDelegation } from './negotiation/principal.records.ts';

export type { DiscoveryClient, DiscoveryScope, DiscoveryCandidate, CandidateQuery, SearchRecord, NegotiationOpeningRequest, OpenNegotiationResult } from './negotiation/discovery.types.ts';
