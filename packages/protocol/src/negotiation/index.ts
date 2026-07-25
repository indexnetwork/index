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
 * ## Legacy paths (thin inward shims)
 *
 * The following old flat-file paths are preserved as thin re-export shims for
 * backward compatibility with test files and runtime composition:
 * - negotiation/negotiation.state.ts → domain
 * - negotiation/negotiation.protocol.ts → domain
 * - negotiation/negotiation.deadlock.ts → domain
 * - negotiation/negotiation.deadlock.contracts.ts → domain
 * - negotiation/negotiation.lifecycle-narration.ts → domain
 * - negotiation/negotiation.task-lock-policy.ts → domain
 * - negotiation/negotiation.intent-snapshot-provenance.ts → domain
 * - negotiation/negotiation.consultation-policy.ts → domain
 * - negotiation/negotiation.question-safety.ts → domain
 * - negotiation/negotiation.memory.ts → domain
 * - negotiation/negotiation.graph.ts → application
 * - negotiation/negotiation.agent.ts → application
 * - negotiation/negotiation.screen.ts → application (+ screen contracts from domain)
 * - negotiation/negotiation.reflect.ts → application
 * - negotiation/negotiation.summarizer.ts → application
 * - negotiation/negotiation.tools.ts → application
 * - negotiation/negotiation.detail-reader.ts → application
 * - negotiation/insight.generator.ts → application
 * - capabilities/negotiation*.facade.ts → public surface
 * - capabilities/negotiation.tools.port.ts → ports
 */
export * from "./public/index.js";
