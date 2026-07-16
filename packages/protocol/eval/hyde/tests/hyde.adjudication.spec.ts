import { describe, expect, it } from 'bun:test';

import { HYDE_CASES } from '../hyde.cases.js';
import { buildBlindExport } from '../hyde.artifacts.js';
import { buildHydeJudgmentArtifact, parseHydeJudgmentArtifact, parseHydeResolvedAdjudicationArtifact, parseHydeResolverDecisionsArtifact, resolveAdjudications } from '../hyde.adjudication.js';
import { HYDE_ARTIFACT_SCHEMA_VERSION } from '../hyde.policy.js';
import { HYDE_RESOLVER_DECISIONS_ARTIFACT_TYPE, type HydeIndependentJudgment, type HydeResolverDecisionsArtifact, type HydeUnsupportedAddition } from '../hyde.schemas.js';
import { buildExportableCollectionFixture, humanJudgment, judgmentsForBatch } from './hyde.artifact-fixtures.js';

const collection = buildExportableCollectionFixture();
const { publicBatch } = buildBlindExport(collection, HYDE_CASES, {
  secret: 'adjudication-test-secret',
  createdAt: '2026-01-03T00:00:00.000Z',
});

function triageJudgment(): ReturnType<typeof buildHydeJudgmentArtifact> {
  return buildHydeJudgmentArtifact(publicBatch, {
    adjudicatorId: 'triage-model',
    adjudicatorKind: 'llm-triage',
    blindedIndependentAttestation: true,
    judgments: judgmentsForBatch(publicBatch),
    createdAt: '2026-01-04T00:00:00.000Z',
  });
}

function resolverArtifact(
  decisions: HydeResolverDecisionsArtifact['decisions'],
): HydeResolverDecisionsArtifact {
  return parseHydeResolverDecisionsArtifact({
    artifactType: HYDE_RESOLVER_DECISIONS_ARTIFACT_TYPE,
    schemaVersion: HYDE_ARTIFACT_SCHEMA_VERSION,
    createdAt: '2026-01-05T00:00:00.000Z',
    resolverId: 'blind-resolver',
    batchFingerprint: publicBatch.batchFingerprint,
    decisions,
  });
}

describe('blinded HyDE adjudication', () => {
  it('requires two distinct complete attested humans and never counts LLM triage as canonical evidence', () => {
    const oneHuman = humanJudgment(publicBatch, 'human-one');
    const result = resolveAdjudications(publicBatch, [oneHuman, triageJudgment()]);

    expect(result.status).toBe('incomplete');
    expect(result.canonical).toBeFalse();
    expect(result.coverage.completeAttestedHumanAdjudicatorCount).toBe(1);
    expect(result.coverage.triageArtifactCount).toBe(1);
    expect(result.coverage.completeTriageArtifactCount).toBe(1);
    expect(result.counts.resolved).toBe(0);
    expect(result.counts.missingEvidence).toBe(publicBatch.items.length);
    expect(result.items.every((item) => item.status === 'missing-evidence')).toBeTrue();

    const duplicateHuman = resolveAdjudications(publicBatch, [
      oneHuman,
      humanJudgment(publicBatch, 'human-one'),
    ]);
    expect(duplicateHuman.canonical).toBeFalse();
    expect(duplicateHuman.coverage.completeAttestedHumanAdjudicatorCount).toBe(0);
    expect(duplicateHuman.diagnostics.invalidJudgmentArtifacts.every((entry) =>
      entry.reasons.includes('duplicate human adjudicator ID'))).toBeTrue();
  });

  it('keeps incomplete but schema-valid LLM triage diagnostic without invalidating two humans', () => {
    const incompleteTriage = buildHydeJudgmentArtifact(publicBatch, {
      adjudicatorId: 'triage-incomplete',
      adjudicatorKind: 'llm-triage',
      blindedIndependentAttestation: false,
      judgments: judgmentsForBatch(publicBatch).slice(1),
      createdAt: '2026-01-04T00:00:00.000Z',
    });
    const result = resolveAdjudications(publicBatch, [
      humanJudgment(publicBatch, 'human-one'),
      humanJudgment(publicBatch, 'human-two'),
      incompleteTriage,
    ]);

    expect(result.status).toBe('complete');
    expect(result.canonical).toBeTrue();
    expect(result.coverage.triageArtifactCount).toBe(1);
    expect(result.coverage.completeTriageArtifactCount).toBe(0);
    expect(result.diagnostics.triage).toEqual([{
      adjudicatorId: 'triage-incomplete',
      complete: false,
      attested: false,
    }]);
  });

  it('resolves exact independent agreement canonically', () => {
    const result = resolveAdjudications(publicBatch, [
      humanJudgment(publicBatch, 'human-one'),
      humanJudgment(publicBatch, 'human-two'),
    ]);

    expect(result.status).toBe('complete');
    expect(result.canonical).toBeTrue();
    expect(result.reasons).toEqual([]);
    expect(result.counts).toEqual({
      resolved: publicBatch.items.length,
      agreement: publicBatch.items.length,
      disagreement: 0,
      unresolved: 0,
      missingEvidence: 0,
    });
    expect(result.items.every((item) => item.status === 'resolved' && item.resolution === 'agreement')).toBeTrue();
  });

  it('makes every unused resolver decision explicit, incomplete, and noncanonical', () => {
    const agreedItem = publicBatch.items.find((item) => item.taskKind === 'candidate-relevance');
    if (!agreedItem) throw new Error('Fixture must include candidate items');
    const result = resolveAdjudications(publicBatch, [
      humanJudgment(publicBatch, 'human-one'),
      humanJudgment(publicBatch, 'human-two'),
    ], resolverArtifact([{
      opaqueId: agreedItem.opaqueId,
      taskKind: 'candidate-relevance',
      finalRelevanceGrade: 2,
      rationale: 'Surplus decision for an already agreed item.',
    }]));

    expect(result.status).toBe('incomplete');
    expect(result.canonical).toBeFalse();
    expect(result.counts.unresolved).toBe(0);
    expect(result.reasons.some((reason) => reason.includes('resolver decisions were unused'))).toBeTrue();
    expect(result.reasons.some((reason) => reason.includes(agreedItem.opaqueId))).toBeTrue();
  });

  it('makes any invalid surplus human artifact explicitly noncanonical', () => {
    const goodOne = humanJudgment(publicBatch, 'human-one');
    const goodTwo = humanJudgment(publicBatch, 'human-two');
    const invalidSurplus = humanJudgment(
      publicBatch,
      'human-three',
      judgmentsForBatch(publicBatch).slice(1),
    );
    const result = resolveAdjudications(publicBatch, [goodOne, goodTwo, invalidSurplus]);

    expect(result.status).toBe('complete');
    expect(result.canonical).toBeFalse();
    expect(result.coverage.invalidHumanArtifactCount).toBe(1);
    expect(result.reasons.some((reason) => reason.includes('submitted human judgment artifacts are invalid'))).toBeTrue();
    expect(result.sourceProvenance.judgmentArtifacts).toHaveLength(3);
  });

  it('makes coverage mismatch explicit rather than silently omitting missing evidence', () => {
    const complete = humanJudgment(publicBatch, 'human-one');
    const incomplete = humanJudgment(
      publicBatch,
      'human-two',
      judgmentsForBatch(publicBatch).slice(1),
    );
    const result = resolveAdjudications(publicBatch, [complete, incomplete]);

    expect(result.status).toBe('incomplete');
    expect(result.canonical).toBeFalse();
    expect(result.coverage.invalidHumanArtifactCount).toBe(1);
    expect(result.diagnostics.invalidJudgmentArtifacts).toEqual([
      { adjudicatorId: 'human-two', reasons: ['1 missing judgment entries'] },
    ]);
    expect(result.items).toHaveLength(publicBatch.items.length);
    expect(result.items.every((item) =>
      item.status === 'missing-evidence' && item.reason === 'invalid-human-coverage')).toBeTrue();
  });

  it('requires blinded resolver decisions for candidate disagreement or grounding unable labels', () => {
    const candidateItem = publicBatch.items.find((item) => item.taskKind === 'candidate-relevance');
    const groundingItem = publicBatch.items.find((item) => item.taskKind === 'generated-document-grounding');
    if (!candidateItem || !groundingItem) throw new Error('Fixture must include both task kinds');

    const secondJudgments = judgmentsForBatch(publicBatch).map((judgment): HydeIndependentJudgment => {
      if (judgment.opaqueId === candidateItem.opaqueId && judgment.taskKind === 'candidate-relevance') {
        return { ...judgment, relevanceGrade: 3 };
      }
      if (judgment.opaqueId === groundingItem.opaqueId && judgment.taskKind === 'generated-document-grounding') {
        return { ...judgment, grounding: 'unable' };
      }
      return judgment;
    });
    const first = humanJudgment(publicBatch, 'human-one');
    const second = humanJudgment(publicBatch, 'human-two', secondJudgments);
    const unresolved = resolveAdjudications(publicBatch, [first, second]);

    expect(unresolved.status).toBe('incomplete');
    expect(unresolved.canonical).toBeFalse();
    expect(unresolved.counts.disagreement).toBe(2);
    expect(unresolved.counts.unresolved).toBe(2);
    expect(unresolved.items.filter((item) => item.status === 'unresolved')).toEqual(expect.arrayContaining([
      expect.objectContaining({ opaqueId: candidateItem.opaqueId, reason: 'resolver-decision-required' }),
      expect.objectContaining({ opaqueId: groundingItem.opaqueId, reason: 'resolver-decision-required' }),
    ]));

    const additions: HydeUnsupportedAddition[] = [{
      category: 'profile_contamination',
      excerpts: ['unsupported profile fact'],
      rationale: 'The source text does not contain this fact.',
    }];
    const resolved = resolveAdjudications(publicBatch, [first, second], resolverArtifact([
      {
        opaqueId: candidateItem.opaqueId,
        taskKind: 'candidate-relevance',
        finalRelevanceGrade: 1,
        rationale: 'The candidate is only weakly relevant under the blinded rubric.',
      },
      {
        opaqueId: groundingItem.opaqueId,
        taskKind: 'generated-document-grounding',
        finalGrounding: 'unsupported',
        unsupportedAdditions: additions,
        rationale: 'The generated text adds a fact not present in source text.',
      },
    ]));

    expect(resolved.status).toBe('complete');
    expect(resolved.canonical).toBeTrue();
    expect(resolved.counts.disagreement).toBe(2);
    expect(resolved.counts.unresolved).toBe(0);
    expect(resolved.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        opaqueId: candidateItem.opaqueId,
        status: 'resolved',
        resolution: 'resolver',
        finalRelevanceGrade: 1,
        resolverId: 'blind-resolver',
      }),
      expect.objectContaining({
        opaqueId: groundingItem.opaqueId,
        status: 'resolved',
        resolution: 'resolver',
        finalGrounding: 'unsupported',
        unsupportedAdditions: additions,
        resolverId: 'blind-resolver',
      }),
    ]));
  });

  it('merges unsupported-addition diagnostics when humans agree on unsupported grounding', () => {
    const groundingItem = publicBatch.items.find((item) => item.taskKind === 'generated-document-grounding');
    if (!groundingItem) throw new Error('Fixture must include grounding items');
    const additionsOne: HydeUnsupportedAddition = {
      category: 'location',
      excerpts: ['Berlin'],
      rationale: 'Berlin is absent from source text.',
    };
    const additionsTwo: HydeUnsupportedAddition = {
      category: 'numeric_scale',
      excerpts: ['10,000'],
      rationale: 'The source gives no numeric scale.',
    };
    const withGrounding = (addition: HydeUnsupportedAddition) =>
      judgmentsForBatch(publicBatch).map((judgment): HydeIndependentJudgment =>
        judgment.opaqueId === groundingItem.opaqueId && judgment.taskKind === 'generated-document-grounding'
          ? { ...judgment, grounding: 'unsupported', unsupportedAdditions: [addition] }
          : judgment);
    const result = resolveAdjudications(publicBatch, [
      humanJudgment(publicBatch, 'human-one', withGrounding(additionsOne)),
      humanJudgment(publicBatch, 'human-two', withGrounding(additionsTwo)),
    ]);
    const record = result.items.find((item) => item.opaqueId === groundingItem.opaqueId);

    expect(result.canonical).toBeTrue();
    expect(record).toEqual(expect.objectContaining({
      status: 'resolved',
      resolution: 'agreement',
      finalGrounding: 'unsupported',
    }));
    if (!record || record.status !== 'resolved' || record.taskKind !== 'generated-document-grounding') {
      throw new Error('Expected resolved grounding record');
    }
    expect(record.unsupportedAdditions).toEqual(expect.arrayContaining([additionsOne, additionsTwo]));
  });

  it('enforces grounding/addition invariants across judgment, resolver, and resolved records', () => {
    const valid = humanJudgment(publicBatch, 'human-one');
    const groundingIndex = valid.judgments.findIndex((judgment) =>
      judgment.taskKind === 'generated-document-grounding');
    if (groundingIndex < 0) throw new Error('Fixture must include grounding judgments');
    const addition: HydeUnsupportedAddition = {
      category: 'other',
      excerpts: ['invented fact'],
      rationale: 'Absent from source text.',
    };
    for (const grounding of [
      { grounding: 'supported', unsupportedAdditions: [addition] },
      { grounding: 'unable', unsupportedAdditions: [addition] },
      { grounding: 'unsupported', unsupportedAdditions: [] },
    ] as const) {
      const malformed = structuredClone(valid);
      malformed.judgments[groundingIndex] = {
        opaqueId: malformed.judgments[groundingIndex].opaqueId,
        taskKind: 'generated-document-grounding',
        grounding: grounding.grounding,
        unsupportedAdditions: [...grounding.unsupportedAdditions],
      };
      expect(() => parseHydeJudgmentArtifact(malformed)).toThrow();
    }

    const groundingItem = publicBatch.items.find((item) =>
      item.taskKind === 'generated-document-grounding');
    if (!groundingItem) throw new Error('Fixture must include grounding items');
    expect(() => resolverArtifact([{
      opaqueId: groundingItem.opaqueId,
      taskKind: 'generated-document-grounding',
      finalGrounding: 'unsupported',
      unsupportedAdditions: [],
      rationale: 'Malformed empty unsupported decision.',
    }])).toThrow();
    expect(() => resolverArtifact([{
      opaqueId: groundingItem.opaqueId,
      taskKind: 'generated-document-grounding',
      finalGrounding: 'unsupported',
      unsupportedAdditions: [{
        category: 'other',
        excerpts: [],
        rationale: 'Malformed addition without an excerpt.',
      }],
      rationale: 'Malformed unsupported decision without excerpt evidence.',
    }])).toThrow();
    expect(() => resolverArtifact([{
      opaqueId: groundingItem.opaqueId,
      taskKind: 'generated-document-grounding',
      finalGrounding: 'supported',
      unsupportedAdditions: [addition],
      rationale: 'Malformed supported decision with additions.',
    }])).toThrow();

    const unsupportedJudgments = judgmentsForBatch(publicBatch).map((judgment): HydeIndependentJudgment =>
      judgment.opaqueId === groundingItem.opaqueId && judgment.taskKind === 'generated-document-grounding'
        ? { ...judgment, grounding: 'unsupported', unsupportedAdditions: [addition] }
        : judgment);
    const resolved = resolveAdjudications(publicBatch, [
      humanJudgment(publicBatch, 'human-one', unsupportedJudgments),
      humanJudgment(publicBatch, 'human-two', unsupportedJudgments),
    ]);
    const malformedResolved = structuredClone(resolved);
    const record = malformedResolved.items.find((item) => item.opaqueId === groundingItem.opaqueId);
    if (!record || record.status !== 'resolved' || record.taskKind !== 'generated-document-grounding') {
      throw new Error('Expected resolved grounding record');
    }
    record.unsupportedAdditions = [];
    expect(() => resolveAdjudications(publicBatch, [
      humanJudgment(publicBatch, 'human-one'),
      humanJudgment(publicBatch, 'human-two'),
    ])).not.toThrow();
    expect(() => parseHydeResolvedAdjudicationArtifact(malformedResolved)).toThrow();
  });

  it('rejects malformed independent judgment versions and artifact types', () => {
    const valid = humanJudgment(publicBatch, 'human-one');
    expect(() => parseHydeJudgmentArtifact({ ...valid, schemaVersion: 'wrong-version' })).toThrow();
    expect(() => parseHydeJudgmentArtifact({ ...valid, artifactType: 'wrong-type' })).toThrow();
  });
});
