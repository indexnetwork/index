import type { ConversationSummary } from '@/services/conversation';
import { deriveNegotiationPresentation, type NegotiationPresentationStatus } from '@/lib/negotiation-presentation';

export type NegotiationInboxGroup = 'your_move' | 'in_progress' | 'resolved';
export type NegotiationInboxStatus = NegotiationPresentationStatus;

export interface NegotiationCounterpart {
  id: string;
  name: string;
  avatar: string | null;
}

export interface NegotiationInboxItem {
  conversationId: string;
  counterpart: NegotiationCounterpart;
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

export interface LastTurnData {
  action: string | null;
}

export function readLastTurn(parts: unknown[]): LastTurnData {
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
  if (status === 'accepted_by_viewer') return 'you accepted the connection';
  if (status === 'connection_accepted') return 'the connection was accepted';
  if (status === 'no_agreement') {
    return reason === 'timeout'
      ? 'the dialogue ended before the agents reached agreement'
      : 'agents could not reach agreement within the turn limit';
  }
  if (status === 'couldnt_complete') return 'the negotiation could not complete';
  if (status === 'expired') return 'the opportunity expired';
  if (reason === 'screened_out') return 'agents did not find enough mutual value to continue';
  return 'agents did not recommend moving forward';
}

function classifyConversation(conversation: ConversationSummary, action: string | null, viewerUserId: string | undefined): {
  group: NegotiationInboxGroup;
  status: NegotiationInboxStatus;
} {
  const presentation = deriveNegotiationPresentation({
    lifecycle: conversation.negotiation,
    latestAction: action,
    latestSenderId: conversation.lastMessage?.senderId,
    viewerUserId,
  });
  return { group: presentation.group, status: presentation.status };
}

/**
 * Resolve the non-viewer seat of an A2A conversation. Shared with the chat
 * rail's outline so both surfaces name a counterparty the same way.
 */
export function resolveNegotiationCounterpart(
  conversation: ConversationSummary,
  viewerUserId: string | undefined,
): NegotiationCounterpart | null {
  const ownAgentId = viewerUserId ? `agent:${viewerUserId}` : null;
  const counterpart = conversation.participants.find((participant) => participant.participantId !== ownAgentId);
  if (!counterpart) return null;
  return {
    id: counterpart.participantId.replace(/^agent:/, ''),
    name: counterpart.ownerName ?? conversation.metadata?.title ?? counterpart.name ?? 'Unknown user',
    avatar: counterpart.avatar,
  };
}

/**
 * The one rule for "does this negotiation conversation exist for this viewer".
 *
 * Zero-turn rows are normally invisible (abandoned task shells). The one
 * exception is the viewer's OWN outreach gate decision: it has no messages by
 * definition, so this filter is what made the IND-610 gate card reachable only
 * by direct link.
 *
 * The owner boundary is NOT re-derived here. `negotiation.screenDecision` is
 * projected by the API only when `initiatorUserId === viewerUserId`
 * (services/api/src/adapters/negotiation-lifecycle.projection.ts), so its mere
 * presence IS the owner proof. A counterparty never receives the field and
 * therefore never gets this row.
 *
 * Both the inbox (which feeds the your-move badge) and the chat rail's outline
 * enumerate conversations through this predicate. Anything the badge can count
 * is therefore something the rail must be able to render — a negotiation the
 * badge advertises can never be missing from the list.
 */
export function isVisibleNegotiationConversation(
  conversation: ConversationSummary,
  viewerUserId: string | undefined,
): boolean {
  if (!resolveNegotiationCounterpart(conversation, viewerUserId)) return false;
  return Boolean(conversation.lastMessage) || Boolean(conversation.negotiation?.screenDecision);
}

/** Derive user-facing inbox groups without exposing raw task or opportunity states. */
export function deriveNegotiationInbox(
  negotiations: ConversationSummary[],
  viewerUserId: string | undefined,
  now = Date.now(),
): NegotiationInboxGroups {
  const ownAgentId = viewerUserId ? `agent:${viewerUserId}` : null;
  const items = negotiations.flatMap<NegotiationInboxItem>((conversation) => {
    // Visibility and counterparty naming come from the shared helpers above so
    // the rail's outline enumerates exactly the same conversations.
    if (!isVisibleNegotiationConversation(conversation, viewerUserId)) return [];
    const counterpart = resolveNegotiationCounterpart(conversation, viewerUserId);
    if (!counterpart) return [];

    if (!conversation.lastMessage) {
      const gateTimestamp = new Date(
        conversation.negotiation?.updatedAt ?? conversation.lastMessageAt ?? conversation.createdAt,
      ).getTime();
      const gateSafeTimestamp = Number.isFinite(gateTimestamp) ? gateTimestamp : 0;

      return [{
        conversationId: conversation.id,
        counterpart,
        group: 'resolved',
        status: 'not_started',
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
      counterpart,
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
    .sort((left, right) => (left.status === right.status ? byNewest(left, right) : left.status === 'needs_input' ? -1 : 1));

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
