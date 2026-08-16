/**
 * contexts/domain — pure participant-context contracts.
 *
 * Value types, graph-state shapes, and domain model types that define the
 * participant-context capability's domain language.
 * No LLM calls, no LangGraph edges, no host-adapter imports.
 *
 * ## Domain model
 *
 * A **Premise** is an atomic self-descriptive proposition asserted by a
 * participant about themselves (e.g. "I am a machine learning researcher").
 * Premises carry:
 *   - **Assertion**: the raw text of the proposition.
 *   - **Provenance**: how the premise was produced (explicit user assertion,
 *     social integration scrape, or auto-generation from account data) plus
 *     a confidence score derived from felicity conditions.
 *   - **Validity**: the time window during which the premise is considered
 *     current, plus a `volatile` flag marking it for automatic retraction
 *     when its `validUntil` window elapses.
 *   - **Analysis**: Speech Act classification (DECLARATIVE | ASSERTIVE) and
 *     felicity scores (authority, sincerity, clarity) recorded at creation time.
 *
 * ## Provenance invariants
 *
 * - `source: 'explicit'` — user typed or confirmed the premise directly in chat.
 * - `source: 'integration'` — derived from a social/external data source; the
 *   `sourceId` identifies the `user_socials` record that was the source of truth.
 * - `source: 'generated'` — auto-produced from account data via the enrichment
 *   generate-mode; no specific social record is the source.
 * - `confidence` is derived from average felicity scores when the PremiseAnalyzer
 *   runs; it falls back to 1.0 when no analysis is available (explicit tier).
 *
 * ## Validity / regeneration invariants
 *
 * - `volatile: false` (assertive tier default) — premise persists until explicitly
 *   retracted by the participant or an update operation.
 * - `volatile: true` (contextual tier default) — premise is automatically retracted
 *   by the background refresh job once `validUntil` has elapsed.
 * - Regeneration (triggered by the ambient enrichment adapter) replaces stale
 *   integration-sourced premises when the social source is re-scraped; it MUST
 *   NOT touch `source: 'explicit'` premises created by the participant directly.
 * - Context synthesis (UserContextGenerator) is triggered after premise writes and
 *   should treat the resulting paragraph as a derived projection — never as a source
 *   of truth for premise recovery.
 *
 * ## Policy separation
 *
 * - **Foreground adapters** (onboarding preview/confirm, explicit enrichment):
 *   managed by the tool composition root (shared/agent). They compose the
 *   EnrichmentGraphFactory and PremiseGraphFactory and pass the compiled graphs
 *   through the tool-dependency ports.
 * - **Ambient adapters** (scrape/decompose, regeneration, indexing, representation
 *   refresh): managed by the background runtime shell. They are the consumers of
 *   PremiseGraphFactory and EnrichmentGraphFactory in queue-worker mode.
 * - **Cache/enrichment/scraper/model/embedding integrations**: remain injected
 *   ports (see contexts/ports) or protocol-owned technology bindings
 *   in shared/agent and shared/hyde.
 *
 * IND-545: canonical home for participant-context domain contracts previously
 * spread across premises/, contexts/, enrichment/, and discovery/.
 * Legacy paths remain as compatibility re-exports pointing here.
 */

// ── Premise graph state ───────────────────────────────────────────────────────
export { PremiseGraphState } from "../../premises/premise.state.js";

// ── Enrichment graph state ────────────────────────────────────────────────────
export { EnrichmentGraphState } from "../../enrichment/enrichment.state.js";

// ── HyDE graph state and document types ──────────────────────────────────────
export {
  HydeGraphState,
  type HydeDocumentState,
  type HydeDocumentOrigin,
  type HydeValidationStatus,
} from "../../discovery/index.js";

// ── Context synthesis DTOs ────────────────────────────────────────────────────
export type {
  UserContextInput,
  IncrementalContextInput,
  GlobalContextInput,
  GlobalIncrementalContextInput,
  UserContextResult,
} from "../../contexts/context.generator.js";

// ── Premise domain model types ────────────────────────────────────────────────
// PremiseAssertion, PremiseProvenance, PremiseAnalysis, PremiseValidity, and
// PremiseRecord are declared in shared/interfaces/database.interface because they
// are shared across protocol sub-capabilities (premise graph + enrichment graph +
// opportunity graph). They are re-exported here as the canonical domain-layer view.
export type {
  PremiseAssertion,
  PremiseProvenance,
  PremiseAnalysis,
  PremiseValidity,
  PremiseRecord,
} from "../../shared/interfaces/database.interface.js";
