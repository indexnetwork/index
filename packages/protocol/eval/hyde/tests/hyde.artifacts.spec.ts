import { describe, expect, it } from 'bun:test';

import { fingerprintHydeCorpus, HYDE_CASES } from '../hyde.cases.js';
import { HYDE_EXPECTED_CANDIDATE_COUNT, HYDE_EXPECTED_PAIR_COUNT } from '../hyde.policy.js';
import { fingerprint as fingerprintHydeReportValue } from '../hyde.report.js';
import { buildBlindExport, fingerprintHydeArtifact, parseHydeBlindPrivateKey, parseHydeBlindPublicBatch, parseHydeCollectionArtifact } from '../hyde.artifacts.js';
import type { HydeCollectionArtifact } from '../hyde.schemas.js';
import { buildExportableCollectionFixture } from './hyde.artifact-fixtures.js';

function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...keysDeep(child)]);
}

describe('HyDE evidence artifact boundaries', () => {
  it('exports every candidate item and completed generated call without leaking private source or diagnostics', () => {
    const collection = buildExportableCollectionFixture();
    const { publicBatch, privateKey } = buildBlindExport(collection, HYDE_CASES, {
      secret: 'unit-test-secret',
      createdAt: '2026-01-03T00:00:00.000Z',
    });
    const candidateItems = publicBatch.items.filter((item) => item.taskKind === 'candidate-relevance');
    const groundingItems = publicBatch.items.filter((item) => item.taskKind === 'generated-document-grounding');

    const expectedGroundingItems = HYDE_EXPECTED_PAIR_COUNT * 5;
    expect(candidateItems).toHaveLength(HYDE_EXPECTED_CANDIDATE_COUNT);
    expect(groundingItems).toHaveLength(expectedGroundingItems);
    expect(new Set(publicBatch.items.map((item) => item.opaqueId)).size)
      .toBe(HYDE_EXPECTED_CANDIDATE_COUNT + expectedGroundingItems);
    expect(privateKey.mappings).toHaveLength(publicBatch.items.length);
    expect(privateKey.batchFingerprint).toBe(publicBatch.batchFingerprint);
    expect(privateKey.corpusFingerprint).toBe(collection.corpusFingerprint);
    expect(privateKey.configFingerprint).toBe(collection.configFingerprint);

    const forbiddenKeys = new Set([
      'mode', 'run', 'caseId', 'candidateId', 'stratum', 'role', 'relevanceGrade',
      'hardNegativeOf', 'returned', 'mapStatus', 'validationStatus', 'lens', 'corpus',
      'verdict', 'validatorKey', 'failedOpenReason', 'timing', 'hmacSecret', 'mappings',
      'backgroundSource', 'graphSourceType', 'backgroundSourceGraphMapping',
    ]);
    expect(keysDeep(publicBatch).filter((key) => forbiddenKeys.has(key))).toEqual([]);

    const serialized = JSON.stringify(publicBatch);
    for (const secretValue of [
      'unit-test-secret',
      'SECRET_LEGACY_LENS',
      'SECRET_FRAME_LENS',
      'SECRET_VALIDATOR_KEY_THREE',
      'SECRET_ENTITY',
      'SECRET_CONSTRAINT',
      'SECRET_VALIDATOR_REASONING',
      'validator_error',
      'failed_open',
      'not_submitted',
      'saved-intent',
      'user-context',
    ]) {
      expect(serialized).not.toContain(secretValue);
    }
    for (const c of HYDE_CASES) {
      expect(serialized).not.toContain(c.id);
      for (const candidate of c.candidates) expect(serialized).not.toContain(candidate.id);
    }
  });

  it('uses source text alone for grounding and never exports profile context', () => {
    const collection = buildExportableCollectionFixture();
    const { publicBatch } = buildBlindExport(collection, HYDE_CASES, {
      secret: 'source-only-secret',
      createdAt: '2026-01-03T00:00:00.000Z',
    });
    const firstCase = HYDE_CASES[0];
    const groundingItems = publicBatch.items.filter((item) => item.taskKind === 'generated-document-grounding');

    expect(groundingItems).toHaveLength(HYDE_EXPECTED_PAIR_COUNT * 5);
    expect(groundingItems.filter((item) => item.sourceText === firstCase.sourceText)).toHaveLength(20);
    expect(firstCase.profileContext).toBeDefined();
    expect(JSON.stringify(publicBatch)).not.toContain(firstCase.profileContext ?? 'missing-profile-context');
    expect(groundingItems.every((item) => item.rubric.includes('source text alone'))).toBeTrue();
  });

  it('creates opaque deterministic HMAC mappings and a matching judgment template', () => {
    const collection = buildExportableCollectionFixture();
    const options = { secret: 'deterministic-secret', createdAt: '2026-01-03T00:00:00.000Z' };
    const first = buildBlindExport(collection, HYDE_CASES, options);
    const second = buildBlindExport(collection, HYDE_CASES, options);

    expect(first.publicBatch.items.map((item) => item.opaqueId))
      .toEqual(second.publicBatch.items.map((item) => item.opaqueId));
    expect(first.privateKey.mappings).toEqual(second.privateKey.mappings);
    expect(first.publicBatch.batchFingerprint).toBe(second.publicBatch.batchFingerprint);
    expect(first.privateKey.mappings.map((mapping) => mapping.opaqueId))
      .toEqual(first.publicBatch.items.map((item) => item.opaqueId));
    expect(first.judgmentTemplate.items).toHaveLength(first.publicBatch.items.length);
    expect(first.judgmentTemplate.batchFingerprint).toBe(first.publicBatch.batchFingerprint);
    expect(first.publicBatch.items.every((item) => /^blind-[a-f0-9]{64}$/.test(item.opaqueId))).toBeTrue();
    expect(first.publicBatch.items.every((item) => !item.opaqueId.includes('/'))).toBeTrue();
    expect(() => parseHydeBlindPublicBatch(first.publicBatch)).not.toThrow();
    expect(() => parseHydeBlindPrivateKey(first.privateKey)).not.toThrow();
  });

  it('defensively rejects noncanonical, setup-failed, and slot-failed blind exports', () => {
    const complete = buildExportableCollectionFixture();
    const noncanonical = structuredClone(complete) as HydeCollectionArtifact;
    noncanonical.canonicality = { candidate: false, reasons: ['synthetic noncanonical collection'] };
    expect(() => buildBlindExport(noncanonical, HYDE_CASES)).toThrow('canonicality.candidate=true');

    const setupFailed = structuredClone(complete) as HydeCollectionArtifact;
    const setup = setupFailed.candidateEmbeddingSetups[0];
    setupFailed.candidateEmbeddingSetups[0] = {
      ...setup,
      status: 'failed',
      failure: {
        code: 'embedding_error',
        stage: 'embedding',
        message: 'synthetic failure',
        retryable: false,
      },
    };
    expect(() => buildBlindExport(setupFailed, HYDE_CASES)).toThrow('embedding setup failure');

    const slotFailed = structuredClone(complete) as HydeCollectionArtifact;
    slotFailed.pairedBlocks[0].legacy = {
      status: 'failed',
      failure: {
        code: 'generation_error',
        stage: 'generation',
        message: 'synthetic failure',
        retryable: false,
      },
      timing: slotFailed.pairedBlocks[0].legacy.timing,
    };
    expect(() => buildBlindExport(slotFailed, HYDE_CASES)).toThrow('failed or missing');
  });

  it('parses explicit filtered/debug evidence but rejects its blind export clearly', () => {
    const full = buildExportableCollectionFixture();
    const caseId = full.config.selectedCaseIds[0];
    const filtered = {
      ...full,
      canonicality: { candidate: false, reasons: ['filtered debug collection'] },
      config: {
        ...full.config,
        selectedCaseIds: [caseId],
        runs: 2,
      },
      candidateEmbeddingSetups: full.candidateEmbeddingSetups.filter((setup) => setup.caseId === caseId),
      pairedBlocks: full.pairedBlocks
        .filter((block) => block.caseId === caseId && block.run <= 2)
        .map((block, executionOrdinal) => ({ ...block, executionOrdinal })),
    };

    expect(() => parseHydeCollectionArtifact(filtered)).not.toThrow();
    expect(() => parseHydeCollectionArtifact({
      ...filtered,
      pairedBlocks: filtered.pairedBlocks.slice(0, -1),
    })).toThrow('Expected 2 paired blocks');
    expect(() => buildBlindExport(parseHydeCollectionArtifact(filtered), HYDE_CASES))
      .toThrow('collection.canonicality.candidate=true');
  });

  it('uses explicit ASCII ordering without locale-dependent fingerprint paths', () => {
    const original = String.prototype.localeCompare;
    String.prototype.localeCompare = () => { throw new Error('localeCompare must not be used'); };
    try {
      const value = { 'é': 1, z: 2, A: 3 };
      expect(fingerprintHydeArtifact(value)).toBe(fingerprintHydeArtifact({ A: 3, z: 2, 'é': 1 }));
      expect(fingerprintHydeCorpus(HYDE_CASES)).toMatch(/^[a-f0-9]{64}$/);
      expect(fingerprintHydeReportValue(value)).toBe(fingerprintHydeReportValue({ A: 3, z: 2, 'é': 1 }));
      expect(() => buildBlindExport(buildExportableCollectionFixture(), HYDE_CASES, {
        secret: 'ascii-order-secret',
        createdAt: '2026-01-03T00:00:00.000Z',
      })).not.toThrow();
    } finally {
      String.prototype.localeCompare = original;
    }
  });

  it('rejects wrong artifact versions, wrong artifact types, tampering, and nonfinite timing values', () => {
    const collection = buildExportableCollectionFixture();
    const exported = buildBlindExport(collection, HYDE_CASES, {
      secret: 'parser-secret',
      createdAt: '2026-01-03T00:00:00.000Z',
    });

    expect(() => parseHydeCollectionArtifact({ ...collection, schemaVersion: 'wrong-version' })).toThrow();
    expect(() => parseHydeBlindPublicBatch({ ...exported.publicBatch, artifactType: 'wrong-type' })).toThrow();
    expect(() => parseHydeBlindPublicBatch({
      ...exported.publicBatch,
      studyId: 'tampered-study',
    })).toThrow('fingerprint');

    const nonfinite = structuredClone(collection) as HydeCollectionArtifact;
    nonfinite.pairedBlocks[0].legacy.timing.durationMs = Number.POSITIVE_INFINITY;
    expect(() => parseHydeCollectionArtifact(nonfinite)).toThrow('finite');
  });
});
