import type { NetworkAssignmentMetadata } from '@indexnetwork/protocol';

export interface IntentVerificationFields {
  semanticEntropy: number | null;
  referentialAnchor: string | null;
  intentMode: string | null;
  speechActType: string | null;
  felicityAuthority: number | null;
  felicitySincerity: number | null;
  felicityClarity: number | null;
}

export type VerificationAnalysisStatus = 'complete' | 'default_only' | 'partial' | 'missing';

export interface IntentDebugRecordInput extends IntentVerificationFields {
  id: string;
  payload: string;
  summary: string | null;
  sourceType: string | null;
  hasEmbedding: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

/**
 * Classifies persisted verifier columns without treating schema defaults as evidence
 * that verification ran. A complete analysis requires every verifier field.
 */
export function buildVerificationAnalysisDiagnostic(
  fields: IntentVerificationFields,
): { status: VerificationAnalysisStatus; missingFields: string[] } {
  const requiredFields: Array<[string, unknown]> = [
    ['semanticEntropy', fields.semanticEntropy],
    ['referentialAnchor', fields.referentialAnchor],
    ['intentMode', fields.intentMode],
    ['speechActType', fields.speechActType],
    ['felicityAuthority', fields.felicityAuthority],
    ['felicitySincerity', fields.felicitySincerity],
    ['felicityClarity', fields.felicityClarity],
  ];
  const missingFields = requiredFields
    .filter(([, value]) => value === null)
    .map(([name]) => name);

  if (missingFields.length === 0) return { status: 'complete', missingFields };

  const isDefaultOnly = fields.semanticEntropy === 1
    && fields.intentMode === 'ATTRIBUTIVE'
    && fields.referentialAnchor === null
    && fields.speechActType === null
    && fields.felicityAuthority === null
    && fields.felicitySincerity === null
    && fields.felicityClarity === null;

  if (isDefaultOnly) return { status: 'default_only', missingFields };
  if (missingFields.length === requiredFields.length) return { status: 'missing', missingFields };
  return { status: 'partial', missingFields };
}

/**
 * Projects verifier columns with their persisted names. In particular,
 * semantic entropy is not a confidence score and is never exposed as one.
 */
export function buildIntentDebugRecord(intent: IntentDebugRecordInput) {
  return {
    id: intent.id,
    text: intent.payload,
    summary: intent.summary,
    status: intent.archivedAt ? 'archived' : 'active',
    semanticEntropy: intent.semanticEntropy,
    referentialAnchor: intent.referentialAnchor,
    intentMode: intent.intentMode,
    speechActType: intent.speechActType,
    felicityAuthority: intent.felicityAuthority,
    felicitySincerity: intent.felicitySincerity,
    felicityClarity: intent.felicityClarity,
    sourceType: intent.sourceType,
    hasEmbedding: intent.hasEmbedding,
    createdAt: intent.createdAt.toISOString(),
    updatedAt: intent.updatedAt.toISOString(),
  };
}

/** Builds the independently actionable verification, assignment, and HyDE health signals. */
export function buildIntentPipelineHealthDiagnostic(input: {
  hasEmbedding: boolean;
  verificationAnalysis: ReturnType<typeof buildVerificationAnalysisDiagnostic>;
  hasHydeDocuments: boolean;
  isInAtLeastOneNetwork: boolean;
}) {
  return {
    hasEmbedding: input.hasEmbedding,
    hasHydeDocuments: input.hasHydeDocuments,
    isInAtLeastOneNetwork: input.isInAtLeastOneNetwork,
    verificationAnalysis: input.verificationAnalysis,
    missingVerificationAnalysis: input.verificationAnalysis.status !== 'complete',
    missingAssignment: !input.isInAtLeastOneNetwork,
    missingHyde: !input.hasHydeDocuments,
  };
}

export interface IntentAssignmentDiagnosticInput {
  networkId: string;
  networkTitle: string;
  networkPrompt: string | null;
  relevancyScore: string | null;
  assignmentMetadata: NetworkAssignmentMetadata | null;
}

/**
 * Serializes stored assignment diagnostics without fabricating a final score for
 * legacy rows that predate assignment metadata.
 */
export function buildIntentAssignmentDiagnostic(row: IntentAssignmentDiagnosticInput) {
  const metadata = row.assignmentMetadata;
  const deterministicNoPromptAssignment = metadata?.promptPresence === 'none'
    && metadata.finalScore === 1
    && metadata.rawScores === undefined;

  return {
    networkId: row.networkId,
    networkTitle: row.networkTitle,
    networkPrompt: row.networkPrompt,
    relevancyScore: row.relevancyScore === null ? null : Number(row.relevancyScore),
    finalScore: metadata?.finalScore ?? null,
    promptPresence: metadata?.promptPresence ?? null,
    isDeterministicNoPromptAssignment: deterministicNoPromptAssignment,
    ...(metadata?.rawScores === undefined ? {} : { rawScores: metadata.rawScores }),
  };
}
