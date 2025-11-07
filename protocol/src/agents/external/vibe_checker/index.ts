/**
 * Vibe Checker Agent
 * 
 * Generates "What Could Happen Here" synthesis text for user collaboration opportunities.
 */

import { traceableLlm } from "../../../lib/agents";

// Type definitions
export interface VibeCheckResult {
  success: boolean;
  synthesis?: string;
  error?: string;
  timing?: {
    startTime: Date;
    endTime: Date;
    durationMs: number;
  };
}

export interface VibeCheckOptions {
  timeout?: number;
  characterLimit?: number;
}

export interface AuthenticatedUserIntent {
  id: string;
  payload: string;
  most_valuable_reason: {
    agent_name: string;
    agent_id: string;
    reasoning: string;
    stake: number;
  };
}

export interface OtherUserData {
  id: string;
  name: string;
  intro: string;
  intents: AuthenticatedUserIntent[]; // Authenticated user's intents matched to this other user
}

/**
 * Generate collaboration synthesis between authenticated user and another user
 */
export async function vibeCheck(
  otherUserData: OtherUserData,
  options: VibeCheckOptions = {}
): Promise<VibeCheckResult> {
  const startTime = new Date();
  console.log(`🚀 Starting vibe check for ${otherUserData?.name || 'unknown user'} at ${startTime.toISOString()}`);
  
  try {

    console.log('Other user data:', JSON.stringify(otherUserData, null, 2));
    if (!otherUserData || !otherUserData.intents?.length) {
      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();
      console.log(`❌ Vibe check failed (no data) after ${durationMs}ms`);
      return { 
        success: false, 
        error: 'No other user data or matched intents provided',
        timing: {
          startTime,
          endTime,
          durationMs
        }
      };
    }

    const { timeout = 30000, characterLimit } = options;

    // System message: Define role, tone, and format
    const systemMessage = {
      role: "system",
      content: `You are a collaboration synthesis generator. Create a warm, practical paragraph explaining why two people are mutual matches based on what they're explicitly looking for.

Style:
- Warm and friendly, not formal (we're introducing humans, not robots)
- Grounded in stated needs (state what they're explicitly looking for, not speculative "could do" scenarios)
- Direct and concise
- Add a small human touch—a light joke, casual aside, or relatable moment. Keep it natural, like you're telling a friend about this match.

Format:
- Markdown with 2-3 inline hyperlinks: [descriptive phrase](https://index.network/intents/ID)
- Link natural phrases like "UX designers crafting interfaces" not "UX designers (link)"
- Place links in beginning/middle of paragraph, not at the end
- No bold, italic, or title${characterLimit ? `\n- Maximum ${characterLimit} characters` : ''}

Structure:
- Start with what the authenticated user (you) is explicitly looking for
- State what the other person provides or is looking for (based on relevance analysis)
- Explain the mutual fit using present tense and direct language
- Address reader as "you" vs the other person by first name only
- Single paragraph, can use line breaks`
    };

    // User message: Provide authenticated user's intents and their relevance to other user
    const yourIntentsXml = otherUserData.intents
      .slice(0, 10)
      .map((intent) => {
        return `  <your_intent id="${intent.id}">
    <what_you_want>${intent.payload}</what_you_want>
    <relevance_to_them>${intent.most_valuable_reason.reasoning}</relevance_to_them>
  </your_intent>`;
      })
      .join('\n');

    const userMessage = {
      role: "user",
      content: `Generate collaboration synthesis between you (authenticated user) and ${otherUserData.name}.

<other_person>
  <name>${otherUserData.name}</name>
  <bio>${otherUserData.intro}</bio>
</other_person>

<your_intents>
${yourIntentsXml}
</your_intents>

<examples>
  <good>"You're looking for [coordination without platforms](https://index.network/intents/ID) and ${otherUserData.name} is designing agent-led systems to negotiate access. They're working on exactly the context-aware coordination primitives you need—this is the match."</good>
  
  <good>"You want to [build better dashboards](https://index.network/intents/ID) and ${otherUserData.name} is obsessed with data viz. They've got the visual design expertise you're looking for (shocking how rare this combo is)."</good>
  
  <good>"${otherUserData.name} runs [community events for developers](https://index.network/intents/ID) and you need beta testers. They have exactly the developer audience you're trying to reach."</good>
  
  <good>"You're building [alignment tools](https://index.network/intents/ID) and ${otherUserData.name} writes about AI safety frameworks. Your implementation work matches their theoretical expertise—bridges theory and practice, pretty rare combo."</good>
  
  <good>"You're looking for [someone to jam on music](https://index.network/intents/ID) and ${otherUserData.name} built a collaborative music app. They're actively looking for musicians to test it with."</good>
  
  <good>"You need help [scaling APIs](https://index.network/intents/ID) and ${otherUserData.name} has done this twice before. They have the exact experience you're looking for."</good>
  
  <good>"You're trying to [understand Web3 gaming](https://index.network/intents/ID) and ${otherUserData.name} shipped three games. They're looking to advise people getting into the space—perfect fit."</good>
</examples>`
    };

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Vibe check timeout')), timeout);
    });

    const vibeCall = traceableLlm(
      "vibe-checker",
      {
        other_user_id: otherUserData.id,
        other_user_name: otherUserData.name,
        matched_intents_count: otherUserData.intents.length
      }
    );

    console.log(JSON.stringify([systemMessage, userMessage], null, 2));

    //console.log('Vibe check call:', [systemMessage, userMessage]);
    const response = await Promise.race([
      vibeCall([systemMessage, userMessage], { reasoning: { exclude: true, effort: 'minimal' } }),
      timeoutPromise
    ]);

    const synthesis = (response.content as string).trim();

    console.log(`Synthesis: ${synthesis}`);
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    console.log(`✅ Generated vibe check for ${otherUserData.name}: ${synthesis.length} characters in ${durationMs}ms`);
    console.log(`🏁 Vibe check completed at ${endTime.toISOString()}`);

    return {
      success: true,
      synthesis,
      timing: {
        startTime,
        endTime,
        durationMs
      }
    };

  } catch (error) {
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();
    
    console.error(`❌ Error checking vibe for ${otherUserData?.name || 'unknown user'} after ${durationMs}ms:`, error);
    console.log(`🏁 Vibe check failed at ${endTime.toISOString()}`);
    
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      timing: {
        startTime,
        endTime,
        durationMs
      }
    };
  }
}
