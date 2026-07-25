/**
 * Narrow signals port previously consumed by communities/network to rank
 * signal membership.  Re-exports from the canonical signals facade to avoid
 * the legacy intent/ shim path.
 *
 * IND-546: canonical import path changed from intent/intent.indexer to
 * capabilities/signals.facade (which exports from signals/application).
 * communities/ports/index.ts is now the primary consumer; this file is
 * retained for any lingering direct importers during the transition.
 */
export { IntentIndexer } from "./signals.facade.js";
export type { IntentIndexerOutput } from "./signals.facade.js";
