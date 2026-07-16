/** Shared bounded public candidate context for pool mining and P4b stamping. */
import { POOL_DISCRIMINATOR_MAX_PUBLIC_CONTEXT_CHARS } from '@indexnetwork/protocol';
import type { CreateOpportunityData, Opportunity, PoolCandidate } from '@indexnetwork/protocol';

import type { ChatDatabaseAdapter } from '../../adapters/database.adapter';

const POOL_FIELD_MAX_CHARS = 100;

type ContextOpportunity = Pick<CreateOpportunityData | Opportunity, 'actors' | 'interpretation'>;

/** One call-local candidate whose id is controlled by the caller. */
export interface PoolCandidateContextInput {
  id: string;
  opportunity: ContextOpportunity;
}

/** Minimal lookup surface needed to assemble public context. */
export interface PoolCandidateContextDeps {
  getProfile: ChatDatabaseAdapter['getProfile'];
  getPremisesForUser: ChatDatabaseAdapter['getPremisesForUser'];
}

/**
 * Build the same bounded profile/bio and active-premise text for persisted
 * mining rows and unpersisted newborn create items. Raw evaluator reasoning is
 * deliberately excluded because it is not verified public presentation copy.
 */
export async function buildPoolCandidateContexts(
  ownerUserId: string,
  input: PoolCandidateContextInput[],
  deps: PoolCandidateContextDeps,
): Promise<PoolCandidate[]> {
  const withCounterpart = input.flatMap((entry) => {
    const counterpartUserId = entry.opportunity.actors.find(
      (actor) => actor.userId !== ownerUserId && actor.role !== 'introducer',
    )?.userId;
    return counterpartUserId ? [{ ...entry, counterpartUserId }] : [];
  });

  const uniqueUserIds = [...new Set(withCounterpart.map((entry) => entry.counterpartUserId))];
  const profilesByUser = new Map<string, { name: string; bio: string }>();
  const premisesByUser = new Map<string, string>();
  await Promise.all(uniqueUserIds.flatMap((userId) => [
    (async () => {
      try {
        const profile = await deps.getProfile(userId);
        if (profile) profilesByUser.set(userId, {
          name: profile.identity.name,
          bio: profile.identity.bio,
        });
      } catch {
        // Profile context is optional enrichment; callers remain fail-open.
      }
    })(),
    (async () => {
      try {
        const premises = await deps.getPremisesForUser(userId, 'ACTIVE');
        const snippets = premises.slice(0, 3).map((premise) => premise.assertion.text.slice(0, 90));
        if (snippets.length > 0) premisesByUser.set(userId, snippets.join('; '));
      } catch {
        // Premise context is optional enrichment; callers remain fail-open.
      }
    })(),
  ]));

  return withCounterpart.map((entry) => {
    const profile = profilesByUser.get(entry.counterpartUserId);
    const publicContext = [
      profile?.name ? `Name: ${profile.name}.` : null,
      profile?.bio ? `Bio: ${profile.bio.slice(0, POOL_FIELD_MAX_CHARS)}` : null,
      premisesByUser.has(entry.counterpartUserId) ? `Premises: ${premisesByUser.get(entry.counterpartUserId)}` : null,
    ].filter(Boolean).join(' ').slice(0, POOL_DISCRIMINATOR_MAX_PUBLIC_CONTEXT_CHARS);
    return {
      id: entry.id,
      publicContext,
      score: entry.opportunity.interpretation?.confidence ?? 0,
    };
  });
}
