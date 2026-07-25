/**
 * signals — domain-first module root.
 *
 * Re-exports the curated public surface.  Other modules inside the signals
 * capability import directly from signals/domain, signals/application, or
 * signals/ports; this barrel is for cross-capability consumers that must go
 * through the signals public surface.
 *
 * IND-544: canonical home for intent/signal behaviour that was previously
 * spread across intent/*.  Legacy intent/* paths remain as compatibility
 * re-exports pointing here.
 */
export * from "./public/index.js";
