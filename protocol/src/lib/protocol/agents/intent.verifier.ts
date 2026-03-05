import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { protocolLogger } from "../support/protocol.logger";
import { Timed } from "../../performance";

const logger = protocolLogger("SemanticVerifier");

/**
 * Config
 */
import { config } from "dotenv";
config({ path: '.env.development', override: true });


const model = new ChatOpenAI({
  model: 'google/gemini-2.5-flash',
  configuration: { baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY }
});
// ──────────────────────────────────────────────────────────────
// 1. SYSTEM PROMPT
// ──────────────────────────────────────────────────────────────

const systemPrompt = `
You are the Semantic Verification Engine for the Index Network — an intent-driven discovery protocol.

Your job: classify a user utterance using Searle's Speech Act Theory, then score its felicity conditions.

Always reason before classifying. Output reasoning first.

═══════════════════════════════════════════════════
STEP 1 — CLASSIFY THE ILLOCUTIONARY ACT
═══════════════════════════════════════════════════

Work through this decision tree in order. Stop at the first matching branch.

IF the utterance cancels, terminates, or declares a state change (e.g., "I quit", "Project cancelled", "This position is closed"):
  → DECLARATION

ELSE IF the utterance expresses a search, need, or request for another party — even without an explicit verb or first-person subject:
  → DIRECTIVE

  DIRECTIVE trigger patterns (any of these → DIRECTIVE):
  · "Looking for [X]"          · "Seeking [X]"
  · "In search of [X]"         · "Need a [X]"
  · "Want to find [X]"         · "Interested in connecting with [X]"
  · "Open to [X]"              · "Hiring [X]"
  · "Would love to meet [X]"   · "Anyone know [X]"

  KEY RULE: A verbless gerundive like "Looking for artists for collaboration" IS a DIRECTIVE.
  The missing first-person subject ("I am") is routinely elided in natural intent language.
  The illocutionary force is a search directive aimed at the system, not an assertion about reality.

  DIRECTIVE positive examples:
  · "Looking for artists for collaboration" → DIRECTIVE (elided subject, search intent)
  · "Seeking a technical co-founder in NYC" → DIRECTIVE
  · "Need a PyTorch expert for a 3-month contract" → DIRECTIVE
  · "Open to angel investment opportunities" → DIRECTIVE
  · "Anyone building in the DeSci space?" → DIRECTIVE

  DIRECTIVE negative examples (do NOT classify these as DIRECTIVE):
  · "AI is changing the creative industry" → ASSERTIVE (states a belief, no search)
  · "I built a collaboration platform" → ASSERTIVE/COMMISSIVE (past action, no request)
  · "Collaboration is important" → ASSERTIVE (general belief)

ELSE IF the utterance commits the speaker to a future action:
  → COMMISSIVE

  COMMISSIVE positive examples:
  · "I will deploy the contract by Friday" → COMMISSIVE
  · "I'm going to learn Rust this quarter" → COMMISSIVE
  · "I commit to mentoring two junior devs" → COMMISSIVE

  COMMISSIVE negative examples (do NOT classify these as COMMISSIVE):
  · "I could probably look into it" → too hedged; score sincerity low instead
  · "We should build something cool" → vague, no personal commitment

ELSE IF the utterance states a fact, belief, or opinion with no implied request or commitment:
  → ASSERTIVE

  ASSERTIVE positive examples:
  · "Rust is faster than C++" → ASSERTIVE
  · "I have 10 years of experience in ML" → ASSERTIVE (profile statement, not a request)
  · "The crypto market is volatile" → ASSERTIVE

ELSE IF the utterance expresses a psychological state or social ritual:
  → EXPRESSIVE

  EXPRESSIVE examples: "I'm so excited!", "Hello everyone", "Congrats to the team"

If none of the above apply cleanly:
  → UNKNOWN

═══════════════════════════════════════════════════
STEP 2 — SCORE THE FELICITY CONDITIONS (0–100)
═══════════════════════════════════════════════════

Score AFTER classification. Do not let scores influence the category decision.

CLARITY (Essential Condition)
  How unambiguous and actionable is the utterance?
  100 → "Deploy the Solidity contract to Mainnet by March 15"
   60 → "Looking for a developer" (clear direction, vague spec)
   20 → "We should do something cool"

AUTHORITY (Preparatory Condition)
  Does the speaker's profile support this act?
  Compare stated skills/role against the action or search domain.
  100 → Profile: Senior ML Engineer | Utterance: "Seeking a research collaborator on transformers"
   20 → Profile: Junior Marketer | Utterance: "I will rewrite the Rust compiler"
  For DIRECTIVEs: authority = plausibility that this person would make this search.

SINCERITY (Sincerity Condition)
  Does the linguistic form imply genuine commitment or genuine need?
  For COMMISSIVEs: check modality (will > going to > might > could).
  For DIRECTIVEs: check specificity of the search (specific need > vague wish).
  100 → "I need a Rails contractor starting next week, $150/hr, remote"
   40 → "I could maybe try to find someone"

SEMANTIC ENTROPY (Constraint Density) → semantic_entropy field, range 0.0–1.0
  0.0 = maximally constrained (time, location, tech stack, quantifiers all present)
  1.0 = no constraints at all
  0.0 example: "Meet 50 senior React devs in SF by Friday"
  1.0 example: "Network"

REFERENTIAL ANCHOR → referential_anchor field
  Does the utterance name a specific unique entity (Donnellan referential use)?
  If YES → output the entity name string.
  If NO (attributive reference to any member of a class) → output null.
  "I want to join Google" → "Google"
  "I want to join a startup" → null

═══════════════════════════════════════════════════
STEP 3 — FLAGS
═══════════════════════════════════════════════════

Add flags when scores fall below threshold:
  authority < 70  → "SKILL_MISMATCH"
  sincerity < 70  → "WEAK_COMMITMENT"
  clarity < 50    → "VAGUE_INTENT"
  classification is ASSERTIVE or EXPRESSIVE → "NOISE"
`;

// ──────────────────────────────────────────────────────────────
// 2. RESPONSE SCHEMA (Zod)
// ──────────────────────────────────────────────────────────────

const responseFormat = z.object({
  // reasoning comes first so the model commits to its analysis
  // before the classification token is generated (chain-of-thought anchor)
  reasoning: z.string().describe(
    "Step-by-step analysis: (1) which decision-tree branch fired and why, " +
    "(2) key surface features of the utterance (trigger keywords, elided subject, modality), " +
    "(3) felicity condition assessment."
  ),

  classification: z.enum([
    "COMMISSIVE",
    "DIRECTIVE",
    "ASSERTIVE",
    "EXPRESSIVE",
    "DECLARATION",
    "UNKNOWN"
  ]).describe("Searle's Speech Act category — determined by the decision tree in STEP 1"),

  felicity_scores: z.object({
    clarity: z.number().min(0).max(100).describe("Essential Condition: how unambiguous and actionable is the utterance (0–100)"),
    authority: z.number().min(0).max(100).describe("Preparatory Condition: does the speaker's profile support this act (0–100)"),
    sincerity: z.number().min(0).max(100).describe("Sincerity Condition: does the linguistic form imply genuine commitment or need (0–100)"),
  }),

  semantic_entropy: z.number().min(0).max(1).describe(
    "Constraint density: 0.0 = maximally specific (time + location + tech + quantifiers), 1.0 = completely unconstrained"
  ),

  referential_anchor: z.string().nullable().describe(
    "Named specific entity the utterance refers to (Donnellan referential), or null for attributive reference"
  ),

  flags: z.array(z.string()).describe(
    "Semantic violation tags: SKILL_MISMATCH (authority<70), WEAK_COMMITMENT (sincerity<70), VAGUE_INTENT (clarity<50), NOISE (ASSERTIVE or EXPRESSIVE)"
  ),
});

// ──────────────────────────────────────────────────────────────
// 3. TYPE DEFINITIONS
// ──────────────────────────────────────────────────────────────

export type SemanticVerifierOutput = z.infer<typeof responseFormat>;

// ──────────────────────────────────────────────────────────────
// 4. CLASS DEFINITION
// ──────────────────────────────────────────────────────────────

export class SemanticVerifier {
  private model: any;

  constructor() {
    this.model = model.withStructuredOutput(responseFormat, {
      name: "semantic_verifier"
    });
  }

  /**
   * Verifies the semantic validity of an intent.
   * @param content - The user's raw utterance.
   * @param context - The User Profile as a JSON string.
   */
  @Timed()
  public async invoke(content: string, context: string) {
    logger.verbose(`[SemanticVerifier.invoke] Verifying: "${content.substring(0, 30)}..."`);

    const prompt = `
      # User Profile (Context)
      ${context}

      # User Utterance (Content)
      "${content}"
      
      Verify the Felicity Conditions and Semantic Metrics for this utterance.
    `;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt)
    ];

    try {
      const result = await this.model.invoke(messages);
      const output = responseFormat.parse(result);

      logger.verbose(`[SemanticVerifier.invoke] Verdict: ${output.classification} Entropy: ${output.semantic_entropy}`);
      return output;
    } catch (error) {
      logger.error("[SemanticVerifier] Error during invocation", { error });
      throw error;
    }
  }

  /**
   * Factory method to expose the agent as a LangChain tool.
   */
  public static asTool() {
    return tool(
      async (args: { content: string; context: string }) => {
        const agent = new SemanticVerifier();
        return await agent.invoke(args.content, args.context);
      },
      {
        name: 'semantic_verifier',
        description: 'Verifies the semantic validity and felicity conditions of an intent.',
        schema: z.object({
          content: z.string().describe('The intent content to verify'),
          context: z.string().describe('The user profile context')
        })
      }
    );
  }
}
