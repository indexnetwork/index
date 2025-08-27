/**
 * Intro Maker Agent
 * 
 * Generates introduction synthesis text for user connection emails.
 * Only uses agent reasonings, not full intent data.
 */

import { traceableLlm } from "../../../lib/agents";

// Type definitions
export interface IntroMakerResult {
  success: boolean;
  synthesis?: string;
  error?: string;
}

export interface IntroMakerOptions {
  timeout?: number;
}

export interface UserReasoning {
  id: string;
  userName: string;
  reasonings: string[];
}

export interface IntroMakerData {
  sender: UserReasoning;
  recipient: UserReasoning;
}

/**
 * Generate introduction synthesis for two users
 */
export async function introMaker(
  data: IntroMakerData,
  options: IntroMakerOptions = {}
): Promise<IntroMakerResult> {
  try {
    if (!data.sender?.reasonings?.length || !data.recipient?.reasonings?.length) {
      return { success: false, error: 'Both users must have reasonings' };
    }

    const { timeout = 30000 } = options;

    const prompt = `Generate a brief introduction synthesis for an email connection between two users based on agent reasonings.

SENDER: ${data.sender.userName}
Agent reasonings about ${data.sender.userName}:
${data.sender.reasonings.map(r => `- ${r}`).join('\n')}

RECIPIENT: ${data.recipient.userName}  
Agent reasonings about ${data.recipient.userName}:
${data.recipient.reasonings.map(r => `- ${r}`).join('\n')}

GUIDELINES:
- Write 2-3 sentences explaining why this connection makes sense
- Focus on shared themes, complementary work, or collaboration opportunities
- Be conversational and warm, not overly formal
- Don't use "What could happen here" - this is for email intros
- Assume you already said hello to the users and already said It's great to connect you both!
- Don't mention specific intent IDs or links
- Focus on the people and their work/interests based on reasonings

Example output:
You both share a strong focus around coordination without platforms and trust-preserving discovery. Sarah's working on agent-led systems that negotiate access based on context, while David is exploring intent schemas that don't rely on reputation scores or central visibility. This feels like a connection where you could build something meaningful together around private, intent-driven coordination.

Generate the synthesis:`;

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Intro maker timeout')), timeout);
    });

    const introCall = traceableLlm(
      "intro-maker",
      [],
      {
        sender_id: data.sender.id,
        recipient_id: data.recipient.id,
        sender_name: data.sender.userName,
        recipient_name: data.recipient.userName,
      }
    );
    const response = await Promise.race([
      introCall(prompt),
      timeoutPromise
    ]);

    const synthesis = (response.content as string).trim();

    console.log(`✅ Generated intro synthesis for ${data.sender.userName} → ${data.recipient.userName}: ${synthesis.length} characters`);

    return {
      success: true,
      synthesis
    };

  } catch (error) {
    console.error(`❌ Error generating intro for ${data.sender.userName} → ${data.recipient.userName}:`, error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
} 