/**
 * HyDE (Hypothetical Document Embeddings) type definitions.
 *
 * The system is now role-agnostic: instead of hardcoded strategy names
 * (mirror, reciprocal, mentor, investor, collaborator, hiree), an LLM
 * infers free-text "lenses" dynamically. This file re-exports the lens
 * types and provides constants for the HyDE pipeline.
 */

export type { Lens, HydeTargetCorpus, LensInferenceInput, LensInferenceOutput } from './lens.inferrer';

/** Default cache TTL for ephemeral HyDE documents (1 hour). */
export const HYDE_DEFAULT_CACHE_TTL = 3600;

/**
 * Prompt templates for HyDE document generation.
 * Keyed by target corpus — the lens label provides the semantic specificity.
 */
export const HYDE_CORPUS_PROMPTS: Record<'profiles' | 'intents', (sourceText: string, lens: string) => string> = {
  profiles: (sourceText, lens) => `
    Write a professional biography for someone who could fulfill this need: "${sourceText}".
    Focus on the specific expertise, background, and role described by: ${lens}.

    Write in first person. Include concrete skills, domain experience, and current professional focus that would make them a strong match.
  `,
  intents: (sourceText, lens) => `
    Write a goal or aspiration statement for someone who is: ${lens}.
    This person's needs would complement: "${sourceText}".

    Write in first person as if stating their own goal.
  `,
};
