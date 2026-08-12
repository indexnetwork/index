import { createHash } from 'node:crypto';
import { z } from 'zod';

import type { HistoricalQualityBaseAttestation } from '../schemas/database.schema';

export type { HistoricalQualityBaseAttestation } from '../schemas/database.schema';

const sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase SHA-256 digest');
const nonBlankStringSchema = z.string().trim().min(1);

const historicalQualityVectorSchema = z.object({
  documentId: nonBlankStringSchema,
  textFingerprint: sha256DigestSchema,
  vectorFingerprint: sha256DigestSchema,
}).strict();

const historicalQualityBaseAttestationSchema = z.object({
  version: z.literal(1),
  corpusVersion: nonBlankStringSchema,
  planFingerprint: sha256DigestSchema,
  seedProjectionFingerprint: sha256DigestSchema,
  documentSetFingerprint: sha256DigestSchema,
  embedding: z.object({
    provider: nonBlankStringSchema,
    model: nonBlankStringSchema,
    dimensions: z.number().int().positive(),
    configurationFingerprint: sha256DigestSchema,
  }).strict(),
  vectors: z.array(historicalQualityVectorSchema).min(1),
}).strict().superRefine(({ vectors }, context) => {
  for (let index = 1; index < vectors.length; index += 1) {
    const previous = vectors[index - 1]!.documentId;
    const current = vectors[index]!.documentId;
    if (previous === current) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Vector documentId values must be unique',
        path: ['vectors', index, 'documentId'],
      });
    } else if (previous > current) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Vector documentId values must use strictly increasing canonical order',
        path: ['vectors', index, 'documentId'],
      });
    }
  }
});

export const HISTORICAL_QUALITY_METADATA_KEY = 'historical-quality-base-v1';

/**
 * Parses the strict canonical protected-base attestation.
 *
 * @param value Untrusted JSON-compatible metadata.
 * @returns The validated canonical v1 attestation.
 * @throws When the shape, digests, dimensions, or document ordering are invalid.
 */
export function parseHistoricalQualityBaseAttestation(
  value: unknown,
): HistoricalQualityBaseAttestation {
  return historicalQualityBaseAttestationSchema.parse(value);
}

/**
 * Fingerprints exact float32 values selected back from PostgreSQL/pgvector.
 *
 * This boundary enforces the value shape of database readback rather than
 * proving provenance identity: provider binary64 arrays such as `[0.1]` are
 * refused because their components are not already float32-canonical.
 *
 * @param vector A vector whose finite components are already float32 values.
 * @returns The SHA-256 digest of normalized big-endian IEEE-754 float32 bytes.
 * @throws When a component is non-finite or is not already float32-canonical.
 */
export function fingerprintHistoricalQualityVector(
  vector: readonly number[],
): string {
  const bytes = Buffer.alloc(vector.length * Float32Array.BYTES_PER_ELEMENT);
  vector.forEach((component, index) => {
    if (!Number.isFinite(component)) {
      throw new Error(`Historical quality vector component ${index} must be finite`);
    }
    const normalized = Object.is(component, -0) ? 0 : component;
    const canonical = Math.fround(normalized);
    if (!Object.is(normalized, canonical)) {
      throw new Error(`Historical quality vector component ${index} must be float32 DB readback`);
    }
    bytes.writeFloatBE(canonical, index * Float32Array.BYTES_PER_ELEMENT);
  });
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Computes the root digest over the strict canonical attestation object.
 *
 * @param value The quality attestation to validate and hash.
 * @returns A lowercase SHA-256 digest.
 * @throws When the attestation is not canonical v1 metadata.
 */
export function historicalQualityAttestationRoot(
  value: HistoricalQualityBaseAttestation,
): string {
  const canonical = parseHistoricalQualityBaseAttestation(value);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
