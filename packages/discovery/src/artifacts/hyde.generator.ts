import { z } from 'zod/v4';

import { getAbortSignalConfig, loggerFor } from '../core/runtime.js';
import type { Model } from '../core/types.js';
import { buildFrameHydePrompt, GENERATOR_SYSTEM_PROMPT } from '../prompts/discovery.prompt.js';
import type { HydeGenerateInput, HydeGeneratorOutput } from './artifact.state.js';

const generatorLogger = loggerFor("HydeGenerator");

const generatorResponseFormat = z.object({
  hypotheticalDocument: z
    .string()
    .describe('The hypothetical document text in the target voice, suitable for embedding and retrieval'),
});

/** Generates hypothetical documents in a target corpus voice for semantic search. */
export class HydeGenerator {
  constructor(private readonly model: Model) {}

  /**
   * Generate a hypothetical document for the given source text and lens.
   * @param input - Source text, lens, target corpus voice, and sanitized frame.
   * @returns The hypothetical document text.
   * @throws On model or response validation failure, or cancellation.
   */
  async generate(input: HydeGenerateInput): Promise<HydeGeneratorOutput> {
    const result = await this.model.complete({
      name: 'hyde_generator', schema: generatorResponseFormat,
      messages: [
        { role: 'system', content: GENERATOR_SYSTEM_PROMPT },
        { role: 'user', content: buildFrameHydePrompt(input) },
      ],
    }, getAbortSignalConfig());
    const parsed = generatorResponseFormat.parse(result);
    const text = parsed.hypotheticalDocument ?? '';

    generatorLogger.verbose('Generated HyDE document', {
      lens: input.lens,
      corpus: input.corpus,
      textLength: text.length,
      frameConstrained: !!input.sourceFrame,
    });

    return { text };
  }
}
