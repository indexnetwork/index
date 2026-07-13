/**
 * Invite Generator Agent
 *
 * Generates contextual, editable invite messages for ghost users.
 * Produces warm, concise messages (~3-5 sentences) referencing why two
 * users were matched, with optional referrer mention.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { createStructuredModel } from "../shared/agent/model.config.js";

const InviteInputSchema = z.object({
  recipientName: z.string(),
  senderName: z.string(),
  opportunityInterpretation: z.string(),
  senderIntents: z.array(z.string()),
  recipientIntents: z.array(z.string()),
  referrerName: z.string().optional(),
});

const InviteOutputSchema = z.object({
  message: z.string().describe("The invite message text, ready to edit and send"),
});

export type InviteInput = z.infer<typeof InviteInputSchema>;
export type InviteOutput = z.infer<typeof InviteOutputSchema>;

const SYSTEM_PROMPT = `You generate brief, casual invite messages for a discovery platform called Index.

The sender wants to reach out to someone they were matched with. Write a short, human message (2-3 sentences max) that:
- Sounds like a real person texting, not a LinkedIn outreach or AI email
- References one concrete, specific detail from the opportunity context — something actual, like a specific project, technology, or goal they share. Not "we have similar interests" or "I noticed we're both in this space" — name the actual thing.
- If a referrer is provided, casually drops that they were introduced
- Ends naturally — no formal CTAs, no "Would you be open to..." closings

Tone: casual, direct, human. Think how you'd actually message someone you just got introduced to.
Do NOT use a generic opener like "Hi [Name], I'm [Sender]." Just get to the point.
Do NOT summarize the person's background. Pick one real, specific overlap from the context and mention it.
Do NOT include a subject line. This is a chat message.
Do NOT use placeholder brackets like [Name]. Use the actual names provided.`;

/**
 * Generates a contextual invite message for a ghost user.
 * @param input - Context about sender, recipient, and opportunity
 * @returns Generated invite message text
 */
export async function generateInviteMessage(input: InviteInput): Promise<InviteOutput> {
  const validated = InviteInputSchema.parse(input);

  const structuredModel = createStructuredModel("inviteGenerator", InviteOutputSchema);

  const userPrompt = `Generate an invite message with this context:
- Sender: ${validated.senderName}
- Recipient: ${validated.recipientName}
- Why they matched: ${validated.opportunityInterpretation}
- Sender's interests: ${validated.senderIntents.join(', ') || 'Not specified'}
- Recipient's interests: ${validated.recipientIntents.join(', ') || 'Not specified'}${validated.referrerName ? `\n- Referred by: ${validated.referrerName}` : ''}`;

  const result = await structuredModel.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(userPrompt),
  ]);

  return result;
}
