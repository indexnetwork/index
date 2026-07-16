import { createHash } from 'crypto';

import type { HydeDocument } from '../interfaces/database.interface.js';
import { HYDE_FRAME_GENERATION_VERSION, type HydeGenerationMode } from './hyde.env.js';

/** Hash source text without persisting the source itself in frame metadata. */
export function computeHydeSourceTextHash(sourceText: string): string {
  return createHash('sha256').update(sourceText).digest('hex');
}

function isFrameStrategy(strategy: string): boolean {
  return strategy.startsWith(`${HYDE_FRAME_GENERATION_VERSION}:`);
}

function hasFrameMetadataForSource(document: HydeDocument, sourceTextHash: string): boolean {
  const context = document.context;
  return isFrameStrategy(document.strategy)
    && context?.hydeGenerationVersion === HYDE_FRAME_GENERATION_VERSION
    && context.validationStatus === 'valid'
    && typeof context.lensLabel === 'string'
    && context.lensLabel.length > 0
    && typeof context.frameFingerprint === 'string'
    && context.frameFingerprint.length > 0
    && context.sourceTextHash === sourceTextHash
    && typeof context.generatedAt === 'string'
    && Number.isFinite(Date.parse(context.generatedAt));
}

/**
 * Select persisted documents that belong to the currently active generation
 * mode and, for frame-v1, the newest generation marker group.
 */
export function selectHydeDocumentsForGeneration(
  documents: HydeDocument[],
  mode: HydeGenerationMode,
  sourceText: string,
): HydeDocument[] {
  if (mode === 'legacy') {
    return documents.filter((document) =>
      !isFrameStrategy(document.strategy)
      && document.context?.hydeGenerationVersion !== HYDE_FRAME_GENERATION_VERSION);
  }

  const sourceTextHash = computeHydeSourceTextHash(sourceText);
  const eligible = documents.filter((document) => hasFrameMetadataForSource(document, sourceTextHash));
  let newestGeneratedAt: string | undefined;
  let newestTimestamp = Number.NEGATIVE_INFINITY;

  for (const document of eligible) {
    const generatedAt = document.context?.generatedAt;
    if (typeof generatedAt !== 'string') continue;
    const timestamp = Date.parse(generatedAt);
    if (timestamp > newestTimestamp) {
      newestTimestamp = timestamp;
      newestGeneratedAt = generatedAt;
    }
  }

  return newestGeneratedAt
    ? eligible.filter((document) => document.context?.generatedAt === newestGeneratedAt)
    : [];
}
