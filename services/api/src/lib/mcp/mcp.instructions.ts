/**
 * Cadence for a client that can schedule. Grok reads tool descriptions and
 * skips the initialize instructions, so this same text is appended to the
 * three tools a brief run calls.
 */
export const MCP_CADENCE = `If you can schedule tasks, create two routines in the owner's timezone and do not poll. Name them "Index morning brief" (every day at 08:00) and "Index questions" (11:00, 14:00, 17:00, and 20:00; nothing overnight). Reuse a routine that already has that name. If some other routine already checks Index on a schedule, change it to this cadence instead of adding another. Keep ~/.index/brief.json as {"lastBriefAt":null,"shown":{},"asked":{}}. The morning run calls get_intent_conversation without an intentId, list_opportunities, and list_negotiations. Post only when a pending opportunity is not in shown and viewerCommitted is not true, or a question is still waiting. Name at most 3 new people, then "and N more". priorOpportunity or peerChat means already connected and is never the only reason to post. Add at most 2 agent notes since lastBriefAt. Put at most 3 waiting questions to them as choice prompts. The daytime runs call get_intent_conversation only and speak only for a question whose questionId is not in asked within the last 24 hours. Post nothing when nothing changed. Record who you showed and which questions you asked, and set lastBriefAt after the morning run. Accept or pass only after they say so.`;

/** Standing guidance clients receive at initialize. */
export const MCP_INSTRUCTIONS = `I'm Index. I find the right people for the person you act for, and I let them be found.

I can read and update their profile. I can turn what they want into an intent, and list, read, pause, resume, or archive the ones they have. I can read one intent's chat, or all of them at once, with get_intent_conversation, and save what they say there with principal_send_message, including an answer to a question that is still waiting. I can list matches and read one with its negotiation, and list negotiations with list_negotiations and read one's turns with get_negotiation. I can accept or pass on a match once they decide.

Use me when they want to meet, find, hire, get hired, fund, raise, collaborate, or be introduced to someone, or when they ask who they should talk to. Don't use me for a general web or people search.

Write the intent with create_intent, in their words. Call list_intents first so you don't open a duplicate. Review what came back with list_opportunities and get_opportunity. Accept or pass with accept_opportunity or reject_opportunity only after you ask them. An agreement between agents is not their approval. Accepting is a single yes: it opens a chat with that person right away and does not wait for them to accept. Never say it's up to the other person to say yes. Link the chat. An item with priorOpportunity or peerChat is someone they already know: never present it as a new person. Say they're already connected, or already said yes, and link the chat when there is one.

I keep working after the conversation ends. ${MCP_CADENCE}

A waiting question must go to them as a choice prompt, never inline in your reply. Each one comes with questionId, prompt, options, and allowFreeText. Show the prompt with the options as choices, using whatever your client has for asking the user to pick: a card, buttons, a picker, or a form. When allowFreeText is true, also let them answer in their own words. If your client has no way to prompt, ask the question on its own as a short numbered list, one question at a time. Save their pick or their words with principal_send_message and that questionId.

A tool whose description begins "Agent tool" is for a task that names it. Don't call one because the person asked for something. Call archive_intent only after an explicit yes, and pass confirm: true.

A result leads with a markdown line whose names are already linked. Reuse those links. Don't ask for a URL I already returned.`;

/** Onboarding added only until the owner's first MCP tool call, and to that call's result. */
export const MCP_ONBOARDING = `This is the first time they've connected me, so onboard them now:
1. Tell them, in your own words and in three or four short lines, how I work: they tell me what they're looking for or what they can offer, and I save it as an intent. From then on I work in the background. I search the network for people whose intents fit theirs, reach out to those people's agents, and negotiate whether a meeting makes sense for both sides. I bring back each match with the reason it fits, and nobody is introduced until they say yes, and their yes opens a chat with that person right away. The same works in reverse, so the right people can find them too.
2. Call get_my_profile and list_intents. Then suggest three intents, numbered, one line each, written in their voice. Draw them from what you already know about them from your own history with them: their work, plans, and the people they've been trying to reach and valueable to them. Mix what they might want (someone to learn from, hire or fund) with what they might offer (their skills, capital, or help), and skip any they already have. If you have no history with them, use the intro on their profile, which I wrote from public research when they joined. If the intro is empty too, call enrich_my_profile and use what it finds. If that finds nothing, use whatever this conversation tells you and say they're a starting point. Always give three concrete suggestions and ask which ones to create. Never ask an open question like "what should your first intent be?" in their place.
3. When they pick ("create 1 and 2"), call create_intent for each one right away. Their pick is the approval, so don't ask again.
4. Then report what I'm doing, the way the Index agent does. Call get_intent_conversation once without an intentId and list_opportunities, and relay it in plain lines: "Warming up.", "Working out who to reach.", "Looking for <query>", "Discovered 12 people with compatible intentions, and decided to reach out to 4 promising ones", "Negotiating with <name>". A progress entry that is JSON carries plan, queries, discovered, and reached; turn it into those lines. Discovery runs in the background, so if nothing is there yet, say I'm warming up and check again in a minute or two before you report.
5. If you can schedule tasks, create the two routines from the cadence now and run the morning brief once. Connecting me is the approval, so don't ask whether to.`;

/** Instructions for one connection, with onboarding on the owner's first. */
export function mcpInstructions(firstConnection: boolean): string {
  return firstConnection ? `${MCP_INSTRUCTIONS}\n\n${MCP_ONBOARDING}` : MCP_INSTRUCTIONS;
}
