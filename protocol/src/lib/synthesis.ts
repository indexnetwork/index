import { vibeCheck, type VibeCheckOptions } from '../agents/external/vibe_checker';
import { introMaker, type IntroMakerData } from '../agents/external/intro_maker';
import { cache } from './redis';
import db from './db';
import { users as usersTable, intents, intentStakes, agents, intentIndexes } from './schema';
import { eq, isNull, and, sql, inArray } from 'drizzle-orm';
import crypto from 'crypto';
import { getAccessibleIntents } from './intent-access';

interface SynthesisOptions extends VibeCheckOptions {}

function createCacheHash(data: any, options?: any): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ data, options: options || {} }))
    .digest('hex');
}

// Main synthesis function - analyzes how targetUser can help with contextUser's intents
export async function synthesizeVibeCheck(
  contextUserId: string,
  targetUserId: string,
  opts?: {
    initiatorId?: string;
    intentIds?: string[];
    indexIds?: string[];
    vibeOptions?: SynthesisOptions;
  }
): Promise<string> {
  try {
    const { initiatorId, intentIds, indexIds, vibeOptions } = opts || {};

    // Get target user info
    const userIds = initiatorId ? [targetUserId, initiatorId] : [targetUserId];
    const users = await db
      .select({ id: usersTable.id, name: usersTable.name, intro: usersTable.intro })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds));

    if (!users.length) return "";

    const targetUser = users.find(u => u.id === targetUserId);
    const initiatorUser = initiatorId ? users.find(u => u.id === initiatorId) : undefined;
    
    if (!targetUser) return "";

    // Get context intents using secure access control
    const contextIntents = await getAccessibleIntents(contextUserId, {
      indexIds,
      intentIds,
      includeOwnIntents: true
    });

    
    const contextIntentIds = contextIntents.intents.map(i => i.id);
    
    if (!contextIntentIds.length) return "";

    // Get top 3 stakes connecting context and target user intents
    // Optimized: use uuid[] instead of text[], leverage GIN index, remove redundant checks
    const stakes = await db
      .select({ stake: intentStakes.stake, stakeIntents: intentStakes.intents })
      .from(intentStakes)
      .innerJoin(agents, eq(intentStakes.agentId, agents.id))
      .innerJoin(intents, sql`${intents.id} = ANY(${intentStakes.intents})`)
      .where(and(
        isNull(agents.deletedAt),
        eq(intents.userId, contextUserId),
        sql`array_length(${intentStakes.intents}, 1) = 2`,
        sql`${intentStakes.intents} && ARRAY[${sql.join(contextIntentIds.map(id => sql`${id}::uuid`), sql`, `)}]::uuid[]`,
        sql`EXISTS(
          SELECT 1 FROM ${intents} i2
          WHERE i2.id = ANY(${intentStakes.intents})
          AND i2.user_id = ${targetUserId}
        )`,
        ...(indexIds?.length ? [
          sql`EXISTS(
            SELECT 1 FROM ${intentIndexes} ii1
            WHERE ii1.intent_id = ${intents.id}
            AND ii1.index_id = ANY(ARRAY[${sql.join(indexIds.map(id => sql`${id}::uuid`), sql`, `)}]::uuid[])
          )`,
          sql`EXISTS(
            SELECT 1 FROM ${intents} i2
            INNER JOIN ${intentIndexes} ii2 ON ii2.intent_id = i2.id
            WHERE i2.id = ANY(${intentStakes.intents})
            AND i2.user_id = ${targetUserId}
            AND ii2.index_id = ANY(ARRAY[${sql.join(indexIds.map(id => sql`${id}::uuid`), sql`, `)}]::uuid[])
          )`
        ] : [])
      ))
      .orderBy(sql`${intentStakes.stake} DESC`)
      .limit(3);

    if (!stakes.length) return "";

    // Fetch intent details and build pairs
    const allIntentIds = stakes.flatMap(s => s.stakeIntents);
    const intentDetails = await db
      .select({ id: intents.id, payload: intents.payload, userId: intents.userId, createdAt: intents.createdAt })
      .from(intents)
      .where(inArray(intents.id, allIntentIds));

    type IntentPair = {
      stake: number;
      contextUserIntent: { id: string; payload: string; createdAt: Date };
      targetUserIntent: { id: string; payload: string; createdAt: Date };
    };

    const intentPairs = stakes
      .map(stake => {
        const [id1, id2] = stake.stakeIntents;
        const intent1 = intentDetails.find(i => i.id === id1);
        const intent2 = intentDetails.find(i => i.id === id2);
        
        const contextIntent = intent1?.userId === contextUserId ? intent1 : intent2;
        const targetIntent = intent1?.userId === targetUserId ? intent1 : intent2;
        
        if (!contextIntent || !targetIntent) return null;
        
        return {
          stake: Number(stake.stake),
          contextUserIntent: {
            id: contextIntent.id,
            payload: contextIntent.payload,
            createdAt: contextIntent.createdAt
          },
          targetUserIntent: {
            id: targetIntent.id,
            payload: targetIntent.payload,
            createdAt: targetIntent.createdAt
          }
        };
      })
      .filter((p): p is IntentPair => p !== null);

    // Prepare vibe check data
    const vibeData = {
      id: targetUser.id,
      name: targetUser.name,
      intro: targetUser.intro || "",
      intentPairs,
      initiatorName: initiatorUser?.name
    };

    // Check cache
    const cacheData = initiatorId ? { ...vibeData, initiatorId } : vibeData;
    const cacheKey = createCacheHash(cacheData, vibeOptions);
    const cached = await cache.hget('synthesis', cacheKey);
    if (cached) return cached;

    // Generate synthesis
    const result = await vibeCheck(vibeData, vibeOptions);
    
    if (result.success && result.synthesis) {
      await cache.hset('synthesis', cacheKey, result.synthesis);
      return result.synthesis;
    }

    return "";
  } catch (error) {
    console.error('Synthesis error:', error);
    return "";
  }
}

// Intro synthesis function - handles all data preparation internally
export async function synthesizeIntro(
  senderUserId: string,
  recipientUserId: string,
  indexIds?: string[]
): Promise<string> {
  try {
    // Get users
    const users = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(inArray(usersTable.id, [senderUserId, recipientUserId]));

    if (users.length !== 2) return "";

    const sender = users.find(u => u.id === senderUserId)!;
    const recipient = users.find(u => u.id === recipientUserId)!;

    // Get shared stakes between both users
    // Optimized: use uuid[] instead of text[], leverage GIN index
    const stakes = await db
      .select({ reasoning: intentStakes.reasoning, stakeIntents: intentStakes.intents })
      .from(intentStakes)
      .innerJoin(agents, eq(intentStakes.agentId, agents.id))
      .where(and(
        isNull(agents.deletedAt),
        sql`array_length(${intentStakes.intents}, 1) > 1`,
        sql`EXISTS(SELECT 1 FROM ${intents} i1 WHERE i1.id = ANY(${intentStakes.intents}) AND i1.user_id = ${senderUserId})`,
        sql`EXISTS(SELECT 1 FROM ${intents} i2 WHERE i2.id = ANY(${intentStakes.intents}) AND i2.user_id = ${recipientUserId})`
      ));

    if (!stakes.length) return "";

    // Get intent IDs for both users
    const [senderIntentIds, recipientIntentIds] = await Promise.all([
      db.select({ id: intents.id }).from(intents).where(eq(intents.userId, senderUserId)).then(r => r.map(i => i.id)),
      db.select({ id: intents.id }).from(intents).where(eq(intents.userId, recipientUserId)).then(r => r.map(i => i.id))
    ]);

    // Group reasonings by user
    const senderReasonings: string[] = [];
    const recipientReasonings: string[] = [];

    stakes.forEach(stake => {
      if (stake.stakeIntents.some(id => senderIntentIds.includes(id))) {
        senderReasonings.push(stake.reasoning);
      }
      if (stake.stakeIntents.some(id => recipientIntentIds.includes(id))) {
        recipientReasonings.push(stake.reasoning);
      }
    });

    if (!senderReasonings.length || !recipientReasonings.length) return "";

    const introData: IntroMakerData = {
      sender: { id: sender.id, userName: sender.name, reasonings: senderReasonings },
      recipient: { id: recipient.id, userName: recipient.name, reasonings: recipientReasonings }
    };

    const result = await introMaker(introData);
    return result.success && result.synthesis ? result.synthesis : "";
    
  } catch (error) {
    console.error('Intro synthesis error:', error);
    return "";
  }
}
