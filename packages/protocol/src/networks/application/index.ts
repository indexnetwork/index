/**
 * networks/application — orchestrators, factories, tools, and agents.
 *
 * Re-exports the orchestration tier of the communities capability: graph
 * factories (LangGraph compilations), tool factories, and agent classes.
 *
 * Boundary: application-layer only.  Imports from networks/domain,
 * networks/ports, and shared/ infrastructure — never from runtime/,
 * host implementations, or capability facades (except as injected ports).
 *
 * ## Foreground use cases (participant-directed)
 *
 * - {@link NetworkGraphFactory} — compiles the network lifecycle graph
 *   (create, read, update, delete networks).
 * - {@link NetworkMembershipGraphFactory} — compiles the membership graph
 *   (add, list, remove members; enforces join-policy and owner authority).
 * - {@link IntentNetworkGraphFactory} — compiles the signal assignment graph
 *   (direct or LLM-evaluated intent–network linking; unassign).
 *   IntentIndexer is injected from the signals public facade.
 * - {@link createNetworkTools} — foreground tool factory; accepts compiled graphs
 *   and host deps through communities.tools.port and produces LangChain-compatible
 *   tool arrays for the tool registry.
 *
 * ## Ambient use case (ranking / recommendation)
 *
 * - {@link NetworkRecommender} — LLM-based community ranking used during onboarding
 *   (step 6) to surface the most relevant public communities for a user.  Lazy-
 *   instantiated inside createNetworkTools to avoid requiring OPENROUTER_API_KEY
 *   at import time.
 *
 * ## Application-internal (not in public surface)
 *
 * - {@link IntentNetworkGraphState}, {@link AssignmentResult}, etc. — graph execution
 *   state types used within indexer.graph.ts; available here for consumers that
 *   need the application-layer state shape.
 *
 * IND-546: canonical application home for communities capability previously spread
 * across network/, network/membership/, and network/indexer/.
 */

// ── Network lifecycle graph ───────────────────────────────────────────────────
export { NetworkGraphFactory } from "./network.graph.js";

// ── Membership graph ──────────────────────────────────────────────────────────
export { NetworkMembershipGraphFactory } from "./membership.graph.js";

// ── Signal-assignment (indexer) graph + state ─────────────────────────────────
export { IntentNetworkGraphFactory } from "./indexer.graph.js";
export {
  IntentNetworkGraphState,
  type AssignmentResult,
  type IntentForIndexing,
  type IndexMemberContext,
} from "./indexer.state.js";

// ── Community ranking agent ───────────────────────────────────────────────────
export {
  NetworkRecommender,
  NetworkRecommenderOutputSchema,
  type NetworkRecommenderOutput,
  type NetworkRecommenderInput,
  type NetworkRecommenderNetwork,
} from "./network.recommender.js";

// ── Tool factory (foreground adapter entry point) ─────────────────────────────
export { createNetworkTools } from "./network.tools.js";
