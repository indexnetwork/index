/**
 * opportunity — domain-first module root.
 *
 * Re-exports the curated public surface. Other modules inside the opportunity
 * capability import directly from opportunity/domain, opportunity/application,
 * or opportunity/ports; this barrel is for cross-capability consumers that must
 * go through the opportunity public surface.
 *
 * IND-551: canonical home for candidate generation, evaluation, persistence,
 * lifecycle, feed projection, evidence, outcome, and safe presentation.
 *
 * ## Module topology
 *
 * ```
 * opportunity/
 * ├── domain/       — pure types, predicates, policy, safe-presentation
 * ├── application/  — LLM agents, LangGraph graphs, effectful orchestration
 * ├── ports/        — injected dependency contracts
 * ├── public/       — curated re-export surface
 * └── index.ts      — this file
 * ```
 *
 * ## Subdirectories (domain and application files co-located)
 * - discriminator/ — pool question mining, scoring, assignment
 * - negotiation-evidence/ — Lens C evidence extraction and mining
 * - outcome/ — Lens B outcome hypothesis mining
 * - feed/ — home feed graph and categorizer
 *
 * ## Legacy paths (thin inward shims)
 * The following old flat-file paths are preserved as thin re-export shims for
 * backward compatibility with test files and runtime composition. All shims
 * delegate to opportunity/domain or opportunity/application.
 *
 * IND-551 completion gate: remove compatibility shims only after an approved
 * deprecation/SemVer plan is in place.
 */
export * from "./public/index.js";
