/**
 * integrations — domain-first module root.
 *
 * Re-exports the curated public surface. Other modules inside the integrations
 * capability import directly from integrations/domain, integrations/application,
 * or integrations/ports; this barrel is for cross-capability consumers that
 * must go through the integrations public surface.
 *
 * IND-549: canonical home for integration capabilities previously spread
 * across integration/, shared/interfaces/integration.interface.ts, and
 * capabilities/integrations.tools.port.ts.
 *
 * Retains host-integration configuration/actions semantics: the module owns
 * the OAuth session lifecycle and bulk contact import pipeline contracts.
 * Runtime foreground transport (authentication headers, request context) and
 * all-capability composition remain in runtime/foreground.
 *
 * Allowed outbound capability dependencies: none (empty set). The integrations
 * module is a leaf capability that only depends on shared/ primitives.
 *
 * Legacy paths:
 * - integration/integration.tools.ts — thin compatibility shim → integrations/application
 * - shared/interfaces/integration.interface.ts — thin compatibility shim → integrations/ports
 * - capabilities/integrations.tools.port.ts — thin compatibility shim → integrations/ports
 * - capabilities/integrations.facade.ts — thin re-export via integrations/public
 */
export * from "./public/index.js";
