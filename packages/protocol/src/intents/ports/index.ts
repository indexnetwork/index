/**
 * intents/ports — narrow injected dependency contracts.
 *
 * Re-exports the subset of shared/interfaces types that the signals
 * capability declares as explicit injected ports.  Consumers of the
 * signals module should import these port types here rather than from
 * the broader shared/interfaces barrel to keep the dependency surface
 * narrow and auditable.
 *
 * Ports are migrated here incrementally; placeholders name the intended
 * contracts before they are physically relocated.
 */

// ── Persistence port ──────────────────────────────────────────────────────────
export type { IntentGraphDatabase } from "../../shared/interfaces/database.interface.js";

// ── Embedding port ────────────────────────────────────────────────────────────
export type { EmbeddingGenerator } from "../../shared/interfaces/embedder.interface.js";

// ── Async-work port ───────────────────────────────────────────────────────────
export type { IntentGraphQueue } from "../../shared/interfaces/queue.interface.js";
