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

    const formatInstructions = `- Always output as markdown.
- Add inline markdown links only for the most important intents: [intent text](https://index.network/intents/:id)
- Do not use bold (**) or italic (*) formatting`;

    const lengthInstructions = characterLimit 
      ? `- Keep the response under ${characterLimit} characters.`
      : '- Keep it concise and actionable';

    const exampleOutput = `Since you're looking for [coordination without platforms](https://index.network/intents/12345) and trust-preserving discovery, Seren is designing agent-led systems to negotiate access based on context, while the other is exploring intent schemas that don't rely on reputation scores or central visibility.

Together, you could co-develop a context-aware coordination primitive: agents that interpret and match intents without revealing identity, a shared layer for discovery across personal data stores, and a working prototype that shows how agents from different graphs collaborate securely. This isn't just adjacent thinking — it's a chance to push the boundaries of what intent-based coordination can look like when it's real, composable, and private by default.`;

    const fewShotExamples = `
GOOD EXAMPLES (DO):
✅ "By teaming up with [UX designers crafting agent interfaces](https://index.network/intents/123), you can prototype accessible dashboards."
✅ "Partner with [social media influencers](https://index.network/intents/456) to showcase the staking model to broader audiences."
✅ "Collaborate with [early adopters testing discovery systems](https://index.network/intents/789) for real-world feedback."

BAD EXAMPLES (DON'T):
❌ "By teaming up with UX designers (link) you can prototype dashboards."
❌ "Partner with social media influencers (UX design effort) to showcase the model."
❌ "Collaborate with early adopters seeking early adopters to test systems."
❌ "Working with the group searching for UX designers to craft interfaces (UX design effort)."
❌ "Connecting with social media influencers (link) and community managers (community manager outreach)."

HYPERLINK POSITIONING RULES:
- Link descriptive phrases that naturally flow: "UX designers crafting agent interfaces" not "UX designers (link)"
- Avoid meta descriptions in parentheses like "(link)", "(UX design effort)", "(community manager outreach)"
- Make links contextual and readable: "early adopters testing discovery systems" not "early adopters seeking early adopters" but not too long.
- Position links where they enhance understanding, not interrupt flow`;

    const prompt = `Generate a "What Could Happen Here" (what these two people can do together) collaboration synthesis text.


INTENT CONTEXTS AND AGENT REASONING:
${userData.intents.slice(0, 10).map(intent => `
- Intent Text: ${intent.payload}
- Intent Link: /intents/${intent.id}
- Agent Analysis: ${intent.reasons.map(r => r.reasoning).join('; ')}
`).join('\n')}

GUIDELINES:
${formatInstructions}
- Be concise. Cut the bullshit, no imaginary things. Be real and practical.
- Use warm and friendly tone.
- Dont justify, just share what they can do together.

- Use "You" vs "${userData.name}" context
- When talking about other, suggested user, use their name ( no surnames) as ${userData.name} and bio as "${userData.intro}"
- Contextualize user's intents as they wants, thinks, seeks, etc. Dont treat them as a pure database object.
- Focus on concrete collaboration possibilities
- When referring to intents, hyperlink key phrases that naturally flow in the text - you must avoid parenthetical meta descriptions like "(link)"
- Position hyperlinks for optimal position in the text - link the most descriptive and contextual parts of sentences.
- Dont add hyperlinks to the end of paragraph.  Beginning and middle is good.
- Use at least 2 but maximum 3 hyperlinks total - only link the most important/relevant intents
- Keep response to maximum 1 paragraph length, but you can add new lines.

${lengthInstructions}
- Dont add "What Could Happen Here" title.
- Dont start with name or intro. 

------
${fewShotExamples}

------
Example Output: 

${exampleOutput}

`;

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Vibe check timeout')), timeout);
    });

    const vibeCall = traceableLlm(
      "vibe-check-synthesis",
      [],
      {
        user_id: userData.id,
        user_name: userData.name,
        intents_count: userData.intents.length
      }
    );

    console.log(`Prompt: ${prompt}`);
    const response = await Promise.race([
      vibeCall(prompt),
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
