import { createHash } from 'node:crypto';

import type { HydeGenerationMode } from '../../src/shared/hyde/hyde.env.js';
import type { HydeDocumentState } from '../../src/shared/hyde/hyde.state.js';
import type { HydeValidationDocument, HydeValidationVerdict } from '../../src/shared/hyde/hyde.validator.js';
import type { HydeTargetCorpus } from '../../src/shared/hyde/lens.inferrer.js';

import type { DiagnosticValidationStatus, FailedOpenReason, GeneratedDocumentDiagnostic } from './hyde.types.js';

export interface RecordedGeneratedDocument {
  lens: string;
  corpus: HydeTargetCorpus;
  text: string;
}

export interface RecordedValidationBatch {
  documents: Record<string, HydeValidationDocument>;
  verdicts?: unknown;
  error?: string;
}

export interface GeneratedDocumentAnalysis {
  documents: GeneratedDocumentDiagnostic[];
  overwrittenDocumentCount: number;
  validatorSubmittedDocumentCount: number;
  rejectedCount: number;
  failedOpenCount: number;
}

/** Mirrors the graph's opaque validator key so diagnostics resolve verdicts by key. */
export function evalOpaqueDocumentKey(document: RecordedGeneratedDocument): string {
  return `d-${createHash('sha256')
    .update(`${document.lens}\0${document.corpus}\0${document.text}`)
    .digest('hex')
    .slice(0, 16)}`;
}

function isValidationVerdict(value: unknown): value is HydeValidationVerdict {
  if (!value || typeof value !== 'object') return false;
  const verdict = value as Partial<HydeValidationVerdict>;
  return typeof verdict.key === 'string'
    && typeof verdict.valid === 'boolean'
    && Array.isArray(verdict.unsupportedNamedEntities)
    && verdict.unsupportedNamedEntities.every((item) => typeof item === 'string')
    && Array.isArray(verdict.unsupportedHardConstraints)
    && verdict.unsupportedHardConstraints.every((item) => typeof item === 'string')
    && typeof verdict.reasoning === 'string';
}

function returnedDocumentKeys(returned: Record<string, HydeDocumentState>): Set<string> {
  return new Set(Object.entries(returned).map(([lensId, document]) =>
    evalOpaqueDocumentKey({
      lens: document.lens || lensId,
      corpus: document.targetCorpus,
      text: document.hydeText,
    })));
}

/**
 * Assign one generated call to each final map entry. RecordingGenerator appends
 * completed calls in the same order in which the graph assigns its lens-keyed map,
 * so the last identical-key completion is the surviving call.
 */
function submittedGeneratedIndexes(
  generated: RecordedGeneratedDocument[],
  submittedKeys: string[],
): Set<number> {
  const indexesByKey = new Map<string, number[]>();
  generated.forEach((document, index) => {
    const key = evalOpaqueDocumentKey(document);
    indexesByKey.set(key, [...(indexesByKey.get(key) ?? []), index]);
  });

  const submitted = new Set<number>();
  for (const key of submittedKeys) {
    const matches = indexesByKey.get(key);
    const index = matches?.pop();
    if (index !== undefined) submitted.add(index);
  }
  return submitted;
}

function resolveFrameStatus(
  key: string,
  validation: RecordedValidationBatch | undefined,
): {
  validationStatus: DiagnosticValidationStatus;
  failedOpenReason?: FailedOpenReason;
  verdict?: HydeValidationVerdict;
} {
  if (!validation || validation.error || validation.verdicts === undefined) {
    return { validationStatus: 'failed_open', failedOpenReason: 'validator_error' };
  }
  if (!Array.isArray(validation.verdicts)) {
    return { validationStatus: 'failed_open', failedOpenReason: 'malformed_verdict' };
  }

  const rawVerdicts = validation.verdicts;
  const matching = rawVerdicts.filter((value) =>
    !!value && typeof value === 'object' && (value as { key?: unknown }).key === key);
  if (matching.length === 0) {
    return { validationStatus: 'failed_open', failedOpenReason: 'missing_verdict' };
  }
  if (matching.length > 1) {
    return { validationStatus: 'failed_open', failedOpenReason: 'duplicate_verdict' };
  }
  if (!isValidationVerdict(matching[0])) {
    return { validationStatus: 'failed_open', failedOpenReason: 'malformed_verdict' };
  }

  const verdict = matching[0];
  const hasUnsupportedGrounding = verdict.unsupportedNamedEntities.length > 0
    || verdict.unsupportedHardConstraints.length > 0;
  if (verdict.valid === hasUnsupportedGrounding) {
    return {
      validationStatus: 'failed_open',
      failedOpenReason: 'contradictory_verdict',
      verdict,
    };
  }
  return verdict.valid
    ? { validationStatus: 'valid', verdict }
    : { validationStatus: 'invalid', verdict };
}

/**
 * Diagnose generated calls separately from map overwrites and classify frame
 * outcomes from exactly one structurally valid verdict resolved by opaque key.
 */
export function analyzeGeneratedDocuments(
  mode: HydeGenerationMode,
  generated: RecordedGeneratedDocument[],
  returned: Record<string, HydeDocumentState>,
  validation?: RecordedValidationBatch,
): GeneratedDocumentAnalysis {
  const returnedKeys = returnedDocumentKeys(returned);
  const submittedKeys = mode === 'frame-v1'
    ? (validation ? Object.keys(validation.documents) : [...returnedKeys])
    : [...returnedKeys];
  const submittedIndexes = submittedGeneratedIndexes(generated, submittedKeys);

  const documents = generated.map((document, index): GeneratedDocumentDiagnostic => {
    const validatorKey = evalOpaqueDocumentKey(document);
    if (!submittedIndexes.has(index)) {
      return {
        ...document,
        mapStatus: 'overwritten',
        validationStatus: mode === 'legacy' ? 'not_applicable' : 'not_submitted',
        validatorKey,
        returned: false,
      };
    }

    if (mode === 'legacy') {
      return {
        ...document,
        mapStatus: 'submitted',
        validationStatus: 'not_applicable',
        validatorKey,
        returned: returnedKeys.has(validatorKey),
      };
    }

    return {
      ...document,
      mapStatus: 'submitted',
      ...resolveFrameStatus(validatorKey, validation),
      validatorKey,
      returned: returnedKeys.has(validatorKey),
    };
  });

  return {
    documents,
    overwrittenDocumentCount: generated.length - submittedIndexes.size,
    validatorSubmittedDocumentCount: mode === 'frame-v1' && validation ? submittedKeys.length : 0,
    rejectedCount: documents.filter((document) => document.validationStatus === 'invalid').length,
    failedOpenCount: documents.filter((document) => document.validationStatus === 'failed_open').length,
  };
}
