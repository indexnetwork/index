import type { OpportunityEvidence } from '../shared/schemas/network-assignment.schema.js';

export interface EvidenceCandidateInput {
  networkId: string;
  similarity: number;
  lens: string;
  discoverySource?: 'query' | 'premise-similarity' | 'context-to-intent';
  matchedStrategies?: string[];
  sourcePremiseId?: string;
  candidatePremiseId?: string;
  candidateIntentId?: string;
  sourceContextId?: string;
  candidatePayload?: string;
  candidateSummary?: string;
}

export function buildCandidateEvidence(candidate: EvidenceCandidateInput): OpportunityEvidence {
  const kind = resolveEvidenceKind(candidate);
  return {
    kind,
    networkId: candidate.networkId,
    score: candidate.similarity,
    lens: candidate.lens,
    discoverySource: candidate.discoverySource,
    matchedStrategies: candidate.matchedStrategies,
    sourcePremiseId: candidate.sourcePremiseId,
    candidatePremiseId: candidate.candidatePremiseId,
    candidateIntentId: candidate.candidateIntentId,
    sourceContextId: candidate.sourceContextId,
    payload: candidate.candidatePayload,
    summary: candidate.candidateSummary,
    assertionText: candidate.candidatePremiseId ? candidate.candidatePayload : undefined,
  };
}

export function withCandidateEvidence<T extends EvidenceCandidateInput>(candidate: T): T & { evidence: OpportunityEvidence[] } {
  return { ...candidate, evidence: [buildCandidateEvidence(candidate)] };
}

export function mergeOpportunityEvidence(...groups: Array<OpportunityEvidence[] | undefined>): OpportunityEvidence[] {
  const byKey = new Map<string, OpportunityEvidence>();
  for (const evidence of groups.flatMap((group) => group ?? [])) {
    const key = [
      evidence.kind,
      evidence.networkId,
      evidence.sourcePremiseId ?? '',
      evidence.candidatePremiseId ?? '',
      evidence.candidateIntentId ?? '',
      evidence.sourceContextId ?? '',
      evidence.lens ?? '',
    ].join('|');
    const existing = byKey.get(key);
    if (!existing || (evidence.score ?? 0) > (existing.score ?? 0)) byKey.set(key, evidence);
  }
  return Array.from(byKey.values());
}

export function withMatchedStrategies(evidence: OpportunityEvidence[], strategies: string[]): OpportunityEvidence[] {
  return evidence.map((item) => ({
    ...item,
    matchedStrategies: Array.from(new Set([...(item.matchedStrategies ?? []), ...strategies])),
  }));
}

export function renderOpportunityEvidenceForPrompt(evidence: OpportunityEvidence[]): string {
  if (evidence.length === 0) return '    —';
  return evidence.map((item) => {
    const refs = [
      item.sourcePremiseId ? `sourcePremise=${item.sourcePremiseId}` : undefined,
      item.candidatePremiseId ? `candidatePremise=${item.candidatePremiseId}` : undefined,
      item.candidateIntentId ? `candidateIntent=${item.candidateIntentId}` : undefined,
      item.sourceContextId ? `sourceContext=${item.sourceContextId}` : undefined,
      item.matchedStrategies?.length ? `strategies=${item.matchedStrategies.join(',')}` : undefined,
    ].filter(Boolean).join(', ');
    const text = item.summary ?? item.payload ?? item.assertionText ?? '';
    return `    - ${item.kind} on ${item.networkId} via ${item.lens ?? 'unknown'} score=${item.score?.toFixed(3) ?? '—'}${refs ? ` (${refs})` : ''}${text ? `: ${text}` : ''}`;
  }).join('\n');
}

function resolveEvidenceKind(candidate: EvidenceCandidateInput): OpportunityEvidence['kind'] {
  if (candidate.discoverySource === 'premise-similarity') return 'premise_similarity';
  if (candidate.discoverySource === 'context-to-intent') return 'context_to_intent';
  if (candidate.candidatePremiseId) return 'query_premise';
  if (candidate.candidateIntentId) return 'query_intent';
  return 'profile';
}
