/**
 * Lens Inferrer Agent: analyzes source text (intent or query) with optional
 * profile context and infers 1-N search lenses, each tagged with a target corpus.
 * Replaces the hardcoded HydeStrategy enum and regex-based selectStrategiesFromQuery.
 */
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { Timed } from "../../performance";
import { protocolLogger } from '../support/protocol.logger';

export type HydeTargetCorpus = 'profiles' | 'intents';

/** A single inferred lens — a search perspective the LLM decided is relevant. */
export interface Lens {
  /** Free-text description (e.g. "crypto infrastructure VC"). */
  label: string;
  /** Which vector index to search: user profiles or user intents. */
  corpus: HydeTargetCorpus;
  /** Why this perspective is relevant (for logging/trace). */
  reasoning: string;
}

export interface LensInferenceInput {
  /** Intent payload or search query. */
  sourceText: string;
  /** User's profile summary for domain context (optional). */
  profileContext?: string;
  /** Maximum number of lenses to infer (default 3). */
  maxLenses?: number;
}

export interface LensInferenceOutput {
  lenses: Lens[];
}

const SYSTEM_PROMPT = `You analyze goals and search queries to identify the most relevant perspectives for finding matching people in a professional network.

For each perspective you identify, specify:
1. A clear, specific description of who or what to search for
2. Whether to search "profiles" (user bios, expertise, backgrounds) or "intents" (stated goals, needs, aspirations)
3. A brief reason why this perspective is relevant

Guidelines:
- Be specific and domain-aware. "early-stage crypto infrastructure investor" is better than "investor".
- Consider both sides: who can help the person AND whose goals complement theirs.
- When user context is provided, tailor perspectives to their domain (e.g. a DePIN founder searching for "investors" needs crypto-native infra investors specifically).
- Generate only perspectives that add distinct search value — don't repeat similar angles.
- Use "profiles" when looking for a type of person (expert, advisor, leader). Use "intents" when looking for a complementary goal or need (someone raising, someone hiring, someone seeking collaboration).
- Always include at least one "profiles" perspective when the source describes a need that a specific type of professional could fulfill. Most intents benefit from profile-based discovery.`;

const responseFormat = z.object({
  lenses: z.array(z.object({
    label: z.string().describe('Specific description of the search perspective'),
    corpus: z.enum(['profiles', 'intents']).describe('Search user profiles or user intents'),
    reasoning: z.string().describe('Why this perspective is relevant'),
  })).min(1).max(5).describe('Inferred search lenses'),
});

const model = new ChatOpenAI({
  model: 'google/gemini-2.5-flash',
  configuration: { baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY }
});

const logger = protocolLogger("LensInferrer");

/**
 * Infers search lenses from source text and optional profile context.
 * Each lens represents a search perspective tagged with a target corpus
 * (profiles or intents) for downstream HyDE document generation.
 */
export class LensInferrer {
  private model = model.withStructuredOutput(responseFormat, {
    name: "lens_inferrer",
  });

  /**
   * Infer search lenses from source text and optional profile context.
   *
   * @param input - Source text, optional profile context, optional max lenses
   * @returns Array of inferred lenses with corpus tags; empty array on failure
   */
  @Timed()
  async infer(input: LensInferenceInput): Promise<LensInferenceOutput> {
    const { sourceText, profileContext, maxLenses = 3 } = input;

    logger.verbose('Inferring lenses', {
      sourceTextLength: sourceText.length,
      hasProfileContext: !!profileContext,
      maxLenses,
    });

    let humanPrompt = `Identify up to ${maxLenses} search perspectives for finding relevant matches.\n\nSource: "${sourceText}"`;

    if (profileContext) {
      humanPrompt += `\n\nUser context: ${profileContext}`;
    }

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(humanPrompt),
    ];

    try {
      const result = await this.model.invoke(messages);
      const parsed = responseFormat.parse(result);
      const lenses = parsed.lenses.slice(0, maxLenses);

      logger.verbose('Lenses inferred', {
        count: lenses.length,
        lenses: lenses.map(l => ({ label: l.label, corpus: l.corpus })),
      });

      return { lenses };
    } catch (error: unknown) {
      logger.error('Lens inference failed', { error });
      return { lenses: [] };
    }
  }
}
