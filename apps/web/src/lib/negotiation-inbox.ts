import type { ConversationSummary, NegotiationTaskIndexEntry } from '@/services/conversation';
import { deriveNegotiationPresentation, type NegotiationPresentationStatus } from '@/lib/negotiation-presentation';
import type { NegotiationPauseReason } from '@/services/conversation';

/** Mirrors NEGOTIATION_MAX_TURNS_AMBIENT — a fixed safety cap, not a per-negotiation field any more. */
export const NEGOTIATION_MAX_TURNS = 6;

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

/** One row per owned intent seat, presented the same way as the conversation inbox. */
export interface TaskIndexInboxItem {
  key: string;
  intentId: string;
  taskId: string;
  counterpartName: string;
  intentLabel: string;
  group: NegotiationInboxGroup;
  status: NegotiationInboxStatus;
  lastAction: string;
  timeAgo: string;
  sortTimestamp: number;
}

export interface TaskIndexInboxGroups {
  yourMove: TaskIndexInboxItem[];
  inProgress: TaskIndexInboxItem[];
  resolved: TaskIndexInboxItem[];
}

export interface LastTurnData {
  /** `outreach` | `counter` | `question` | `pause`. */
  verb: string | null;
  pauseReason: NegotiationPauseReason | null;
}

export function readLastTurn(parts: unknown[]): LastTurnData {
  for (const part of parts) {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) continue;
    const record = part as Record<string, unknown>;
    if (record.kind !== 'data' || typeof record.data !== 'object' || record.data === null || Array.isArray(record.data)) continue;
    const data = record.data as Record<string, unknown>;
    const verb = typeof data.verb === 'string' ? data.verb : null;
    const reason = verb === 'pause' && typeof data.reason === 'string' ? data.reason : null;
    return { verb, pauseReason: reason as LastTurnData['pauseReason'] };
  }
  return { verb: null, pauseReason: null };
}

/**
 * Conversation summaries contain one last message, while a durable A2A
 * conversation can contain several task sessions. Only use that message to
 * classify a task when its projected task id proves the session relationship.
 */
export function sessionScopedLastTurn(conversation: ConversationSummary, taskId: string | null | undefined): LastTurnData & { senderId: string | null } {
  if (!taskId || conversation.lastMessage?.taskId !== taskId) return { verb: null, pauseReason: null, senderId: null };
  return { ...readLastTurn(conversation.lastMessage.parts), senderId: conversation.lastMessage.senderId };
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

/**
 * The summary line of a live row. `verb`/`pauseReason` describe the
 * represented session's own last turn, or null when the conversation's last
 * message belongs to another session with the same person (a later pairing
 * that died, say). A null turn is then described from the row's state, so a
 * dead session's "did not recommend proceeding" can never caption a row
 * whose badge says the viewer is awaited.
 */
function describeLive(status: NegotiationInboxStatus, lastTurn: LastTurnData, isOwnAgent: boolean): string {
  if (lastTurn.verb === null && status === 'awaiting_review') return 'agents recommended moving forward';
  return describeTurn(lastTurn, isOwnAgent);
}

function describeTurn(lastTurn: LastTurnData, isOwnAgent: boolean): string {
  const actor = isOwnAgent ? 'your agent' : 'their agent';
  if (lastTurn.verb === 'pause') {
    switch (lastTurn.pauseReason) {
      case 'needs_principal': return `${actor} asked for guidance`;
      case 'ready_for_verdict': return `${actor} recommended a decision`;
      case 'counterparty_silent': return 'waiting on the other side';
      case 'turn_cap': return `${actor} reached its limit`;
      case 'open_failed': return 'this negotiation could not be started';
      default: return 'agents exchanged a turn';
    }
  }
  switch (lastTurn.verb) {
    case 'counter': return `${actor} countered`;
    case 'question': return `${actor} asked a question`;
    case 'outreach': return `${actor} opened the dialogue`;
    default: return 'agents exchanged a turn';
  }
}

function describeResolved(status: NegotiationInboxStatus): string {
  if (status === 'accepted_by_viewer') return 'you accepted the connection';
  if (status === 'connection_accepted') return 'the connection was accepted';
  if (status === 'no_agreement') return 'agents could not reach agreement';
  if (status === 'couldnt_complete') return 'the negotiation could not complete';
  if (status === 'expired') return 'the opportunity expired';
  return 'agents did not recommend moving forward';
}

function classifyConversation(conversation: ConversationSummary, viewerUserId: string | undefined): {
  group: NegotiationInboxGroup;
  status: NegotiationInboxStatus;
} {
  const latestTurn = sessionScopedLastTurn(conversation, conversation.negotiation?.taskId);
  const presentation = deriveNegotiationPresentation({
    lifecycle: conversation.negotiation,
    latestSenderId: latestTurn.senderId,
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
 * exception is the viewer's OWN "did not reach out" decision: it has no
 * messages by definition, so this filter is what made the IND-610 gate card
 * reachable only by direct link.
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

/**
 * Derive user-facing inbox groups without exposing raw task or opportunity
 * states.
 *
 * One row per A2A negotiation conversation. Its lifecycle is projected on
 * `conversation.negotiation`; the signal DM and Radar card are the owner-facing
 * surfaces for questions and verdicts.
 */
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
        maxTurns: NEGOTIATION_MAX_TURNS,
      }];
    }

    const classification = classifyConversation(conversation, viewerUserId);
    const lifecycle = conversation.negotiation;
    // The represented session is the most alive one with this person, not
    // necessarily the one that produced the conversation's last message; its
    // summary line and timestamp come from that session alone.
    const lastTurn = sessionScopedLastTurn(conversation, lifecycle?.taskId);
    const sortTimestamp = new Date(
      lifecycle?.updatedAt
        ?? conversation.lastMessage.createdAt
        ?? conversation.lastMessageAt
        ?? conversation.createdAt,
    ).getTime();
    const safeTimestamp = Number.isFinite(sortTimestamp) ? sortTimestamp : 0;

    return [{
      conversationId: conversation.id,
      counterpart,
      group: classification.group,
      status: classification.status,
      signalCount: Math.max(lifecycle?.signalCount ?? 0, conversation.via.length),
      lastAction: classification.group === 'resolved'
        ? describeResolved(classification.status)
        : describeLive(classification.status, lastTurn, lastTurn.senderId === ownAgentId),
      timeAgo: formatTimeAgo(safeTimestamp, now),
      sortTimestamp: safeTimestamp,
      turnCount: lifecycle ? lifecycle.turnCount : null,
      maxTurns: NEGOTIATION_MAX_TURNS,
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

/**
 * Same presentation as the conversation inbox, keyed per owned intent seat
 * rather than per A2A conversation. The /negotiations page lists these rows
 * so two pairings with the same person stay distinct.
 */
export function deriveTaskIndexInbox(
  entries: NegotiationTaskIndexEntry[],
  now = Date.now(),
): TaskIndexInboxGroups {
  const items = entries.map<TaskIndexInboxItem>((entry) => {
    const presentation = deriveNegotiationPresentation({
      lifecycle: {
        taskId: entry.taskId,
        state: entry.state,
        pause: entry.pause ? { reason: entry.pause.reason } : null,
        statusTimestamp: entry.latestActivity.createdAt,
        opportunityId: entry.opportunityId,
        opportunityStatus: entry.opportunityStatus,
        acceptedByViewer: false,
        turnCount: 0,
        signalCount: 0,
        updatedAt: entry.updatedAt,
      },
      latestSenderId: entry.latestActivity.actor === 'yours' ? 'agent:viewer' : 'agent:peer',
      viewerUserId: 'viewer',
    });
    const lastTurn: LastTurnData = {
      verb: entry.latestActivity.verb ?? (entry.pause ? 'pause' : null),
      pauseReason: entry.pause?.reason ?? null,
    };
    const sortTimestamp = new Date(entry.latestActivity.createdAt ?? entry.updatedAt).getTime();
    const safeTimestamp = Number.isFinite(sortTimestamp) ? sortTimestamp : 0;
    return {
      key: `${entry.taskId}:${entry.intentId}`,
      intentId: entry.intentId,
      taskId: entry.taskId,
      counterpartName: entry.counterpartLabel,
      intentLabel: entry.intentLabel,
      group: presentation.group,
      status: presentation.status,
      lastAction: presentation.group === 'resolved'
        ? describeResolved(presentation.status)
        : describeLive(presentation.status, lastTurn, entry.latestActivity.actor === 'yours'),
      timeAgo: formatTimeAgo(safeTimestamp, now),
      sortTimestamp: safeTimestamp,
    };
  });

  const byNewest = (left: TaskIndexInboxItem, right: TaskIndexInboxItem) => right.sortTimestamp - left.sortTimestamp;
  return {
    yourMove: items
      .filter((item) => item.group === 'your_move')
      .sort((left, right) => (left.status === right.status ? byNewest(left, right) : left.status === 'needs_input' ? -1 : 1)),
    inProgress: items.filter((item) => item.group === 'in_progress').sort(byNewest),
    resolved: items.filter((item) => item.group === 'resolved').sort(byNewest),
  };
}
