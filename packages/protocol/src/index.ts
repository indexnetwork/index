// ─── Public API (recommended for external consumers) ──────────────────────────

export { createChatTools } from "./shared/agent/tool.factory.js";
export { configureProtocol } from "./shared/agent/model.config.js";
export type { ChatTools } from "./shared/agent/tool.factory.js";
export type { ModelConfig, ModelSettings } from "./shared/agent/model.config.js";
export type {
  ToolContext,
  ResolvedToolContext,
  ToolDeps,
  ProtocolDeps,
  DefineTool,
  RawToolDefinition,
  ToolRegistry,
} from "./shared/agent/tool.helpers.js";
export { ChatContextAccessError, resolveChatContext } from "./shared/agent/tool.helpers.js";

// ─── Interfaces (implement these to wire up your infrastructure) ───────────────

export type * from "./shared/interfaces/auth.interface.js";
export type * from "./shared/interfaces/cache.interface.js";
export type * from "./shared/interfaces/chat-session.interface.js";
export type * from "./shared/interfaces/contact.interface.js";
export type * from "./shared/interfaces/database.interface.js";
export type * from "./shared/interfaces/embedder.interface.js";
export type * from "./shared/interfaces/enrichment.interface.js";
export type * from "./shared/interfaces/integration.interface.js";
export type * from "./shared/interfaces/queue.interface.js";
export type * from "./shared/interfaces/scraper.interface.js";
export type * from "./shared/interfaces/storage.interface.js";
export type * from "./shared/interfaces/delivery-ledger.interface.js";
export type * from "./shared/interfaces/negotiation-events.interface.js";
export type { AgentDispatcher, AgentDispatchResult, NegotiationTurnPayload } from "./shared/interfaces/agent-dispatcher.interface.js";
export type {
  AgentRecord,
  AgentTransportRecord,
  AgentPermissionRecord,
  AgentWithRelations,
  CreateAgentInput,
  CreateTransportInput,
  GrantPermissionInput,
  AgentDatabase,
} from './shared/interfaces/agent.interface.js';
export { SYSTEM_AGENT_IDS } from './shared/interfaces/agent.interface.js';

// ─── Graph factories ──────────────────────────────────────────────────────────

export { ChatGraphFactory } from "./chat/chat.graph.js";
export { HomeGraphFactory } from "./opportunity/feed/feed.graph.js";
export { HydeGraphFactory } from "./shared/hyde/hyde.graph.js";
export { NetworkGraphFactory } from "./network/network.graph.js";
export { NetworkMembershipGraphFactory } from "./network/membership/membership.graph.js";
export { IntentGraphFactory } from "./intent/intent.graph.js";
export { IntentNetworkGraphFactory } from "./network/indexer/indexer.graph.js";
export { MaintenanceGraphFactory } from "./maintenance/maintenance.graph.js";
export type {
  MaintenanceGraphDatabase,
  MaintenanceGraphCache,
  MaintenanceGraphQueue,
} from "./maintenance/maintenance.graph.js";
export { NegotiationGraphFactory, createDefaultNegotiationGraph, negotiateCandidates } from "./negotiation/negotiation.graph.js";
export { OpportunityGraphFactory } from "./opportunity/opportunity.graph.js";
export { ProfileGraphFactory } from "./profile/profile.graph.js";

// ─── Agents ───────────────────────────────────────────────────────────────────

export { ChatTitleGenerator } from "./chat/chat.title.generator.js";
export { HydeGenerator } from "./shared/hyde/hyde.generator.js";
export { SuggestionGenerator } from "./chat/chat.suggester.js";
export type { SuggestionGeneratorInput } from "./chat/chat.suggester.js";
export { generateInviteMessage } from "./contact/contact.inviter.js";
export type { InviteInput, InviteOutput } from "./contact/contact.inviter.js";
export { IntentIndexer } from "./intent/intent.indexer.js";
export { LensInferrer } from "./shared/hyde/lens.inferrer.js";
export { NegotiationInsightsGenerator } from "./negotiation/negotiation.insights.generator.js";
export type { NegotiationDigest } from "./negotiation/negotiation.insights.generator.js";
export { IndexNegotiator } from "./negotiation/negotiation.agent.js";
export type { NegotiationAgentInput } from "./negotiation/negotiation.agent.js";
export { OpportunityEvaluator } from "./opportunity/opportunity.evaluator.js";
export type {
  EvaluatorInput,
  OpportunityEvaluatorOptionsConstructor,
} from "./opportunity/opportunity.evaluator.js";
export { OpportunityPresenter, gatherPresenterContext } from "./opportunity/opportunity.presenter.js";
export type { PresenterDatabase } from "./opportunity/opportunity.presenter.js";

// ─── Support utilities ────────────────────────────────────────────────────────

export {
  canUserSeeOpportunity,
  isActionableForViewer,
  validateOpportunityActors,
  classifyOpportunity,
  selectByComposition,
  FEED_SOFT_TARGETS,
} from "./opportunity/opportunity.utils.js";
export { getPrimaryActionLabel } from "./opportunity/opportunity.labels.js";
export { computeFeedHealth } from "./opportunity/feed/feed.health.js";
export type { FeedHealthInput, FeedHealthResult } from "./opportunity/feed/feed.health.js";
export {
  selectContactsForDiscovery,
  shouldRunIntroducerDiscovery,
  runIntroducerDiscovery,
  MAX_CONTACTS_PER_CYCLE,
  MAX_CANDIDATES_PER_CONTACT,
  INTRODUCER_DISCOVERY_SOURCE,
} from "./opportunity/opportunity.introducer.js";
export type {
  IntroducerDiscoveryDatabase,
  IntroducerDiscoveryQueue,
  ContactWithIntents,
} from "./opportunity/opportunity.introducer.js";
export { persistOpportunities } from "./opportunity/opportunity.persist.js";
export { presentOpportunity } from "./opportunity/opportunity.presentation.js";
export type { UserInfo } from "./opportunity/opportunity.presentation.js";
export { stripUuids, stripIntroducerMentions } from "./opportunity/opportunity.presentation.js";

// ─── Tools ────────────────────────────────────────────────────────────────────

export { createToolRegistry } from "./shared/agent/tool.registry.js";
export { createAgentTools } from './agent/agent.tools.js';
export { AMBIENT_PARK_WINDOW_MS } from './negotiation/negotiation.tools.js';

// ─── MCP ──────────────────────────────────────────────────────────────────────

export { createMcpServer } from "./mcp/mcp.server.js";
export type { ScopedDepsFactory } from "./mcp/mcp.server.js";

// ─── States (for advanced graph consumers) ────────────────────────────────────

export type {
  UserNegotiationContext,
  NegotiationTurn,
  NegotiationOutcome,
  SeedAssessment,
  NegotiationGraphLike,
} from "./negotiation/negotiation.state.js";

// ─── Streamers ────────────────────────────────────────────────────────────────

export { ChatStreamer } from "./chat/chat.streamer.js";
export { ResponseStreamer } from "./shared/agent/response.streamer.js";
