import { setTimeout as sleep } from 'node:timers/promises';

import { and, eq, gt, isNull, or } from 'drizzle-orm';

import { createRedisClient } from '../../adapters/cache.adapter';
import { apikeys, oauthAccessTokens, oauthApplications, sessions } from '../../schemas/database.schema';
import db from '../drizzle/drizzle';
import { log } from '../log';
import { ackUserEvent, ensureUserEventGroup, readUserEventGroup, type UserEventRecord } from '../user-events';
import { WebhookUrlError, postWebhook } from '../webhook';

import { MCP_EVENTS_GROUP, deleteSubscription, listSubscribedUsers, listSubscriptions, matchesSubscription, signingSecrets, toMcpEvent, type EventFrame, type McpEvent, type McpEventSubscription } from './mcp.events';

const logger = log.server.from('McpEventDispatcher');

const BLOCK_MS = 5_000;
const RETRY_DELAYS_MS = [1_000, 5_000];

/** The credential that created the subscription still authenticates its owner. */
async function isCredentialLive({ userId, credential }: McpEventSubscription): Promise<boolean> {
  const now = new Date();
  const rows = credential.kind === 'api_key'
    ? await db.select({ id: apikeys.id }).from(apikeys).where(and(
      eq(apikeys.id, credential.id),
      eq(apikeys.referenceId, userId),
      eq(apikeys.enabled, true),
      or(isNull(apikeys.expiresAt), gt(apikeys.expiresAt, now)),
    )).limit(1)
    : credential.kind === 'oauth'
      ? await db.select({ id: oauthAccessTokens.id }).from(oauthAccessTokens)
        .innerJoin(oauthApplications, eq(oauthApplications.clientId, oauthAccessTokens.clientId))
        .where(and(
          eq(oauthAccessTokens.clientId, credential.id),
          eq(oauthAccessTokens.userId, userId),
          gt(oauthAccessTokens.refreshTokenExpiresAt, now),
          or(isNull(oauthApplications.disabled), eq(oauthApplications.disabled, false)),
        )).limit(1)
      : await db.select({ id: sessions.id }).from(sessions).where(and(
        eq(sessions.id, credential.id),
        eq(sessions.userId, userId),
        gt(sessions.expiresAt, now),
      )).limit(1);
  return rows.length > 0;
}

/** Deliver one event to one subscription with bounded retries. 410 removes the subscription; 413 is final. */
async function deliver(subscription: McpEventSubscription, event: McpEvent): Promise<void> {
  if (!(await isCredentialLive(subscription))) {
    await deleteSubscription(subscription.userId, subscription.id);
    return;
  }
  const body = JSON.stringify(event);
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await postWebhook({
        url: subscription.url,
        secrets: signingSecrets(subscription),
        id: event.eventId,
        subscriptionId: subscription.id,
        body,
      });
      if (response.ok || response.status === 413) return;
      if (response.status === 410) {
        await deleteSubscription(subscription.userId, subscription.id);
        return;
      }
    } catch (error) {
      if (error instanceof WebhookUrlError) return;
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      logger.warn('MCP event delivery failed', { subscriptionId: subscription.id, eventId: event.eventId });
      return;
    }
    await sleep(delay);
  }
}

/** Fan one stream record out to every subscription of its owner that matches it. */
export async function dispatchRecord(record: UserEventRecord): Promise<void> {
  let frame: EventFrame;
  try {
    frame = JSON.parse(record.data) as EventFrame;
  } catch {
    return;
  }
  const event = toMcpEvent(frame, record.id);
  if (!event) return;
  const subscriptions = (await listSubscriptions(record.userId)).filter((subscription) => matchesSubscription(subscription, event));
  await Promise.all(subscriptions.map((subscription) =>
    deliver(subscription, { eventId: `evt_${subscription.id.slice(4, 16)}_${record.id}`, ...event })));
}

/**
 * Pushes user events to MCP event subscriptions. Reads the `mcp-events`
 * consumer group of every user with a subscription, so each event is
 * delivered by exactly one process.
 */
export class McpEventDispatcher {
  private readonly joined = new Set<string>();
  private reader?: ReturnType<typeof createRedisClient>;
  private running = false;

  start(): void {
    this.running = true;
    this.reader = createRedisClient();
    void this.follow(this.reader);
  }

  stop(): void {
    this.running = false;
    this.reader?.disconnect();
    this.reader = undefined;
  }

  private async follow(reader: ReturnType<typeof createRedisClient>): Promise<void> {
    let from: '>' | '0' = '0';
    while (this.running) {
      try {
        const userIds = await listSubscribedUsers();
        if (!userIds.length) {
          await sleep(BLOCK_MS);
          continue;
        }
        for (const userId of userIds) {
          if (this.joined.has(userId)) continue;
          await ensureUserEventGroup(userId, MCP_EVENTS_GROUP);
          this.joined.add(userId);
        }

        const records = await readUserEventGroup(reader, {
          group: MCP_EVENTS_GROUP, consumer: MCP_EVENTS_GROUP, userIds, from, blockMs: BLOCK_MS,
        });
        from = '>';

        for (const record of records) {
          void dispatchRecord(record).catch((error: unknown) => {
            logger.error('MCP event dispatch failed', { error: error instanceof Error ? error.message : String(error) });
          });
          await ackUserEvent(MCP_EVENTS_GROUP, record);
        }
      } catch (error: unknown) {
        if (!this.running) return;
        logger.error('MCP event read failed', { error: error instanceof Error ? error.message : String(error) });
        this.joined.clear();
        from = '0';
        await sleep(BLOCK_MS);
      }
    }
  }
}
