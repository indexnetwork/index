/**
 * Opportunity graph utilities: role derivation, visibility rules, and pure
 * helper functions for the opportunity discovery pipeline.
 *
 * With lens-based HyDE, strategy selection is handled automatically by the
 * LensInferrer agent. This file provides corpus-to-role mapping for opportunity actors
 * and stateless computation helpers used across graph nodes.
 */

import type { HydeTargetCorpus } from '../agents/lens.inferrer';

/** Actor roles in the opportunity model (agent / patient / peer). */
export type OpportunityActorRole = 'agent' | 'patient' | 'peer';

/** Result of mapping a corpus to source and candidate roles. */
export interface DerivedRoles {
  sourceRole: OpportunityActorRole;
  candidateRole: OpportunityActorRole;
}

/**
 * Derive actor roles from the corpus type of a lens match.
 *
 * When a candidate is found via:
 * - "profiles" corpus → found by who they are → candidate can help → agent
 * - "intents" corpus → found by what they need → candidate needs something → patient
 *
 * @param corpus - The target corpus that produced the match ('profiles' | 'intents')
 * @returns Roles for the source (intent owner) and the candidate (matched user/intent)
 */
export function deriveRolesFromCorpus(corpus: HydeTargetCorpus): DerivedRoles {
  switch (corpus) {
    case 'profiles':
      // Source seeks someone who can help → source is patient, candidate can help → agent
      return { sourceRole: 'patient', candidateRole: 'agent' };
    case 'intents':
      // Source offers or needs; candidate has complementary goal → source is agent, candidate is patient
      return { sourceRole: 'agent', candidateRole: 'patient' };
    default:
      return { sourceRole: 'peer', candidateRole: 'peer' };
  }
}

/**
 * Validates opportunity actors against the introducer rule:
 * - If an opportunity has an introducer, it must have one or two non-introducer actors
 *   (1 = 1:1 intro e.g. "I want to connect with X"; 2 = introducer connecting two others).
 *
 * @param actors - Array of actors with at least a role (e.g. { role: string })
 * @throws Error when the actor set is invalid
 */
export function validateOpportunityActors(actors: Array<{ role: string }>): void {
  const introducerCount = actors.filter((a) => a.role === 'introducer').length;
  const nonIntroducerCount = actors.filter((a) => a.role !== 'introducer').length;

  if (introducerCount > 0 && (nonIntroducerCount < 1 || nonIntroducerCount > 2)) {
    throw new Error(
      'An opportunity with an introducer must have one or two other actors.'
    );
  }
}

/**
 * Role-based visibility (Latent Opportunity Lifecycle).
 * A user can see an opportunity iff they are an actor and the rule below allows it.
 *
 * Compact Visibility Rule (from lifecycle doc):
 * - Introducer or peer: always see.
 * - Patient or party: see if (status is not latent, or there is no introducer).
 * - Agent: see if (status is accepted/rejected/expired, or (status is not latent and there is no introducer)).
 */
export function canUserSeeOpportunity(
  actors: Array<{ userId: string; role: string }>,
  status: string,
  userId: string
): boolean {
  const hasIntroducer = actors.some((a) => a.role === 'introducer');
  const userRoles = actors.filter((a) => a.userId === userId).map((a) => a.role);
  if (userRoles.length === 0) return false;

  return userRoles.some((role) => {
    if (role === 'introducer') return true;
    if (role === 'peer') return true;
    if (role === 'patient' || role === 'party')
      return status !== 'latent' || !hasIntroducer;
    if (role === 'agent')
      return (
        ['accepted', 'rejected', 'expired'].includes(status) ||
        (status !== 'latent' && !hasIntroducer)
      );
    return false;
  });
}

/**
 * Whether an opportunity should appear on the Home feed for the viewer (actionable = has a pending action).
 * Encodes the role-visibility matrix from the Latent Opportunity Lifecycle.
 */
export function isActionableForViewer(
  actors: Array<{ userId: string; role: string }>,
  status: string,
  viewerId: string
): boolean {
  const viewerActors = actors.filter((a) => a.userId === viewerId);
  if (viewerActors.length === 0) return false;

  const hasIntroducer = actors.some((a) => a.role === 'introducer');

  return viewerActors.some(({ role }) => {
    switch (role) {
      case 'introducer':
        return status === 'latent';
      case 'patient':
      case 'party':
        return hasIntroducer
          ? status === 'pending' || status === 'viewed'
          : status === 'latent';
      case 'agent':
        return hasIntroducer
          ? status === 'accepted'
          : status === 'pending' || status === 'viewed';
      case 'peer':
        return status === 'latent' || status === 'pending' || status === 'viewed';
      default:
        return false;
    }
  });
}

/** Per-lens statistics: candidate count and average similarity. */
export interface LensStats {
  count: number;
  avgSimilarity: number;
}

/**
 * Compute per-lens statistics from a list of candidates without mutation.
 *
 * Groups candidates by their `lens` field, counts each group, and computes
 * the average similarity rounded to three decimal places. Returns a new
 * object on every call — the input array is never modified.
 *
 * @param candidates - Array of objects with at least `lens` and `similarity`
 * @returns Record mapping each lens label to its aggregated stats
 */
export function computeLensStats(
  candidates: ReadonlyArray<{ lens?: string; similarity: number }>,
): Record<string, LensStats> {
  const totals = candidates.reduce<Record<string, { count: number; totalSimilarity: number }>>(
    (acc, c) => {
      const key = c.lens || 'unknown';
      const prev = acc[key] ?? { count: 0, totalSimilarity: 0 };
      return {
        ...acc,
        [key]: {
          count: prev.count + 1,
          totalSimilarity: prev.totalSimilarity + c.similarity,
        },
      };
    },
    {},
  );

  return Object.fromEntries(
    Object.entries(totals).map(([key, { count, totalSimilarity }]) => [
      key,
      {
        count,
        avgSimilarity: count > 0 ? Math.round((totalSimilarity / count) * 1000) / 1000 : 0,
      },
    ]),
  );
}
