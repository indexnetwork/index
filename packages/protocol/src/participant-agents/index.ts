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
 * and dispatch contracts previously spread across agent/,
 * shared/interfaces/agent.interface.ts, and
 * shared/interfaces/agent-dispatcher.interface.ts.
 *
 * Legacy paths:
 * - agent/* — thin compatibility shims pointing to participant-agents/application
 * - shared/interfaces/agent.interface.ts — re-exports from participant-agents/domain
 *   and participant-agents/ports
 * - shared/interfaces/agent-dispatcher.interface.ts — re-exports from
 *   participant-agents/ports
 * - capabilities/participant-agents.tools.port.ts — re-exports AgentToolDeps
 *   from participant-agents/ports
 */
export * from "./public/index.js";
