import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

import { createStructuredModel } from '../agent/model.config.js';
import { invokeWithAbortSignal } from '../agent/model-signal.js';
import type { HydeSourceFrame } from './hyde.frame.js';
import type { HydeTargetCorpus } from './lens.inferrer.js';

export interface HydeValidationDocument {
  corpus: HydeTargetCorpus;
  text: string;
}

export interface HydeValidationInput {
  sourceText: string;
  sourceFrame: HydeSourceFrame;
  /** Generated documents keyed by opaque caller-supplied identifiers. */
  documents: Record<string, HydeValidationDocument>;
}

export interface HydeValidationVerdict {
  key: string;
  valid: boolean;
  unsupportedNamedEntities: string[];
  unsupportedHardConstraints: string[];
  reasoning: string;
}

export interface HydeValidationOutput {
  verdicts: HydeValidationVerdict[];
}

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

const VALIDATOR_SYSTEM_PROMPT = `You validate hypothetical retrieval documents against a sanitized source-grounded frame.

A document is invalid only when it invents unsupported proper nouns/named entities or unsupported HARD constraints (location, time, numeric, credential, organization, or exclusivity constraints).

Explicitly allowed and not grounds for rejection:
- first-person target voice;
- generic role or domain elaboration;
- reciprocal or complementary inversion of source and target roles.

Return exactly one verdict for each opaque key. Copy each key exactly. Mark valid=false when either unsupported list is non-empty. Keep reasoning concise.`;

/** Build a profile-free batch validation prompt. */
export function buildHydeValidationPrompt(input: HydeValidationInput): string {
  return `Source text:\n${input.sourceText}\n\nSanitized source frame:\n${JSON.stringify(input.sourceFrame)}\n\nGenerated documents:\n${JSON.stringify(input.documents)}`;
}

/** Minimal structured model contract used for deterministic injection in tests. */
export interface HydeValidatorStructuredModel {
  invoke(input: BaseLanguageModelInput, config?: { signal?: AbortSignal }): Promise<unknown>;
}

/** Production structured-model batch validator for frame-v1 HyDE documents. */
export class HydeValidator {
  private model?: HydeValidatorStructuredModel;

  constructor(model?: HydeValidatorStructuredModel) {
    this.model = model;
  }

  private getModel(): HydeValidatorStructuredModel {
    this.model ??= createStructuredModel('hydeValidator', HydeValidationResponseSchema, {
      name: 'hyde_validator',
    });
    return this.model;
  }

  /** Validate all generated documents in one structured-model call. */
  async validate(input: HydeValidationInput): Promise<HydeValidationOutput> {
    const result = await invokeWithAbortSignal(this.getModel(), [
      new SystemMessage(VALIDATOR_SYSTEM_PROMPT),
      new HumanMessage(buildHydeValidationPrompt(input)),
    ]);
    return HydeValidationResponseSchema.parse(result);
  }
}
