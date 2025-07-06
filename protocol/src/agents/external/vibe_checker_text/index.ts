/**
 * Vibe Checker Agent
 * 
 * Generates "What Could Happen Here" synthesis text for user collaboration opportunities.
 * Takes file text from one user, infers their intent, and compares with another person's intents.
 */

import { llm } from "../../../lib/agents";
import { z } from "zod";

// Type definitions
export interface VibeCheckResult {
  success: boolean;
  synthesis?: string;
  score?: number;
  error?: string;
}

export interface VibeCheckOptions {
  timeout?: number;
}

export interface UserIntent {
  payload: string;
}

export interface OtherUserData {
  user: {
    id: string;
    name: string;
    intro: string;
  };
  intents: UserIntent[];
}

// Zod schema for structured output
const VibeCheckSchema = z.object({
  synthesis: z.string().describe("Markdown synthesis explaining collaboration possibilities between the two users"),
  score: z.number().min(0).max(1).describe("Collaboration potential score between 0 and 1, where 1 is perfect alignment")
});

/**
 * Generate collaboration synthesis and inferred intent from file text
 */
export async function vibeCheck(
  fileText: string,
  otherUserData: OtherUserData,
  options: VibeCheckOptions = {}
): Promise<VibeCheckResult> {
  try {
    if (!fileText?.trim() || !otherUserData?.intents?.length) {
      return { success: false, error: 'No file text or other user intents provided' };
    }

    const { timeout = 30000 } = options;

    const prompt = `You are going to compare the file content with ${otherUserData.user.name}'s intents to generate a "What Could Happen Here" collaboration synthesis.

FILE CONTENT:
${fileText}

OTHER USER: ${otherUserData.user.name}
INTRO: ${otherUserData.user.intro}
INTENTS:
${otherUserData.intents.map(intent => `- ${intent.payload}`).join('\n')}


GUIDELINES:
- Always output as markdown.
- Use "You" vs "${otherUserData.user.name}" context
- Contextualize user's intents as they wants, thinks, seeks, etc. Dont treat them as a pure database object.
- Focus on concrete collaboration possibilities
- Write in second person addressing the current user
- Keep it concise and actionable
- Dont add  "What Could Happen Here" title.
- Also provide a collaboration score between 0 and 1, where:
  - 0.8-1.0: Highly aligned, complementary skills/interests with clear collaboration potential
  - 0.5-0.7: Good alignment with some collaboration opportunities
  - 0.3-0.4: Moderate alignment, limited collaboration potential
  - 0.0-0.2: Poor alignment, minimal collaboration opportunities

------
Example: 

Since you’re looking for coordination without platforms and trust-preserving discovery, Seren is designing agent-led systems to negotiate access based on context, while the other is exploring intent schemas that don’t rely on reputation scores or central visibility.

Together, you could co-develop a context-aware coordination primitive:
– Agents that interpret and match intents without revealing identity
– A shared layer for discovery across personal data stores
– A working prototype that shows how agents from different graphs collaborate securely

This isn’t just adjacent thinking — it’s a chance to push the boundaries of what intent-based coordination can look like when it’s real, composable, and private by default.`;

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Vibe check timeout')), timeout);
    });

    const modelWithStructure = llm.withStructuredOutput(VibeCheckSchema);
    const response = await Promise.race([
      modelWithStructure.invoke(prompt),
      timeoutPromise
    ]);


    return {
      success: true,
      synthesis: response.synthesis,
      score: response.score,
    };

  } catch (error) {
    console.error(`❌ Error checking vibe:`, error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}
