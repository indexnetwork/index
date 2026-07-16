import { describe, expect, it } from 'bun:test';

import type { HydeDocument } from '../../interfaces/database.interface.js';
import { computeHydeSourceTextHash, selectHydeDocumentsForGeneration } from '../hyde.documents.js';

function document(
  id: string,
  strategy: string,
  context: Record<string, unknown> | null = null,
): HydeDocument {
  return {
    id,
    sourceType: 'context',
    sourceId: 'context-1',
    sourceText: null,
    strategy,
    targetCorpus: 'intents',
    hydeText: `document ${id}`,
    hydeEmbedding: [1, 2],
    context,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  };
}

function frameContext(
  sourceText: string,
  generatedAt: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    hydeGenerationVersion: 'frame-v1',
    lensLabel: 'investor',
    validationStatus: 'valid',
    frameFingerprint: 'fingerprint',
    sourceTextHash: computeHydeSourceTextHash(sourceText),
    generatedAt,
    ...overrides,
  };
}

describe('persisted HyDE generation selection', () => {
  it('selects only legacy rows when frame generation is disabled', () => {
    const sourceText = 'Founder seeking funding';
    const documents = [
      document('legacy', 'legacy-hash'),
      document('frame-prefix', 'frame-v1:stable', frameContext(sourceText, '2026-01-01T00:00:00.000Z')),
      document('frame-metadata', 'legacy-looking', frameContext(sourceText, '2026-01-02T00:00:00.000Z')),
    ];

    expect(selectHydeDocumentsForGeneration(documents, 'legacy', sourceText).map((doc) => doc.id))
      .toEqual(['legacy']);
  });

  it('requires current valid frame metadata and selects only the newest generation group', () => {
    const sourceText = 'Founder seeking funding';
    const oldGeneration = '2026-01-01T00:00:00.000Z';
    const newestGeneration = '2026-01-02T00:00:00.000Z';
    const documents = [
      document('legacy', 'legacy-hash'),
      document('stale-source', 'frame-v1:stale', frameContext('Founder no longer fundraising', '2026-01-03T00:00:00.000Z')),
      document('missing-fingerprint', 'frame-v1:malformed', frameContext(sourceText, '2026-01-04T00:00:00.000Z', { frameFingerprint: undefined })),
      document('failed-open', 'frame-v1:failed', frameContext(sourceText, '2026-01-05T00:00:00.000Z', { validationStatus: 'failed_open' })),
      document('old-a', 'frame-v1:old-a', frameContext(sourceText, oldGeneration)),
      document('old-b', 'frame-v1:old-b', frameContext(sourceText, oldGeneration)),
      document('new-a', 'frame-v1:new-a', frameContext(sourceText, newestGeneration)),
      document('new-b', 'frame-v1:new-b', frameContext(sourceText, newestGeneration)),
    ];

    expect(selectHydeDocumentsForGeneration(documents, 'frame-v1', sourceText).map((doc) => doc.id))
      .toEqual(['new-a', 'new-b']);
  });
});
