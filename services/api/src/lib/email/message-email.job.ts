import { and, eq, ne, sql } from 'drizzle-orm/sql';

import { getRedisClient } from '../../adapters/cache.adapter';
import db from '../drizzle/drizzle';
import { log } from '../log';
import * as schema from '../../schemas/database.schema';

import { newMessageTemplate } from './templates/new-message.template';
import { executeSendEmail } from './transport.helper';

const logger = log.job.from('MessageEmail');

const DUE_KEY = 'message-email:due';
const QUIET_MS = 60_000;
const TICK_MS = 10_000;
const APP_URL = (process.env.WEB_APP_URL ?? 'https://index.network').replace(/\/+$/, '');

/** Claim only while the score is still due, so a newer message keeps the wait. */
const CLAIM = `
local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not score or tonumber(score) > tonumber(ARGV[2]) then return 0 end
return redis.call('ZREM', KEYS[1], ARGV[1])
`;

interface UnreadMessage {
  text: string | null;
  senderName: string | null;
  senderId: string | null;
}

interface DueMessage {
  email: string;
  name: string;
  off: boolean;
  messages: UnreadMessage[] | string | null;
}

/**
 * Push each other person's email to one minute after this message.
 * A later message in the same conversation overwrites the due time.
 */
export async function queueMessageEmails(conversationId: string, senderId: string): Promise<void> {
  const recipients = await db
    .select({ id: schema.conversationParticipants.participantId })
    .from(schema.conversationParticipants)
    .where(and(
      eq(schema.conversationParticipants.conversationId, conversationId),
      eq(schema.conversationParticipants.participantType, 'user'),
      ne(schema.conversationParticipants.participantId, senderId),
    ));
  if (!recipients.length) return;
  const due = Date.now() + QUIET_MS;
  const pipeline = getRedisClient().pipeline();
  for (const recipient of recipients) pipeline.zadd(DUE_KEY, due, `${recipient.id}:${conversationId}`);
  await pipeline.exec();
}

async function dueMessage(recipientId: string, conversationId: string): Promise<DueMessage | null> {
  const [row] = await db.execute(sql`
    SELECT u.email, u.name,
      EXISTS (
        SELECT 1 FROM ${schema.userNotificationSettings} s
        WHERE s.user_id = u.id AND s.preferences->>'messages' = 'false'
      ) AS off,
      unread.messages
    FROM ${schema.users} u
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
        'text', m.parts->0->>'text',
        'senderName', sender.name,
        'senderId', m.sender_id
      ) ORDER BY m.created_at) AS messages
      FROM ${schema.messages} m
      INNER JOIN ${schema.conversationParticipants} p
        ON p.conversation_id = m.conversation_id AND p.participant_id = u.id
      LEFT JOIN ${schema.users} sender ON sender.id = m.sender_id
      WHERE m.conversation_id = ${conversationId}
        AND m.sender_id <> u.id
        AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
    ) unread ON true
    WHERE u.id = ${recipientId} AND u.deleted_at IS NULL
  `) as unknown as DueMessage[];
  return row ?? null;
}

function unreadMessages(value: DueMessage['messages']): UnreadMessage[] {
  if (!value) return [];
  const parsed = typeof value === 'string' ? JSON.parse(value) as UnreadMessage[] : value;
  return Array.isArray(parsed) ? parsed : [];
}

function fromHeader(name: string): string {
  const safe = name.replace(/[\r\n<>"]/g, '').trim() || 'Someone';
  return `${safe} via Index <updates@agent.index.network>`;
}

async function sendDue(member: string): Promise<void> {
  const split = member.indexOf(':');
  if (split <= 0) return;
  const due = await dueMessage(member.slice(0, split), member.slice(split + 1));
  const messages = unreadMessages(due?.messages ?? null).filter((message) => message.text?.trim() && message.senderId);
  if (!due || due.off === true || !due.email || !messages.length) return;
  const latest = messages[messages.length - 1];
  const senderName = latest.senderName?.trim() || 'Someone';
  const email = newMessageTemplate({
    recipientName: due.name,
    messages: messages.map((message) => ({ senderName: message.senderName?.trim() || 'Someone', text: message.text ?? '' })),
    url: `${APP_URL}/u/${encodeURIComponent(latest.senderId ?? '')}/chat`,
    settingsUrl: `${APP_URL}/settings?tab=notifications`,
  });
  await executeSendEmail({ to: due.email, from: fromHeader(senderName), ...email });
}

let started = false;
let running = false;

async function tick(): Promise<void> {
  const redis = getRedisClient();
  const now = Date.now();
  const due = await redis.zrangebyscore(DUE_KEY, 0, now, 'LIMIT', 0, 100);
  for (const member of due) {
    const claimed = await redis.eval(CLAIM, 1, DUE_KEY, member, String(now));
    if (Number(claimed) !== 1) continue;
    try {
      await sendDue(member);
    } catch (error) {
      logger.error('Message email failed', {
        member,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Check every 10 seconds. A pass still running skips the next tick. */
export function startMessageEmails(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    if (running) return;
    running = true;
    void tick().catch((error: unknown) => {
      logger.error('Message email pass failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }).finally(() => {
      running = false;
    });
  }, TICK_MS).unref();
  logger.info('Message email scheduled (every 10 seconds, 1 minute after the last message)');
}
