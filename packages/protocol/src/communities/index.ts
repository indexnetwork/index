/**
 * communities — domain-first module root.
 *
 * Re-exports the curated public surface.  Other modules inside the communities
 * capability import directly from communities/domain, communities/application,
 * or communities/ports; this barrel is for cross-capability consumers that must
 * go through the communities public surface.
 *
 * IND-546: canonical home for network lifecycle, membership, scope, and signal
 * assignment behaviour previously spread across network/, network/membership/,
 * and network/indexer/.  Legacy network/* paths remain as compatibility
 * re-exports pointing here.
 */
export * from "./public/index.js";
