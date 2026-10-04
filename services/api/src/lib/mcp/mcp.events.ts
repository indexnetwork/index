import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { type McpServer, ProtocolError, ProtocolErrorCode, type ServerCapabilities } from '@modelcontextprotocol/server';
import { z } from 'zod-v4';

import { getRedisClient } from '../../adapters/cache.adapter';
import { appLink } from '../app-link';
import { ensureUserEventGroup, skipUserEventGroupToTail } from '../user-events';
import { WebhookUrlError, postWebhook } from '../webhook';

import type { McpCredential, McpPrincipal } from './mcp.types';

/** Consumer group the dispatcher reads every subscribed user's stream with. */
export const MCP_EVENTS_GROUP = 'mcp-events';

/** Longest lifetime granted; matches the stream's 7-day retention. */
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_TTL_MS = 60 * 60 * 1000;
const ROTATION_MS = 24 * 60 * 60 * 1000;
const VERIFIED_TTL_S = 24 * 60 * 60;
const CALLBACK_ENDPOINT_ERROR = -32015;

/** A frame as stored on a user's event stream. */
export interface EventFrame {
  type?: string;
  title?: string;
  body?: string;
  at?: string;
  data?: Record<string, unknown>;
}

interface EventDefinition {
  description: string;
  args: z.ZodObject;
  payload: z.ZodObject;
  toPayload(frame: EventFrame): Record<string, unknown>;
}

const intentFilter = z.string().optional().describe('Only events for this signal (UUID).');

/**
 * Events ChatGPT can subscribe to. Payloads are pointers plus server-written
 * copy; the agent reads full records through the tools. `message` and
 * `principal.input` are left out because they carry user-written text.
 */
export const MCP_EVENT_CATALOG: Record<string, EventDefinition> = {
  'opportunity.new': {
    description: 'Index has a new opportunity (a possible introduction) waiting on the owner. Read it with get_opportunity, then accept or pass only after asking the owner.',
    args: z.object({ intentId: intentFilter }).strict(),
    payload: z.object({
      opportunityId: z.string(),
      intentId: z.string().nullable(),
      headline: z.string(),
      url: z.string(),
    }).strict(),
    toPayload: ({ title, data = {} }) => ({
      opportunityId: String(data.opportunityId),
      intentId: (data.intentId as string | null | undefined) ?? null,
      headline: title ?? '',
      url: appLink('o', String(data.opportunityId)),
    }),
  },
  'opportunity.status': {
    description: 'An opportunity the owner is part of changed status: negotiating, pending (waiting on the owner), accepted, rejected, or expired.',
    args: z.object({
      intentId: intentFilter,
      status: z.enum(['negotiating', 'pending', 'accepted', 'rejected', 'expired']).optional().describe('Only this status.'),
    }).strict(),
    payload: z.object({
      opportunityId: z.string(),
      intentId: z.string().nullable(),
      status: z.string(),
      url: z.string(),
    }).strict(),
    toPayload: ({ data = {} }) => ({
      opportunityId: String(data.opportunityId),
      intentId: (data.intentId as string | null | undefined) ?? null,
      status: String(data.status),
      url: appLink('o', String(data.opportunityId)),
    }),
  },
  'negotiation.turn': {
    description: 'The owner\'s negotiator owes the next turn, or the turn limit paused the negotiation. Read it with get_opportunity. The turn message is not included.',
    args: z.object({ intentId: intentFilter }).strict(),
    payload: z.object({
      opportunityId: z.string(),
      intentId: z.string().nullable(),
      turnIndex: z.number(),
      summary: z.string(),
      url: z.string(),
    }).strict(),
    toPayload: ({ body, data = {} }) => ({
      opportunityId: String(data.opportunityId),
      intentId: (data.intentId as string | null | undefined) ?? null,
      turnIndex: Number(data.turnIndex),
      summary: body ?? '',
      url: appLink('o', String(data.opportunityId)),
    }),
  },
  'question.pending': {
    description: 'The owner\'s Index agent stopped on a question only the owner can answer. Relay it to the owner and link them to the signal.',
    args: z.object({ intentId: intentFilter }).strict(),
    payload: z.object({
      intentId: z.string(),
      questionId: z.string(),
      opportunityId: z.string().nullable(),
      question: z.string(),
      url: z.string(),
    }).strict(),
    toPayload: ({ body, data = {} }) => ({
      intentId: String(data.intentId),
      questionId: String(data.questionId),
      opportunityId: (data.opportunityId as string | null | undefined) ?? null,
      question: body ?? '',
      url: appLink('i', String(data.intentId)),
    }),
  },
};

export interface McpEventSubscription {
  id: string;
  userId: string;
  credential: McpCredential;
  name: string;
  arguments: Record<string, unknown>;
  url: string;
  secret: string;
  previousSecret?: string;
  rotatedAt?: number;
  expiresAt: number;
}

/** An event body as POSTed to a callback. */
export interface McpEvent {
  eventId: string;
  name: string;
  timestamp: string;
  data: Record<string, unknown>;
  cursor: null;
}

/** Subscription identity: owner, callback, event, and canonical arguments. */
export function subscriptionId(userId: string, url: string, name: string, args: Record<string, unknown>): string {
  const canonical = Object.keys(args).sort().filter((key) => args[key] !== undefined).map((key) => [key, args[key]]);
  return `sub_${createHash('sha256').update(JSON.stringify([userId, url, name, canonical])).digest('hex').slice(0, 32)}`;
}

/** `whsec_` followed by base64 that decodes to 24-64 bytes. */
export function isSigningSecret(secret: string): boolean {
  if (!secret.startsWith('whsec_')) return false;
  const encoded = secret.slice('whsec_'.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const length = Buffer.from(encoded, 'base64').length;
  return length >= 24 && length <= 64;
}

/** Secrets to sign with: the current one, plus the replaced one during its rotation window. */
export function signingSecrets(subscription: McpEventSubscription, now = Date.now()): string[] {
  return subscription.previousSecret && subscription.rotatedAt && now - subscription.rotatedAt < ROTATION_MS
    ? [subscription.secret, subscription.previousSecret]
    : [subscription.secret];
}

/** Map a stream frame to the event a subscription would receive, or null when no event covers it. */
export function toMcpEvent(frame: EventFrame, streamId: string): Omit<McpEvent, 'eventId'> | null {
  const definition = frame.type ? MCP_EVENT_CATALOG[frame.type] : undefined;
  if (!frame.type || !definition) return null;
  return {
    name: frame.type,
    timestamp: frame.at ?? new Date(Number(streamId.split('-')[0])).toISOString(),
    data: definition.toPayload(frame),
    cursor: null,
  };
}

/** Every filter the subscription set must equal the payload field of the same name. */
export function matchesSubscription(subscription: McpEventSubscription, event: Pick<McpEvent, 'name' | 'data'>): boolean {
  return subscription.name === event.name
    && Object.entries(subscription.arguments).every(([key, value]) => value === undefined || event.data[key] === value);
}

const subscriptionKey = (id: string) => `mcp:sub:${id}`;
const USER_SUBSCRIPTIONS_PREFIX = 'mcp:subs:user:';

async function saveSubscription(subscription: McpEventSubscription): Promise<void> {
  await getRedisClient().multi()
    .set(subscriptionKey(subscription.id), JSON.stringify(subscription), 'PXAT', subscription.expiresAt)
    .sadd(`${USER_SUBSCRIPTIONS_PREFIX}${subscription.userId}`, subscription.id)
    .exec();
}

export async function deleteSubscription(userId: string, id: string): Promise<void> {
  await getRedisClient().multi()
    .del(subscriptionKey(id))
    .srem(`${USER_SUBSCRIPTIONS_PREFIX}${userId}`, id)
    .exec();
}

/** A user's live subscriptions. Ids whose subscription expired are pruned. */
export async function listSubscriptions(userId: string): Promise<McpEventSubscription[]> {
  const redis = getRedisClient();
  const setKey = `${USER_SUBSCRIPTIONS_PREFIX}${userId}`;
  const ids = await redis.smembers(setKey);
  if (!ids.length) return [];
  const values = await redis.mget(...ids.map(subscriptionKey));
  const expired = ids.filter((_, index) => values[index] === null);
  if (expired.length) await redis.srem(setKey, ...expired);
  return values.flatMap((value) => (value ? [JSON.parse(value) as McpEventSubscription] : []));
}

/** Users that have, or recently had, a subscription. An emptied set disappears with its last member. */
export async function listSubscribedUsers(): Promise<string[]> {
  const redis = getRedisClient();
  const userIds: string[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${USER_SUBSCRIPTIONS_PREFIX}*`, 'COUNT', 500);
    cursor = next;
    for (const key of keys) userIds.push(key.slice(USER_SUBSCRIPTIONS_PREFIX.length));
  } while (cursor !== '0');
  return userIds;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Prove the callback holds the secret before any application data reaches it. Cached per owner and URL. */
async function verifyCallback(userId: string, id: string, url: string, secret: string): Promise<void> {
  const redis = getRedisClient();
  const cacheKey = `mcp:verified:${createHash('sha256').update(`${userId}\n${url}`).digest('hex')}`;
  if (await redis.exists(cacheKey)) return;

  const challenge = randomBytes(24).toString('base64url');
  let reason = 'challenge_failed';
  try {
    const response = await postWebhook({
      url,
      secrets: [secret],
      id: `msg_verification_${randomBytes(12).toString('hex')}`,
      subscriptionId: id,
      body: JSON.stringify({ type: 'verification', challenge }),
    });
    if (!response.ok) {
      reason = 'http_error';
    } else {
      const echoed = ((await response.json().catch(() => null)) as { challenge?: unknown } | null)?.challenge;
      if (typeof echoed === 'string' && sameText(echoed, challenge)) {
        await redis.set(cacheKey, '1', 'EX', VERIFIED_TTL_S);
        return;
      }
    }
  } catch (error) {
    reason = error instanceof WebhookUrlError
      ? 'invalid_url'
      : error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unreachable';
  }
  throw new ProtocolError(CALLBACK_ENDPOINT_ERROR, 'Callback verification failed', { reason });
}

function parseArguments(name: string, args: unknown): Record<string, unknown> {
  const definition = MCP_EVENT_CATALOG[name];
  if (!definition) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown event: ${name}`);
  const parsed = definition.args.safeParse(args ?? {});
  if (!parsed.success) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Invalid arguments for ${name}`, { issues: parsed.error.issues });
  return parsed.data;
}

const argumentsSchema = z.record(z.string(), z.unknown()).nullish();

/** Serve `events/list`, `events/subscribe`, and `events/unsubscribe` for this owner. */
export function registerMcpEvents(server: McpServer, principal: McpPrincipal): void {
  server.server.registerCapabilities({ events: {} } as ServerCapabilities);

  server.server.setRequestHandler('events/list', { params: z.unknown() }, () => ({
    events: Object.entries(MCP_EVENT_CATALOG).map(([name, definition]) => ({
      name,
      description: definition.description,
      delivery: ['webhook'],
      inputSchema: z.toJSONSchema(definition.args),
      payloadSchema: z.toJSONSchema(definition.payload),
    })),
  }));

  server.server.setRequestHandler('events/subscribe', {
    params: z.object({
      name: z.string(),
      arguments: argumentsSchema,
      delivery: z.object({ mode: z.literal('webhook'), url: z.string(), secret: z.string() }),
      ttlMs: z.number().nullish(),
    }),
  }, async ({ name, arguments: rawArguments, delivery, ttlMs }) => {
    const { credential } = principal;
    if (!credential) {
      throw new ProtocolError(ProtocolErrorCode.InvalidRequest, 'Event subscriptions need an OAuth, API key, or device session credential.');
    }
    const args = parseArguments(name, rawArguments);
    if (!isSigningSecret(delivery.secret)) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'delivery.secret must be whsec_ followed by 24-64 base64-encoded bytes.');
    }

    const { userId } = principal;
    const id = subscriptionId(userId, delivery.url, name, args);
    await verifyCallback(userId, id, delivery.url, delivery.secret);

    const current = await listSubscriptions(userId);
    if (!current.length) {
      await ensureUserEventGroup(userId, MCP_EVENTS_GROUP);
      await skipUserEventGroupToTail(userId, MCP_EVENTS_GROUP);
    }
    const previous = current.find((subscription) => subscription.id === id);
    const rotation = previous && previous.secret !== delivery.secret
      ? { previousSecret: previous.secret, rotatedAt: Date.now() }
      : { previousSecret: previous?.previousSecret, rotatedAt: previous?.rotatedAt };
    const expiresAt = Date.now() + Math.min(Math.max(ttlMs ?? MAX_TTL_MS, MIN_TTL_MS), MAX_TTL_MS);

    await saveSubscription({ id, userId, credential, name, arguments: args, url: delivery.url, secret: delivery.secret, ...rotation, expiresAt });
    return { id, refreshBefore: new Date(expiresAt).toISOString(), cursor: null, truncated: false };
  });

  server.server.setRequestHandler('events/unsubscribe', {
    params: z.object({
      name: z.string(),
      arguments: argumentsSchema,
      delivery: z.object({ url: z.string() }),
    }),
  }, async ({ name, arguments: rawArguments, delivery }) => {
    if (MCP_EVENT_CATALOG[name]) {
      await deleteSubscription(principal.userId, subscriptionId(principal.userId, delivery.url, name, parseArguments(name, rawArguments)));
    }
    return {};
  });
}
