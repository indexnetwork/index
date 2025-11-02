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
  reasons: Array<{
    agent_name: string;
    agent_id: string;
    reasoning: string;
  }>;
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
      content: `You are a collaboration synthesis generator. Create a warm, practical paragraph describing what two people could do together.

Style:
- Warm and friendly, not formal (we're introducing humans, not robots)
- Real and practical (no hypotheticals)
- Direct and concise
- Add a small human touch—a light joke, casual aside, or relatable moment. Keep it natural, like you're telling a friend about this match.

Format:
- Markdown with 2-3 inline hyperlinks: [descriptive phrase](https://index.network/intents/ID)
- Link natural phrases like "UX designers crafting interfaces" not "UX designers (link)"
- Place links in beginning/middle of paragraph, not at the end
- No bold, italic, or title${characterLimit ? `\n- Maximum ${characterLimit} characters` : ''}

Structure:
- Start with an energetic first sentence that hooks the reader
- Address reader as "you" vs the other person by first name only
- Describe their work/interests from agent analysis
- Focus on concrete collaboration possibilities
- Single paragraph, can use line breaks`
    };

    // User message: Provide authenticated user's intents and their relevance to other user
    const yourIntentsXml = otherUserData.intents
      .slice(0, 10)
      .map((intent) => {
        const relevance = intent.reasons
          .map((r) => r.reasoning)
          .join('; ');
        return `  <your_intent id="${intent.id}">
    <what_you_want>${intent.payload}</what_you_want>
    <relevance_to_them>${relevance}</relevance_to_them>
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
  <good>"Since you're looking for [coordination without platforms](https://index.network/intents/ID), ${otherUserData.name} is designing agent-led systems to negotiate access. Together, you could co-develop a context-aware coordination primitive—might finally crack this thing."</good>
  
  <good>"You want to [build better dashboards](https://index.network/intents/ID) and ${otherUserData.name} is obsessed with data viz. Team up to prototype something users actually want to look at (shocking concept, we know)."</good>
  
  <good>"${otherUserData.name} runs [community events for developers](https://index.network/intents/ID) and you're hunting for beta testers. Perfect match—you get real users, they get cool demos to show off."</good>
  
  <good>"While ${otherUserData.name} writes about [AI safety frameworks](https://index.network/intents/ID), you're building [alignment tools](https://index.network/intents/ID). Could co-author something that bridges theory and practice, honestly pretty rare combo."</good>
  
  <good>"You're looking for [someone to jam on music](https://index.network/intents/ID) and ${otherUserData.name} literally built a collaborative music app. Make some noise together, see what happens."</good>
  
  <good>"${otherUserData.name} needs help [scaling their API](https://index.network/intents/ID) and you've done this twice before. Share war stories, save them some headaches. You know how this goes."</good>
  
  <good>"You're trying to [understand Web3 gaming](https://index.network/intents/ID), ${otherUserData.name} shipped three of them. Grab coffee, pick their brain—this stuff makes way more sense when someone's actually built it."</good>
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
