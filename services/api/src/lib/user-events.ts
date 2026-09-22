import type { Redis } from 'ioredis';

import { getRedisClient } from '../adapters/cache.adapter';
import { log } from './log';

/**
 * One stream per user carries every realtime frame, and nothing on the wire
 * separates the audiences: an agent-bound key resolves to its owner, so the
 * agent reads the same stream the owner's app is already reading and
 * each side ignores the types it does not recognise. `opportunity.new`,
 * `question.pending` and `message` are the human's; the rest are the agent's.
 *
 * The agent types come in two scopes. `negotiation.turn` and
 * `negotiation.settled` point at one negotiation and carry a pointer rather
 * than the turn — the agent reads `GET /opportunities/:id/negotiation` to act.
 * `intent.created` and `intent.lifecycle` are scoped to a signal instead: that
 * a signal now exists, and whether the agent should be working it at all.
 * Creation has its own frame because an agent that only follows lifecycle
 * changes would never learn about a signal made after it started.
 * `negotiation.changed` refreshes both seats after a negotiation is opened,
 * after a turn, or after a related intent's lifecycle change. It does not imply
 * that either seat owes the next turn; `negotiation.turn` remains addressed to
 * the seat that does.
 *
 * `question.pending` is scoped to a signal too, but the other way round: the
 * personal agent stopped and cannot continue until its owner answers, so the
 * frame names the intent whose H2A conversation holds the question.
 * `principal.input` is the owner's answer or message on that same conversation
 * when an external executor is selected.
 *
 * `message` is the exception to the pointer shape: it is human-addressed and
 * carries its text inline, so a desktop toast needs no follow-up read.
 */
export type UserEventType =
  | 'opportunity.new'
  | 'question.pending'
  | 'principal.input'
  | 'negotiation.turn'
  | 'negotiation.settled'
  | 'negotiation.changed'
  | 'intent.lifecycle'
  | 'intent.created'
  | 'intent.updated'
  | 'agent.configuration'
  | 'agent.status'
  | 'agent.wake'
  | 'message';

/**
 * The effective state of a signal as agents see it.
 *
 * `ARCHIVED` is a wire value, not a column: removal sets `archived_at` rather
 * than a status, and an agent only needs to know the signal is gone. The
 * `FULFILLED` and `EXPIRED` members of the database enum are read as guards but
 * never written, so they never reach the wire.
 */
export type IntentLifecycleWireStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

/**
 * Every frame except `message`: a pointer at the record that moved, plus copy
 * composed on the server for a desktop toast. Messages are published by
 * {@link publishConversationMessageEvent} and carry their text inline instead.
 */
export interface UserEvent {
  type: Exclude<UserEventType, 'message'>;
  id: string;
  title: string;
  body: string;
  /**
   * Absolute deep link to the surface that resolves the event, when the frame
   * has one.
   */
  link?: string;
  /**
   * Machine payload. `title`/`body` are for the person; this is what an agent
   * reads to know which record moved.
   */
  data?: Record<string, unknown>;
}

/** Injectable delivery boundary shared by realtime publication and isolated tests. */
export type UserEventPublisher = (
  userId: string,
  event: UserEvent,
) => Promise<void>;

interface ConversationEventParticipant {
  participantId: string;
}

interface ConversationEventMessage {
  conversationId: string;
  id: string;
  senderId: string;
  /** Display name for OS/inbox previews; omitted when unresolved. */
  senderName?: string;
  /**
   * Sender avatar for OS notification attachments: either a full URL (legacy
   * OAuth photos) or an S3 object key served at `{base}/storage/<key>`.
   * Omitted when the sender has none.
   */
  senderAvatar?: string;
  role: 'user' | 'agent';
  parts: unknown;
  /**
   * The persisted row's metadata, carried verbatim. Owner surfaces filter the
   * agent DM by `metadata.intentId` to tell one signal's H2A from another's, so
   * this frame is the live path for that inbox, not just a notification.
   */
  metadata: unknown;
  createdAt: Date;
}

const STREAM_PREFIX = 'events:user:';
const STREAM_FIELD = 'data';
/**
 * Entries a consumer can still resume from. An offset older than this is gone:
 * the consumer falls back to live frames and reconciles over REST.
 */
const STREAM_MAXLEN = 1000;
const READ_COUNT = 100;

export function userEventStream(userId: string): string {
  return `${STREAM_PREFIX}${userId}`;
}

/** One entry read from a user's event stream. */
export interface UserEventRecord {
  /** Owner whose stream carried the entry. */
  userId: string;
  /** Redis entry id, which is also the consumer's offset once it is handled. */
  id: string;
  /** The frame JSON exactly as it was published. */
  data: string;
}

/**
 * Reads the frame JSON out of an XREAD/XREADGROUP reply, dropping entries that
 * do not carry one.
 */
function toRecords(reply: unknown): UserEventRecord[] {
  if (!Array.isArray(reply)) return [];

  const records: UserEventRecord[] = [];
  for (const stream of reply) {
    if (!Array.isArray(stream)) continue;
    const [key, entries] = stream as [unknown, unknown];
    if (typeof key !== 'string' || !Array.isArray(entries)) continue;

    for (const entry of entries) {
      if (!Array.isArray(entry)) continue;
      const [id, fields] = entry as [unknown, unknown];
      if (typeof id !== 'string' || !Array.isArray(fields)) continue;
      const at = fields.indexOf(STREAM_FIELD);
      const data = at === -1 ? undefined : fields[at + 1];
      if (typeof data === 'string') {
        records.push({ userId: key.slice(STREAM_PREFIX.length), id, data });
      }
    }
  }
  return records;
}

/** Appends one frame to a user's stream. */
async function append(userId: string, payload: string): Promise<void> {
  await getRedisClient().xadd(
    userEventStream(userId), 'MAXLEN', '~', STREAM_MAXLEN, '*', STREAM_FIELD, payload,
  );
}

/**
 * Appends a user-scoped event to that user's stream.
 */
export async function publishUserEvent(
  userId: string,
  event: UserEvent,
): Promise<void> {
  if (!userId) return;
  await append(userId, JSON.stringify(event));
}

/**
 * Blocking read for consumers that hold their own offset.
 *
 * @param client - A dedicated client; a blocked connection serves nothing else.
 * @param cursors - Owner id to the last entry that consumer handled, or `$` for live only.
 * @param blockMs - How long Redis waits for an entry before answering empty.
 * @returns The entries published after each cursor, oldest first.
 */
export async function readUserEvents(
  client: Redis,
  cursors: ReadonlyMap<string, string>,
  blockMs: number,
): Promise<UserEventRecord[]> {
  const userIds = [...cursors.keys()];
  if (!userIds.length) return [];

  return toRecords(await client.xread(
    'COUNT', READ_COUNT, 'BLOCK', blockMs, 'STREAMS',
    ...userIds.map(userEventStream),
    ...userIds.map((userId) => cursors.get(userId)!),
  ));
}

/**
 * Creates a consumer group at the start of a user's stream, so the first frame
 * published after the stream appeared is delivered rather than skipped.
 *
 * @param userId - Owner whose stream the group reads.
 * @param group - Group name; each group sees every entry independently.
 */
export async function ensureUserEventGroup(userId: string, group: string): Promise<void> {
  try {
    await getRedisClient().xgroup('CREATE', userEventStream(userId), group, '0', 'MKSTREAM');
  } catch (error: unknown) {
    if (!String(error).includes('BUSYGROUP')) throw error;
  }
}

/**
 * Blocking read for consumers whose offset Redis holds. Consumers in one group
 * compete for entries; separate groups each receive every entry.
 *
 * @param client - A dedicated client; a blocked connection serves nothing else.
 * @param options - The group, this consumer's name, and the owners to read.
 *   `from` is `>` for entries nobody in the group has taken, or `0` to pick up
 *   this consumer's entries again after it stopped without acknowledging them.
 * @returns Entries now pending for this consumer until they are acknowledged.
 */
export async function readUserEventGroup(
  client: Redis,
  options: {
    group: string;
    consumer: string;
    userIds: readonly string[];
    from: '>' | '0';
    blockMs: number;
  },
): Promise<UserEventRecord[]> {
  if (!options.userIds.length) return [];

  return toRecords(await client.xreadgroup(
    'GROUP', options.group, options.consumer, 'COUNT', READ_COUNT, 'BLOCK', options.blockMs, 'STREAMS',
    ...options.userIds.map(userEventStream),
    ...options.userIds.map(() => options.from),
  ));
}

/**
 * Advances a group's offset past one handled entry.
 *
 * @param group - Group that read the entry.
 * @param record - The handled entry.
 */
export async function ackUserEvent(group: string, record: UserEventRecord): Promise<void> {
  await getRedisClient().xack(userEventStream(record.userId), group, record.id);
}

/**
 * Every owner who has a stream. Streams are per user, so a consumer that
 * follows all of them discovers new owners here rather than by pattern.
 *
 * @returns Owner ids, in no particular order.
 */
export async function scanUserEventStreams(): Promise<string[]> {
  const client = getRedisClient();
  const userIds: string[] = [];
  let cursor = '0';

  do {
    const [next, keys] = await client.scan(cursor, 'MATCH', `${STREAM_PREFIX}*`, 'COUNT', 500);
    cursor = next;
    for (const key of keys) userIds.push(key.slice(STREAM_PREFIX.length));
  } while (cursor !== '0');

  return userIds;
}

/**
 * Invalidate affected views after a committed change, without retrying delivery.
 * @param userId - Owner whose agents and views should refresh.
 * @param type - Intent creation or content, agent configuration, or runtime availability change.
 * @param intentId - Affected intent, when the change is scoped to one.
 */
export async function publishUserInvalidation(
  userId: string,
  type: 'intent.created' | 'intent.updated' | 'agent.configuration' | 'agent.status',
  intentId?: string,
): Promise<void> {
  try {
    await publishUserEvent(userId, { type, id: crypto.randomUUID(), title: '', body: '', data: { intentId } });
  } catch (error: unknown) {
    log.lib.from('user-events').error('Failed to publish user invalidation', { userId, intentId, type, error: String(error) });
  }
}

/**
 * Refresh each affected seat without announcing that its owner owes a turn.
 * @param seats - Negotiation seats affected by a committed change; duplicates are collapsed.
 * @param opportunityId - Changed negotiation, or all negotiations for these seats after a lifecycle change.
 */
export async function publishNegotiationChange(
  seats: readonly { userId: string; intentId: string }[],
  opportunityId?: string,
): Promise<void> {
  const affected = new Map(seats.map((seat) => [JSON.stringify([seat.userId, seat.intentId]), seat]));
  await Promise.all([...affected.values()].map(async ({ userId, intentId }) => {
    try {
      await publishUserEvent(userId, {
        type: 'negotiation.changed', id: crypto.randomUUID(), title: '', body: '', data: { intentId, opportunityId },
      });
    } catch (error: unknown) {
      log.lib.from('user-events').error('Failed to publish negotiation change', { userId, intentId, opportunityId, error: String(error) });
    }
  }));
}

/**
 * Resolves the authenticated user channels entitled to receive an event for a
 * conversation. Agent participants represent their owner as `agent:<userId>`.
 *
 * @param participants - Persisted conversation participants.
 * @returns Unique authenticated user IDs authorized for the conversation.
 */
export function conversationEventRecipientUserIds(
  participants: ConversationEventParticipant[],
): string[] {
  return [...new Set(participants
    .map(({ participantId }) => participantId.startsWith('agent:')
      ? participantId.slice('agent:'.length)
      : participantId)
    .filter(Boolean))];
}

/**
 * Appends a persisted message to each authorized participant's stream. The
 * stream is user-scoped, never intent-scoped, so the API remains the final
 * provenance/privacy filter.
 *
 * @param message - Persisted conversation message.
 * @param participants - Persisted conversation participants.
 */
export async function publishConversationMessageEvent(
  message: ConversationEventMessage,
  participants: ConversationEventParticipant[],
): Promise<void> {
  const event = JSON.stringify({
    type: 'message',
    conversationId: message.conversationId,
    message,
  });
  await Promise.all(conversationEventRecipientUserIds(participants).map((userId) => (
    append(userId, event)
  )));
}
