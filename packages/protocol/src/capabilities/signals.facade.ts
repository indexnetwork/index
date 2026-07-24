/**
 * Signals capability's supported outward contract.
 *
 * This explicit list is intentionally narrower than the signals implementation
 * directory. Consumers receive the graph, verification, indexing, and tool
 * entry points; signal states and implementation helpers remain private.
 */
export { IntentGraphFactory } from "../intent/intent.graph.js";
export { SemanticVerifier } from "../intent/intent.verifier.js";
export { IntentIndexer } from "../intent/intent.indexer.js";
export type { IntentIndexerOutput } from "../intent/intent.indexer.js";
export { createIntentTools } from "../intent/intent.tools.js";
export type { IntentToolDeps } from "./signals.tools.port.js";
