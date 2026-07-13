/**
 * Negotiator chat feature flag (P4.1 / IND-402).
 *
 * Gates the negotiator persona chat surface: the get-or-create negotiator
 * session endpoint and negotiator-persona streaming. When off, those code
 * paths behave as if they do not exist (404), and the flag is surfaced as
 * `features.negotiatorChat = false` on the `/auth/me` bootstrap response so
 * the web app can gate the sidebar entry (P4.4 / IND-411) without a new
 * config channel.
 *
 * Disabled when unset: the feature is OFF unless `NEGOTIATOR_CHAT_ENABLED` is
 * exactly the string `"true"`. This is a fail-closed default.
 */

/** @returns true when the negotiator chat surface is enabled. */
export function isNegotiatorChatEnabled(): boolean {
  return process.env.NEGOTIATOR_CHAT_ENABLED === 'true';
}

/**
 * Negotiator memory write flag (P5.2 / IND-406). Gates every
 * `negotiator_memories` write path: the reflect queue, the ask_user
 * disclosure-rule shortcut, and the negotiator DM's `remember` tool
 * registration (P5.4). Lives here (lib) so controllers, services, and the
 * chat composition root can all read it without crossing the
 * service→service boundary. Fail-closed: only the string `"true"` enables.
 *
 * @returns true when negotiator memory writes are enabled.
 */
export function isNegotiatorMemoryWriteEnabled(): boolean {
  return process.env.NEGOTIATOR_MEMORY_WRITE_ENABLED === 'true';
}
