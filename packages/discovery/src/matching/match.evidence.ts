import type { MatchEvidence } from '../core/types.js';

export interface EvidenceCandidateInput {
  networkId: string;
  similarity: number;
  lens: string;
  discoverySource?: 'query';
  matchedStrategies?: string[];
  candidateIntentId?: string;
  sourceContextId?: string;
  candidateContextId?: string;
  candidatePayload?: string;
  candidateSummary?: string;
}

export function buildCandidateEvidence(candidate: EvidenceCandidateInput): MatchEvidence {
  const kind = resolveEvidenceKind(candidate);
  return {
    kind,
    networkId: candidate.networkId,
    score: candidate.similarity,
    lens: candidate.lens,
    discoverySource: candidate.discoverySource,
    matchedStrategies: candidate.matchedStrategies,
    candidateIntentId: candidate.candidateIntentId,
    sourceContextId: candidate.sourceContextId,
    candidateContextId: candidate.candidateContextId,
    payload: candidate.candidatePayload,
    summary: candidate.candidateSummary,
  };
}

export function withCandidateEvidence<T extends EvidenceCandidateInput>(candidate: T): T & { evidence: MatchEvidence[] } {
  return { ...candidate, evidence: [buildCandidateEvidence(candidate)] };
}

export function mergeMatchEvidence(...groups: Array<MatchEvidence[] | undefined>): MatchEvidence[] {
  const byKey = new Map<string, MatchEvidence>();
  for (const evidence of groups.flatMap((group) => group ?? [])) {
    const key = [
      evidence.kind,
      evidence.networkId,
      evidence.candidateIntentId ?? '',
      evidence.sourceContextId ?? '',
      evidence.candidateContextId ?? '',
      evidence.lens ?? '',
    ].join('|');
    const existing = byKey.get(key);
    if (!existing || (evidence.score ?? 0) > (existing.score ?? 0)) byKey.set(key, evidence);
  }
  return Array.from(byKey.values());
}

export function withMatchedStrategies(evidence: MatchEvidence[], strategies: string[]): MatchEvidence[] {
  return evidence.map((item) => ({
    ...item,
    matchedStrategies: Array.from(new Set([...(item.matchedStrategies ?? []), ...strategies])),
  }));
}

function resolveEvidenceKind(candidate: EvidenceCandidateInput): MatchEvidence['kind'] {
  if (candidate.candidateContextId) return 'query_context';
  if (candidate.candidateIntentId) return 'query_intent';
  return 'profile';
}
