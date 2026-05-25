import { describe, it, expect } from 'bun:test';

import { deriveRolesFromCorpus } from '../../opportunity/opportunity.utils.js';
import { resolveInitialStatus } from '../../opportunity/opportunity.state.js';
import type { CandidateMatch } from '../../opportunity/opportunity.state.js';
import type { OpportunityActor } from '../../shared/interfaces/database.interface.js';
import type { Id } from '../../shared/interfaces/database.interface.js';

describe('Premise Discovery', () => {
  describe('deriveRolesFromCorpus', () => {
    it('returns peer/peer for premises corpus', () => {
      const roles = deriveRolesFromCorpus('premises');
      expect(roles.sourceRole).toBe('peer');
      expect(roles.candidateRole).toBe('peer');
    });

    it('returns patient/agent for profiles corpus', () => {
      const roles = deriveRolesFromCorpus('profiles');
      expect(roles.sourceRole).toBe('patient');
      expect(roles.candidateRole).toBe('agent');
    });

    it('returns agent/patient for intents corpus', () => {
      const roles = deriveRolesFromCorpus('intents');
      expect(roles.sourceRole).toBe('agent');
      expect(roles.candidateRole).toBe('patient');
    });
  });

  describe('CandidateMatch shape', () => {
    it('accepts premise-similarity discovery source', () => {
      const candidate: CandidateMatch = {
        candidateUserId: 'user-1' as Id<'users'>,
        candidatePremiseId: 'premise-1' as Id<'premises'>,
        networkId: 'network-1' as Id<'networks'>,
        similarity: 0.85,
        lens: 'premise_match',
        candidatePayload: 'I am a blockchain researcher focused on zero-knowledge proofs',
        discoverySource: 'premise-similarity',
      };
      expect(candidate.discoverySource).toBe('premise-similarity');
      expect(candidate.candidatePremiseId).toBe('premise-1');
    });

    it('allows candidatePremiseId to be omitted for non-premise candidates', () => {
      const candidate: CandidateMatch = {
        candidateUserId: 'user-2' as Id<'users'>,
        networkId: 'network-1' as Id<'networks'>,
        similarity: 0.72,
        lens: 'profile_match',
        candidatePayload: 'Product manager at a climate startup',
        discoverySource: 'profile-similarity',
      };
      expect(candidate.candidatePremiseId).toBeUndefined();
    });
  });

  describe('OpportunityActor premise tracking', () => {
    it('accepts optional premise field', () => {
      const actor: OpportunityActor = {
        networkId: 'network-1' as Id<'networks'>,
        userId: 'user-1' as Id<'users'>,
        role: 'peer',
        premise: 'premise-1' as Id<'premises'>,
      };
      expect(actor.premise).toBe('premise-1');
    });

    it('works without premise field', () => {
      const actor: OpportunityActor = {
        networkId: 'network-1' as Id<'networks'>,
        userId: 'user-1' as Id<'users'>,
        role: 'agent',
        intent: 'intent-1' as Id<'intents'>,
      };
      expect(actor.premise).toBeUndefined();
    });

    it('allows both intent and premise to be absent', () => {
      const actor: OpportunityActor = {
        networkId: 'network-1' as Id<'networks'>,
        userId: 'user-1' as Id<'users'>,
        role: 'peer',
      };
      expect(actor.intent).toBeUndefined();
      expect(actor.premise).toBeUndefined();
    });
  });

  describe('resolveInitialStatus', () => {
    it('returns pending for ambient trigger without explicit status', () => {
      expect(resolveInitialStatus('ambient', undefined)).toBe('pending');
    });

    it('returns negotiating for orchestrator trigger without explicit status', () => {
      expect(resolveInitialStatus('orchestrator', undefined)).toBe('negotiating');
    });

    it('respects explicit status over trigger default', () => {
      expect(resolveInitialStatus('ambient', 'latent')).toBe('latent');
      expect(resolveInitialStatus('orchestrator', 'draft')).toBe('draft');
    });
  });
});
