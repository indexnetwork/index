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
  synthesis: z.string().describe("Generate a markdown summary outlining potential collaboration opportunities between the two users. Exclude any collaboration score or unrelated text. Oonly include the markdown synthesis output."),
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
- Always output as markdown and output rich text.
- Use "You" vs "${otherUserData.user.name}" context, and always talk to file content owner as "you". Intent owner is the other user.
- Contextualize user's intents as they wants, thinks, seeks, etc. Dont treat them as a pure database object.
- Focus on concrete collaboration/business/relationship possibilities
- Keep it concise and actionable
- Dont add  "What Could Happen Here" title.
- Output length should be 1000 characters or less.
- Also provide a collaboration/business/relationship score between 0 and 1, where:
  - 0.8-1.0: Highly aligned, complementary skills/interests with clear potential
  - 0.5-0.7: Good alignment with some  opportunities
  - 0.3-0.4: Moderate alignment, limited  potential
  - 0.0-0.2: Poor alignment, minimal  opportunities

------
Examples:

**Founder-Investor Example:**
Your zero-knowledge identity protocol addresses exactly what Sarah is looking for in her next investment. She's specifically seeking privacy-tech startups with strong technical foundations and clear go-to-market strategies.

Potential collaboration:
– Sarah could lead your Series A round with her expertise in privacy regulations
– Her portfolio connections in fintech could accelerate customer acquisition
– Together, you could shape the narrative around compliant privacy infrastructure

**Sales Example:**
You're building AI-powered customer analytics while Marcus specializes in enterprise sales for B2B SaaS. His track record shows he's closed $2M+ deals with Fortune 500 companies in the data space.

Potential collaboration:
– Marcus could drive enterprise sales for your analytics platform
– His existing relationships could fast-track pilot programs
– Your technical product could enhance his consulting offerings

**Hiring Example:**
Your fintech startup needs a senior backend engineer, and Alex has 8 years building scalable payment systems at Stripe and Square. She's seeking a lead engineering role at an early-stage company.

Potential collaboration:
– Alex could architect your payment infrastructure from the ground up
– Her experience scaling systems could prevent costly technical debt
– Perfect timing as she's transitioning from big tech to startup environment

**Partnership Example:**
You're developing creator economy tools while Jamie runs a successful influencer marketing agency. She's looking for tech partners to enhance her service offerings.

Potential collaboration:
– Integrate your tools into Jamie's client workflows
– Co-develop features based on real creator needs
– Joint go-to-market strategy targeting mid-tier influencers

**Mentorship Example:**
Your product design background aligns with what David offers as a mentor. He's a former Head of Design at Airbnb who specifically helps early-stage founders improve user experience.

Potential collaboration:
– Regular design reviews and strategic UX guidance
– Introduction to his network of design talent for hiring
– Validation of your product direction from an experienced practitioner

------
Default Example: 

Since you're looking for coordination without platforms and trust-preserving discovery, Seren is designing agent-led systems to negotiate access based on context, while the other is exploring intent schemas that don't rely on reputation scores or central visibility.

Together, you could co-develop a context-aware coordination primitive:
– Agents that interpret and match intents without revealing identity
– A shared layer for discovery across personal data stores
– A working prototype that shows how agents from different graphs collaborate securely

This isn't just adjacent thinking — it's a chance to push the boundaries of what intent-based coordination can look like when it's real, composable, and private by default.`;

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Vibe check timeout')), timeout);
    });

    console.log('Prompt:', prompt);
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
