/**
 * networks/ports — narrow injected dependency contracts.
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
// Derived from the intents module surface so that application-layer code
// (indexer.graph.ts, indexer.state.ts) imports from the communities port, not
// directly from the intents module or its implementation. The port names the
// single method communities needs rather than the whole capability.
import type { Intents } from "../../intents/intent.module.js";

/** The one intents method communities calls: score a signal against a network. */
export type IntentNetworkIndexer = Pick<Intents, "indexIntent">;

export type { IntentIndexerOutput } from "../../intents/intent.module.js";
