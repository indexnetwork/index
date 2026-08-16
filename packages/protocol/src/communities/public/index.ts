/**
 * communities/public — curated public surface of the communities capability.
 *
 * Re-exports the stable contracts from domain, application, and ports.
 * Runtime adapter creation (graph factories, tool factories) is accessible
 * via capabilities/communities.facade.ts for package consumers and via the
 * tool composition root (shared/agent) for internal registries.
 *
 * Boundary: public-compatibility.  References only communities/domain,
 * communities/application, and communities/ports — never the tool composition root (shared/agent)
 * or host implementations.
 *
 * ## Intentionally excluded from public surface
 *
 * The following are application-internal:
 * - IntentNetworkGraphState, IntentForIndexing, IndexMemberContext,
 *   AssignmentResult — indexer graph execution state types; import from
 *   communities/application/ when genuinely needed.
 * - NetworkRecommender — LLM ranking agent used only inside createNetworkTools;
 *   import from communities/application/ if required for testing overrides.
 *
 * IND-546: canonical public surface for communities capability.
 * Legacy paths (capabilities/communities.facade.ts) re-export from here.
 */

// ── Domain contracts ──────────────────────────────────────────────────────────
export {
  NetworkGraphState,
  NetworkMembershipGraphState,
} from "../domain/index.js";

// ── Application seams ─────────────────────────────────────────────────────────

// Graph factories (foreground + ambient adapter entry points)
export { NetworkGraphFactory } from "../application/index.js";
export { NetworkMembershipGraphFactory } from "../application/index.js";
export { IntentNetworkGraphFactory } from "../application/index.js";

// Tool factory (foreground adapter composition entry point)
export { createNetworkTools } from "../application/index.js";

// ── Ports ─────────────────────────────────────────────────────────────────────
export type {
  NetworkGraphDatabase,
  NetworkMembershipGraphDatabase,
  IntentNetworkGraphDatabase,
} from "../ports/index.js";
