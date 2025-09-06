import { vibeCheck, type VibeCheckOptions } from '../agents/external/vibe_checker';
import { introMaker, type IntroMakerData } from '../agents/external/intro_maker';
import { cache } from './redis';
import db from './db';
import { users as usersTable, intents, intentStakes, agents } from './schema';
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
  intentIds?: string[]; // Specific context user's intents to focus on (if no contextUserId)
  indexIds?: string[]; // Index filtering for secure access
  userIds?: string[]; // external user-ids filter (for vibecheck)
  offset?: number; // pagination offset
  limit?: number; // pagination limit
  options?: SynthesisOptions;
}): Promise<{
  synthesis: string;
  total: number;
  offset: number;
  limit: number;
}> {
  const { targetUserId, contextUserId, intentIds, indexIds, userIds, offset = 0, limit = 20, options } = params;
  
  try {
    // Get target user info
    const targetUser = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      intro: usersTable.intro
    })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId))
    .limit(1);

    if (targetUser.length === 0) {
      return {
        synthesis: "",
        total: 0,
        offset,
        limit
      };
    }

    const user = targetUser[0];

    // Get context intents using secure generic function
    let contextIntentIds: string[] = [];
    if (contextUserId) {
      const contextIntentsResult = await getAccessibleIntents(contextUserId, {
        indexIds: indexIds,
        intentIds: intentIds,
        userIds: userIds,
        includeOwnIntents: true
      });
      contextIntentIds = contextIntentsResult.intents.map(i => i.id);
    } else if (intentIds) {
      // Even when intentIds are provided, we need to validate them through proper access control
      // This requires a contextUserId - without it, we can't validate access
      console.warn('Synthesis called with intentIds but no contextUserId - cannot validate access');
      return { synthesis: "", total: 0, offset, limit };
    }

    if (contextIntentIds.length === 0) {
      return { synthesis: "", total: 0, offset, limit };
    }

    // Get target user's intents using secure generic function
    const targetIntentsResult = await getAccessibleIntents(targetUserId, {
      indexIds: indexIds,
      userIds: userIds,
      includeOwnIntents: true
    });
    const targetIntentIds = targetIntentsResult.intents.map(i => i.id);

    // Get stakes data - find stakes that connect context user's intents with target user's intents
    // First get total count for pagination
    const countResult = await db.select({ 
      count: sql<number>`count(*)`.mapWith(Number) 
    })
    .from(intentStakes)
    .innerJoin(agents, eq(intentStakes.agentId, agents.id))
    .innerJoin(intents, sql`${intents.id}::text = ANY(${intentStakes.intents})`)
    .where(and(
      isNull(agents.deletedAt),
      eq(intents.userId, contextUserId || targetUserId), // Context user's intents
      inArray(intents.id, contextIntentIds),
      // Stakes must also include at least one intent from target user
      targetIntentIds.length > 0 ? sql`EXISTS(
        SELECT 1 FROM unnest(${intentStakes.intents}) AS intent_id
        WHERE intent_id IN (${sql.join(targetIntentIds.map(id => sql`${id}`), sql`, `)})
      )` : sql`1=1`
    ));

    const totalCount = countResult[0]?.count || 0;

    if (totalCount === 0) {
      return { synthesis: "", total: 0, offset, limit };
    }

    // Add pagination to stakes query
    const paginatedStakes = await db.select({
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
      eq(intents.userId, contextUserId || targetUserId), // Context user's intents
      inArray(intents.id, contextIntentIds),
      // Stakes must also include at least one intent from target user
      targetIntentIds.length > 0 ? sql`EXISTS(
        SELECT 1 FROM unnest(${intentStakes.intents}) AS intent_id
        WHERE intent_id IN (${sql.join(targetIntentIds.map(id => sql`${id}`), sql`, `)})
      )` : sql`1=1`
    ))
    .offset(offset)
    .limit(limit);

    if (paginatedStakes.length === 0) {
      return { synthesis: "", total: totalCount, offset, limit };
    }

    // Group by intent
    const intentGroups = new Map();
    paginatedStakes.forEach(stake => {
      if (!intentGroups.has(stake.intentId)) {
        intentGroups.set(stake.intentId, {
          id: stake.intentId,
          summary: stake.intentSummary,
          payload: stake.intentPayload,
          reasons: []
        });
      }
      intentGroups.get(stake.intentId).reasons.push({
        agent_name: stake.agentName,
        agent_id: stake.agentName,
        reasoning: stake.reasoning
      });
    });

    // Prepare data for vibe checker - target user info with context user's intents
    const userData = {
      id: user.id,
      name: user.name,
      intro: user.intro || "",
      intents: Array.from(intentGroups.values())
    };

    // Check cache
    const hashKey = 'synthesis';
    const fieldKey = createCacheHash(userData, options);
    const cachedResult = await cache.hget(hashKey, fieldKey);
    
    if (cachedResult) {
      return {
        synthesis: cachedResult,
        total: totalCount,
        offset,
        limit
      };
    }

    // Generate synthesis
    const vibeResult = await vibeCheck(userData, options);
    
    if (vibeResult.success && vibeResult.synthesis) {
      await cache.hset(hashKey, fieldKey, vibeResult.synthesis);
      return {
        synthesis: vibeResult.synthesis,
        total: totalCount,
        offset,
        limit
      };
    }

    return {
      synthesis: "",
      total: totalCount,
      offset,
      limit
    };
    
  } catch (error) {
    console.error('Synthesis error:', error);
    return {
      synthesis: "",
      total: 0,
      offset,
      limit
    };
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

    // Get intents for both users using secure generic function
    const [senderIntentsResult, recipientIntentsResult] = await Promise.all([
      getAccessibleIntents(senderUserId, { indexIds, includeOwnIntents: true }),
      getAccessibleIntents(recipientUserId, { indexIds, includeOwnIntents: true })
    ]);

    const senderIntentIds = senderIntentsResult.intents.map(i => i.id);
    const recipientIntentIds = recipientIntentsResult.intents.map(i => i.id);

    if (senderIntentIds.length === 0 || recipientIntentIds.length === 0) {
      return "";
    }

    // Get shared stakes
    const sharedStakes = await db.select({
      reasoning: intentStakes.reasoning,
      stakeIntents: intentStakes.intents
    })
    .from(intentStakes)
    .innerJoin(agents, eq(intentStakes.agentId, agents.id))
    .where(and(
      isNull(agents.deletedAt),
      sql`EXISTS(
        SELECT 1 FROM unnest(${intentStakes.intents}) AS intent_id
        WHERE intent_id IN (${sql.join(senderIntentIds.map(id => sql`${id}`), sql`, `)})
      )`,
      sql`EXISTS(
        SELECT 1 FROM unnest(${intentStakes.intents}) AS intent_id
        WHERE intent_id IN (${sql.join(recipientIntentIds.map(id => sql`${id}`), sql`, `)})
      )`
    ));

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
