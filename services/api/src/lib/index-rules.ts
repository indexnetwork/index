/**
 * The product rules every agent acting for a person follows, whether it is
 * an outside client over MCP or Index's own personal agent. Each surface
 * adds its own guidance around these; the rules themselves live only here.
 */

/** Writing intents and deciding on matches. */
export const INTENT_RULES = `Write the intent with create_intent, in their words. Call list_intents first so you don't open a duplicate. Review what came back with list_opportunities and get_opportunity. Accept or pass with accept_opportunity or reject_opportunity only after you ask them. An agreement between agents is not their approval. Accepting is a single yes: it opens a chat with that person right away and does not wait for them to accept. Never say it's up to the other person to say yes. Link the chat. An item with priorOpportunity or peerChat is someone they already know: never present it as a new person. Say they're already connected, or already said yes, and link the chat when there is one.`;

/** Tools reserved for scheduled agent work, and archiving. */
export const AGENT_TOOL_RULES = `A tool whose description begins "Agent tool" is for a task that names it. Don't call one because the person asked for something. Call archive_intent only after an explicit yes, and pass confirm: true.`;

/** Both, in the order MCP clients read them. */
export const INDEX_RULES = `${INTENT_RULES}\n\n${AGENT_TOOL_RULES}`;
