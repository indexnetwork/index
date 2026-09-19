// Public API: Agent is H2A. receiveInput() accepts human input and wakes it;
// wake() reviews existing context. A2A negotiation is internal subagent work.
// These declarations re-export implementations and types for API consumers.

// The human-facing agent; model loops and negotiation subagents are not public agents.
export { Agent } from './agent.ts';
// Construction, human input, and host-owned lifetime/observation contracts.
export type { AgentOptions, AgentParticipant, AgentInput, AgentHost } from './agent.ts';
// Speaker contract used by the negotiation layer.
export type { NegotiationSpeaker } from './negotiation/negotiation.speaker.ts';
// Negotiation actions, turn inputs, users, and intents (aliased to avoid name
// collisions), plus negotiation state, history, client, and subagent event contracts.
export type { Action as NegotiationAction, TurnInput as NegotiationTurn, User as NegotiationUser, Intent as NegotiationIntent, Negotiation, NegotiationHistory, NegotiationClient, NegotiationEvent } from './negotiation/negotiation.types.ts';
// Principal inbox payloads: messages, questions, answers, tool calls,
// match references, and the scope in which a question applies.
export type { PrincipalMessage, PrincipalQuestion, PrincipalAnswer, PrincipalToolCall, MatchReference, QuestionScope } from "./negotiation/principal.inbox.ts";

// Tool for asking the represented user a question and the default tool collection.
export { askUserTool, defaultTools } from "./core/tools.ts";
// Tool contract and the execution context supplied to a tool.
export type { Tool, ToolContext } from "./core/tools.ts";

// In-memory storage implementation for session messages.
export { MemoryMessageStore } from "./core/sessions.ts";
// Client implementation for interacting with a model.
export { ModelClient } from "./core/model.ts";
// Model interface, client configuration, message format, request options,
// and tool definitions exposed to the model.
export type { Model, ModelClientOptions, ModelMessage, ModelRequestOptions, ToolDefinition } from "./core/model.ts";

// Shared contracts for agent identity, intent, message storage, pending
// questions, run termination, run results, and individual execution steps.
export type { AgentIdentity, Intent, MessageStore, PendingQuestion, RunEnd, RunResult, Step } from "./core/types.ts";

// Intent and principal activation types, plus agent domain events.
export type { IntentActivation, PrincipalActivation, AgentDomainEvent } from './negotiation/agent.events.ts';
// In-memory principal records and helpers for retrieving pending questions,
// valid effects, accepted messages, and the latest principal input; checking
// brief currency and execution version; selecting a valid standing brief;
// and obtaining negotiation-opening delegation and request keys.
export { MemoryPrincipalRecords, pendingPrincipalQuestions, validPrincipalEffects, acceptedPrincipalMessages, latestPrincipalInput, isPrincipalBriefCurrent, briefExecutionVersion, validStandingBrief, openingDelegation, openingRequestKey } from './negotiation/principal.records.ts';
// Contracts for principal record storage and views, recorded effects,
// standing briefs, and delegations.
export type { PrincipalRecords, PrincipalRecordsView, PrincipalEffects, PrincipalStandingBrief, PrincipalDelegation } from './negotiation/principal.records.ts';

// Discovery client, search scope, candidates, query and search record types,
// plus request and result contracts for opening a negotiation.
export type { DiscoveryClient, DiscoveryScope, DiscoveryCandidate, CandidateQuery, SearchRecord, NegotiationOpeningRequest, OpenNegotiationResult } from './negotiation/discovery.types.ts';
