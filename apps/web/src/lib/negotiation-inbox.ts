import type { ConversationSummary } from '@/services/conversation';

export type NegotiationInboxGroup = 'your_move' | 'in_progress' | 'resolved';
export type NegotiationInboxStatus =
  | 'answer'
  | 'agreed'
  | 'live'
  | 'waiting'
  | 'accepted'
  | 'started'
  | 'rejected'
  | 'stalled'
  /** IND-610: the owner's own agent declined before any contact. Owner-only. */
  | 'not_sent';

export interface NegotiationInboxItem {
  conversationId: string;
  counterpart: { id: string; name: string; avatar: string | null };
  group: NegotiationInboxGroup;
  status: NegotiationInboxStatus;
  signalCount: number;
  lastAction: string;
  timeAgo: string;
  sortTimestamp: number;
  turnCount: number | null;
  maxTurns: number;
}

export interface NegotiationInboxGroups {
  yourMove: NegotiationInboxItem[];
  inProgress: NegotiationInboxItem[];
  resolved: NegotiationInboxItem[];
}

interface LastTurnData {
  action: string | null;
}

const REJECT_ACTIONS = new Set(['reject', 'decline', 'withdraw']);
const STALL_REASONS = new Set(['turn_cap', 'timeout']);

function readLastTurn(parts: unknown[]): LastTurnData {
  for (const part of parts) {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) continue;
    const record = part as Record<string, unknown>;
    if (record.kind !== 'data' || typeof record.data !== 'object' || record.data === null || Array.isArray(record.data)) continue;
    const action = (record.data as Record<string, unknown>).action;
    return { action: typeof action === 'string' ? action : null };
  }
  return { action: null };
}

function formatTimeAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function describeAction(action: string | null, isOwnAgent: boolean): string {
  const actor = isOwnAgent ? 'your agent' : 'their agent';
  switch (action) {
    case 'ask_user': return `${actor} asked for guidance`;
    case 'propose': return `${actor} proposed a connection`;
    case 'counter': return `${actor} countered`;
    case 'question': return `${actor} asked a question`;
    case 'accept': return `${actor} recommended moving forward`;
    case 'reject':
    case 'decline': return `${actor} did not recommend proceeding`;
    case 'withdraw': return `${actor} stepped back`;
    case 'outreach': return `${actor} opened the dialogue`;
    default: return 'agents exchanged a turn';
  }
}

function describeResolved(status: NegotiationInboxStatus, reason: string | null): string {
  if (status === 'accepted') return 'you started the chat';
  if (status === 'started') return 'the chat was started';
  if (status === 'stalled') {
    return reason === 'timeout'
      ? 'the dialogue ended before the agents reached agreement'
      : 'agents could not reach agreement within the turn limit';
  }
  if (reason === 'screened_out') return 'agents did not find enough mutual value to continue';
  return 'agents did not recommend moving forward';
}

function classifyConversation(conversation: ConversationSummary, action: string | null, viewerUserId: string | undefined): {
  group: NegotiationInboxGroup;
  status: NegotiationInboxStatus;
} {
  const lifecycle = conversation.negotiation;
  const opportunityStatus = lifecycle?.opportunityStatus;

  if (opportunityStatus === 'accepted') {
    return { group: 'resolved', status: lifecycle?.acceptedByViewer ? 'accepted' : 'started' };
  }
  if (opportunityStatus === 'rejected') return { group: 'resolved', status: 'rejected' };
  if (opportunityStatus === 'stalled' || opportunityStatus === 'expired') {
    return { group: 'resolved', status: 'stalled' };
  }
  if (lifecycle?.state === 'input_required' && action === 'ask_user' && conversation.lastMessage?.senderId === `agent:${viewerUserId}`) {
    return { group: 'your_move', status: 'answer' };
  }
  if (opportunityStatus === 'pending') return { group: 'your_move', status: 'agreed' };

  if (lifecycle?.outcome?.hasOpportunity === true) return { group: 'your_move', status: 'agreed' };
  if (lifecycle?.outcome?.hasOpportunity === false) {
    return STALL_REASONS.has(lifecycle.outcome.reason ?? '')
      ? { group: 'resolved', status: 'stalled' }
      : { group: 'resolved', status: 'rejected' };
  }
  if (lifecycle && ['failed', 'canceled', 'auth_required'].includes(lifecycle.state)) {
    return { group: 'resolved', status: 'stalled' };
  }
  if (lifecycle?.state === 'rejected' || (action && REJECT_ACTIONS.has(action))) {
    return { group: 'resolved', status: 'rejected' };
  }
  if (action === 'accept') return { group: 'your_move', status: 'agreed' };

  return lifecycle?.turnCount && lifecycle.turnCount > 0
    ? { group: 'in_progress', status: 'live' }
    : { group: 'in_progress', status: 'waiting' };
}

/** Derive user-facing inbox groups without exposing raw task or opportunity states. */
export function deriveNegotiationInbox(
  negotiations: ConversationSummary[],
  viewerUserId: string | undefined,
  now = Date.now(),
): NegotiationInboxGroups {
  const ownAgentId = viewerUserId ? `agent:${viewerUserId}` : null;
  const items = negotiations.flatMap<NegotiationInboxItem>((conversation) => {
    const counterpart = conversation.participants.find((participant) => participant.participantId !== ownAgentId);
    if (!counterpart) return [];

    // Zero-turn rows are normally invisible (abandoned task shells), matching
    // ChatSidebar's A2A rule. The one exception is the viewer's OWN outreach
    // gate decision: it has no messages by definition, so this filter is what
    // made the IND-610 gate card reachable only by direct link.
    //
    // The owner boundary is NOT re-derived here. `negotiation.screenDecision`
    // is projected by the API only when `initiatorUserId === viewerUserId`
    // (services/api/src/adapters/negotiation-lifecycle.projection.ts), so its
    // mere presence IS the owner proof. A counterparty never receives the
    // field and therefore never gets this row.
    if (!conversation.lastMessage) {
      const gateDecision = conversation.negotiation?.screenDecision;
      if (!gateDecision) return [];

      const gateTimestamp = new Date(
        conversation.negotiation?.updatedAt ?? conversation.lastMessageAt ?? conversation.createdAt,
      ).getTime();
      const gateSafeTimestamp = Number.isFinite(gateTimestamp) ? gateTimestamp : 0;

      return [{
        conversationId: conversation.id,
        counterpart: {
          id: counterpart.participantId.replace(/^agent:/, ''),
          name: counterpart.ownerName ?? conversation.metadata?.title ?? counterpart.name ?? 'Unknown user',
          avatar: counterpart.avatar,
        },
        group: 'resolved',
        status: 'not_sent',
        signalCount: Math.max(conversation.negotiation?.signalCount ?? 0, conversation.via.length),
        lastAction: 'Your agent did not reach out',
        timeAgo: formatTimeAgo(gateSafeTimestamp, now),
        sortTimestamp: gateSafeTimestamp,
        turnCount: 0,
        maxTurns: conversation.negotiation?.maxTurns ?? 6,
      }];
    }

    const lastTurn = readLastTurn(conversation.lastMessage.parts);
    const classification = classifyConversation(conversation, lastTurn.action, viewerUserId);
    const lifecycle = conversation.negotiation;
    const sortTimestamp = new Date(
      lifecycle?.updatedAt
        ?? conversation.lastMessage.createdAt
        ?? conversation.lastMessageAt
        ?? conversation.createdAt,
    ).getTime();
    const safeTimestamp = Number.isFinite(sortTimestamp) ? sortTimestamp : 0;
    const reason = lifecycle?.outcome?.reason ?? null;

    return [{
      conversationId: conversation.id,
      counterpart: {
        id: counterpart.participantId.replace(/^agent:/, ''),
        name: counterpart.ownerName ?? conversation.metadata?.title ?? counterpart.name ?? 'Unknown user',
        avatar: counterpart.avatar,
      },
      group: classification.group,
      status: classification.status,
      signalCount: Math.max(lifecycle?.signalCount ?? 0, conversation.via.length),
      lastAction: classification.group === 'resolved'
        ? describeResolved(classification.status, reason)
        : describeAction(lastTurn.action, conversation.lastMessage.senderId === ownAgentId),
      timeAgo: formatTimeAgo(safeTimestamp, now),
      sortTimestamp: safeTimestamp,
      turnCount: lifecycle ? lifecycle.turnCount : null,
      maxTurns: lifecycle?.maxTurns ?? 6,
    }];
  });

  const byNewest = (left: NegotiationInboxItem, right: NegotiationInboxItem) => right.sortTimestamp - left.sortTimestamp;
  const yourMove = items
    .filter((item) => item.group === 'your_move')
    .sort((left, right) => (left.status === right.status ? byNewest(left, right) : left.status === 'answer' ? -1 : 1));

  return {
    yourMove,
    inProgress: items.filter((item) => item.group === 'in_progress').sort(byNewest),
    resolved: items.filter((item) => item.group === 'resolved').sort(byNewest),
  };
}

/**
 * Flat last-updated ordering across all groups — a re-sort of the derived rows
 * for the Last updated view mode, not a new derivation.
 */
export function flattenNegotiationInbox(groups: NegotiationInboxGroups): NegotiationInboxItem[] {
  return [...groups.yourMove, ...groups.inProgress, ...groups.resolved]
    .sort((left, right) => right.sortTimestamp - left.sortTimestamp);
}

export function countNegotiationsRequiringAction(
  negotiations: ConversationSummary[],
  viewerUserId: string | undefined,
): number {
  return deriveNegotiationInbox(negotiations, viewerUserId).yourMove.length;
}
