/**
 * Derivation for the radar's warmup card (see `DiscoveryWarmupLog`).
 *
 * The log is derived, never recorded: both lanes are rebuilt from durable data
 * on every render, so a reload reproduces the identical log and no client-side
 * delta tracking (or new table) is involved.
 *
 *  - Lane ● reads the `intent_discovery_progress` row the from-intent worker
 *    writes at its run boundaries (queued / started / retried / succeeded).
 *  - Lane ○ reads the negotiation conversations the page already fetches.
 *
 * There is deliberately no per-community narration ("scanning Climate
 * Founders…"): the discovery graph runs once across every valid network and
 * exposes no per-community boundary outside the protocol graph, so such a line
 * would be fiction.
 */
import type { DiscoveryProgress, DiscoveryProgressStatus } from '@/services/intents';

/** A negotiation conversation on this signal, for the live lane. */
export interface WarmupConversation {
  /** Conversation id; stable log key across refreshes. */
  id: string;
  counterpartLabel: string;
  /** Conversation creation time — when the agents actually started talking. */
  startedAt: string | null;
}

export interface WarmupLogEntry {
  id: string;
  lane: 'progress' | 'conversation';
  text: string;
  /** Epoch ms; entries without a durable timestamp are never invented. */
  at: number;
  /** The line the run is sitting on right now. */
  current: boolean;
  /** Tie-break for entries sharing a timestamp (a retry starts its own scan). */
  order: number;
}

/** Statuses where a run is still in flight. */
export const ACTIVE_DISCOVERY_STATUSES: ReadonlySet<DiscoveryProgressStatus> = new Set([
  'queued',
  'running',
  'retrying',
]);

/** Mono uppercase pill copy, one word per status. */
export const DISCOVERY_STATUS_CHIP: Record<DiscoveryProgressStatus, string> = {
  queued: 'queued',
  running: 'scanning',
  retrying: 'retrying',
  completed: 'completed',
  failed: 'failed',
  blocked: 'blocked',
  unknown: 'unknown',
};

function epoch(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

/** HH:MM, 24-hour, in the reader's own timezone. */
export function formatLogClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Rebuild the whole log from the durable snapshot. Entries with no timestamp
 * are dropped rather than stamped with "now" — an invented clock time is the
 * one thing a log like this cannot survive.
 */
export function buildWarmupLog({
  progress,
  conversations = [],
  maxConversations = 5,
}: {
  progress?: DiscoveryProgress;
  conversations?: WarmupConversation[];
  maxConversations?: number;
}): WarmupLogEntry[] {
  const status = progress?.status ?? 'unknown';
  const active = ACTIVE_DISCOVERY_STATUSES.has(status);
  const entries: WarmupLogEntry[] = [];

  // `unknown` means no durable row (legacy signals, or a worker heartbeat gone
  // stale). Report the absence; never reconstruct a run from freshness.
  if (progress && status !== 'unknown') {
    const queuedAt = epoch(progress.queuedAt);
    if (queuedAt !== null) {
      entries.push({ id: 'queued', lane: 'progress', text: 'queued', at: queuedAt, current: status === 'queued', order: 0 });
    }

    const startedAt = epoch(progress.startedAt);
    if (progress.attempt > 1) {
      const retriedAt = startedAt ?? epoch(progress.updatedAt);
      if (retriedAt !== null) {
        entries.push({
          id: 'attempt',
          lane: 'progress',
          text: `attempt ${progress.attempt} of ${progress.maxAttempts} — retrying`,
          at: retriedAt,
          current: status === 'retrying',
          order: 1,
        });
      }
    }

    if (startedAt !== null) {
      const communities = count(progress.assignedCommunityCount, 'community', 'communities');
      entries.push({
        id: 'scanning',
        lane: 'progress',
        text: active ? `scanning ${communities}…` : `scanned ${communities}`,
        at: startedAt,
        current: status === 'running',
        order: 2,
      });
    }

    const completedAt = epoch(progress.completedAt);
    if (completedAt !== null && status === 'completed') {
      entries.push({
        id: 'completed',
        lane: 'progress',
        text: `＋ ${count(progress.possibleOverlapCount, 'possible overlap', 'possible overlaps')} found, `
          + `${count(progress.conversationsStartedCount, 'conversation', 'conversations')} started`,
        at: completedAt,
        current: false,
        order: 3,
      });
    }
  }

  const conversationEntries = conversations
    .flatMap((conversation): WarmupLogEntry[] => {
      const at = epoch(conversation.startedAt);
      if (at === null) return [];
      return [{
        id: `conversation:${conversation.id}`,
        lane: 'conversation',
        text: `conversation with ${conversation.counterpartLabel}'s agent started`,
        at,
        current: false,
        order: 4,
      }];
    })
    .sort((left, right) => left.at - right.at)
    .slice(-maxConversations);

  return [...entries, ...conversationEntries]
    .sort((left, right) => left.at - right.at || left.order - right.order);
}

/** The card's paused copy — one wording for both ways a run can be unable to start. */
export const WARMUP_PAUSED_HEADLINE = {
  title: 'Scanning is paused',
  summary: 'This signal is not shared with an active community yet.',
} as const;

/** Title + one-line summary. Completed runs keep their tallies, zeroes included. */
export function warmupHeadline(
  progress: DiscoveryProgress | undefined,
  communityCount: number,
): { title: string; summary: string } {
  const status = progress?.status ?? 'unknown';
  const assigned = progress?.assignedCommunityCount ?? communityCount;

  if (status === 'blocked') return { ...WARMUP_PAUSED_HEADLINE };
  if (status === 'unknown') {
    return { title: 'Preparing your first conversations', summary: 'Status unavailable.' };
  }
  if (status === 'completed') {
    // `processedCommunityCount` is written only by runs that carried a graph
    // summary; older rows fall back to what the run was assigned.
    const scanned = progress?.processedCommunityCount || assigned;
    const overlaps = progress?.possibleOverlapCount ?? 0;
    const conversations = progress?.conversationsStartedCount ?? 0;
    // A zero-result run still reports its tallies — an empty card would read as
    // "nothing happened" when in fact the whole search ran and found nothing.
    const tally = overlaps === 0 && conversations === 0
      ? 'no overlaps yet'
      : `${count(overlaps, 'possible overlap', 'possible overlaps')}, ${count(conversations, 'conversation', 'conversations')} started`;
    return {
      title: 'First scan complete',
      summary: `Scanned ${count(scanned, 'community', 'communities')} — ${tally}`,
    };
  }
  if (status === 'failed') {
    return {
      title: 'Scanning needs attention',
      summary: `Stopped after ${count(progress?.attempt ?? 0, 'attempt', 'attempts')}. It will be picked up again.`,
    };
  }
  if (status === 'queued') {
    return {
      title: 'Finding your first conversations',
      summary: `Queued — ${count(assigned, 'community', 'communities')} to scan.`,
    };
  }
  return {
    title: 'Finding your first conversations',
    summary: `Scanning ${count(assigned, 'community', 'communities')} for possible overlaps.`,
  };
}
