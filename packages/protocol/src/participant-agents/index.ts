/**
 * participant-agents — domain-first module root.
 *
 * Re-exports the curated public surface.  Other modules inside the
 * participant-agents capability import directly from
 * participant-agents/domain, participant-agents/application, or
 * participant-agents/ports; this barrel is for cross-capability consumers
 * that must go through the participant-agents public surface.
 *
 * IND-548: canonical home for agent registration, permission-aware behaviour,
 * and dispatch contracts.
 *
 * Compatibility path:
 * - shared/interfaces/agent-dispatcher.interface.ts — re-exports from
 *   participant-agents/ports
 */
export * from "./public/index.js";
