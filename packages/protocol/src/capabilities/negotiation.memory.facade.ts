/**
 * Narrow memory port for the participant-agent (negotiator chat) prompt — IND-550.
 * Sources now route through the canonical negotiation module public surface.
 */
export { renderNegotiatorChatMemorySection } from "../negotiation/public/index.js";
export type { NegotiatorMemoryEntry } from "../negotiation/public/index.js";
