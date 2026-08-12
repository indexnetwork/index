import { createHash } from 'node:crypto';

export interface CanonicalEmbeddingIdentityFields {
  provider: string;
  model: string;
  dimensions: number;
}

export const HISTORICAL_QUALITY_APPROVED_EMBEDDING_IDENTITY = Object.freeze({
  provider: 'openrouter',
  model: 'openai/text-embedding-3-large',
  dimensions: 2000,
} as const);

/** Fingerprints only the canonical provider/model/dimensions identity fields. */
export function embeddingConfigurationFingerprint(identity: CanonicalEmbeddingIdentityFields): string {
  const canonical = {
    provider: identity.provider,
    model: identity.model,
    dimensions: identity.dimensions,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
