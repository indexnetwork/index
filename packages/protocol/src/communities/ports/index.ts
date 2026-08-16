/**
 * communities/ports — narrow injected dependency contracts.
 *
 * Re-exports the subset of types that the communities capability declares as
 * explicit injected ports.  Consumers of the communities module should import
 * these types from here rather than from the broader shared/interfaces barrel
 * to keep the dependency surface narrow and auditable.
 *
 * ## Port groups
 *
 * ### Persistence ports
 * - NetworkGraphDatabase — network lifecycle CRUD (membership + owner queries).
 * - NetworkMembershipGraphDatabase — cross-user membership operations.
 * - IntentNetworkGraphDatabase — intent–network link CRUD + context queries.
 *
 * ### Signal-assignment port
 * - IntentIndexer, IntentIndexerOutput — LLM evaluator interface injected into
 *   IntentNetworkGraphFactory.  Sourced from capabilities/signals.facade.ts (the
 *   signals public facade) so that communities never imports signals internals.
 *
 * IND-546: explicit port layer for communities; signals consumed via capabilities/signals.facade.ts.
 */

// ── Persistence ports ─────────────────────────────────────────────────────────
export type {
  NetworkGraphDatabase,
  NetworkMembershipGraphDatabase,
  IntentNetworkGraphDatabase,
} from "../../shared/interfaces/database.interface.js";

// ── Signal-assignment port ────────────────────────────────────────────────────
// Re-exported from the signals capability facade so that application-layer code
// (indexer.graph.ts, indexer.state.ts) imports from the communities port, not
// directly from the signals facade or its implementation.
export { IntentIndexer } from "../../signals/index.js";
export type { IntentIndexerOutput } from "../../signals/index.js";
