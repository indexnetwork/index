/**
 * contexts/ports — narrow injected dependency contracts.
 *
 * Re-exports the subset of shared/interfaces types that the participant-context
 * capability declares as explicit injected ports.  Consumers of the
 * participant-context module should import these port types here rather than
 * from the broader shared/interfaces barrel to keep the dependency surface
 * narrow and auditable.
 *
 * ## Port taxonomy
 *
 * ### Persistence ports
 * - {@link PremiseGraphDatabase} — premise CRUD, assignment, and dedup queries.
 * - {@link EnrichmentGraphDatabase} — profile read/write and enrichment-run records.
 * - {@link HydeGraphDatabase} — HyDE document cache read/write.
 *
 * ### External-service ports
 * - {@link ProfileEnricher} — resolves structured profile data from external
 *   sources (e.g. Parallel Chat API).  Protocol depends only on this interface;
 *   the concrete adapter lives in the host.
 * - {@link Scraper} — extracts text content from URLs.  Protocol depends only on
 *   this interface; the concrete adapter (Firecrawl, etc.) lives in the host.
 *
 * ### Embedding port
 * - {@link EmbeddingGenerator} — generates dense vector embeddings.  Used by
 *   PremiseGraphFactory (premise embedding), UserContextGenerator (context
 *   embedding), and HydeGraphFactory (HyDE document embedding).
 * - {@link Embedder} — the superset interface (EmbeddingGenerator + VectorStore)
 *   used by the embedding adapter bound at composition time.
 *
 * IND-545: canonical ports home for participant-context injected contracts
 * previously scattered across shared/interfaces.
 */

// ── Persistence ports ─────────────────────────────────────────────────────────
export type {
  PremiseGraphDatabase,
  EnrichmentGraphDatabase,
  HydeGraphDatabase,
} from "../../shared/interfaces/database.interface.js";

// ── External-service ports ────────────────────────────────────────────────────
export type {
  ProfileEnricher,
  EnrichmentResult,
  EnrichmentRequest,
} from "../../shared/interfaces/enrichment.interface.js";

export type {
  Scraper,
  ExtractUrlContentOptions,
} from "../../shared/interfaces/scraper.interface.js";

// ── Embedding port ────────────────────────────────────────────────────────────
export type { EmbeddingGenerator, Embedder } from "../../shared/interfaces/embedder.interface.js";
