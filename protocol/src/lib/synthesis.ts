import { vibeCheck, type VibeCheckOptions } from '../agents/external/vibe_checker';
import { introMaker, type IntroMakerData } from '../agents/external/intro_maker';
import { cache } from './redis';
import db from './db';
import { users as usersTable, intents, intentStakes, agents, intentIndexes } from './schema';
import { eq, isNull, and, sql, inArray } from 'drizzle-orm';
import crypto from 'crypto';
import { getAccessibleIntents } from './intent-access';

interface SynthesisOptions extends VibeCheckOptions {}

interface IntroOptions {}

function createCacheHash(data: any, options?: any): string {
  const hashData = { data, options: options || {} };
  const dataString = JSON.stringify(hashData);
  return crypto.createHash('sha256').update(dataString).digest('hex');
}

// Main synthesis function - analyzes how targetUser can help with contextUser's intents
export async function synthesizeVibeCheck(params: {
  targetUserId: string; // User being analyzed - their profile info will be used
  targetUserName?: string;
  contextUserId?: string; // User requesting analysis - their intents will be analyzed
  initiatorId?: string; // For 3rd person admin view - the person initiating connection
  intentIds?: string[]; // Specific context user's intents to focus on (if no contextUserId)
  indexIds?: string[]; // Index filtering for secure access
  options?: SynthesisOptions;
}): Promise<string> {
  try {
    const { targetUserId, contextUserId, initiatorId, intentIds, indexIds, options } = params;

    // Get target user info
    const userIds = initiatorId ? [targetUserId, initiatorId] : [targetUserId];
    const userRecords = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      intro: usersTable.intro
    })
    .from(usersTable)
    .where(inArray(usersTable.id, userIds));

    if (userRecords.length === 0) {
      return "";
    }

    const targetUser = userRecords.find(u => u.id === targetUserId);
    const initiatorUser = initiatorId ? userRecords.find(u => u.id === initiatorId) : undefined;
    
    if (!targetUser) {
      return "";
    }

    // Get context intents using secure generic function
    let contextIntentIds: string[] = [];
    if (contextUserId) {
      const contextIntentsResult = await getAccessibleIntents(contextUserId, {
        indexIds: indexIds,
        intentIds: intentIds,
        includeOwnIntents: true
      });
      contextIntentIds = contextIntentsResult.intents.map(i => i.id);
    } else if (intentIds) {
      // Even when intentIds are provided, we need to validate them through proper access control
      // This requires a contextUserId - without it, we can't validate access
      console.warn('Synthesis called with intentIds but no contextUserId - cannot validate access');
      return "";
    }

    if (contextIntentIds.length === 0) {
      return "";
    }

    // Ensure contextUserId is defined before proceeding
    if (!contextUserId) {
      console.warn('Synthesis called without contextUserId');
      return "";
    }

    // Get stakes data - find stakes that connect context user's intents with target user's intents
    // Filter to only include intents that exist in the specified indexes
    const stakes = await db.select({
      stake: intentStakes.stake,
      reasoning: intentStakes.reasoning,
      stakeIntents: intentStakes.intents,
      agentName: agents.name,
      agentAvatar: agents.avatar,
      intentId: intents.id,
      intentSummary: intents.summary,
      intentPayload: intents.payload
    })
    .from(intentStakes)
    .innerJoin(agents, eq(intentStakes.agentId, agents.id))
    .innerJoin(intents, sql`${intents.id}::text = ANY(${intentStakes.intents})`)
    .where(and(
      isNull(agents.deletedAt),
      eq(intents.userId, contextUserId), // Context user's intents (authenticated user)
      sql`array_length(${intentStakes.intents}, 1) > 1`, // Exclude single-intent confidence stakes
      sql`EXISTS(
        SELECT 1 FROM unnest(${intentStakes.intents}) AS intent_id
        WHERE intent_id IN (${sql.join(contextIntentIds.map(id => sql`${id}`), sql`, `)})
      )`,
      // Stakes must also include at least one intent OWNED by target user
      sql`EXISTS(
        SELECT 1 FROM ${intents} i2
        WHERE i2.id::text = ANY(${intentStakes.intents})
        AND i2.user_id = ${targetUserId}
      )`,
      // Filter: both context and target intents must exist in the specified indexes
      ...(indexIds && indexIds.length > 0 ? [sql`EXISTS(
        SELECT 1 FROM ${intentIndexes} ii1
        WHERE ii1.intent_id = ${intents.id}
        AND ii1.index_id IN (${sql.join(indexIds.map(id => sql`${id}`), sql`, `)})
      )`,
      sql`EXISTS(
        SELECT 1 FROM ${intents} i2
        INNER JOIN ${intentIndexes} ii2 ON ii2.intent_id = i2.id
        WHERE i2.id::text = ANY(${intentStakes.intents})
        AND i2.user_id = ${targetUserId}
        AND ii2.index_id IN (${sql.join(indexIds.map(id => sql`${id}`), sql`, `)})
      )`] : [])
    ))
    .orderBy(sql`${intentStakes.stake} DESC`)
    .limit(3);

    if (stakes.length === 0) {
      return "";
    }

    
    // Group by intent and keep only the most valuable reason (highest stake)
    const intentGroups = new Map();
    stakes.forEach(stake => {
      if (!intentGroups.has(stake.intentId)) {
        intentGroups.set(stake.intentId, {
          id: stake.intentId,
          summary: stake.intentSummary,
          payload: stake.intentPayload,
          most_valuable_reason: {
            agent_name: stake.agentName,
            agent_id: stake.agentName,
            reasoning: stake.reasoning,
            stake: Number(stake.stake)
          }
        });
      } else {
        // Update if this stake is higher
        const current = intentGroups.get(stake.intentId).most_valuable_reason;
        if (Number(stake.stake) > current.stake) {
          intentGroups.get(stake.intentId).most_valuable_reason = {
            agent_name: stake.agentName,
            agent_id: stake.agentName,
            reasoning: stake.reasoning,
            stake: Number(stake.stake)
          };
        }
      }
    });

    // Prepare data for vibe checker - target user info with context user's intents
    const userData = {
      id: targetUser.id,
      name: targetUser.name,
      intro: targetUser.intro || "",
      intents: Array.from(intentGroups.values()),
      initiatorName: initiatorUser?.name
    };

    // Check cache (include initiatorId in cache key for proper segmentation)
    const hashKey = 'synthesis';
    const cacheData = initiatorId ? { ...userData, initiatorId } : userData;
    const fieldKey = createCacheHash(cacheData, options);
    const cachedResult = await cache.hget(hashKey, fieldKey);
    
    if (cachedResult) {
      return cachedResult;
    }

    // Generate synthesis
    const vibeResult = await vibeCheck(userData, options);
    
    if (vibeResult.success && vibeResult.synthesis) {
      await cache.hset(hashKey, fieldKey, vibeResult.synthesis);
      return vibeResult.synthesis;
    }

    return "";
    
  } catch (error) {
    console.error('Synthesis error:', error);
    return "";
  }
}

// Intro synthesis function - handles all data preparation internally
export async function synthesizeIntro(params: {
  senderUserId: string;
  recipientUserId: string;
  indexIds?: string[]; // Index filtering for secure access
  options?: IntroOptions;
}): Promise<string> {
  try {
    const { senderUserId, recipientUserId, indexIds } = params;

    // Get users
    const userRecords = await db.select({
      id: usersTable.id,
      name: usersTable.name
    })
    .from(usersTable)
    .where(inArray(usersTable.id, [senderUserId, recipientUserId]));

    if (userRecords.length !== 2) {
      return "";
    }

    const senderUser = userRecords.find(u => u.id === senderUserId);
    const recipientUser = userRecords.find(u => u.id === recipientUserId);

    // Get shared stakes - stakes must include intents OWNED by both users
    const sharedStakes = await db.select({
      reasoning: intentStakes.reasoning,
      stakeIntents: intentStakes.intents
    })
    .from(intentStakes)
    .innerJoin(agents, eq(intentStakes.agentId, agents.id))
    .where(and(
      isNull(agents.deletedAt),
      sql`array_length(${intentStakes.intents}, 1) > 1`, // Exclude single-intent confidence stakes
      sql`EXISTS(
        SELECT 1 FROM ${intents} i1
        WHERE i1.id::text = ANY(${intentStakes.intents})
        AND i1.user_id = ${senderUserId}
      )`,
      sql`EXISTS(
        SELECT 1 FROM ${intents} i2
        WHERE i2.id::text = ANY(${intentStakes.intents})
        AND i2.user_id = ${recipientUserId}
      )`
    ));

    console.log('Shared stakes:', sharedStakes);

    // Get intent IDs for both users to group reasonings
    const senderIntentIds = await db.select({ id: intents.id })
      .from(intents)
      .where(eq(intents.userId, senderUserId))
      .then(rows => rows.map(r => r.id));
    
    const recipientIntentIds = await db.select({ id: intents.id })
      .from(intents)
      .where(eq(intents.userId, recipientUserId))
      .then(rows => rows.map(r => r.id));

    const senderReasonings: string[] = [];
    const recipientReasonings: string[] = [];

    sharedStakes.forEach(stake => {
      const hasSenderIntent = stake.stakeIntents.some(id => senderIntentIds.includes(id));
      const hasRecipientIntent = stake.stakeIntents.some(id => recipientIntentIds.includes(id));
      
      if (hasSenderIntent) senderReasonings.push(stake.reasoning);
      if (hasRecipientIntent) recipientReasonings.push(stake.reasoning);
    });

    if (senderReasonings.length === 0 || recipientReasonings.length === 0) {
      return "";
    }

    const introData: IntroMakerData = {
      sender: {
        id: senderUser!.id,
        userName: senderUser!.name,
        reasonings: senderReasonings
      },
      recipient: {
        id: recipientUser!.id,
        userName: recipientUser!.name,
        reasonings: recipientReasonings
      }
    };

    console.log('Intro data:', introData);

    const result = await introMaker(introData);
    return result.success && result.synthesis ? result.synthesis : "";
    
  } catch (error) {
    console.error('Intro synthesis error:', error);
    return "";
  }
}
