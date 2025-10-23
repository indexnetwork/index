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

    const systemMessage = {
      role: "system",
      content: `You are an email introduction writer. Generate warm, conversational synthesis explaining why two people should connect.

Style:
- 2-3 sentences
- Warm and conversational, not formal
- Focus on shared themes or complementary work
- No "What could happen here" phrasing
- Assume greetings already said
- No intent IDs or links`
    };

    const userMessage = {
      role: "user",
      content: `Write introduction synthesis for email connecting two users.

${data.sender.userName}:
${data.sender.reasonings.map(r => `- ${r}`).join('\n')}

${data.recipient.userName}:
${data.recipient.reasonings.map(r => `- ${r}`).join('\n')}

Example: "You both share a strong focus around coordination without platforms and trust-preserving discovery. Sarah's working on agent-led systems that negotiate access based on context, while David is exploring intent schemas that don't rely on reputation scores. This feels like a connection where you could build something meaningful together."

Generate synthesis:`
    };

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Intro maker timeout')), timeout);
    });

    const introCall = traceableLlm(
      "intro-maker",
      {
        sender_id: data.sender.id,
        recipient_id: data.recipient.id,
        sender_name: data.sender.userName,
        recipient_name: data.recipient.userName,
      }
    );
    const response = await Promise.race([
      introCall([systemMessage, userMessage]),
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