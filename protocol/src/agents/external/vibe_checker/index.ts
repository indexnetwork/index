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
  outputFormat?: 'markdown' | 'html';
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
  try {
    if (!userData || !userData.intents?.length) {
      return { success: false, error: 'No user data or intents provided' };
    }

    const { timeout = 30000, outputFormat = 'markdown', characterLimit } = options;

    const formatInstructions = outputFormat === 'html' 
      ? `- Always output as HTML.
- Use HTML links for intents: <a href="https://index.network/intents/:id">intent text</a>
- Use HTML formatting: <strong>, <em>, <p>, <ul>, <li> as appropriate`
      : `- Always output as markdown.
- You must always add inline markdown links for intents when referring to them.: https://index.network/intents/:id`;

    const lengthInstructions = characterLimit 
      ? `- Keep the response under ${characterLimit} characters.`
      : '- Keep it concise and actionable';

    const exampleOutput = outputFormat === 'html'
      ? `Since you're looking for <a href="https://index.network/intents/12345">coordination without platforms</a> and <a href="https://index.network/intents/67890">trust-preserving discovery</a>. Seren is designing agent-led systems to negotiate access based on context, while the other is exploring intent schemas that don't rely on reputation scores or central visibility.

<p>Together, you could co-develop a context-aware coordination primitive:</p>
<ul>
<li>Agents that interpret and match intents without revealing identity</li>
<li>A shared layer for discovery across personal data stores</li>
<li>A working prototype that shows how agents from different graphs collaborate securely</li>
</ul>

<p>This isn't just adjacent thinking — it's a chance to push the boundaries of what intent-based coordination can look like when it's real, composable, and private by default.</p>`
      : `Since you're looking for [coordination without platforms](https://index.network/intents/12345) and [trust-preserving discovery](https://index.network/intents/67890). Seren is designing agent-led systems to negotiate access based on context, while the other is exploring intent schemas that don't rely on reputation scores or central visibility.

Together, you could co-develop a context-aware coordination primitive:
– Agents that interpret and match intents without revealing identity
– A shared layer for discovery across personal data stores
– A working prototype that shows how agents from different graphs collaborate securely

This isn't just adjacent thinking — it's a chance to push the boundaries of what intent-based coordination can look like when it's real, composable, and private by default.`;

    const prompt = `Generate a "What Could Happen Here" collaboration synthesis text.

USER: ${userData.name}
INTRO: ${userData.intro}

INTENT CONTEXTS AND AGENT REASONING:
${userData.intents.map(intent => `
- Intent Text: ${intent.payload}
- Intent Link: /intents/${intent.id}
- Agent Analysis: ${intent.reasons.map(r => r.reasoning).join('; ')}
`).join('\n')}

GUIDELINES:
${formatInstructions}
- Use "You" vs "${userData.name}" context
- Contextualize user's intents as they wants, thinks, seeks, etc. Dont treat them as a pure database object.
- Focus on concrete collaboration possibilities
- When referring to intents, be consistent with the actual intent text as the link text
- You should add exactly one link per intent.
- Always add inline markdown links for intents when referring to them, but do not hallucinate links or link texts, only use intent links provided..
- Write in second person addressing the current user
${lengthInstructions}
- Dont add "What Could Happen Here" title.

------
Example: 

${exampleOutput}

`;

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Vibe check timeout')), timeout);
    });

    console.log('prompt', prompt);
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
