/**
 * Vibe Checker Agent
 * 
 * Generates "What Could Happen Here" synthesis text for user collaboration opportunities.
 */

import { llm } from "../../../lib/agents";

// Type definitions
export interface VibeCheckResult {
  success: boolean;
  synthesis?: string;
  error?: string;
}

export interface VibeCheckOptions {
  timeout?: number;
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
  try {
    if (!userData || !userData.intents?.length) {
      return { success: false, error: 'No user data or intents provided' };
    }

    const { timeout = 30000 } = options;

    console.log(JSON.stringify(userData.intents, null, 2));

    const prompt = `Generate a "What Could Happen Here" collaboration synthesis markdown text.

USER: ${userData.name}
INTRO: ${userData.intro}

INTENT CONTEXTS AND AGENT REASONING:
${userData.intents.map(intent => `
- Intent: ${intent.payload}
- Intent Link: /intents/${intent.id}
- Agent Analysis: ${intent.reasons.map(r => r.reasoning).join('; ')}
`).join('\n')}

GUIDELINES:
- Always output as markdown.
- Use "You" vs "${userData.name}" context
- You must ad inline markdown links for intents when referring to them: /intents/:id
- Contextualize user's intents as they wants, thinks, seeks, etc. Dont treat them as a pure database object.
- Focus on concrete collaboration possibilities
- Write in second person addressing the current user
- Keep it concise and actionable
- Dont add  "What Could Happen Here" title.


------
Example: 

Since you’re looking for [coordination without platforms](/intents/12345) and [trust-preserving discovery](/intents/67890). Seren is designing agent-led systems to negotiate access based on context, while the other is exploring intent schemas that don’t rely on reputation scores or central visibility.

Together, you could co-develop a context-aware coordination primitive:
– Agents that interpret and match intents without revealing identity
– A shared layer for discovery across personal data stores
– A working prototype that shows how agents from different graphs collaborate securely

This isn’t just adjacent thinking — it’s a chance to push the boundaries of what intent-based coordination can look like when it’s real, composable, and private by default.

`;

    console.log(prompt);
    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Vibe check timeout')), timeout);
    });

    const response = await Promise.race([
      llm.invoke(prompt),
      timeoutPromise
    ]);

    const synthesis = (response.content as string).trim();

    console.log(`✅ Generated vibe check for ${userData.name}: ${synthesis.length} characters`);

    return {
      success: true,
      synthesis
    };

  } catch (error) {
    console.error(`❌ Error checking vibe for ${userData.name}:`, error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Batch process multiple users
 */
export async function checkMultipleVibes(
  users: UserData[],
  options: VibeCheckOptions = {}
): Promise<VibeCheckResult[]> {
  const promises = users.map(user => vibeCheck(user, options));
  return Promise.all(promises);
}
