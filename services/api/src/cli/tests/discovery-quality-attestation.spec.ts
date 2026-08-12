import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { getTableColumns } from 'drizzle-orm';

import { evalMatrixMetadata } from '../../schemas/database.schema';
import { HISTORICAL_QUALITY_METADATA_KEY, fingerprintHistoricalQualityVector, historicalQualityAttestationRoot, parseHistoricalQualityBaseAttestation } from '../discovery-quality-attestation';

const digest = (character: string): string => character.repeat(64);

function validAttestation() {
  return {
    version: 1,
    corpusVersion: 'historical-quality-v1',
    planFingerprint: digest('a'),
    seedProjectionFingerprint: digest('b'),
    documentSetFingerprint: digest('c'),
    embedding: {
      provider: 'openrouter',
      model: 'resolved-model',
      dimensions: 2000,
      configurationFingerprint: digest('d'),
    },
    vectors: [
      {
        documentId: 'doc-a',
        textFingerprint: digest('e'),
        vectorFingerprint: fingerprintHistoricalQualityVector([Math.fround(0.1), 1, -2]),
      },
      {
        documentId: 'doc-b',
        textFingerprint: digest('f'),
        vectorFingerprint: fingerprintHistoricalQualityVector([0, 2, -3]),
      },
    ],
  };
}

describe('historical quality base attestation', () => {
  it('parses the exact canonical v1 shape and fixes its metadata key', () => {
    const parsed = parseHistoricalQualityBaseAttestation(validAttestation());

    expect(parsed).toEqual(validAttestation());
    expect(HISTORICAL_QUALITY_METADATA_KEY).toBe('historical-quality-base-v1');
  });

  it('rejects unknown keys at every object boundary', () => {
    const valid = validAttestation();
    const mutations = [
      { ...valid, extra: true },
      { ...valid, embedding: { ...valid.embedding, extra: true } },
      { ...valid, vectors: [{ ...valid.vectors[0]!, extra: true }, valid.vectors[1]!] },
    ];

    for (const mutation of mutations) {
      expect(() => parseHistoricalQualityBaseAttestation(mutation)).toThrow(/unrecognized|unknown/i);
    }
  });

  it('rejects wrong versions, malformed digests, blank identities, and invalid dimensions', () => {
    const valid = validAttestation();
    const mutations = [
      { ...valid, version: 2 },
      { ...valid, planFingerprint: digest('A') },
      { ...valid, seedProjectionFingerprint: 'short' },
      { ...valid, corpusVersion: '   ' },
      { ...valid, embedding: { ...valid.embedding, provider: '' } },
      { ...valid, embedding: { ...valid.embedding, model: '  ' } },
      { ...valid, embedding: { ...valid.embedding, configurationFingerprint: digest('z') } },
      { ...valid, embedding: { ...valid.embedding, dimensions: 0 } },
      { ...valid, embedding: { ...valid.embedding, dimensions: 1.5 } },
      { ...valid, vectors: [] },
    ];

    for (const mutation of mutations) {
      expect(() => parseHistoricalQualityBaseAttestation(mutation)).toThrow();
    }
  });

  it('requires vectors in strictly increasing unique documentId order', () => {
    const valid = validAttestation();
    expect(() => parseHistoricalQualityBaseAttestation({
      ...valid,
      vectors: [...valid.vectors].reverse(),
    })).toThrow(/documentId.*order/i);
    expect(() => parseHistoricalQualityBaseAttestation({
      ...valid,
      vectors: [valid.vectors[0], { ...valid.vectors[1]!, documentId: 'doc-a' }],
    })).toThrow(/documentId.*unique/i);
  });

  it('rejects malformed vector document fields and digests', () => {
    const valid = validAttestation();
    const mutations = [
      { ...valid.vectors[0]!, documentId: '' },
      { ...valid.vectors[0]!, textFingerprint: digest('G') },
      { ...valid.vectors[0]!, vectorFingerprint: 'not-a-digest' },
    ];

    for (const vector of mutations) {
      expect(() => parseHistoricalQualityBaseAttestation({
        ...valid,
        vectors: [vector, valid.vectors[1]],
      })).toThrow();
    }
  });

  it('hashes only already-canonical float32 readback values in big-endian order', () => {
    const readback = [Math.fround(0.1), 1, -2];
    const bytes = Buffer.alloc(readback.length * Float32Array.BYTES_PER_ELEMENT);
    readback.forEach((component, index) => bytes.writeFloatBE(component, index * Float32Array.BYTES_PER_ELEMENT));

    expect(fingerprintHistoricalQualityVector(readback))
      .toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(fingerprintHistoricalQualityVector([-0]))
      .toBe(fingerprintHistoricalQualityVector([0]));
  });

  it('rejects non-finite and provider-style binary64 vector components', () => {
    for (const component of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => fingerprintHistoricalQualityVector([component])).toThrow(/finite/i);
    }

    expect(() => fingerprintHistoricalQualityVector([0.1])).toThrow(/float32.*readback/i);
    expect(() => fingerprintHistoricalQualityVector([Math.fround(0.1)])).not.toThrow();
  });

  it('roots the canonical parsed object independently of input key insertion order', () => {
    const canonical = parseHistoricalQualityBaseAttestation(validAttestation());
    const reorderedInput = {
      vectors: validAttestation().vectors,
      embedding: validAttestation().embedding,
      documentSetFingerprint: digest('c'),
      seedProjectionFingerprint: digest('b'),
      planFingerprint: digest('a'),
      corpusVersion: 'historical-quality-v1',
      version: 1,
    };
    const reordered = parseHistoricalQualityBaseAttestation(reorderedInput);
    const expected = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');

    expect(reordered).toEqual(canonical);
    expect(historicalQualityAttestationRoot(canonical)).toBe(expected);
    expect(historicalQualityAttestationRoot(reordered)).toBe(expected);
  });

  it('keeps the generated database column nullable for legacy metadata rows', () => {
    const column = getTableColumns(evalMatrixMetadata).qualityAttestation;
    const legacyRow: typeof evalMatrixMetadata.$inferSelect = {
      key: 'legacy',
      schemaMigrationFingerprint: digest('1'),
      fixtureFingerprint: digest('2'),
      fixtureCorpusVersion: 'legacy-v1',
      seededAt: new Date('2026-08-07T00:00:00.000Z'),
      qualityAttestation: null,
    };

    expect(column).toBeDefined();
    expect(column!.notNull).toBe(false);
    expect(legacyRow.qualityAttestation).toBeNull();
  });
});
