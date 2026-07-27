/**
 * Narrow participant-agent tool port used by interaction composition.
 *
 * IND-548: createAgentTools now sourced from the canonical
 * participant-agents application layer, not the legacy agent/ shim.
 */
export { createChatTools } from "../chat/chat.tools.js";
export { createAgentTools } from "../participant-agents/application/index.js";
