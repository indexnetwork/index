/**
 * Main-web Signal Agent cutover flag (IND-449).
 *
 * Disabled unless WEB_SIGNAL_AGENT_ENABLED is exactly "true". The flag only
 * changes session-authenticated web chat routing; API-key, Telegram, MCP, CLI,
 * and direct-tool consumers retain their existing orchestrator behavior.
 */

/** @returns true when new ordinary web chats must use Signal Agent. */
export function isWebSignalAgentEnabled(): boolean {
  return process.env.WEB_SIGNAL_AGENT_ENABLED === 'true';
}
