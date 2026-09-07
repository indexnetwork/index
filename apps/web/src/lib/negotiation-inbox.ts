import type { NegotiationSummary } from '@/services/negotiations';

export type NegotiationInboxGroup = 'your_move' | 'in_progress' | 'resolved';

export interface NegotiationInboxItem {
  id: string;
  opportunityId: string;
  counterpart: { id: string; name: string; avatar: string | null };
  statement: string;
  group: NegotiationInboxGroup;
  label: string;
  chipClass: string;
  turnCount: number;
  timeAgo: string;
  sortTimestamp: number;
}

export interface NegotiationInboxGroups {
  yourMove: NegotiationInboxItem[];
  inProgress: NegotiationInboxItem[];
  resolved: NegotiationInboxItem[];
}

const OUTCOME_PRESENTATION = {
  agreed: { label: 'Agreed', chipClass: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  declined: { label: 'Declined', chipClass: 'border-gray-200 bg-gray-100 text-gray-600' },
  closed: { label: 'Closed', chipClass: 'border-gray-200 bg-gray-100 text-gray-600' },
} as const;

const YOUR_MOVE = { label: 'Your agent’s turn', chipClass: 'border-[#041729] bg-[#041729] text-white' };
const THEIR_MOVE = { label: 'Their agent’s turn', chipClass: 'border-amber-200 bg-amber-50 text-amber-700' };

function formatTimeAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * Groups the viewer's negotiations by whose turn it is.
 *
 * The record carries the whole state: `awaitingUserId` is the seat that owes a
 * turn, and `outcome` is set exactly once, when it settles.
 *
 * @param negotiations - The viewer's negotiations, as `/negotiations` returns them.
 * @param viewerUserId - The authenticated seat owner.
 * @param now - Clock for the relative timestamps.
 * @returns The three inbox groups, newest first within each.
 */
export function deriveNegotiationInbox(
  negotiations: NegotiationSummary[],
  viewerUserId: string | undefined,
  now = Date.now(),
): NegotiationInboxGroups {
  const items = negotiations.map<NegotiationInboxItem>((negotiation) => {
    const presentation = negotiation.outcome
      ? OUTCOME_PRESENTATION[negotiation.outcome]
      : negotiation.awaitingUserId === viewerUserId ? YOUR_MOVE : THEIR_MOVE;
    const group: NegotiationInboxGroup = negotiation.outcome
      ? 'resolved'
      : negotiation.awaitingUserId === viewerUserId ? 'your_move' : 'in_progress';
    const timestamp = new Date(negotiation.updatedAt).getTime();

    return {
      id: negotiation.id,
      opportunityId: negotiation.opportunityId,
      counterpart: {
        id: negotiation.counterparty.userId,
        name: negotiation.counterparty.name ?? 'Unknown user',
        avatar: negotiation.counterparty.avatar,
      },
      statement: negotiation.counterparty.statement,
      group,
      label: presentation.label,
      chipClass: presentation.chipClass,
      turnCount: negotiation.turnCount,
      timeAgo: formatTimeAgo(Number.isFinite(timestamp) ? timestamp : 0, now),
      sortTimestamp: Number.isFinite(timestamp) ? timestamp : 0,
    };
  });

  const byNewest = (left: NegotiationInboxItem, right: NegotiationInboxItem) => right.sortTimestamp - left.sortTimestamp;
  return {
    yourMove: items.filter((item) => item.group === 'your_move').sort(byNewest),
    inProgress: items.filter((item) => item.group === 'in_progress').sort(byNewest),
    resolved: items.filter((item) => item.group === 'resolved').sort(byNewest),
  };
}

export function countNegotiationsRequiringAction(
  negotiations: NegotiationSummary[],
  viewerUserId: string | undefined,
): number {
  return deriveNegotiationInbox(negotiations, viewerUserId).yourMove.length;
}
