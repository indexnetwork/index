import { z } from 'zod/v4';

import { getAbortSignalConfig, loggerFor } from '../core/runtime.js';
import type { Model } from '../core/types.js';
import { buildLensInferencePrompt, buildSourceFramePrompt, FRAME_SYSTEM_PROMPT, LENS_SYSTEM_PROMPT } from '../prompts/discovery.prompt.js';
import type { LensInferenceInput, LensInferenceOutput } from './artifact.state.js';
import { FrameResponseSchema, sanitizeHydeSourceFrame } from './frame.schema.js';

const lensSchema = z.object({
  label: z.string().describe('Specific description of the search perspective'),
  corpus: z.enum(['profiles', 'intents']).describe('Search user profiles or user intents'),
  reasoning: z.string().describe('Why this perspective is relevant'),
});

const lensResponseFormat = z.object({
  lenses: z.array(lensSchema).min(1).max(5).describe('Inferred search lenses'),
});

const lensLogger = loggerFor("LensInferrer");

/** Infers search lenses from source text and optional profile context. */
export class LensInferrer {
  constructor(private readonly model: Model) {}

  /**
   * Infer search lenses and extract a source-only frame in parallel.
   * @param input - Source text, optional profile context, and lens limit.
   * @returns Lenses and a sanitized frame; failed inference produces empty output.
   * @throws On cancellation.
   */
  async infer(input: LensInferenceInput): Promise<LensInferenceOutput> {
    const { sourceText, profileContext, maxLenses = 3 } = input;

    lensLogger.verbose('Inferring lenses', {
      sourceTextLength: sourceText.length,
      hasProfileContext: !!profileContext,
      maxLenses,
    });

    const humanPrompt = buildLensInferencePrompt({ sourceText, profileContext, maxLenses });

    const lensPromise = this.model.complete({
      name: 'lens_inferrer', schema: lensResponseFormat,
      messages: [
        { role: 'system', content: LENS_SYSTEM_PROMPT },
        { role: 'user', content: humanPrompt },
      ],
    }, getAbortSignalConfig()).then(result => lensResponseFormat.parse(result).lenses.slice(0, maxLenses));
    const framePromise = this.model.complete({
      name: 'lens_inferrer_frame_v1', schema: FrameResponseSchema,
      messages: [
        { role: 'system', content: FRAME_SYSTEM_PROMPT },
        { role: 'user', content: buildSourceFramePrompt(sourceText) },
      ],
    }, getAbortSignalConfig()).then(result => sanitizeHydeSourceFrame(sourceText, FrameResponseSchema.parse(result).sourceFrame));
    const [lensResult, frameResult] = await Promise.allSettled([lensPromise, framePromise]);

    getAbortSignalConfig().signal?.throwIfAborted();

    if (lensResult.status === 'rejected') {
      lensLogger.error('Lens inference failed', { error: lensResult.reason });
      return { lenses: [] };
    }

    const lenses = lensResult.value;
    lensLogger.verbose('Frame-constrained lenses inferred', { count: lenses.length });

    if (frameResult.status === 'rejected') {
      lensLogger.error('Source frame extraction failed', { error: frameResult.reason });
      return {
        lenses,
        sourceFrame: {
          sourceRoles: [],
          counterpartRoles: [],
          hardConstraints: [],
          namedEntities: [],
          domainVocabulary: [],
        },
      };
    }

    return { lenses, sourceFrame: frameResult.value };
  }
}
