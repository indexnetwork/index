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
- Use HTML links sparingly for only the most important intents: <a href="https://index.network/intents/:id">intent text</a>
- Use HTML formatting: <strong>, <em>, <p>, <ul>, <li> as appropriate`
      : `- Always output as markdown.
- Add inline markdown links only for the most important intents: https://index.network/intents/:id
- Do not use bold (**) or italic (*) formatting`;

    const lengthInstructions = characterLimit 
      ? `- Keep the response under ${characterLimit} characters.`
      : '- Keep it concise and actionable';

    const exampleOutput = outputFormat === 'html'
      ? `Since you're looking for <a href="https://index.network/intents/12345">coordination without platforms</a> and trust-preserving discovery, Seren is designing agent-led systems to negotiate access based on context, while the other is exploring intent schemas that don't rely on reputation scores or central visibility.

<p>Together, you could co-develop a context-aware coordination primitive: agents that interpret and match intents without revealing identity, a shared layer for discovery across personal data stores, and a working prototype that shows how agents from different graphs collaborate securely. This isn't just adjacent thinking — it's a chance to push the boundaries of what intent-based coordination can look like when it's real, composable, and private by default.</p>`
      : `Since you're looking for [coordination without platforms](https://index.network/intents/12345) and trust-preserving discovery, Seren is designing agent-led systems to negotiate access based on context, while the other is exploring intent schemas that don't rely on reputation scores or central visibility.

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
- Make links contextual and readable: "early adopters testing discovery systems" not "early adopters seeking early adopters"
- Position links where they enhance understanding, not interrupt flow`;

    const prompt = `Generate a "What Could Happen Here" collaboration synthesis text.

SUGGESTED USER: ${userData.name}
SUGGESTED USER INTRO: ${userData.intro}

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
- When referring to intents, hyperlink key phrases that naturally flow in the text - you must avoid parenthetical meta descriptions like "(link)"
- Position hyperlinks for optimal readability - link the most descriptive and contextual parts of sentences
- Use maximum 3 hyperlinks total - only link the most important/relevant intents
- Write in second person addressing the current user
- Keep response to maximum 2 paragraphs
${lengthInstructions}
- Dont add "What Could Happen Here" title.

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
        intents_count: userData.intents.length,
        output_format: outputFormat
      }
    );
    const response = await Promise.race([
      vibeCall(prompt),
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
