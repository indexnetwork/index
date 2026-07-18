import { describe, expect, it } from 'bun:test';

import type { HydeDocumentState } from '../../../src/shared/hyde/hyde.state.js';
import type { HydeValidationVerdict } from '../../../src/shared/hyde/hyde.validator.js';

import { analyzeGeneratedDocuments, evalOpaqueDocumentKey, type RecordedGeneratedDocument } from '../hyde.diagnostics.js';

function generated(lens: string, text = lens): RecordedGeneratedDocument {
  return { lens, corpus: 'premises', text };
}

function returned(documents: RecordedGeneratedDocument[]): Record<string, HydeDocumentState> {
  return Object.fromEntries(documents.map((document) => [
    document.lens,
    {
      lens: document.lens,
      targetCorpus: document.corpus,
      hydeText: document.text,
      hydeEmbedding: [1, 0],
      origin: 'generated',
      validationStatus: 'failed_open',
      hydeGenerationVersion: 'frame-v1',
    },
  ]));
}

function verdict(
  document: RecordedGeneratedDocument,
  overrides: Partial<HydeValidationVerdict> = {},
): HydeValidationVerdict {
  return {
    key: evalOpaqueDocumentKey(document),
    valid: true,
    unsupportedNamedEntities: [],
    unsupportedHardConstraints: [],
    reasoning: 'grounded',
    ...overrides,
  };
}

describe('HyDE validator diagnostics', () => {
  it('counts only key-resolved grounded invalid verdicts as rejections and separates overwrites', () => {
    const valid = generated('valid');
    const rejected = generated('rejected');
    const contradictoryTrue = generated('contradictory-true');
    const contradictoryFalse = generated('contradictory-false');
    const missing = generated('missing');
    const duplicate = generated('duplicate');
    const overwritten = generated('duplicate-lens', 'old output');
    const survivor = generated('duplicate-lens', 'new output');
    const generatedDocuments = [
      valid,
      rejected,
      contradictoryTrue,
      contradictoryFalse,
      missing,
      duplicate,
      overwritten,
      survivor,
    ];
    const submitted = [
      valid,
      rejected,
      contradictoryTrue,
      contradictoryFalse,
      missing,
      duplicate,
      survivor,
    ];

    const analysis = analyzeGeneratedDocuments(
      'frame-v1',
      generatedDocuments,
      returned([valid, contradictoryTrue, contradictoryFalse, missing, duplicate, survivor]),
      {
        documents: Object.fromEntries(submitted.map((document) => [
          evalOpaqueDocumentKey(document),
          { corpus: document.corpus, text: document.text },
        ])),
        verdicts: [
          verdict(valid),
          verdict(rejected, {
            valid: false,
            unsupportedNamedEntities: ['Invented Org'],
            reasoning: 'invented entity',
          }),
          verdict(contradictoryTrue, {
            valid: true,
            unsupportedHardConstraints: ['September'],
            reasoning: 'contradictory valid verdict',
          }),
          verdict(contradictoryFalse, {
            valid: false,
            reasoning: 'invalid without unsupported grounding',
          }),
          verdict(duplicate),
          verdict(duplicate, { reasoning: 'duplicate response' }),
          verdict(survivor),
          {
            ...verdict(rejected),
            key: 'd-unrelated-key',
            valid: false,
            unsupportedHardConstraints: ['wrong key'],
          },
        ],
      },
    );

    expect(analysis).toMatchObject({
      overwrittenDocumentCount: 1,
      validatorSubmittedDocumentCount: 7,
      rejectedCount: 1,
      failedOpenCount: 4,
    });
    expect(analysis.documents.find((document) => document.text === 'old output')).toMatchObject({
      mapStatus: 'overwritten',
      validationStatus: 'not_submitted',
      returned: false,
    });
    expect(analysis.documents.find((document) => document.lens === 'rejected')).toMatchObject({
      validationStatus: 'invalid',
      returned: false,
    });
    expect(analysis.documents.find((document) => document.lens === 'missing')).toMatchObject({
      validationStatus: 'failed_open',
      failedOpenReason: 'missing_verdict',
      returned: true,
    });
    expect(analysis.documents.find((document) => document.lens === 'duplicate')).toMatchObject({
      validationStatus: 'failed_open',
      failedOpenReason: 'duplicate_verdict',
    });
    expect(analysis.documents.filter((document) => document.failedOpenReason === 'contradictory_verdict')).toHaveLength(2);
  });

  it('classifies every submitted document as failed open after a validator error', () => {
    const documents = [generated('one'), generated('two')];
    const analysis = analyzeGeneratedDocuments(
      'frame-v1',
      documents,
      returned(documents),
      {
        documents: Object.fromEntries(documents.map((document) => [
          evalOpaqueDocumentKey(document),
          { corpus: document.corpus, text: document.text },
        ])),
        error: 'provider unavailable',
      },
    );

    expect(analysis.rejectedCount).toBe(0);
    expect(analysis.failedOpenCount).toBe(2);
    expect(analysis.documents.every((document) =>
      document.validationStatus === 'failed_open'
      && document.failedOpenReason === 'validator_error')).toBe(true);
  });
});
