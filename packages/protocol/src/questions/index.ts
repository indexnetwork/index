/**
 * questions — domain-first module root.
 *
 * Re-exports the curated public surface. Other modules inside the questions
 * capability import directly from questions/domain, questions/application,
 * or questions/ports; this barrel is for cross-capability consumers that must
 * go through the questions public surface.
 *
 * IND-547: canonical home for question generation, eligibility, validation,
 * provenance, settlement policy, and continuation behaviour.
 *
 * Compatibility paths:
 * - capabilities/questions.facade.ts — re-exports from questions/public/index.js
 */
export * from "./public/index.js";
