/**
 * Injects new opportunity messages into users' XMTP home feeds
 * when an opportunity is created or sent between users.
 *
 * Replaces the previous Stream Chat injection.  Each actor in the opportunity
 * receives an `opportunity_update` structured message in their personal
 * home-feed group chat via the XMTP agent.
 */

import { eq } from 'drizzle-orm';
import type { Opportunity } from '../interfaces/database.interface';
import { sendOpportunityToHomeFeed } from '../../../agent/xmtp.agent';
import type { OpportunityUpdateContent } from '../../../agent/content-types';
import db from '../../../lib/drizzle/drizzle';
import { users } from '../../../schemas/database.schema';
import { protocolLogger } from './protocol.logger';

const logger = protocolLogger('OpportunityChatInjection');

/**
 * Get the two user IDs that define the actor pair for this opportunity.
 * Prefers non-introducer actors; if only one or zero, falls back to any two distinct actors.
 */
function getActorPairUserIds(opportunity: Opportunity): [string, string] | null {
  const nonIntroducers = opportunity.actors.filter((a) => a.role !== 'introducer');
  const ids = new Set<string>(
    (nonIntroducers.length >= 2 ? nonIntroducers : opportunity.actors).map((a) => a.userId)
  );
  const arr = [...ids];
  if (arr.length < 2) return null;
  return [arr[0], arr[1]];
}

/**
 * Send an opportunity update notification to both actors' XMTP home feeds.
 *
 * This replaces the previous Stream Chat channel injection.  Each actor receives
 * a structured `opportunity_update` message in their personal home-feed group
 * chat.  The function is fire-and-forget: failures are logged but never
 * propagated to the caller.
 *
 * @param opportunity - The opportunity to notify about.
 */
export async function injectOpportunityIntoExistingChat(
  opportunity: Opportunity,
): Promise<void> {
  const pair = getActorPairUserIds(opportunity);
  if (!pair) {
    logger.debug('[injectOpportunityIntoExistingChat] Opportunity has no pair of users; skipping', {
      opportunityId: opportunity.id,
    });
    return;
  }

  const reasoning = opportunity.interpretation?.reasoning ?? 'I found a new possible connection for you.';

  const updateContent: OpportunityUpdateContent = {
    type: 'opportunity_update',
    opportunityId: opportunity.id,
    headline: 'New possible connection',
    summary: reasoning,
  };

  // Send to both actors' home feeds
  for (const userId of pair) {
    try {
      const userRows = await db
        .select({ xmtpInboxId: users.xmtpInboxId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const inboxId = userRows[0]?.xmtpInboxId;
      if (!inboxId) {
        logger.debug('[injectOpportunityIntoExistingChat] No XMTP inbox ID for user; skipping', {
          userId,
          opportunityId: opportunity.id,
        });
        continue;
      }

      await sendOpportunityToHomeFeed(inboxId, updateContent);

      logger.info('[injectOpportunityIntoExistingChat] Sent opportunity update to XMTP home feed', {
        opportunityId: opportunity.id,
        userId,
      });
    } catch (error) {
      logger.warn('[injectOpportunityIntoExistingChat] Failed to send to XMTP home feed', {
        error,
        opportunityId: opportunity.id,
        userId,
      });
    }
  }
}
