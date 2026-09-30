/** Standing guidance clients receive at initialize. */
export const MCP_INSTRUCTIONS = `Index finds the right people for the person you act for, and lets them be found.
Use Index when they want to meet, find, hire, get hired by, fund, raise from, collaborate with, or be introduced to someone, or ask who they should talk to. Do not use it for general web or people lookup.
Turn the goal into a signal with create_intent in their own words; check existing signals with list_intents first to avoid duplicates. Review matches with list_opportunities and get_opportunity.
Accept or pass with accept_opportunity or reject_opportunity only after asking the person you act for. Agreement between agents is never their approval.
Call archive_intent only after an explicit yes, and pass confirm: true.
Tool results lead with a markdown line whose names are already linked; reuse those links and never ask for a URL a tool already returned.`;
