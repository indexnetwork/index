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

export interface UserIntent {
  id: string;
  payload: string;
  reasons: Array<{
    agent_name: string;
    agent_id: string;
    reasoning: string;
  }>;
}

export interface UserData {
  id: string;
  name: string;
  intro: string;
  intents: UserIntent[];
}

/**
 * Generate collaboration synthesis for a user
 */
export async function vibeCheck(
  userData: UserData,
  options: VibeCheckOptions = {}
): Promise<VibeCheckResult> {
  const startTime = new Date();
  console.log(`🚀 Starting vibe check for ${userData?.name || 'unknown user'} at ${startTime.toISOString()}`);
  
  try {
    if (!userData || !userData.intents?.length) {
      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();
      console.log(`❌ Vibe check failed (no data) after ${durationMs}ms`);
      return { 
        success: false, 
        error: 'No user data or intents provided',
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
- Warm and friendly, not formal
- Real and practical (no hypotheticals)
- Direct and concise

Format:
- Markdown with 2-3 inline hyperlinks: [descriptive phrase](https://index.network/intents/ID)
- Link natural phrases like "UX designers crafting interfaces" not "UX designers (link)"
- Place links in beginning/middle of paragraph, not at the end
- No bold, italic, or title${characterLimit ? `\n- Maximum ${characterLimit} characters` : ''}

Structure:
- Address reader as "you" vs the other person by first name only
- Describe their work/interests from agent analysis
- Focus on concrete collaboration possibilities
- Single paragraph, can use line breaks`
    };

    // User message: Provide intent data and task
    const intentContext = userData.intents.slice(0, 10).map(intent => 
      `- "${intent.payload}" (ID: ${intent.id})\n  Analysis: ${intent.reasons.map(r => r.reasoning).join('; ')}`
    ).join('\n');

    const userMessage = {
      role: "user",
      content: `Generate collaboration synthesis for you + ${userData.name}.

### ${userData.name}'s Profile
Bio: ${userData.intro}
Intents:
${intentContext}

### Examples
✅ "Since you're looking for [coordination without platforms](https://index.network/intents/ID), ${userData.name} is designing agent-led systems to negotiate access. Together, you could co-develop a context-aware coordination primitive."

✅ "By teaming up with [React developers](https://index.network/intents/ID), you can build the interface while ${userData.name} handles [backend architecture](https://index.network/intents/ID)."

Generate synthesis:`
    };

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Vibe check timeout')), timeout);
    });

    const vibeCall = traceableLlm(
      "vibe-checker",
      {
        user_id: userData.id,
        user_name: userData.name,
        intents_count: userData.intents.length
      }
    );

    const response = await Promise.race([
      vibeCall([systemMessage, userMessage], { reasoning: { exclude: true, effort: 'minimal' } }),
      timeoutPromise
    ]);

    const synthesis = (response.content as string).trim();

    console.log(`Synthesis: ${synthesis}`);
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    console.log(`✅ Generated vibe check for ${userData.name}: ${synthesis.length} characters in ${durationMs}ms`);
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
    
    console.error(`❌ Error checking vibe for ${userData?.name || 'unknown user'} after ${durationMs}ms:`, error);
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
