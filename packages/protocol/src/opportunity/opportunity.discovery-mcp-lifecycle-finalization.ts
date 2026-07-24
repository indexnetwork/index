import type { OpportunityStatus } from '../shared/interfaces/database.interface.js';
import type { OpportunityCardLike } from './opportunity.card-presentation.js';
import type { ExistingConnection, FormattedDiscoveryCandidate } from './opportunity.discover.js';

type DiscoveryPagination = {
  discoveryId: string;
  evaluated: number;
  remaining: number;
};

export interface DiscoveryMcpLifecycleFinalizationInput<TCard extends OpportunityCardLike> {
  isMcp: boolean;
  candidates: FormattedDiscoveryCandidate[];
  existingConnections?: ExistingConnection[];
  existingConnectionsForMention?: ExistingConnection[];
  alreadyAcceptedPairs?: Array<{ opportunityId: string; counterpartyUserId: string }>;
  pagination?: DiscoveryPagination;
  isIntroducerFlow: boolean;
  displayLimit: number;
  readOpportunitiesByIds: (ids: string[]) => Promise<Array<{ id: string; status: OpportunityStatus }>>;
  warn: (message: string, data: Record<string, unknown>) => void;
  /** The caller supplies the only allowed safe-presentation path for card text. */
  projectSafeCard: (candidate: FormattedDiscoveryCandidate) => TCard;
}

export interface DiscoveryMcpLifecycleFinalization<TCard extends OpportunityCardLike> {
  displayedCards: TCard[];
  /** Source candidates retain viewer approval data for facade-owned link minting. */
  displayedCandidates: FormattedDiscoveryCandidate[];
  negotiatingCount: number;
  /** Adds lifecycle-aware completion copy after facade-owned link decoration. */
  composeMessage: (baseMessage: string) => string;
}

function existingConnectionsNarrative(connections: ExistingConnection[]): string {
  if (connections.length === 0) return '';
  return (
    '\n\nYou already have a connection with: ' +
    connections.map((connection) => connection.name + (connection.status ? ` (${connection.status})` : '')).join(', ') +
    '. View on your home page.'
  );
}

function alreadyAcceptedNarrative(alreadyAcceptedPairs: Array<{ opportunityId: string; counterpartyUserId: string }>): string {
  if (alreadyAcceptedPairs.length === 0) return '';
  return `\n\nYou already have ${alreadyAcceptedPairs.length} accepted opportunity(ies) with some of these candidates — open the existing chat with them rather than creating a new draft.`;
}

/**
 * Reconciles a discovery graph result with authoritative opportunity lifecycle
 * rows before the MCP tool presents cards. Graph output is intentionally not
 * trusted for new-card lifecycle after its negotiate phase. The tools facade
 * continues to own link writes and the outer tool response.
 */
export async function finalizeMcpDiscoveryLifecycle<TCard extends OpportunityCardLike>(
  input: DiscoveryMcpLifecycleFinalizationInput<TCard>,
): Promise<DiscoveryMcpLifecycleFinalization<TCard>> {
  const existingConnectionIds = new Set(
    (input.existingConnections ?? [])
      .map((connection) => connection.opportunityId)
      .filter((id): id is string => typeof id === 'string'),
  );

  let negotiatingCount = 0;
  let visibleCandidates = input.candidates;
  if (input.isMcp && input.candidates.length > 0) {
    const newCardIds = input.candidates
      .filter((candidate) => !existingConnectionIds.has(candidate.opportunityId))
      .map((candidate) => candidate.opportunityId);
    const refreshed = newCardIds.length > 0
      ? await input.readOpportunitiesByIds(newCardIds)
      : [];
    const statusById = new Map<string, OpportunityStatus>(
      refreshed.map((opportunity) => [opportunity.id, opportunity.status]),
    );

    const draftCandidates: FormattedDiscoveryCandidate[] = [];
    for (const candidate of input.candidates) {
      if (existingConnectionIds.has(candidate.opportunityId)) {
        // Re-surfaced connections preserve their discover-time lifecycle.
        draftCandidates.push(candidate);
        continue;
      }

      const refreshedStatus = statusById.get(candidate.opportunityId);
      if (refreshedStatus === 'draft') {
        draftCandidates.push({ ...candidate, status: refreshedStatus });
        continue;
      }
      if (refreshedStatus === 'negotiating') {
        negotiatingCount += 1;
        continue;
      }
      if (refreshedStatus === 'rejected' || refreshedStatus === 'stalled') {
        continue;
      }

      // Pending, latent, and missing rows are not expected after the graph's
      // negotiate phase. Preserve the established fail-closed display policy:
      // do not surface a card, but make the deferred state observable.
      input.warn('unexpected refreshed status — counting as negotiating', {
        opportunityId: candidate.opportunityId,
        refreshedStatus,
      });
      negotiatingCount += 1;
    }
    visibleCandidates = draftCandidates;
  }

  // Projection is supplied by the tools facade so this policy cannot choose a
  // raw-reasoning path; callers must use getSafePresentationOrSkip-compatible copy.
  const projectedCards = visibleCandidates.map(input.projectSafeCard);
  const displayedCards = projectedCards.slice(0, input.displayLimit);
  const displayedCandidates = visibleCandidates.slice(0, input.displayLimit);
  const extraFromCap = projectedCards.length - displayedCards.length;
  const existingNarrative = existingConnectionsNarrative(
    input.existingConnectionsForMention ?? input.existingConnections ?? [],
  );
  const acceptedNarrative = alreadyAcceptedNarrative(input.alreadyAcceptedPairs ?? []);
  const totalRemaining = (input.pagination?.remaining ?? 0) + extraFromCap;
  const completionNarrative = totalRemaining > 0 && input.pagination?.discoveryId
    ? `\n\nThere are ${totalRemaining} more candidates. Ask if the user wants to see more — they can say "show me more" and you should call discover_opportunities with continueFrom="${input.pagination.discoveryId}".`
    : input.isIntroducerFlow
      ? '\n\nThese are all the introduction candidates I found for this person.'
      : '\n\nThese are all the connections I found. If the user wants to attract more connections, suggest they create a signal — e.g. "Would you like to create a signal so others looking for someone like you can find you?" If they agree, call create_intent with a description based on what they were searching for.';

  return {
    displayedCards,
    displayedCandidates,
    negotiatingCount,
    composeMessage(baseMessage) {
      const message = baseMessage + existingNarrative + acceptedNarrative + completionNarrative;
      if (!input.isMcp || negotiatingCount === 0) return message;

      if (displayedCards.length > 0) {
        return message + `\n\n${negotiatingCount} more opportunit${negotiatingCount === 1 ? 'y is' : 'ies are'} still being evaluated — check back via \`list_opportunities\` shortly.`;
      }

      // Preserve existing/accepted facts but omit card-only completion copy.
      return `Found candidates, but they're still being evaluated. Try \`list_opportunities\` in a minute — ${negotiatingCount} pending.` + existingNarrative + acceptedNarrative;
    },
  };
}
