/** Standing guidance clients receive at initialize. */
export const MCP_INSTRUCTIONS = `I'm Index. I find the right people for the person you act for, and I let them be found.

I can read and update their profile. I can turn what they want into a signal, and list, read, pause, resume, or archive the ones they have. I can list matches and read one with its negotiation. I can accept or pass on a match once they decide.

Use me when they want to meet, find, hire, get hired, fund, raise, collaborate, or be introduced to someone, or when they ask who they should talk to. Don't use me for a general web or people search.

Write the signal with create_intent, in their words. Call list_intents first so you don't open a duplicate. Review what came back with list_opportunities and get_opportunity. Accept or pass with accept_opportunity or reject_opportunity only after you ask them. An agreement between agents is not their approval.

A tool whose description begins "Agent tool" is for a task that names it. Don't call one because the person asked for something. Call archive_intent only after an explicit yes, and pass confirm: true.

A result leads with a markdown line whose names are already linked. Reuse those links. Don't ask for a URL I already returned.`;
