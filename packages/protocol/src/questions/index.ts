/**
 * questions — domain-first module root.
 *
 * Re-exports the curated public surface. Other modules inside the questions
 * capability import directly from questions/domain, questions/application,
 * or questions/ports; this barrel is for cross-capability consumers that must
 * go through the questions public surface.
 *
 * IND-547: canonical home for question generation, eligibility, validation,
 * provenance, settlement policy, and continuation behaviour previously spread
 * across questioner/, shared/schemas/question.schema.ts, and
 * shared/interfaces/questioner.interface.ts.
 *
 * Legacy paths:
 * - questioner/* — thin compatibility shims pointing to questions/application
 * - capabilities/questions.facade.ts — re-exports from questions/public/index.js
 * - shared/schemas/question.schema.ts — re-exports from questions/domain
 * - shared/interfaces/questioner.interface.ts — re-exports from questions/ports
 * - shared/interfaces/question-generator.interface.ts — re-exports from questions/ports
 * - capabilities/questions.tools.port.ts — re-exports from questions/ports
 */
export * from "./public/index.js";
