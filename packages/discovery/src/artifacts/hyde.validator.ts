import { z } from 'zod/v4';

import { getAbortSignalConfig } from '../core/runtime.js';
import type { Model } from '../core/types.js';
import { buildHydeValidationPrompt, VALIDATOR_SYSTEM_PROMPT } from '../prompts/discovery.prompt.js';
import type { HydeValidationInput, HydeValidationOutput } from './artifact.state.js';

/** Structured-output schema for a single batch validation response. */
export const HydeValidationResponseSchema = z.object({
  verdicts: z.array(z.object({
    key: z.string().min(1),
    valid: z.boolean(),
    unsupportedNamedEntities: z.array(z.string()),
    unsupportedHardConstraints: z.array(z.string()),
    reasoning: z.string().min(1).describe('Concise explanation of the verdict'),
  })),
});

/** Validates a batch against source evidence without access to profile context. */
export class HydeValidator {
  constructor(private readonly model: Model) {}

  /**
   * Validate all generated documents in one structured-model call.
   * @param input - Source text, sanitized frame, and documents keyed by opaque IDs.
   * @returns One structured batch of grounding verdicts.
   * @throws On model or response validation failure, or cancellation.
   */
  async validate(input: HydeValidationInput): Promise<HydeValidationOutput> {
    const result = await this.model.complete({
      name: 'hyde_validator', schema: HydeValidationResponseSchema,
      temperature: 0, maxTokens: 2048,
      messages: [
        { role: 'system', content: VALIDATOR_SYSTEM_PROMPT },
        { role: 'user', content: buildHydeValidationPrompt(input) },
      ],
    }, getAbortSignalConfig());
    return HydeValidationResponseSchema.parse(result);
  }
}
