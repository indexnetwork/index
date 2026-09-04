import type { OpportunityEvidence } from '../../protocol/schemas/network-assignment.schema.js';

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

export function buildCandidateEvidence(candidate: EvidenceCandidateInput): OpportunityEvidence {
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

export function withCandidateEvidence<T extends EvidenceCandidateInput>(candidate: T): T & { evidence: OpportunityEvidence[] } {
  return { ...candidate, evidence: [buildCandidateEvidence(candidate)] };
}

export function mergeOpportunityEvidence(...groups: Array<OpportunityEvidence[] | undefined>): OpportunityEvidence[] {
  const byKey = new Map<string, OpportunityEvidence>();
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
      item.candidateIntentId ? `candidateIntent=${item.candidateIntentId}` : undefined,
      item.sourceContextId ? `sourceContext=${item.sourceContextId}` : undefined,
      item.candidateContextId ? `candidateContext=${item.candidateContextId}` : undefined,
      item.matchedStrategies?.length ? `strategies=${item.matchedStrategies.join(',')}` : undefined,
    ].filter(Boolean).join(', ');
    const text = item.summary ?? item.payload ?? '';
    const domainCaution =
      (item.kind === 'query_context' && !text)
        ? ' [context text unavailable — do NOT infer domain match from RAG score alone; verify domain alignment from profile]'
        : '';
    return `    - ${item.kind} on ${item.networkId} via ${item.lens ?? 'unknown'} score=${item.score?.toFixed(3) ?? '—'}${refs ? ` (${refs})` : ''}${text ? `: ${text}` : ''}${domainCaution}`;
  }).join('\n');
}

function resolveEvidenceKind(candidate: EvidenceCandidateInput): OpportunityEvidence['kind'] {
  if (candidate.candidateContextId) return 'query_context';
  if (candidate.candidateIntentId) return 'query_intent';
  return 'profile';
}
