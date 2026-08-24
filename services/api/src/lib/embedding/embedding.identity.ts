import { createHash } from 'node:crypto';

export interface CanonicalEmbeddingIdentityFields {
  provider: string;
  model: string;
  dimensions: number;
}

/** Fingerprints only the canonical provider/model/dimensions identity fields. */
export function embeddingConfigurationFingerprint(identity: CanonicalEmbeddingIdentityFields): string {
  const canonical = {
    provider: identity.provider,
    model: identity.model,
    dimensions: identity.dimensions,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
