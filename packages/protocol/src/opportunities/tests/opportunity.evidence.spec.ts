import { describe, expect, it } from 'bun:test';

import type { OpportunityEvidence } from '../../shared/schemas/network-assignment.schema.js';
import { buildCandidateEvidence, mergeOpportunityEvidence, renderOpportunityEvidenceForPrompt, withMatchedStrategies } from '../domain/opportunity.evidence.js';

describe('opportunity.evidence', () => {
  it('builds premise-similarity evidence', () => {
    const evidence = buildCandidateEvidence({
      networkId: 'net-1',
      similarity: 0.82,
      lens: 'premise_match',
      discoverySource: 'premise-similarity',
      sourcePremiseId: 'source-premise',
      candidatePremiseId: 'candidate-premise',
      candidatePayload: 'I build AI tools',
    });

    expect(evidence).toMatchObject({
      kind: 'premise_similarity',
      networkId: 'net-1',
      score: 0.82,
      sourcePremiseId: 'source-premise',
      candidatePremiseId: 'candidate-premise',
      assertionText: 'I build AI tools',
    });
  });

  it('uses profile evidence kind for profile-only candidates', () => {
    const evidence = buildCandidateEvidence({
      networkId: 'net-1',
      similarity: 1,
      lens: 'explicit_mention',
      discoverySource: 'query',
    });

    expect(evidence.kind).toBe('profile');
  });

  it('merges duplicate evidence by stable key and keeps highest score', () => {
    const merged = mergeOpportunityEvidence(
      [{ kind: 'query_intent', networkId: 'net-1', candidateIntentId: 'intent-1', lens: 'mirror', score: 0.7 }],
      [{ kind: 'query_intent', networkId: 'net-1', candidateIntentId: 'intent-1', lens: 'mirror', score: 0.9 }],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBe(0.9);
  });

  it('copies matched strategies onto merged evidence', () => {
    const evidence = withMatchedStrategies([
      { kind: 'query_intent', networkId: 'net-1', candidateIntentId: 'intent-1', lens: 'mirror', score: 0.9 },
    ], ['query', 'context-to-intent']);

    expect(evidence[0].matchedStrategies).toEqual(['query', 'context-to-intent']);
  });

  it('renders evidence for evaluator prompt', () => {
    const rendered = renderOpportunityEvidenceForPrompt([
      { kind: 'context_to_intent', networkId: 'net-1', sourceContextId: 'ctx-1', candidateIntentId: 'intent-1', lens: 'context_match', score: 0.8, matchedStrategies: ['context-to-intent'] },
    ]);

    expect(rendered).toContain('context_to_intent');
    expect(rendered).toContain('sourceContext=ctx-1');
    expect(rendered).toContain('candidateIntent=intent-1');
    expect(rendered).toContain('strategies=context-to-intent');
  });
});

describe('context-backed evidence', () => {
  it('resolves context-similarity discovery source to context_similarity kind', () => {
    const ev = buildCandidateEvidence({
      networkId: 'net1',
      similarity: 0.8,
      lens: 'context_match',
      discoverySource: 'context-similarity',
      sourceContextId: 'ctx-src',
      candidateContextId: 'ctx-cand',
      candidatePayload: 'A researcher working on protocol design.',
    });
    expect(ev.kind).toBe('context_similarity');
    expect(ev.candidateContextId).toBe('ctx-cand');
    expect(ev.assertionText).toBeUndefined();
  });

  it('resolves HyDE context candidates (candidateContextId, query source) to query_context kind', () => {
    const ev = buildCandidateEvidence({
      networkId: 'net1',
      similarity: 0.7,
      lens: 'some_lens',
      discoverySource: 'query',
      candidateContextId: 'ctx-cand',
      candidatePayload: 'A researcher working on protocol design.',
    });
    expect(ev.kind).toBe('query_context');
  });

  it('renders query_context entries with candidateContext ref and text-unavailable caution', () => {
    const rendered = renderOpportunityEvidenceForPrompt([
      {
        kind: 'query_context',
        networkId: 'net1',
        score: 0.7,
        lens: 'some_lens',
        candidateContextId: 'ctx-cand',
      } as OpportunityEvidence,
    ]);
    expect(rendered).toContain('candidateContext=ctx-cand');
    expect(rendered).toContain('context text unavailable');
  });

  it('merge dedups context evidence by candidateContextId', () => {
    const a = buildCandidateEvidence({
      networkId: 'net1', similarity: 0.6, lens: 'l1',
      discoverySource: 'context-similarity', candidateContextId: 'ctx-1',
    });
    const b = buildCandidateEvidence({
      networkId: 'net1', similarity: 0.9, lens: 'l1',
      discoverySource: 'context-similarity', candidateContextId: 'ctx-1',
    });
    const merged = mergeOpportunityEvidence([a], [b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBe(0.9);
  });
});
