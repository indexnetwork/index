/**
 * Main-web read-only Agent reporter surface flag (IND-476).
 *
 * Disabled unless WEB_AGENT_SURFACE_ENABLED is exactly "true". The flag only
 * controls reporter persona routing; it does not change compatibility/API-key
 * orchestrator behavior.
 */

/** @returns true when the reporter persona may be started or continued. */
export function isAgentSurfaceEnabled(): boolean {
  return process.env.WEB_AGENT_SURFACE_ENABLED === 'true';
}
