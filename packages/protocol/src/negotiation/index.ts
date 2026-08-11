/**
 * negotiation — domain-first module root.
 *
 * Re-exports the curated public surface. Other modules inside the negotiation
 * capability import directly from negotiation/domain, negotiation/application,
 * or negotiation/ports; this barrel is for cross-capability consumers that must
 * go through the negotiation public surface.
 *
 * IND-550: canonical home for the bilateral turn protocol, screening, memory,
 * consultation, settlement, and summary capabilities previously spread across
 * the flat negotiation/ directory and capabilities/negotiation*.facade.ts files.
 *
 * ## Module topology
 *
 * ```
 * negotiation/
 * ├── domain/       — pure types, protocol rules, policy functions, renderers
 * ├── application/  — LLM agents, LangGraph factory, MCP tool factory
 * ├── ports/        — injected dependency contracts (NegotiationToolDeps)
 * ├── public/       — curated re-export surface
 * └── index.ts      — this file
 * ```
 *
 */
export * from "./public/index.js";
