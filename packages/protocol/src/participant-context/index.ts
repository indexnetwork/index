/**
 * participant-context — domain-first module root.
 *
 * Re-exports the curated public surface.  Other modules inside the
 * participant-context capability import directly from
 * participant-context/domain, participant-context/application, or
 * participant-context/ports; this barrel is for cross-capability consumers
 * that must go through the participant-context public surface.
 *
 * IND-545: canonical home for premise/context/enrichment/HyDE behaviour that
 * was previously spread across premise/, context/, enrichment/, and
 * shared/hyde/.  Legacy paths in capabilities/participant-context.facade and
 * direct shared/hyde imports from root index.ts remain as compatibility
 * re-exports pointing here.
 */
export * from "./public/index.js";
