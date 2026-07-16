/**
 * Lens Inferrer Agent: analyzes source text (intent or query) with optional
 * profile context and infers 1-N search lenses, each tagged with a target corpus.
 * Replaces the hardcoded HydeStrategy enum and regex-based selectStrategiesFromQuery.
 */
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

import { createStructuredModel } from "../agent/model.config.js";
import { invokeWithAbortSignal } from "../agent/model-signal.js";
import { protocolLogger } from '../observability/protocol.logger.js';
import { Timed } from "../observability/performance.js";
import { HydeSourceFrameSchema, sanitizeHydeSourceFrame, type HydeSourceFrame } from './hyde.frame.js';

export type HydeTargetCorpus = 'profiles' | 'intents' | 'premises';

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
  /** Use the source-grounded frame-v1 inference path. */
  frameConstrained?: boolean;
}

export interface LensInferenceOutput {
  lenses: Lens[];
  /** Sanitized source frame, present only for frame-constrained inference. */
  sourceFrame?: HydeSourceFrame;
}

const SYSTEM_PROMPT = `You analyze goals and search queries to identify the most relevant perspectives for finding matching people in a professional network.

For each perspective you identify, specify:
1. A clear, specific description of who or what to search for
2. Whether to search "profiles" (user bios, expertise, backgrounds), "intents" (stated goals, needs, aspirations), or "premises" (identity assertions, values, worldview)
3. A brief reason why this perspective is relevant

Guidelines:
- Be specific and domain-aware. "early-stage crypto infrastructure investor" is better than "investor".
- Consider both sides: who can help the person AND whose goals complement theirs.
- When user context is provided, tailor perspectives to their domain (e.g. a DePIN founder searching for "investors" needs crypto-native infra investors specifically).
- Generate only perspectives that add distinct search value — don't repeat similar angles.
- Use "profiles" when looking for a type of person (expert, advisor, leader). Use "intents" when looking for a complementary goal or need (someone raising, someone hiring, someone seeking collaboration). Use "premises" when looking for someone whose identity, values, or worldview aligns — stable traits rather than transient goals.
- Always include at least one "profiles" perspective when the source describes a need that a specific type of professional could fulfill. Most intents benefit from profile-based discovery.
- LOCATION AWARENESS: When the source text or user context mentions a specific location (city, region, country), incorporate it into lens descriptions. For example, "investors in San Francisco" should produce a lens like "SF-based early-stage investor" rather than just "early-stage investor". This helps the hypothetical document generator produce location-specific search documents, improving retrieval quality.`;

/** Source-grounded system prompt used only by the frame-v1 path. */
export const FRAME_LENS_SYSTEM_PROMPT = `You infer search lenses and a source-grounded frame for semantic retrieval.

Lens rules:
- Infer distinct profile, intent, or premise search perspectives.
- You may infer reciprocal target roles and complementary roles (for example, infer "investor" from a source seeking funding).
- profileContext may specialize which lenses are useful, but it is lens-selection context only.

Source-frame rules:
- Extract evidence ONLY from sourceText, never from profileContext.
- Every frame element must include an evidence field copied as an exact substring of sourceText.
- sourceRoles describe roles held or offered by the source side.
- counterpartRoles describe reciprocal or complementary target roles. The role may be inferred, but its evidence must be an exact sourceText span that supports the inference.
- hardConstraints contain only explicit constraints and classify each as location, time, numeric, credential, organization, exclusivity, or other.
- namedEntities contain only proper names explicitly present in sourceText and classify each as person, organization, product, location, event, or other.
- domainVocabulary contains source domain terms worth preserving.
- Do not use profileContext as frame evidence, even when it contains useful names or constraints.`;

const lensSchema = z.object({
  label: z.string().describe('Specific description of the search perspective'),
  corpus: z.enum(['profiles', 'intents', 'premises']).describe('Search user profiles, user intents, or user premises (identity/values)'),
  reasoning: z.string().describe('Why this perspective is relevant'),
});

const responseFormat = z.object({
  lenses: z.array(lensSchema).min(1).max(5).describe('Inferred search lenses'),
});

/** Structured-output schema used only by frame-constrained inference. */
export const FrameLensResponseSchema = z.object({
  lenses: z.array(lensSchema).min(1).max(5).describe('Inferred search lenses'),
  sourceFrame: HydeSourceFrameSchema,
});

type ModelInput = BaseLanguageModelInput;

/** Minimal structured model contract used for deterministic injection in tests. */
export interface LensStructuredModel {
  invoke(input: ModelInput, config?: { signal?: AbortSignal }): Promise<unknown>;
}

export interface LensInferrerOptions {
  legacyModel?: LensStructuredModel;
  frameModel?: LensStructuredModel;
}

const logger = protocolLogger("LensInferrer");

/** Infers search lenses from source text and optional profile context. */
export class LensInferrer {
  private legacyModel?: LensStructuredModel;
  private frameModel?: LensStructuredModel;

  constructor(options: LensInferrerOptions = {}) {
    // Preserve legacy construction behavior in production. Frame-only model
    // injection deliberately avoids constructing a provider-backed legacy model.
    this.legacyModel = options.legacyModel
      ?? (options.frameModel ? undefined : createStructuredModel("lensInferrer", responseFormat, { name: "lens_inferrer" }));
    this.frameModel = options.frameModel;
  }

  private getLegacyModel(): LensStructuredModel {
    this.legacyModel ??= createStructuredModel("lensInferrer", responseFormat, {
      name: "lens_inferrer",
    });
    return this.legacyModel;
  }

  private getFrameModel(): LensStructuredModel {
    this.frameModel ??= createStructuredModel("lensInferrer", FrameLensResponseSchema, {
      name: "lens_inferrer_frame_v1",
    });
    return this.frameModel;
  }

  /** Infer search lenses while preserving the legacy path unless explicitly enabled. */
  @Timed()
  async infer(input: LensInferenceInput): Promise<LensInferenceOutput> {
    const { sourceText, profileContext, maxLenses = 3, frameConstrained = false } = input;

    logger.verbose('Inferring lenses', {
      sourceTextLength: sourceText.length,
      hasProfileContext: !!profileContext,
      maxLenses,
      frameConstrained,
    });

    let humanPrompt = `Identify up to ${maxLenses} search perspectives for finding relevant matches.\n\nSource: "${sourceText}"`;

    if (profileContext) {
      humanPrompt += `\n\nUser context: ${profileContext}`;
    }

    const messages = [
      new SystemMessage(frameConstrained ? FRAME_LENS_SYSTEM_PROMPT : SYSTEM_PROMPT),
      new HumanMessage(humanPrompt),
    ];

    try {
      if (frameConstrained) {
        const result = await invokeWithAbortSignal(this.getFrameModel(), messages);
        const parsed = FrameLensResponseSchema.parse(result);
        const lenses = parsed.lenses.slice(0, maxLenses);
        const sourceFrame = sanitizeHydeSourceFrame(sourceText, parsed.sourceFrame);
        logger.verbose('Frame-constrained lenses inferred', { count: lenses.length });
        return { lenses, sourceFrame };
      }

      const result = await invokeWithAbortSignal(this.getLegacyModel(), messages);
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
