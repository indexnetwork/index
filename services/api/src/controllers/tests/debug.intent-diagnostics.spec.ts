import { describe, expect, test } from 'bun:test';

import { buildIntentAssignmentDiagnostic, buildIntentDebugRecord, buildIntentPipelineHealthDiagnostic, buildVerificationAnalysisDiagnostic } from '../../services/debug-intent-diagnostics.service';

describe('intent debug diagnostics', () => {
  test('marks default entropy with absent verifier columns as default-only analysis', () => {
    const diagnostic = buildVerificationAnalysisDiagnostic({
      semanticEntropy: 1,
      referentialAnchor: null,
      intentMode: 'ATTRIBUTIVE',
      speechActType: null,
      felicityAuthority: null,
      felicitySincerity: null,
      felicityClarity: null,
    });

    expect(diagnostic).toEqual({
      status: 'default_only',
      missingFields: [
        'referentialAnchor',
        'speechActType',
        'felicityAuthority',
        'felicitySincerity',
        'felicityClarity',
      ],
    });
  });

  test('keeps all verifier fields distinct when analysis is complete', () => {
    expect(buildVerificationAnalysisDiagnostic({
      semanticEntropy: 0.2,
      referentialAnchor: 'first-person commitment',
      intentMode: 'DIRECTIVE',
      speechActType: 'COMMISSIVE',
      felicityAuthority: 8,
      felicitySincerity: 9,
      felicityClarity: 7,
    })).toEqual({ status: 'complete', missingFields: [] });
  });

  test('exposes entropy by name and preserves default/null verifier values', () => {
    const response = buildIntentDebugRecord({
      id: 'intent-1',
      payload: 'Need a collaborator',
      summary: null,
      semanticEntropy: 1,
      referentialAnchor: null,
      intentMode: 'ATTRIBUTIVE',
      speechActType: null,
      felicityAuthority: null,
      felicitySincerity: null,
      felicityClarity: null,
      sourceType: 'discovery_form',
      hasEmbedding: true,
      createdAt: new Date('2026-07-25T00:00:00.000Z'),
      updatedAt: new Date('2026-07-25T00:00:00.000Z'),
      archivedAt: null,
    });

    expect(response).toMatchObject({
      semanticEntropy: 1,
      referentialAnchor: null,
      intentMode: 'ATTRIBUTIVE',
      speechActType: null,
      felicityAuthority: null,
      felicitySincerity: null,
      felicityClarity: null,
    });
    expect(response).not.toHaveProperty('confidence');
    expect(response).not.toHaveProperty('inferenceType');
  });

  test('reports promptless assignment as deterministic without raw model scores', () => {
    expect(buildIntentAssignmentDiagnostic({
      networkId: 'network-1',
      networkTitle: 'No prompts',
      indexPrompt: null,
      relevancyScore: '1.0',
      assignmentMetadata: {
        resourceType: 'intent',
        mode: 'automatic',
        scope: 'global',
        policy: 'unified-threshold-v1',
        threshold: 0.7,
        promptPresence: 'none',
        finalScore: 1,
        assigned: true,
      },
    })).toEqual({
      networkId: 'network-1',
      networkTitle: 'No prompts',
      indexPrompt: null,
      relevancyScore: 1,
      finalScore: 1,
      promptPresence: 'none',
      isDeterministicNoPromptAssignment: true,
    });
  });

  test('does not fabricate final or raw scores for legacy assignments', () => {
    expect(buildIntentAssignmentDiagnostic({
      networkId: 'network-legacy',
      networkTitle: 'Legacy',
      indexPrompt: 'people who build tools',
      relevancyScore: null,
      assignmentMetadata: null,
    })).toEqual({
      networkId: 'network-legacy',
      networkTitle: 'Legacy',
      indexPrompt: 'people who build tools',
      relevancyScore: null,
      finalScore: null,
      promptPresence: null,
      isDeterministicNoPromptAssignment: false,
    });
  });

  test('makes missing verification analysis, assignment, and HyDE independently visible', () => {
    const verificationAnalysis = buildVerificationAnalysisDiagnostic({
      semanticEntropy: null,
      referentialAnchor: null,
      intentMode: null,
      speechActType: null,
      felicityAuthority: null,
      felicitySincerity: null,
      felicityClarity: null,
    });

    expect(buildIntentPipelineHealthDiagnostic({
      hasEmbedding: true,
      verificationAnalysis,
      hasHydeDocuments: false,
      isInAtLeastOneIndex: false,
    })).toMatchObject({
      missingVerificationAnalysis: true,
      missingAssignment: true,
      missingHyde: true,
    });
  });
});
