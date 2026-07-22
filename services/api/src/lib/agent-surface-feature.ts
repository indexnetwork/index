/**
 * Main-web read-only Agent reporter surface flag (IND-476).
 *
 * Disabled unless WEB_AGENT_SURFACE_ENABLED is exactly "true". The flag only
 * controls reporter persona routing; it does not change compatibility/API-key
 * orchestrator behavior.
 */

export const DEFAULT_REPORTER_BRIEFING_TTL_MS = 24 * 60 * 60 * 1000;

/** @returns true when the reporter persona may be started or continued. */
export function isAgentSurfaceEnabled(): boolean {
  return process.env.WEB_AGENT_SURFACE_ENABLED === 'true';
}

/**
 * Resolve the lazy reporter briefing lifetime.
 *
 * Startup validation accepts only positive whole milliseconds; this runtime
 * fallback keeps direct test imports and partially configured processes safe.
 *
 * @returns Briefing freshness lifetime in milliseconds
 */
export function getReporterBriefingTtlMs(): number {
  const configured = process.env.REPORTER_BRIEFING_TTL_MS?.trim();
  if (!configured) return DEFAULT_REPORTER_BRIEFING_TTL_MS;
  const parsed = Number(configured);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_REPORTER_BRIEFING_TTL_MS;
}

/** Cleanup-action proposals are effective only on the reporter surface. */
export function isAgentActionsEnabled(): boolean {
  return isAgentSurfaceEnabled() && process.env.WEB_AGENT_ACTIONS_ENABLED === 'true';
}
